import { berlinParts, formatBerlin, formatIsoDe, todayBerlin } from './clock';
import { selectTop } from './detectors';
import { invoiceRef } from './detectors/refs';
import { sourceFreshness } from './freshness';
import { deriveProposals } from './import/proposals';
import { invoiceOpenCents, nexusReceivables, paymentRestCents } from './ledger/receivables';
import type { AppState, Commitment, Company, Invoice, IsoDate, Payment, StoredInsight } from './types';

/** Ab dieser Länge startet ein Abschnitt zugeklappt. Heute und „Fällig heute“ bleiben offen. */
const COLLAPSE_AFTER = 4;

export type HeuteLine = {
  kind: 'line';
  key: string;
  title: string;
  subtitle: string;
  href?: string;
  amountCents?: number;
};

export type HeuteEntry = HeuteLine | { kind: 'insight'; insight: StoredInsight };

export type HeuteSectionId = 'faellig' | 'ueberfaellig' | 'offen' | 'demnaechst' | 'quellen';

export type HeuteSection = {
  id: HeuteSectionId;
  title: string;
  entries: HeuteEntry[];
  /** Lange Listen starten zu, die Zahl steht in der Überschrift. */
  collapsed: boolean;
};

const companyLabel = (c: Company): string => (c === 'nexus' ? 'NEXUS' : 'Zulassungsdienst');

const contactName = (s: AppState, id: string | null): string => s.contacts.find((c) => c.id === id)?.name ?? 'Unbekannt';

const commitKind = (k: Commitment['kind']): string => (k === 'invoice' ? 'Rechnung' : k === 'callback' ? 'Rückruf' : 'Zusage');

type Dated = { at: string; amount: number; entry: HeuteEntry };

function section(id: HeuteSectionId, title: string, entries: HeuteEntry[], forceOpen = false): HeuteSection | null {
  if (entries.length === 0) return null;
  return { id, title, entries, collapsed: !forceOpen && entries.length > COLLAPSE_AFTER };
}

function byDate(rows: Dated[]): HeuteEntry[] {
  return rows
    .sort((a, b) => a.at.localeCompare(b.at) || b.amount - a.amount || a.entry.kind.localeCompare(b.entry.kind))
    .map((r) => r.entry);
}

function invoiceRows(s: AppState, today: IsoDate): { bucket: 'ueberfaellig' | 'faellig' | 'offen'; row: Dated }[] {
  const out: { bucket: 'ueberfaellig' | 'faellig' | 'offen'; row: Dated }[] = [];
  for (const inv of s.invoices) {
    const open = invoiceOpenCents(s, inv);
    if (open <= 0) continue;
    const bucket = inv.dueDate < today ? 'ueberfaellig' : inv.dueDate === today ? 'faellig' : 'offen';
    const when = bucket === 'ueberfaellig' ? `fällig seit ${formatIsoDe(inv.dueDate)}` : `fällig am ${formatIsoDe(inv.dueDate)}`;
    out.push({ bucket, row: { at: inv.dueDate, amount: open, entry: invoiceLine(s, inv, open, when) } });
  }
  return out;
}

function invoiceLine(s: AppState, inv: Invoice, open: number, when: string): HeuteLine {
  return {
    kind: 'line', key: `invoice:${inv.id}`, title: contactName(s, inv.contactId),
    subtitle: `${companyLabel(inv.company)} · ${inv.number} · ${when}`,
    href: invoiceRef(inv, inv.number).href, amountCents: open,
  };
}

function contractRows(s: AppState, today: IsoDate): { bucket: 'ueberfaellig' | 'faellig'; row: Dated }[] {
  const out: { bucket: 'ueberfaellig' | 'faellig'; row: Dated }[] = [];
  for (const r of nexusReceivables(s, today).items) {
    if (r.kind !== 'contract' || r.dueDate > today) continue;
    const bucket = r.dueDate < today ? 'ueberfaellig' : 'faellig';
    const when = bucket === 'ueberfaellig' ? `fällig seit ${formatIsoDe(r.dueDate)}` : 'fällig heute';
    out.push({
      bucket,
      row: {
        at: r.dueDate, amount: r.amountCents,
        entry: {
          kind: 'line', key: r.key, title: r.name,
          subtitle: `NEXUS · ${r.label} · ${when}`,
          href: `/nexus/mitglieder/${r.id}`, amountCents: r.amountCents,
        },
      },
    });
  }
  return out;
}

function commitmentRows(s: AppState, now: Date, today: IsoDate): { bucket: 'ueberfaellig' | 'faellig' | 'demnaechst'; row: Dated }[] {
  const out: { bucket: 'ueberfaellig' | 'faellig' | 'demnaechst'; row: Dated }[] = [];
  for (const c of s.commitments) {
    if (c.status === 'kept') continue;
    const message = s.messages.find((m) => m.id === c.messageId);
    if (!message) continue;
    const past = c.status === 'broken' || Date.parse(c.dueAt) < now.getTime();
    const day = berlinParts(new Date(c.dueAt)).date;
    const bucket = past ? 'ueberfaellig' : day === today ? 'faellig' : 'demnaechst';
    const name = contactName(s, c.contactId);
    out.push({
      bucket,
      row: {
        at: c.dueAt, amount: 0,
        entry: {
          kind: 'line', key: `commitment:${c.id}`, title: `Zusage an ${name}`,
          subtitle: `${commitKind(c.kind)} · „${c.text}“ · bis ${formatBerlin(new Date(c.dueAt), 'dd.MM.yyyy, HH:mm')}`,
          href: `/nachrichten/${message.threadId}`,
        },
      },
    });
  }
  return out;
}

