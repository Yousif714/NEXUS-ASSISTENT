import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { realNow, todayBerlin } from '@/domain/clock';
import { MDC_CSV_MAX_CHARS } from '@/domain/import/mydigitalcar';
import { applyPortalImport, isPortalSource, PORTAL_LABEL, type PortalSource } from '@/domain/import/portal';
import { deriveProposals } from '@/domain/import/proposals';
import { applyMcpChange, MCP_ACTION_TYPES, type McpChange } from '@/domain/mcp-changes';
import { isFetchableMailbox } from '@/domain/connections';
import { syncMailboxes } from '@/server/mail-sync';
import { getActionProvider, getMailDeps, getRepos } from '@/server/registry';
import { dispatchEvents, loadState } from '@/server/state-service';
import { logMcpTool } from './log';
import { contactName, matches, overview, pageOf, scrub, shapeContact, shapeContract, shapeInvoice } from './view';

type Page = { query?: string; limit?: number; offset?: number; company?: 'nexus' | 'zulassung' };

const company = z.enum(['nexus', 'zulassung']);
const pageShape = {
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
};
const listed = z.object(pageShape);
const listedCompany = z.object({ ...pageShape, company: company.optional() });
const byId = z.object({ id: z.string().min(1).max(200) });

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const writeAnn = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

class McpToolError extends Error {}

function jsonResult(data: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    ...(isError ? { isError: true as const } : {}),
  };
}

async function current() {
  return loadState(getRepos(), realNow());
}

function paged<T>(rows: T[], args: Page) {
  return pageOf(rows, args.limit, args.offset);
}

async function commitChange(tool: string, change: McpChange) {
  const repos = getRepos();
  const at = realNow();
  const preview = applyMcpChange((await repos.state.load()).state, change, { newId: () => 'preview', at });
  if (preview.error) {
    await logMcpTool(tool, `abgelehnt: ${preview.error}`);
    return jsonResult({ error: preview.error }, true);
  }
  if (preview.unchanged) {
    await logMcpTool(tool, 'unverändert');
    return jsonResult({ ok: true, unchanged: true, id: preview.id ?? null });
  }
  try {
    const saved = await dispatchEvents(repos, [{ type: 'mcpChange', change }], { at: realNow, provider: getActionProvider() });
    await logMcpTool(tool);
    return jsonResult({ ok: true, id: saved.created[0] ?? preview.id ?? null });
  } catch (err) {
    const message = err instanceof Error && err.message === 'conflict'
      ? 'Gleichzeitige Änderung, bitte erneut versuchen'
      : 'Änderung fehlgeschlagen';
    return jsonResult({ error: message }, true);
  }
}

