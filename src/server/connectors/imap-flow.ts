import 'server-only';

import { ImapFlow, type FetchMessageObject, type ListResponse, type MessageEnvelopeObject, type MessageStructureObject } from 'imapflow';

import type { ImapAccount } from '@/server/imap-config';

import type { ImapRaw, ImapSession } from './imap';
import { ConnectorError } from './types';

/** Textauszug, den wir je Nachricht herunterladen. Anhänge bleiben auf dem Server. */
const TEXT_CAP = 48 * 1024;

function headerSafe(v: string): string {
  return v.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function fmt(list?: { name?: string; address?: string }[]): string {
  return (list ?? [])
    .map((a) => {
      const addr = a.address?.trim();
      if (!addr) return '';
      const name = a.name?.replace(/[\r\n]+/g, ' ').trim();
      return name ? `${name} <${addr}>` : addr;
    })
    .filter(Boolean)
    .join(', ');
}

function leaves(node: MessageStructureObject | undefined, acc: MessageStructureObject[] = []): MessageStructureObject[] {
  if (!node) return acc;
  if (node.childNodes?.length) for (const c of node.childNodes) leaves(c, acc);
  else acc.push(node);
  return acc;
}

/** Bevorzugt text/plain, sonst text/html. Anhänge (auch text/plain als Anhang) nicht. */
function textPart(structure: MessageStructureObject | undefined): { id: string; html: boolean } | null {
  const parts = leaves(structure);
  const visible = (n: MessageStructureObject) => (n.disposition ?? '').toLowerCase() !== 'attachment';
  const plain = parts.find((n) => n.type === 'text/plain' && visible(n));
  const html = parts.find((n) => n.type === 'text/html' && visible(n));
  const hit = plain ?? html;
  if (!hit) return null;
  return { id: hit.part || '1', html: hit.type === 'text/html' };
}

function isSent(box: ListResponse): boolean {
  if ((box.specialUse ?? '').toLowerCase() === '\\sent') return true;
  const path = box.path.toLowerCase();
  return /sent|gesendet/.test(path) && !/trash|junk|spam|draft|entwurf|papierkorb/.test(path);
}

function whenOf(envelope: MessageEnvelopeObject | undefined, internalDate: Date | string | undefined): Date | undefined {
  const raw = envelope?.date ?? internalDate;
  if (!raw) return undefined;
  const d = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Kopfzeilen plus bereits dekodierter Text. Kein Anhang, kein Transfer-Encoding. */
function synthesize(envelope: MessageEnvelopeObject | undefined, internalDate: Date | string | undefined, kind: 'plain' | 'html', text: string): Buffer {
  const when = whenOf(envelope, internalDate);
  const headers = [
    `From: ${headerSafe(fmt(envelope?.from))}`,
    `To: ${headerSafe(fmt([...(envelope?.to ?? []), ...(envelope?.cc ?? [])]))}`,
    `Subject: ${headerSafe(envelope?.subject ?? '')}`,
    when ? `Date: ${when.toUTCString()}` : '',
    envelope?.messageId ? `Message-ID: ${headerSafe(envelope.messageId)}` : '',
    envelope?.inReplyTo ? `In-Reply-To: ${headerSafe(envelope.inReplyTo)}` : '',
    'MIME-Version: 1.0',
    `Content-Type: text/${kind}; charset=utf-8`,
    'Content-Transfer-Encoding: 8bit',
  ].filter((h) => h.length > 0);
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${text}`, 'utf8');
}

async function readStream(stream: AsyncIterable<Buffer | string> & { destroy?: () => void }, max: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const chunk of stream) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const room = max - n;
    if (room <= 0) {
      stream.destroy?.();
      break;
    }
    chunks.push(b.length > room ? b.subarray(0, room) : b);
    n += Math.min(b.length, room);
    if (b.length > room) {
      stream.destroy?.();
      break;
    }
  }
  return Buffer.concat(chunks);
}

class FlowSession implements ImapSession {
  private sent: string | null | undefined;

  constructor(private client: ImapFlow) {}

  async sentMailbox(): Promise<boolean> {
    return (await this.sentPath()) !== null;
  }

  private async sentPath(): Promise<string | null> {
    if (this.sent !== undefined) return this.sent;
    const boxes = await this.client.list();
    this.sent = boxes.find(isSent)?.path ?? null;
    return this.sent;
  }

  async fetchNew(which: 'inbox' | 'sent', afterUid: number, since: string, limit: number): Promise<{ messages: ImapRaw[]; more: boolean }> {
    const path = which === 'inbox' ? 'INBOX' : await this.sentPath();
    if (!path) return { messages: [], more: false };
    const lock = await this.client.getMailboxLock(path);
    try {
      const query: { since: Date; uid?: string } = { since: new Date(`${since}T00:00:00Z`) };
      if (afterUid > 0) query.uid = `${afterUid + 1}:*`;
      const found = await this.client.search(query, { uid: true });
      const uids = (Array.isArray(found) ? found : []).filter((u) => u > afterUid).sort((a, b) => a - b);
      const take = uids.slice(0, limit);
      if (take.length === 0) return { messages: [], more: false };
      // Erst die Köpfe, danach die Textteile. download() darf nicht innerhalb von fetch() laufen.
      const metas = await this.client.fetchAll(take, { uid: true, envelope: true, internalDate: true, bodyStructure: true }, { uid: true });
      const byUid = new Map(metas.map((m) => [m.uid, m]));
      const messages: ImapRaw[] = [];
      for (const uid of take) messages.push({ uid, raw: await this.bodyOf(uid, byUid.get(uid)) });
      return { messages, more: uids.length > limit };
    } finally {
      lock.release();
    }
  }

  private async bodyOf(uid: number, meta: FetchMessageObject | undefined): Promise<Buffer> {
    const part = textPart(meta?.bodyStructure);
    const kind = part?.html ? 'html' : 'plain';
    if (!part) return synthesize(meta?.envelope, meta?.internalDate, 'plain', '');
    const dl = await this.client.download(String(uid), part.id, { uid: true, maxBytes: TEXT_CAP });
    if (!dl.content) return synthesize(meta?.envelope, meta?.internalDate, kind, '');
    const buf = await readStream(dl.content, TEXT_CAP);
    return synthesize(meta?.envelope, meta?.internalDate, kind, buf.toString('utf8'));
  }

  async close(): Promise<void> {
    try {
      await this.client.logout();
    } catch {
      this.client.close();
    }
  }
}

/** TLS erzwungen, Logger aus (kein Passwort im Log). */
export async function openImapFlow(account: ImapAccount): Promise<ImapSession> {
  if (!account.user || !account.password || !account.host) throw new ConnectorError('IMAP: Zugangsdaten fehlen');
  if (account.port === 143) throw new ConnectorError('IMAP: TLS erforderlich');
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: true,
    auth: { user: account.user, pass: account.password },
    logger: false,
    logRaw: false,
    emitLogs: false,
    disableAutoIdle: true,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    connectionTimeout: 15_000,
    greetingTimeout: 16_000,
    socketTimeout: 30_000,
    maxLiteralSize: 5_000_000,
    clientInfo: { name: 'Nexus-Assistent', version: '0.1' },
  });
  try {
    await client.connect();
  } catch (err) {
    try { client.close(); } catch { /* Verbindung war nicht offen */ }
    const auth = !!err && typeof err === 'object' && 'authenticationFailed' in err && Boolean((err as { authenticationFailed?: boolean }).authenticationFailed);
    throw new ConnectorError(auth ? 'IMAP: Anmeldung abgelehnt' : 'IMAP: Verbindung fehlgeschlagen');
  }
  return new FlowSession(client);
}
