import 'server-only';

import { simpleParser } from 'mailparser';

import { emptyBatch, type ImportBatch } from '@/domain/import/batch';
import { encodeImapCursor, emailsIn, htmlToPlain, normalizeMessageId, parseImapCursor, toImportedMessage, type ImapCursor } from '@/domain/import/mail';
import type { ConnectionId } from '@/domain/types';

import type { MailboxChoice } from './imap-folders';
import { ConnectorError, type PullResult } from './types';

/** Nachrichten je Lauf, über alle Ordner eines Postfachs. Der nächste Lauf macht am UID-Cursor weiter. */
export const IMAP_MAX_PER_RUN = 200;

export interface ImapRaw {
  uid: number;
  raw: Buffer;
  /** Von Gmail-Labels, wenn der Ordner Eingang und Ausgang mischt. */
  direction?: 'in' | 'out';
}

export interface ImapSession {
  /** Gewählter Ordner. Gmail: Alle Nachrichten. Sonst INBOX und, wenn vorhanden, Gesendet. */
  mailboxes(): Promise<MailboxChoice>;
  /**
   * Nachrichten mit UID > `afterUid` (beim ersten Lauf ab `since`), aufsteigend, höchstens `limit`.
   * `more`: im Ordner liegen weitere UIDs.
   */
  fetchNew(which: 'inbox' | 'sent', afterUid: number, since: string, limit: number): Promise<{ messages: ImapRaw[]; more: boolean }>;
  close(): Promise<void>;
}

/** Bibliotheksfehler werden auf einen festen Text gekürzt. Der Wortlaut kann das Passwort enthalten und wird nie gespeichert. */
export function asMailError(err: unknown): ConnectorError {
  if (err instanceof ConnectorError) return err;
  const blob = err instanceof Error ? `${err.name}\n${err.message}` : '';
  if (/timeout|timed out|etimedout|etimeout/i.test(blob)) return new ConnectorError('IMAP: Zeitüberschreitung');
  if (/authenticat/i.test(blob)) return new ConnectorError('IMAP: Anmeldung abgelehnt');
  return new ConnectorError('IMAP: Abruf fehlgeschlagen');
}

const parserOptions = { skipTextToHtml: true, checksumAlgo: false as const, keepCidLinks: true, maxHtmlLengthToParse: 100_000 };

function asList(v: string | string[] | undefined): string[] | undefined {
  if (!v) return undefined;
  const list = (Array.isArray(v) ? v : v.split(/\s+/)).map((id) => normalizeMessageId(id)).filter(Boolean);
  return list.length ? list : undefined;
}

/** RFC822 → Nachricht. Anhänge landen nicht im Text. Ohne Datum oder Kennung: `null` (die UID rückt trotzdem vor). */
export async function parseRawMail(raw: Buffer, connectionId: ConnectionId, direction: 'in' | 'out', uid: number, which: 'inbox' | 'sent'): Promise<ImportBatch['messages'][number] | null> {
  if (raw.length === 0) return null;
  let parsed;
  try {
    parsed = await simpleParser(raw, parserOptions);
  } catch {
    return null;
  }
  const text = (parsed.text ?? '').trim() || (typeof parsed.html === 'string' ? htmlToPlain(parsed.html) : '');
  const messageId = parsed.messageId?.trim() || `uid:${which}:${uid}`;
  const sentAt = parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : '';
  const addr = (v: { text?: string } | { text?: string }[] | undefined): string => {
    if (!v) return '';
    return (Array.isArray(v) ? v : [v]).map((a) => a.text ?? '').filter(Boolean).join(', ');
  };
  const unsub = parsed.headers?.get('list-unsubscribe');
  return toImportedMessage({
    connectionId,
    direction,
    messageId,
    inReplyTo: parsed.inReplyTo,
    references: asList(parsed.references),
    from: addr(parsed.from),
    to: [addr(parsed.to), addr(parsed.cc)].filter(Boolean).join(', '),
    subject: parsed.subject ?? '',
    text,
    sentAt,
    listUnsubscribe: Array.isArray(unsub) ? unsub.length > 0 : Boolean(unsub),
  });
}