function paymentRows(s: AppState): HeuteLine[] {
  const rows: { amount: number; title: string; entry: HeuteLine }[] = [];
  for (const p of s.payments) {
    if (!openIncoming(p)) continue;
    const rest = paymentRestCents(s, p);
    if (rest <= 0) continue;
    const title = p.payerName || 'Zahlung';
    rows.push({
      amount: rest, title,
      entry: {
        kind: 'line', key: `payment:${p.id}`, title,
        subtitle: `${companyLabel(p.company)} · ${rest < p.amountCents ? 'Rest nicht zugeordnet' : 'Zahlung offen'} · ${formatIsoDe(p.bookedOn)}`,
        href: p.company === 'zulassung' ? '/zulassung/zuordnen' : '/nexus/zuordnen',
        amountCents: rest,
      },
    });
  }
  return rows.sort((a, b) => b.amount - a.amount || a.title.localeCompare(b.title, 'de')).map((r) => r.entry);
}

const openIncoming = (p: Payment): boolean => !p.ignoredAt && p.kind === 'incoming' && p.amountCents > 0 && (p.source === 'bank' || p.source === 'stripe');

function upcomingRows(s: AppState, today: IsoDate): Dated[] {
  const rows: Dated[] = [];
  for (const e of s.events) {
    if (berlinParts(new Date(e.startAt)).date <= today) continue;
    rows.push({
      at: e.startAt, amount: 0,
      entry: {
        kind: 'line', key: `event:${e.id}`, title: e.title,
        subtitle: [formatBerlin(new Date(e.startAt), 'dd.MM.yyyy, HH:mm'), e.location].filter(Boolean).join(' · '),
      },
    });
  }
  for (const c of s.calls) {
    if (berlinParts(new Date(c.startsAt)).date <= today) continue;
    rows.push({
      at: c.startsAt, amount: 0,
      entry: {
        kind: 'line', key: `call:${c.id}`, title: c.topic,
        subtitle: `Call · ${formatBerlin(new Date(c.startsAt), 'dd.MM.yyyy, HH:mm')}`,
        href: `/nexus/calls/${c.id}`,
      },
    });
  }
  return rows;
}

function insightRows(s: AppState): HeuteEntry[] {
  const open = s.insights.filter((i) => i.status === 'open' && !i.type.startsWith('coach_'));
  const top = new Set(selectTop(open, 3).map((i) => i.dedupeKey));
  const rest = open.filter((i) => i.type !== 'stale_source' && i.type !== 'reply_waiting' && !top.has(i.dedupeKey));
  return selectTop(rest, rest.length).map((insight) => ({ kind: 'insight', insight }));
}

function proposalRows(s: AppState): HeuteLine[] {
  return deriveProposals(s).map((p) => ({
    kind: 'line', key: `proposal:${p.id}`, title: p.name,
    subtitle: `Vertrag zum Bestätigen · ${p.sourceLabel}`,
    href: '/nexus/mitglieder/vorschlaege',
  }));
}

const SOURCE_RANK = { error: 0, stale: 1, missing: 2, fresh: 3 } as const;
const SOURCE_TEXT = { error: 'Störung', stale: 'Datenstand zu alt', missing: 'Nicht verbunden' } as const;

function sourceRows(s: AppState, now: Date): HeuteLine[] {
  return s.connections
    .flatMap((c) => {
      const freshness = sourceFreshness(c, now);
      if (freshness === 'fresh') return [];
      return [{ c, freshness }];
    })
    .sort((a, b) => SOURCE_RANK[a.freshness] - SOURCE_RANK[b.freshness] || a.c.label.localeCompare(b.c.label, 'de'))
    .map(({ c, freshness }) => ({
      kind: 'line' as const, key: `source:${c.id}`, title: c.label, subtitle: SOURCE_TEXT[freshness], href: '/verbindungen',
    }));
}

/**
 * Alles, was auf Heute unter den heutigen Punkten noch dazugehört.
 * „Fällig heute“ bleibt aufgeklappt. Längere Abschnitte starten zu.
 */
export function buildHeuteFeed(s: AppState, now: Date): HeuteSection[] {
  const today = todayBerlin(now);
  const invoices = invoiceRows(s, today);
  const contracts = contractRows(s, today);
  const commitments = commitmentRows(s, now, today);
  const pick = (bucket: 'ueberfaellig' | 'faellig') => byDate([
    ...invoices.filter((x) => x.bucket === bucket).map((x) => x.row),
    ...contracts.filter((x) => x.bucket === bucket).map((x) => x.row),
    ...commitments.filter((x) => x.bucket === bucket).map((x) => x.row),
  ]);
  const soon = byDate([
    ...upcomingRows(s, today),
    ...commitments.filter((x) => x.bucket === 'demnaechst').map((x) => x.row),
  ]);
  const openEntries: HeuteEntry[] = [
    ...byDate(invoices.filter((x) => x.bucket === 'offen').map((x) => x.row)),
    ...paymentRows(s),
    ...insightRows(s),
    ...proposalRows(s),
  ];
  return [
    section('faellig', 'Fällig heute', pick('faellig'), true),
    section('ueberfaellig', 'Überfällig', pick('ueberfaellig')),
    section('offen', 'Offen', openEntries),
    section('demnaechst', 'Demnächst', soon),
    section('quellen', 'Quellen', sourceRows(s, now)),
  ].filter((x): x is HeuteSection => x !== null);
}