/** Registriert Lese- und Schreibwerkzeuge. Geld bewegen, Geheimnisse und Löschen des Protokolls gibt es hier nicht. */
export function registerNexusTools(server: McpServer): void {
  const read = (name: string, title: string, description: string, inputSchema: z.ZodObject<z.ZodRawShape>, run: (args: Page & { id?: string }) => Promise<unknown>) => {
    server.registerTool(name, { title, description, inputSchema, annotations: readOnly }, async (args) => {
      try {
        const data = await run(args as Page & { id?: string });
        await logMcpTool(name);
        return jsonResult(data);
      } catch (err) {
        if (err instanceof McpToolError) {
          await logMcpTool(name, err.message);
          return jsonResult({ error: err.message }, true);
        }
        throw err;
      }
    });
  };

  const write = (name: string, title: string, description: string, inputSchema: z.ZodObject<z.ZodRawShape>, run: (args: Record<string, unknown>) => McpChange) => {
    server.registerTool(name, { title, description, inputSchema, annotations: writeAnn }, async (args) => commitChange(name, run(args as Record<string, unknown>)));
  };

  read('list_contacts', 'Kontakte auflisten', 'Kontakte suchen (Name, Telefon, E-Mail). Optional Firma nexus oder zulassung. Höchstens 50.', listedCompany, async (args) => {
    const s = await current();
    const rows = s.contacts.filter((c) => (!args.company || c.company === args.company) && matches(args.query, [c.name, c.kind, c.notes, ...c.emails, ...c.phones]));
    return paged(rows.map((c) => shapeContact(s, c.id)), args);
  });
  read('get_contact', 'Kontakt lesen', 'Ein Kontakt mit seinen Verträgen. Beträge in Cent.', byId, async (args) => {
    const item = shapeContact(await current(), args.id!);
    if (!item) throw new McpToolError('Nicht gefunden');
    return { item };
  });

  read('list_contracts', 'Verträge auflisten', 'Verträge suchen. Firma filtert über den Kontakt. Beträge in Cent.', listedCompany, async (args) => {
    const s = await current();
    const rows = s.contracts.filter((c) => {
      const contact = s.contacts.find((x) => x.id === c.contactId);
      return (!args.company || contact?.company === args.company) && matches(args.query, [c.id, contact?.name, c.kind, c.billing, c.specialTerms]);
    });
    return paged(rows.map((c) => shapeContract(s, c.id, todayBerlin(realNow()))), args);
  });
  read('get_contract', 'Vertrag lesen', 'Ein Vertrag mit Zahlungsstand aus der Fachlogik (offen, Rückstand, Ampel). Beträge in Cent.', byId, async (args) => {
    const item = shapeContract(await current(), args.id!, todayBerlin(realNow()));
    if (!item) throw new McpToolError('Nicht gefunden');
    return { item };
  });

  read('list_payments', 'Zahlungen auflisten', 'Zahlungen suchen (Zahler, Verwendungszweck, IBAN). Beträge in Cent. Keine Zahlungslinks.', listedCompany, async (args) => {
    const s = await current();
    const rows = s.payments.filter((p) => (!args.company || p.company === args.company) && matches(args.query, [p.payerName, p.reference, p.iban, p.externalId, p.source, String(p.amountCents)]));
    return paged(rows.map((p) => scrub(p)), args);
  });
  read('get_payment', 'Zahlung lesen', 'Eine Zahlung. Beträge in Cent. Keine Zahlungslinks.', byId, async (args) => {
    const s = await current();
    const item = s.payments.find((p) => p.id === args.id);
    if (!item) throw new McpToolError('Nicht gefunden');
    return { item: scrub(item) };
  });

  read('list_invoices', 'Rechnungen auflisten', 'Rechnungen suchen (Nummer, Text). openCents kommt aus der Forderungslogik, in Cent.', listedCompany, async (args) => {
    const s = await current();
    const rows = s.invoices.filter((i) => (!args.company || i.company === args.company) && matches(args.query, [i.number, i.text, i.status, contactName(s, i.contactId)]));
    return paged(rows.map((i) => shapeInvoice(s, i)), args);
  });
  read('get_invoice', 'Rechnung lesen', 'Eine Rechnung mit offenem Betrag in Cent.', byId, async (args) => {
    const s = await current();
    const inv = s.invoices.find((i) => i.id === args.id);
    if (!inv) throw new McpToolError('Nicht gefunden');
    return { item: shapeInvoice(s, inv) };
  });

  read('list_commitments', 'Zusagen auflisten', 'Offene Punkte und Zusagen suchen (Text, Kontakt).', listed, async (args) => {
    const s = await current();
    const rows = s.commitments.filter((c) => matches(args.query, [c.text, c.kind, c.status, contactName(s, c.contactId)]));
    return paged(rows.map((c) => scrub({ ...c, contactName: contactName(s, c.contactId) })), args);
  });
  read('get_commitment', 'Zusage lesen', 'Eine Zusage oder ein offener Punkt.', byId, async (args) => {
    const s = await current();
    const item = s.commitments.find((c) => c.id === args.id);
    if (!item) throw new McpToolError('Nicht gefunden');
    return { item: scrub({ ...item, contactName: contactName(s, item.contactId) }) };
  });

  read('list_events', 'Termine auflisten', 'Kalendertermine suchen (Titel, Ort).', listed, async (args) => {
    const s = await current();
    const rows = s.events.filter((e) => matches(args.query, [e.title, e.location]));
    return paged(rows.map((e) => scrub(e)), args);
  });
  read('get_event', 'Termin lesen', 'Ein Kalendertermin.', byId, async (args) => {
    const s = await current();
    const item = s.events.find((e) => e.id === args.id);
    if (!item) throw new McpToolError('Nicht gefunden');
    return { item: scrub(item) };
  });

  read('list_messages', 'Nachrichten auflisten', 'WhatsApp- und E-Mail-Nachrichten suchen (Text, Absender, Kanal). channel ist whatsapp oder email.', listed, async (args) => {
    const s = await current();
    const rows = s.messages.filter((m) => matches(args.query, [m.body, m.from, m.to, contactName(s, m.contactId), m.channel]));
    return paged(rows.map((m) => scrub(m)), args);
  });
  read('get_message', 'Nachricht lesen', 'Eine Nachricht. channel ist whatsapp oder email.', byId, async (args) => {
    const s = await current();
    const item = s.messages.find((m) => m.id === args.id);
    if (!item) throw new McpToolError('Nicht gefunden');
    return { item: scrub(item) };
  });

  read('list_vehicles', 'Fahrzeuge auflisten', 'Fahrzeuge suchen (Kennzeichen, FIN, Modell).', listed, async (args) => {
    const s = await current();
    const rows = s.vehicles.filter((v) => matches(args.query, [v.plate, v.vin, v.model, contactName(s, v.contactId)]));
    return paged(rows.map((v) => scrub({ ...v, contactName: contactName(s, v.contactId) })), args);
  });
  read('get_vehicle', 'Fahrzeug lesen', 'Ein Fahrzeug.', byId, async (args) => {
    const s = await current();
    const item = s.vehicles.find((v) => v.id === args.id);
    if (!item) throw new McpToolError('Nicht gefunden');
    return { item: scrub({ ...item, contactName: contactName(s, item.contactId) }) };
  });

  read('list_insights', 'Hinweise auflisten', 'Hinweise und offene Punkte suchen. id ist der dedupeKey.', listed, async (args) => {
    const s = await current();
    const rows = s.insights.filter((i) => matches(args.query, [i.title, i.body, i.type, i.status, i.dedupeKey]));
    return paged(rows.map((i) => scrub({ ...i, id: i.dedupeKey })), args);
  });
  read('get_insight', 'Hinweis lesen', 'Ein Hinweis. id ist der dedupeKey.', byId, async (args) => {
    const s = await current();
    const item = s.insights.find((i) => i.dedupeKey === args.id);
    if (!item) throw new McpToolError('Nicht gefunden');
    return { item: scrub({ ...item, id: item.dedupeKey }) };
  });

  read('list_subscriptions', 'Abos auflisten', 'Stripe-Abos suchen (Name, Produkt). Beträge in Cent. Keine Zahlungslinks.', listed, async (args) => {
    const s = await current();
    const rows = s.subscriptions.filter((x) => matches(args.query, [x.customerName, x.customerEmail, x.productName, x.externalId, x.status]));
    return paged(rows.map((x) => scrub(x)), args);
  });
  read('get_subscription', 'Abo lesen', 'Ein Stripe-Abo. Beträge in Cent. Keine Zahlungslinks.', byId, async (args) => {
    const s = await current();
    const item = s.subscriptions.find((x) => x.id === args.id);
    if (!item) throw new McpToolError('Nicht gefunden');
    return { item: scrub(item) };
  });

  read('list_actions', 'Aktionen auflisten', 'Entwürfe und Aktionen suchen. Es wird nichts ausgeführt.', listed, async (args) => {
    const s = await current();
    const rows = s.actions.filter((a) => matches(args.query, [a.title, a.type, a.status, a.id]));
    return paged(rows.map((a) => scrub(a)), args);
  });
  read('get_action', 'Aktion lesen', 'Eine Aktion. Zahlungslinks im Inhalt sind entfernt.', byId, async (args) => {
    const s = await current();
    const item = s.actions.find((a) => a.id === args.id);
    if (!item) throw new McpToolError('Nicht gefunden');
    return { item: scrub(item) };
  });

  read('list_proposals', 'Vorschläge auflisten', 'Offene Vertragsvorschläge, die sich verwerfen lassen.', listed, async (args) => {
    const s = await current();
    const rows = deriveProposals(s).filter((p) => matches(args.query, [p.name, p.email, p.id, p.sourceLabel, ...p.references]));
    return paged(rows.map((p) => ({ id: p.id, name: p.name, email: p.email, sourceLabel: p.sourceLabel, billing: p.billing, complete: p.complete, references: p.references })), args);
  });

  read('overview', 'Überblick', 'Offene Rechnungen, überfällige Zahlungen, anstehende Zusagen, Geldbeträge in Cent. staleSources: verbunden, aber Fehler oder zu alt. notConnectedSources: nicht verbunden.', z.object({}), async () => overview(await current(), realNow()));

  write('create_contact', 'Kontakt anlegen', 'Legt einen Kontakt an (nexus oder zulassung, member, private oder dealer).', z.object({
    company, kind: z.enum(['member', 'private', 'dealer']), name: z.string().min(1).max(200),
    phones: z.array(z.string().max(40)).max(10).optional(),
    emails: z.array(z.string().max(254)).max(10).optional(),
  }), (a) => ({
    op: 'createContact',
    contact: { company: a.company as 'nexus', kind: a.kind as 'member', name: String(a.name), phones: (a.phones as string[] | undefined) ?? [], emails: (a.emails as string[] | undefined) ?? [] },
  }));

  write('update_contact', 'Kontakt ändern', 'Ändert Name, Firma, Art, Telefon oder E-Mail eines Kontakts.', z.object({
    id: z.string().min(1).max(200),
    company: company.optional(),
    kind: z.enum(['member', 'private', 'dealer']).optional(),
    name: z.string().min(1).max(200).optional(),
    phones: z.array(z.string().max(40)).max(10).optional(),
    emails: z.array(z.string().max(254)).max(10).optional(),
  }), (a) => ({
    op: 'updateContact',
    id: String(a.id),
    patch: {
      ...(a.company !== undefined ? { company: a.company as 'nexus' } : {}),
      ...(a.kind !== undefined ? { kind: a.kind as 'member' } : {}),
      ...(a.name !== undefined ? { name: String(a.name) } : {}),
      ...(a.phones !== undefined ? { phones: a.phones as string[] } : {}),
      ...(a.emails !== undefined ? { emails: a.emails as string[] } : {}),
    },
  }));

  write('create_commitment', 'Zusage anlegen', 'Legt eine Zusage oder einen offenen Punkt an. Ohne Nachricht nur callback oder other, nicht invoice.', z.object({
    contactId: z.string().min(1).max(200),
    kind: z.enum(['invoice', 'callback', 'other']),
    text: z.string().min(1).max(2_000),
    dueAt: z.string().min(4).max(40),
    messageId: z.string().min(1).max(200).optional(),
  }), (a) => ({
    op: 'createCommitment',
    contactId: String(a.contactId),
    kind: a.kind as 'other',
    text: String(a.text),
    dueAt: String(a.dueAt),
    ...(a.messageId !== undefined ? { messageId: String(a.messageId) } : {}),
  }));

  write('update_commitment', 'Zusage ändern', 'Ändert Text, Art, Fälligkeit oder Status einer Zusage.', z.object({
    id: z.string().min(1).max(200),
    kind: z.enum(['invoice', 'callback', 'other']).optional(),
    text: z.string().min(1).max(2_000).optional(),
    dueAt: z.string().min(4).max(40).optional(),
    status: z.enum(['open', 'kept', 'broken']).optional(),
  }), (a) => ({
    op: 'updateCommitment',
    id: String(a.id),
    patch: {
      ...(a.kind !== undefined ? { kind: a.kind as 'other' } : {}),
      ...(a.text !== undefined ? { text: String(a.text) } : {}),
      ...(a.dueAt !== undefined ? { dueAt: String(a.dueAt) } : {}),
      ...(a.status !== undefined ? { status: a.status as 'open' } : {}),
    },
  }));

  write('complete_commitment', 'Zusage erledigen', 'Setzt eine Zusage auf erledigt (kept).', byId, (a) => ({ op: 'completeCommitment', id: String(a.id) }));

  write('create_action', 'Aktionsentwurf anlegen', 'Legt nur einen Entwurf an (WhatsApp, E-Mail, Erinnerung, Rechnung, Termin, Zuordnung). Sendet nichts und löst keine Zahlung aus.', z.object({
    title: z.string().min(1).max(200),
    actionType: z.enum(MCP_ACTION_TYPES),
    company: company.nullable().optional(),
    payload: z.record(z.string().max(80), z.union([z.string().max(2_000), z.number(), z.boolean(), z.null()])).optional(),
  }), (a) => ({
    op: 'createAction',
    title: String(a.title),
    actionType: a.actionType as (typeof MCP_ACTION_TYPES)[number],
    company: (a.company as 'nexus' | null | undefined) ?? null,
    payload: (a.payload as Record<string, string | number | boolean | null> | undefined) ?? {},
  }));

  write('create_note', 'Notiz anlegen', 'Hängt eine Notiz an einen Kontakt oder einen Auftrag. Ersetzt vorhandene Notizen nicht.', z.object({
    text: z.string().min(1).max(2_000),
    contactId: z.string().min(1).max(200).optional(),
    jobId: z.string().min(1).max(200).optional(),
  }), (a) => ({
    op: 'createNote',
    text: String(a.text),
    ...(a.contactId !== undefined ? { contactId: String(a.contactId) } : {}),
    ...(a.jobId !== undefined ? { jobId: String(a.jobId) } : {}),
  }));

  write('dismiss_proposal', 'Vorschlag verwerfen', 'Markiert einen Vertragsvorschlag als verworfen, wie in der App.', z.object({
    proposalId: z.string().min(1).max(500),
  }), (a) => ({ op: 'dismissProposal', proposalId: String(a.proposalId) }));

  server.registerTool('import_portal_csv', {
    title: 'Portal-CSV importieren',
    description: 'Importiert eine Portal-CSV als Kunden, Fahrzeuge und Aufträge. source ist mydigitalcar oder nextoz, beides bleibt getrennt. mydigitalcar: Semikolon, UTF-8, Kopfzeile des myDigitalCar-Exports; idempotent über Ex_Vorgangsnummer, auch in Portionen mit derselben Kopfzeile. nextoz ist registriert, die Spaltenzuordnung fehlt noch und es wird nichts geschrieben. Antwort nur Zähler, keine Rohdaten.',
    inputSchema: z.object({
      source: z.enum(['mydigitalcar', 'nextoz']),
      csv: z.string().min(1).max(MDC_CSV_MAX_CHARS),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (args) => {
    if (!isPortalSource(args.source)) return jsonResult({ error: 'Unbekannte Quelle' }, true);
    const source = args.source as PortalSource;
    const repos = getRepos();
    const at = realNow();
    const planned = applyPortalImport(await current(), source, args.csv, () => 'preview', at.toISOString());
    if (planned.error) {
      await logMcpTool('import_portal_csv', `${PORTAL_LABEL[source]}: ${planned.error}`);
      return jsonResult({ error: planned.error, source }, true);
    }
    try {
      await dispatchEvents(repos, [{ type: 'importPortalCsv', source, csv: args.csv }], { at: realNow, provider: getActionProvider() });
    } catch (err) {
      const message = err instanceof Error && err.message === 'conflict' ? 'Gleichzeitige Änderung, bitte erneut versuchen' : 'Import fehlgeschlagen';
      await logMcpTool('import_portal_csv', message);
      return jsonResult({ error: message, source }, true);
    }
    await logMcpTool('import_portal_csv', PORTAL_LABEL[source]);
    return jsonResult({
      ok: true,
      source,
      rows: planned.rows,
      duplicates: planned.duplicates,
      contacts: planned.contacts,
      vehicles: planned.vehicles,
      jobs: planned.jobs,
      errors: planned.errors.slice(0, 50),
      errorCount: planned.errors.length,
    });
  });

  server.registerTool('sync_mail', {
    title: 'Postfach abrufen',
    description: 'Ruft ein IMAP-Postfach ab oder alle eingerichteten (info@, privates Gmail und weitere). id optional: info_mail, gmail, icloud oder mail_<name>. Antwort: Anzahl neuer Nachrichten und Fehler je Postfach. Kein Mailinhalt, keine Passwörter.',
    inputSchema: z.object({ id: z.string().min(1).max(48).optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (args) => {
    if (args.id !== undefined && !isFetchableMailbox(args.id)) {
      await logMcpTool('sync_mail', 'unbekanntes Postfach');
      return jsonResult({ error: 'Unbekanntes Postfach' }, true);
    }
    try {
      const repos = getRepos();
      const result = await syncMailboxes(repos, getMailDeps(args.id ? { only: [args.id] } : {}));
      await logMcpTool('sync_mail', `${result.added} neu`);
      return jsonResult({
        added: result.added,
        mailboxes: result.mailboxes.map((m) => ({ id: m.id, outcome: m.outcome, added: m.added, ...(m.error ? { error: m.error } : {}) })),
      });
    } catch {
      await logMcpTool('sync_mail', 'Abruf fehlgeschlagen');
      return jsonResult({ error: 'Abruf fehlgeschlagen' }, true);
    }
  });
}
