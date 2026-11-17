import { validPhone } from './matching/messages';
import type { Action, ActionType, AppState, Commitment, Company, Contact } from './types';

/** Aktionsarten, die der MCP-Connector als Entwurf anlegen darf. Nichts davon bewegt Geld oder wird hier freigegeben. */
export const MCP_ACTION_TYPES = [
  'send_whatsapp', 'send_email', 'send_reminder', 'create_invoice_draft', 'create_calendar_event', 'link_invoice_to_job',
] as const satisfies readonly ActionType[];

export type McpActionType = (typeof MCP_ACTION_TYPES)[number];

export type McpContactInput = {
  company: Company;
  kind: Contact['kind'];
  name: string;
  phones: string[];
  emails: string[];
};

export type McpChange =
  | { op: 'createContact'; contact: McpContactInput }
  | { op: 'updateContact'; id: string; patch: Partial<McpContactInput> }
  | { op: 'createCommitment'; contactId: string; kind: Commitment['kind']; text: string; dueAt: string; messageId?: string }
  | { op: 'updateCommitment'; id: string; patch: Partial<Pick<Commitment, 'kind' | 'text' | 'dueAt' | 'status'>> }
  | { op: 'completeCommitment'; id: string }
  | { op: 'createAction'; title: string; actionType: McpActionType; company: Company | null; payload: Record<string, string | number | boolean | null> }
  | { op: 'createNote'; text: string; jobId?: string; contactId?: string }
  | { op: 'dismissProposal'; proposalId: string };

export type McpApply = { state: AppState; text: string; id?: string; error?: string; unchanged?: boolean };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOTE_MAX = 8_000;

const fail = (s: AppState, error: string): McpApply => ({ state: s, text: '', error });

function cleanName(name: string | undefined): string | undefined {
  const t = name?.trim();
  return t ? t : undefined;
}

function cleanPhones(phones: string[] | undefined): { phones?: string[]; error?: string } {
  if (!phones) return {};
  if (phones.length > 10) return { error: 'Höchstens 10 Telefonnummern' };
  const out: string[] = [];
  for (const raw of phones) {
    const n = validPhone(raw);
    if (!n) return { error: `Keine Telefonnummer: ${raw.trim().slice(0, 40)}` };
    if (!out.includes(n)) out.push(n);
  }
  return { phones: out };
}

function cleanEmails(emails: string[] | undefined): { emails?: string[]; error?: string } {
  if (!emails) return {};
  if (emails.length > 10) return { error: 'Höchstens 10 E-Mail-Adressen' };
  const out: string[] = [];
  for (const raw of emails) {
    const e = raw.trim().toLowerCase();
    if (e.length > 254 || !EMAIL.test(e)) return { error: `Keine E-Mail-Adresse: ${e.slice(0, 80)}` };
    if (!out.includes(e)) out.push(e);
  }
  return { emails: out };
}

function contactFields(input: Partial<McpContactInput>, requireAll: boolean): { value?: McpContactInput; error?: string } {
  const name = cleanName(input.name);
  if (requireAll && !name) return { error: 'Name fehlt' };
  if (input.name !== undefined && !name) return { error: 'Name fehlt' };
  if (name && name.length > 200) return { error: 'Name ist zu lang' };
  const phones = cleanPhones(input.phones);
  if (phones.error) return { error: phones.error };
  const emails = cleanEmails(input.emails);
  if (emails.error) return { error: emails.error };
  if (!requireAll) return { value: { company: input.company ?? 'nexus', kind: input.kind ?? 'private', name: name ?? '', phones: phones.phones ?? [], emails: emails.emails ?? [] } };
  if (!input.company || !input.kind) return { error: 'Firma oder Art fehlt' };
  return { value: { company: input.company, kind: input.kind, name: name!, phones: phones.phones ?? [], emails: emails.emails ?? [] } };
}

