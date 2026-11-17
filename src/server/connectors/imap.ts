import 'server-only';

import { simpleParser } from 'mailparser';

import { emptyBatch, type ImportBatch } from '@/domain/import/batch';
import { encodeImapCursor, htmlToPlain, normalizeMessageId, parseImapCursor, toImportedMessage, type ImapCursor } from '@/domain/import/mail';
import type { ConnectionId } from '@/domain/types';

import type { PullResult } from './types';

/** Nachrichten je Ordner und Lauf. Zwei Ordner bleiben damit klar unter dem 60-Sekunden-Limit. */
export const IMAP_MAX_PER_FOLDER = 20;

export interface ImapRaw {
  uid: number;
  raw: Buffer;
}

export interface ImapSession {
  /** Ob es einen Gesendet-Ordner gibt. */
  sentMailbox(): Promise<boolean>;
  /**
   * Nachrichten mit UID > `afterUid`, aufsteigend, höchstens `limit`.
   * `more`: im Ordner liegen weitere UIDs.
   */
  fetchNew(which: 'inbox' | 'sent', afterUid: number, since: string, limit: number): Promise<{ messages: ImapRaw[]; more: boolean }>;
  close(): Promise<void>;
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
  });
}

/**
 * Liest INBOX und Gesendet ab dem Cursor. Dieselbe Message-ID gewinnt einmal;
 * eine Kopie unter Gesendet zählt als Ausgang.
 */
export async function pullImap(connectionId: ConnectionId, cursor: string | null, session: ImapSession, ctx: { now: () => number; deadline: number }): Promise<PullResult> {
  const cur: ImapCursor = parseImapCursor(cursor);
  const batch = emptyBatch();
  let complete = true;
  let entered = false;

  const take = async (which: 'inbox' | 'sent', key: 'inboxUid' | 'sentUid') => {
    if (ctx.now() >= ctx.deadline) {
      complete = false;
      return;
    }
    entered = true;
    const page = await session.fetchNew(which, cur[key], cur.since, IMAP_MAX_PER_FOLDER);
    for (const m of page.messages) {
      if (ctx.now() >= ctx.deadline) {
        complete = false;
        return;
      }
      cur[key] = m.uid;
      const msg = await parseRawMail(m.raw, connectionId, which === 'inbox' ? 'in' : 'out', m.uid, which);
      if (msg) batch.messages.push(msg);
    }
    if (page.more) complete = false;
  };

  await take('inbox', 'inboxUid');
  // Gesendet im selben Lauf, damit Antworten nicht erst nach dem ganzen Posteingang ankommen.
  if (ctx.now() < ctx.deadline && (await session.sentMailbox())) await take('sent', 'sentUid');

  const byId = new Map<string, (typeof batch.messages)[number]>();
  for (const m of batch.messages) {
    const prev = byId.get(m.externalId);
    if (!prev) {
      byId.set(m.externalId, m);
      continue;
    }
    const direction = prev.direction === 'out' || m.direction === 'out' ? 'out' : 'in';
    const chosen = m.direction === 'out' ? m : prev.direction === 'out' ? prev : m;
    byId.set(m.externalId, { ...chosen, direction, needsReply: direction === 'in' });
  }
  batch.messages = [...byId.values()];

  // Kein Ordner angefasst (Zeitbudget schon aufgebraucht): Cursor unverändert, der Aufrufer speichert nichts.
  if (!entered) return { batch, cursor, complete: false };
  return { batch, cursor: encodeImapCursor(cur), complete };
}