function applyDirection(msg: NonNullable<Awaited<ReturnType<typeof parseRawMail>>>, which: 'inbox' | 'sent', source: MailboxChoice['source'], user: string, hinted?: 'in' | 'out') {
  const own = emailsIn(msg.from).includes(user.trim().toLowerCase());
  const direction = hinted ?? (source === 'all' ? (own ? 'out' : 'in') : which === 'sent' ? 'out' : 'in');
  return { ...msg, direction, needsReply: direction === 'in' && !msg.automated };
}

/**
 * Liest den gewählten Ordner ab dem UID-Cursor, bei gewöhnlichen Servern danach Gesendet.
 * Dieselbe Message-ID gewinnt einmal; eine Kopie unter Gesendet zählt als Ausgang.
 * Ein Fehler in einem Ordner verwirft nicht, was der andere schon geliefert hat.
 */
export async function pullImap(connectionId: ConnectionId, cursor: string | null, session: ImapSession, ctx: { now: () => number; deadline: number; since: string; user: string; limit?: number }): Promise<PullResult> {
  const boxes = await session.mailboxes();
  const cur: ImapCursor = parseImapCursor(cursor, ctx.since);
  if (cur.incoming && cur.incoming !== boxes.incoming) cur.inboxUid = 0;
  cur.incoming = boxes.incoming;
  if (cur.sent && cur.sent !== boxes.sent) cur.sentUid = 0;
  cur.sent = boxes.sent;
  const batch = emptyBatch();
  let complete = true;
  let entered = false;
  let warning: string | undefined;
  const limit = ctx.limit ?? IMAP_MAX_PER_RUN;

  const take = async (which: 'inbox' | 'sent', key: 'inboxUid' | 'sentUid', max: number): Promise<number> => {
    if (max <= 0 || ctx.now() >= ctx.deadline) {
      complete = false;
      return 0;
    }
    entered = true;
    const page = await session.fetchNew(which, cur[key], cur.since, max);
    let n = 0;
    for (const m of page.messages) {
      if (ctx.now() >= ctx.deadline) {
        complete = false;
        return n;
      }
      cur[key] = m.uid;
      n += 1;
      const msg = await parseRawMail(m.raw, connectionId, which === 'inbox' ? 'in' : 'out', m.uid, which);
      if (msg) batch.messages.push(applyDirection(msg, which, boxes.source, ctx.user, m.direction));
    }
    if (page.more) complete = false;
    return n;
  };

  const run = async (which: 'inbox' | 'sent', key: 'inboxUid' | 'sentUid', max: number) => {
    try {
      return await take(which, key, max);
    } catch (err) {
      complete = false;
      warning ??= asMailError(err).message;
      return 0;
    }
  };

  if (boxes.source === 'all' || !boxes.sent) {
    await run('inbox', 'inboxUid', limit);
  } else {
    const inboxMax = Math.min(limit, Math.max(1, Math.ceil(limit * 0.75)));
    const got = await run('inbox', 'inboxUid', inboxMax);
    const left = limit - got;
    if (!warning && left > 0 && ctx.now() < ctx.deadline) await run('sent', 'sentUid', left);
    else if (left <= 0) complete = false;
  }

  const byId = new Map<string, (typeof batch.messages)[number]>();
  for (const m of batch.messages) {
    const prev = byId.get(m.externalId);
    if (!prev) {
      byId.set(m.externalId, m);
      continue;
    }
    const direction = prev.direction === 'out' || m.direction === 'out' ? 'out' : 'in';
    const chosen = m.direction === 'out' ? m : prev.direction === 'out' ? prev : m;
    byId.set(m.externalId, { ...chosen, direction, needsReply: direction === 'in' && !chosen.automated && !prev.automated });
  }
  batch.messages = [...byId.values()];

  // Kein Ordner angefasst: Cursor unverändert, der Aufrufer speichert nichts. Ein Fehler davor bleibt als Warnung sichtbar.
  if (!entered) return { batch, cursor, complete: false, ...(warning ? { warning } : {}) };
  return { batch, cursor: encodeImapCursor(cur), complete, ...(warning ? { warning } : {}) };
}