function instant(v: string): string | null {
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

function appendNote(prev: string | undefined, text: string, at: Date): { notes?: string; error?: string } {
  const line = text.trim();
  if (!line) return { error: 'Notiz ist leer' };
  if (line.length > 2_000) return { error: 'Notiz ist zu lang' };
  const stamped = `[${at.toISOString()}] ${line}`;
  const notes = prev?.trim() ? `${prev.trim()}\n${stamped}` : stamped;
  if (notes.length > NOTE_MAX) return { error: 'Notizspeicher ist voll' };
  return { notes };
}

const contactName = (s: AppState, id: string | null | undefined) => s.contacts.find((c) => c.id === id)?.name ?? id ?? 'unbekannt';

/** Wendet eine MCP-Änderung an. `error` = abgelehnt, `unchanged` = nichts zu speichern. */
export function applyMcpChange(s: AppState, change: McpChange, ctx: { newId: () => string; at: Date }): McpApply {
  switch (change.op) {
    case 'createContact': {
      const c = contactFields(change.contact, true);
      if (c.error || !c.value) return fail(s, c.error ?? 'Kontakt unvollständig');
      const id = ctx.newId();
      const contact: Contact = { id, ...c.value };
      return { state: { ...s, contacts: [...s.contacts, contact] }, text: `Kontakt angelegt: ${contact.name}`, id };
    }
    case 'updateContact': {
      const prev = s.contacts.find((c) => c.id === change.id);
      if (!prev) return fail(s, 'Kontakt nicht gefunden');
      const patch = change.patch;
      if (Object.values(patch).every((v) => v === undefined)) return fail(s, 'Nichts zu ändern');
      const c = contactFields({ ...prev, ...patch }, true);
      if (c.error || !c.value) return fail(s, c.error ?? 'Kontakt unvollständig');
      const next: Contact = { ...prev, ...c.value };
      if (JSON.stringify(next) === JSON.stringify(prev)) return { state: s, text: '', unchanged: true, id: prev.id };
      const contacts = s.contacts.map((x) => (x.id === prev.id ? next : x));
      return { state: { ...s, contacts }, text: `Kontakt geändert: ${next.name}`, id: prev.id };
    }
    case 'createCommitment': {
      const contact = s.contacts.find((c) => c.id === change.contactId);
      if (!contact) return fail(s, 'Kontakt nicht gefunden');
      const text = change.text.trim();
      if (!text || text.length > 2_000) return fail(s, 'Text der Zusage fehlt oder ist zu lang');
      const dueAt = instant(change.dueAt);
      if (!dueAt) return fail(s, 'Fälligkeit ist kein Zeitpunkt');
      let messageId = 'mcp';
      if (change.messageId) {
        if (!s.messages.some((m) => m.id === change.messageId)) return fail(s, 'Nachricht nicht gefunden');
        messageId = change.messageId;
      } else if (change.kind === 'invoice') {
        return fail(s, 'Zusage „Rechnung“ braucht eine Nachricht');
      }
      const id = ctx.newId();
      const item: Commitment = { id, messageId, contactId: contact.id, kind: change.kind, text, dueAt, status: 'open' };
      return { state: { ...s, commitments: [...s.commitments, item] }, text: `Zusage angelegt: ${contact.name}`, id };
    }
    case 'updateCommitment': {
      const prev = s.commitments.find((c) => c.id === change.id);
      if (!prev) return fail(s, 'Zusage nicht gefunden');
      const patch = change.patch;
      if (Object.values(patch).every((v) => v === undefined)) return fail(s, 'Nichts zu ändern');
      const text = patch.text !== undefined ? patch.text.trim() : prev.text;
      if (!text || text.length > 2_000) return fail(s, 'Text der Zusage fehlt oder ist zu lang');
      const dueAt = patch.dueAt !== undefined ? instant(patch.dueAt) : prev.dueAt;
      if (!dueAt) return fail(s, 'Fälligkeit ist kein Zeitpunkt');
      const next: Commitment = { ...prev, text, dueAt, kind: patch.kind ?? prev.kind, status: patch.status ?? prev.status };
      if (JSON.stringify(next) === JSON.stringify(prev)) return { state: s, text: '', unchanged: true, id: prev.id };
      return {
        state: { ...s, commitments: s.commitments.map((c) => (c.id === prev.id ? next : c)) },
        text: `Zusage geändert: ${contactName(s, prev.contactId)}`,
        id: prev.id,
      };
    }
    case 'completeCommitment': {
      const prev = s.commitments.find((c) => c.id === change.id);
      if (!prev) return fail(s, 'Zusage nicht gefunden');
      if (prev.status === 'kept') return { state: s, text: '', unchanged: true, id: prev.id };
      const commitments = s.commitments.map((c) => (c.id === prev.id ? { ...c, status: 'kept' as const } : c));
      return { state: { ...s, commitments }, text: `Zusage erledigt: ${contactName(s, prev.contactId)}`, id: prev.id };
    }
    case 'createAction': {
      if (!(MCP_ACTION_TYPES as readonly string[]).includes(change.actionType)) return fail(s, 'Diese Aktion ist über MCP nicht erlaubt');
      const title = change.title.trim();
      if (!title || title.length > 200) return fail(s, 'Titel fehlt oder ist zu lang');
      const payload = change.payload ?? {};
      if (Object.keys(payload).length > 30 || JSON.stringify(payload).length > 4_000) return fail(s, 'Aktionsdaten sind zu groß');
      const id = ctx.newId();
      const action: Action = {
        id, type: change.actionType, company: change.company, title, payload, version: 1, status: 'draft',
        createdAt: ctx.at.toISOString(), isDemo: false,
      };
      return { state: { ...s, actions: [...s.actions, action] }, text: `Entwurf angelegt: ${title}`, id };
    }
    case 'createNote': {
      const note = change.text;
      if (change.jobId) {
        const job = s.jobs.find((j) => j.id === change.jobId);
        if (!job) return fail(s, 'Auftrag nicht gefunden');
        if (change.contactId && change.contactId !== job.contactId) return fail(s, 'Auftrag gehört zu einem anderen Kontakt');
        const n = appendNote(job.notes, note, ctx.at);
        if (n.error || !n.notes) return fail(s, n.error ?? 'Notiz ist leer');
        const jobs = s.jobs.map((j) => (j.id === job.id ? { ...j, notes: n.notes } : j));
        return { state: { ...s, jobs }, text: `Notiz zum Auftrag: ${contactName(s, job.contactId)}`, id: job.id };
      }
      if (!change.contactId) return fail(s, 'Notiz braucht einen Kontakt oder einen Auftrag');
      const contact = s.contacts.find((c) => c.id === change.contactId);
      if (!contact) return fail(s, 'Kontakt nicht gefunden');
      const n = appendNote(contact.notes, note, ctx.at);
      if (n.error || !n.notes) return fail(s, n.error ?? 'Notiz ist leer');
      const contacts = s.contacts.map((c) => (c.id === contact.id ? { ...c, notes: n.notes } : c));
      return { state: { ...s, contacts }, text: `Notiz zum Kontakt: ${contact.name}`, id: contact.id };
    }
    case 'dismissProposal': {
      const id = change.proposalId.trim();
      if (!id || id.length > 500) return fail(s, 'Vorschlags-ID fehlt oder ist zu lang');
      if (s.dismissedProposals.includes(id)) return { state: s, text: '', unchanged: true, id };
      return { state: { ...s, dismissedProposals: [...s.dismissedProposals, id] }, text: `Vorschlag verworfen: ${id}`, id };
    }
  }
}
