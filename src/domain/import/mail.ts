import type { Contact } from '@/domain/types';
import { IMPORT_SINCE, cursorOutdated, type ImportedMessage } from '@/domain/import/batch';

/** Zeichen des gespeicherten Textauszugs, ohne Anhänge. */
export const MAIL_SNIPPET_CHARS = 2_000;

export interface ImapCursor {
  since: string;
  inboxUid: number;
  sentUid: number;
}

/** Letzte verarbeitete UID je Ordner. Ungültig oder veraltet → Start bei IMPORT_SINCE, UID 0. */
export function parseImapCursor(raw: string | null): ImapCursor {
  if (raw) {
    try {
      const c = JSON.parse(raw) as Partial<ImapCursor>;
      if (!cursorOutdated(c.since) && Number.isInteger(c.inboxUid) && (c.inboxUid as number) >= 0 && Number.isInteger(c.sentUid) && (c.sentUid as number) >= 0) {
        return { since: IMPORT_SINCE, inboxUid: c.inboxUid as number, sentUid: c.sentUid as number };
      }
    } catch { /* ungültiger Cursor → Neustart */ }
  }
  return { since: IMPORT_SINCE, inboxUid: 0, sentUid: 0 };
}

export function encodeImapCursor(c: ImapCursor): string {
  return JSON.stringify({ since: IMPORT_SINCE, inboxUid: c.inboxUid, sentUid: c.sentUid });
}

/** Message-ID ohne Klammern, kleingeschrieben, gekürzt. Leer, wenn nichts übrig bleibt. */
export function normalizeMessageId(id: string): string {
  return id.trim().replace(/^<|>$/g, '').replace(/[\r\n\s]/g, '').toLowerCase().slice(0, 500);
}

/** E-Mail-Adressen aus einem Kopf (auch „Name <a@b.de>“). */
export function emailsIn(value: string): string[] {
  return [...value.toLowerCase().matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g)].map((m) => m[0]);
}

/** Kontakt, dessen Adresse exakt im Gegenüber steht. */
export function contactIdForMail(counterpart: string, contacts: Contact[]): string | null {
  const want = new Set(emailsIn(counterpart));
  if (want.size === 0) return null;
  for (const c of contacts) {
    if (c.emails.some((e) => want.has(e.toLowerCase()))) return c.id;
  }
  return null;
}

export function mailSnippet(text: string): string {
  const flat = text.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  if (flat.length <= MAIL_SNIPPET_CHARS) return flat;
  return `${flat.slice(0, MAIL_SNIPPET_CHARS).trimEnd()}…`;
}

/** Grober Text aus HTML, falls der Parser keinen Plain-Text liefert. */
export function htmlToPlain(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

export function threadIdOf(messageId: string, inReplyTo?: string, references?: string[]): string {
  const root = references?.[0] || inReplyTo || messageId;
  return (normalizeMessageId(root) || messageId).slice(0, 200);
}

/** Baut die gespeicherte Nachricht. `messageId` ist die Message-ID oder ein UID-Ersatz. */
export function toImportedMessage(input: {
  connectionId: ImportedMessage['connectionId'];
  direction: 'in' | 'out';
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  from: string;
  to: string;
  subject: string;
  text: string;
  sentAt: string;
}): ImportedMessage | null {
  const externalId = normalizeMessageId(input.messageId);
  if (!externalId || Number.isNaN(Date.parse(input.sentAt))) return null;
  const subject = input.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  const snippet = mailSnippet(input.text);
  const bodyCore = !subject || snippet.startsWith(subject) ? snippet : `${subject}\n\n${snippet}`;
  return {
    channel: 'email',
    connectionId: input.connectionId,
    externalId,
    threadId: threadIdOf(externalId, input.inReplyTo, input.references),
    direction: input.direction,
    from: input.from.slice(0, 500),
    to: input.to.slice(0, 500),
    ...(subject ? { subject } : {}),
    body: bodyCore.slice(0, 2_400),
    sentAt: new Date(input.sentAt).toISOString(),
    needsReply: input.direction === 'in',
  };
}
