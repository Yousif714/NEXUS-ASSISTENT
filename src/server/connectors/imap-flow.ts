import 'server-only';

import { ImapFlow, type FetchMessageObject, type MessageEnvelopeObject, type MessageStructureObject } from 'imapflow';

import type { ImapAccount } from '@/server/imap-config';

import type { ImapRaw, ImapSession } from './imap';
import { pickImapMailboxes, type MailboxChoice } from './imap-folders';
import { planAttachments, type MailPart } from './imap-parts';
import { ConnectorError } from './types';

/** Textauszug, den wir je Nachricht herunterladen. Große Anhänge bleiben auf dem Server. */
const TEXT_CAP = 48 * 1024;
const SMALL_CAP = 8 * 1024;

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

function toPart(n: MessageStructureObject): MailPart {
  const named = n.dispositionParameters?.filename ?? n.parameters?.name ?? n.parameters?.filename;
  return {
    type: n.type,
    disposition: n.disposition,
    filename: typeof named === 'string' ? named : undefined,
    size: n.size,
    part: n.part,
    children: n.childNodes?.map(toPart),
  };
}

function labelDirection(labels: Set<string> | undefined): 'in' | 'out' | undefined {
  if (!labels) return undefined;
  const names = [...labels].map((l) => l.toLowerCase());
  if (names.includes('\\sent')) return 'out';
  if (names.includes('\\inbox')) return 'in';
  return undefined;
}

class FlowSession implements ImapSession {
  private boxes: MailboxChoice | undefined;

  constructor(private client: ImapFlow) {}

  async mailboxes(): Promise<MailboxChoice> {
    if (this.boxes) return this.boxes;
    const listed = await this.client.list();
    this.boxes = pickImapMailboxes(listed.map((b) => ({ path: b.path, specialUse: b.specialUse })));
    return this.boxes;
  }

  async fetchNew(which: 'inbox' | 'sent', afterUid: number, since: string, limit: number): Promise<{ messages: ImapRaw[]; more: boolean }> {
    const boxes = await this.mailboxes();
    const path = which === 'inbox' ? boxes.incoming : boxes.sent;
    if (!path) return { messages: [], more: false };
    const lock = await this.client.getMailboxLock(path);
    try {
      // Ab der zweiten Seite nur die UID. SINCE und UID zusammen ist bei Gmail sehr langsam.
      const query = afterUid > 0 ? { uid: `${afterUid + 1}:*` } : { since: new Date(`${since}T00:00:00Z`) };
      const found = await this.client.search(query, { uid: true });
      const uids = (Array.isArray(found) ? found : []).filter((u) => u > afterUid).sort((a, b) => a - b);
      const take = uids.slice(0, limit);
      if (take.length === 0) return { messages: [], more: false };
      const wantLabels = boxes.source === 'all';
      const metas = await this.fetchMetas(take, wantLabels);
      const byUid = new Map(metas.map((m) => [m.uid, m]));
      const messages: ImapRaw[] = [];
      for (const uid of take) {
        const meta = byUid.get(uid);
        const direction = wantLabels ? labelDirection(meta?.labels) : undefined;
        messages.push({ uid, raw: await this.bodyOf(uid, meta), ...(direction ? { direction } : {}) });
      }
      return { messages, more: uids.length > limit };
    } finally {
      lock.release();
    }
  }

  private async fetchMetas(uids: number[], labels: boolean): Promise<FetchMessageObject[]> {
    const base = { uid: true, envelope: true, internalDate: true, bodyStructure: true } as const;
    if (!labels) return this.client.fetchAll(uids, base, { uid: true });
    try {
      return await this.client.fetchAll(uids, { ...base, labels: true }, { uid: true });
    } catch {
      return this.client.fetchAll(uids, base, { uid: true });
    }
  }

  private async bodyOf(uid: number, meta: FetchMessageObject | undefined): Promise<Buffer> {
    const part = textPart(meta?.bodyStructure);
    const kind = part?.html ? 'html' : 'plain';
    let text = '';
    if (part) {
      const dl = await this.client.download(String(uid), part.id, { uid: true, maxBytes: TEXT_CAP });
      if (dl.content) text = (await readStream(dl.content, TEXT_CAP)).toString('utf8');
    }
    const plan = planAttachments(meta?.bodyStructure ? toPart(meta.bodyStructure) : undefined);
    const extras: string[] = [];
    for (const small of plan.smallText) {
      if (!small.part) continue;
      const dl = await this.client.download(String(uid), small.part, { uid: true, maxBytes: SMALL_CAP });
      if (!dl.content) continue;
      const snippet = (await readStream(dl.content, SMALL_CAP)).toString('utf8').replace(/\u0000/g, '').trim().slice(0, 1_000);
      if (snippet) extras.push(`${small.filename ?? 'Anhang'}:\n${snippet}`);
    }
    const note = [...plan.notes, ...extras].join('\n');
    if (note) text = text.trim() ? `${note}\n\n${text}` : note;
    return synthesize(meta?.envelope, meta?.internalDate, kind, text);
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
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 60_000,
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
