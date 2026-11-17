import type { ImportBatch, ImportedEvent, ImportedMessage } from '@/domain/import/batch';
import { contactIdForMail } from '@/domain/import/mail';
import { classifyBankTx, linkBankReturns, normalizeIban } from '@/domain/matching/payments';
import { matchMessage } from '@/domain/matching/messages';
import { upsertImported } from '@/domain/matching/imports';
import type { AppState, CalendarEvent, Contact, ExternalRef, Invoice, Message, OrderConfirmation, Payment, Subscription } from '@/domain/types';

export interface MergeAdded { contacts: number; invoices: number; payments: number; subscriptions: number; messages: number; events: number }

const refKey = (r: ExternalRef) => `${r.connectionId}:${r.externalId}`;

/**
 * Führt einen Import-Stapel in den Zustand zusammen. Idempotent; Bestätigtes (Verträge, `contractId`,
 * Bestätigungswerte, erledigte Rechnungen) wird nie überschrieben. Verträge fasst der Import gar nicht an.
 */
export function mergeBatch(s: AppState, b: ImportBatch, newId: () => string): { state: AppState; added: MergeAdded } {
  // Kontakte: bekannter externalRef → unverändert (nur Kontaktpersonen werden nachgezogen), sonst neu
  const contacts: Contact[] = [...s.contacts];
  const known = new Set(contacts.flatMap((c) => (c.externalRefs ?? []).map(refKey)));
  let addedContacts = 0;
  for (const c of b.contacts) {
    const knownRef = c.externalRefs.find((r) => known.has(refKey(r)));
    if (knownRef) {
      const at = contacts.findIndex((x) => (x.externalRefs ?? []).some((r) => refKey(r) === refKey(knownRef)));
      // fehlt das Feld im Batch, bleiben vorhandene Kontaktpersonen unverändert
      if (at >= 0 && c.contactPersons && JSON.stringify(contacts[at].contactPersons) !== JSON.stringify(c.contactPersons)) {
        contacts[at] = { ...contacts[at], contactPersons: c.contactPersons };
      }
      continue;
    }
    c.externalRefs.forEach((r) => known.add(refKey(r)));
    contacts.push({ ...c, id: newId() });
    addedContacts++;
  }
  const contactByRef = new Map<string, string>();
  for (const c of contacts) for (const r of c.externalRefs ?? []) if (!contactByRef.has(refKey(r))) contactByRef.set(refKey(r), c.id);
  const resolveContact = (i: { connectionId: Invoice['connectionId']; contactExternalId?: string }): string | null =>
    i.contactExternalId ? (contactByRef.get(refKey({ connectionId: i.connectionId, externalId: i.contactExternalId })) ?? null) : null;

  // Rechnungen
  const inv = upsertImported<Invoice, (typeof b.invoices)[number]>(
    s.invoices,
    b.invoices,
    (next, old) => {
      // lokal erledigt (settleInvoice): nur Lexware selbst (bezahlt/storniert) darf das ändern
      const keepLocal = old !== null && old.settledByPaymentId !== undefined && next.status !== 'paid' && next.status !== 'void';
      const merged = {
        ...next,
        contactId: resolveContact(next) ?? old?.contactId ?? null,
        ...(keepLocal ? { status: old.status, openCents: old.openCents } : {}),
        ...(old?.settledByPaymentId !== undefined ? { settledByPaymentId: old.settledByPaymentId } : {}),
      };
      return merged;
    },
    newId,
  );
  // ältere Rechnungen ohne Kontakt: nachziehen, sobald der Kontakt da ist
  const invoices = inv.items.map((i) => (i.contactId === null && i.contactExternalId ? { ...i, contactId: resolveContact(i) } : i));

  // Auftragsbestätigungen: eigene Liste (nie Forderung), Kontakt wie bei Rechnungen
  const oc = upsertImported<OrderConfirmation, (typeof b.orderConfirmations)[number]>(
    s.orderConfirmations ?? [],
    b.orderConfirmations ?? [],
    (next, old) => ({ ...next, contactId: resolveContact(next) ?? old?.contactId ?? null }),
    newId,
  );
  const orderConfirmations = oc.items.map((x) => (x.contactId === null && x.contactExternalId ? { ...x, contactId: resolveContact(x) } : x));

  // Zahlungen: Bestehende gewinnen (wie mergeImported, aber mit neuer ID und Zählung)
  // Qonto: Rückbuchungen mit Original verknüpfen (sonst verworfen), neue Zahlungen mit Mitglieds-IBANs klassifizieren
  const memberIbans = new Set(s.ibanLinks.map((l) => normalizeIban(l.iban)));
  const isBank = (p: { connectionId: Payment['connectionId'] }) => p.connectionId === 'bank_qonto' || p.connectionId === 'bank_sparkasse';
  const bank = linkBankReturns(s.payments, b.payments.filter(isBank)).map((p) => (p.refundOf ? p : { ...p, kind: classifyBankTx(p, memberIbans) }));
  const incomingPayments = [...b.payments.filter((p) => !isBank(p)), ...bank];
  const pay = upsertImported<Payment, (typeof b.payments)[number]>(s.payments, incomingPayments, (next, old) => (old ?? next), newId);

  // Abos
  const sub = upsertImported<Subscription, (typeof b.subscriptions)[number]>(
    s.subscriptions,
    b.subscriptions,
    (next, old) => ({
      ...next,
      amountCents: next.amountCents ?? old?.amountCents ?? null,
      contractId: old?.contractId ?? null,
      confirmedPriceCents: old?.confirmedPriceCents ?? null,
      confirmedEndDate: old?.confirmedEndDate ?? null,
      disputes: old?.disputes ?? [],
      metadataContractId: next.metadataContractId ?? null,
    }),
    newId,
  );

  // Streitfälle: Zahlung (externalId = Rechnung) → Abo
  let subscriptions = sub.items;
  for (const d of b.disputes) {
    if (!d.invoiceExternalId) continue;
    const payment = pay.items.find((p) => p.externalId === d.invoiceExternalId && p.subscriptionExternalId);
    if (!payment) continue;
    subscriptions = subscriptions.map((x) =>
      x.externalId === payment.subscriptionExternalId && !x.disputes.includes(d.externalId) ? { ...x, disputes: [...x.disputes, d.externalId] } : x,
    );
  }

  const msg = upsertImported<Message, ImportedMessage>(
    s.messages,
    b.messages ?? [],
    (next, old) => {
      const direction = old?.direction === 'out' || next.direction === 'out' ? 'out' : next.direction;
      const from = direction === 'out' && next.direction !== 'out' ? (old?.from ?? next.from) : next.from;
      const to = direction === 'out' && next.direction !== 'out' ? (old?.to ?? next.to) : next.to;
      const body = next.body || old?.body || '';
      const matched = matchMessage({ from, to, direction, body }, contacts, s.vehicles, s.jobs);
      const counterpart = direction === 'in' ? from : to;
      const linked = contactIdForMail(counterpart, contacts) ?? matched.contactId;
      const done = old?.doneManually === true;
      const subject = next.subject || old?.subject;
      const fromName = next.fromName || old?.fromName;
      return {
        ...(fromName ? { fromName } : {}),
        channel: next.channel,
        connectionId: next.connectionId,
        externalId: next.externalId,
        threadId: next.threadId || old?.threadId || next.externalId,
        direction,
        from,
        to,
        ...(subject ? { subject } : {}),
        body,
        sentAt: next.sentAt || old?.sentAt || '',
        contactId: linked ?? old?.contactId ?? null,
        jobId: matched.jobId ?? old?.jobId ?? null,
        needsReply: done || direction === 'out' ? false : (old ? old.needsReply : next.needsReply),
        ...(done ? { doneManually: true as const } : {}),
      };
    },
    newId,
  );

  const events = mergeEvents(s.events, b.events ?? [], newId);

  return {
    state: { ...s, contacts, invoices, orderConfirmations, payments: pay.items, subscriptions, messages: msg.items, events: events.events },
    added: { contacts: addedContacts, invoices: inv.added, payments: pay.added, subscriptions: sub.added, messages: msg.added, events: events.added },
  };
}

/** Termine nur anfassen, wenn der Stapel welche bringt. Bestehende ohne Schlüssel bleiben, wie sie sind. */
function mergeEvents(existing: CalendarEvent[], incoming: ImportedEvent[], newId: () => string): { events: CalendarEvent[]; added: number } {
  if (incoming.length === 0) return { events: existing, added: 0 };
  const events = [...existing];
  const index = new Map<string, number>();
  events.forEach((e, i) => {
    if (e.connectionId && e.externalId) index.set(`${e.connectionId}:${e.externalId}`, i);
  });
  let added = 0;
  for (const next of incoming) {
    const key = `${next.connectionId}:${next.externalId}`;
    const at = index.get(key);
    const location = next.location ? { location: next.location } : {};
    if (at !== undefined) {
      const old = events[at];
      events[at] = { ...old, title: next.title, startAt: next.startAt, endAt: next.endAt, connectionId: next.connectionId, externalId: next.externalId, ...(next.location ? location : old.location ? { location: old.location } : {}) };
    } else {
      index.set(key, events.length);
      events.push({ id: newId(), title: next.title, startAt: next.startAt, endAt: next.endAt, connectionId: next.connectionId, externalId: next.externalId, ...location });
      added++;
    }
  }
  return { events, added };
}
