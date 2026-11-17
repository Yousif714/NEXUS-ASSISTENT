import type { ImportedMessage } from '@/domain/import/batch';
import { emptyBatch } from '@/domain/import/batch';
import { toE164 } from '@/domain/matching/messages';
import type { MessageAttachment } from '@/domain/types';

/** Kunden-WhatsApp des Zulassungsdienstes. Nur eingehend, nichts wird gesendet. */
export const WHATSAPP_KUNDEN = 'whatsapp_kunden' as const;

export interface WhatsAppParseOptions {
  /** Steht sie, werden nur Ereignisse dieser Telefonnummern-ID übernommen. */
  phoneNumberId?: string;
  /** Steht sie, werden nur Einträge dieses WhatsApp-Business-Kontos übernommen. */
  wabaId?: string;
}

export interface WhatsAppImport {
  batch: ReturnType<typeof emptyBatch>;
  /** Jüngster Nachrichtenzeitpunkt, sonst null (der Webhook behält dann den alten Cursor). */
  cursor: string | null;
  /** false, solange ein Historien-Stück `progress` unter 100 meldet. */
  complete: boolean;
  /** Dieses Ereignis enthielt das Feld `history`. */
  historySeen: boolean;
  /** Mindestens eine Änderung gehörte zu dieser Nummer bzw. diesem Konto. */
  relevant: boolean;
}

const MEDIA: Record<string, string> = {
  image: 'Bild',
  video: 'Video',
  audio: 'Sprachnachricht',
  document: 'Dokument',
  sticker: 'Sticker',
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const idOf = (v: unknown): string | undefined => str(v) ?? (typeof v === 'number' && Number.isFinite(v) ? String(v) : undefined);

const e164 = (raw: string): string => {
  const t = toE164(raw.trim());
  return /^\+\d{6,15}$/.test(t) ? t : '';
};

const samePhone = (a: string, b: string): boolean => {
  const da = e164(a).replace(/\D/g, '');
  const db = e164(b).replace(/\D/g, '');
  return da.length >= 6 && da === db;
};

function sentAtOf(ts: unknown): string | null {
  if (typeof ts !== 'string' && typeof ts !== 'number') return null;
  const n = typeof ts === 'number' ? ts : Number(ts.trim());
  if (!Number.isFinite(n) || n < 1_000_000_000) return null;
  const ms = n < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Sichtbarer Text. Medien nur als Bezeichnung, Dateiname, Typ und Bildunterschrift – kein Abruf, keine URL. */
function readBody(m: Obj): string | null {
  const type = str(m.type) ?? 'unknown';
  if (type === 'text') return str(isObj(m.text) ? m.text.body : undefined) ?? '';
  if (type === 'button') {
    const b = isObj(m.button) ? m.button : {};
    return str(b.text) ?? str(b.payload) ?? '[Schaltfläche]';
  }
  if (type === 'interactive') {
    const i = isObj(m.interactive) ? m.interactive : {};
    const reply = isObj(i.button_reply) ? i.button_reply : isObj(i.list_reply) ? i.list_reply : {};
    return str(reply.title) ?? str(reply.description) ?? '[Interaktiv]';
  }
  if (type === 'reaction') {
    const emoji = str(isObj(m.reaction) ? m.reaction.emoji : undefined);
    return emoji ? `[Reaktion] ${emoji}` : '[Reaktion entfernt]';
  }
  if (type === 'location') {
    const l = isObj(m.location) ? m.location : {};
    const name = [str(l.name), str(l.address)].filter(Boolean).join(', ');
    const coord = typeof l.latitude === 'number' && typeof l.longitude === 'number' ? `${l.latitude}, ${l.longitude}` : '';
    return ['[Standort]', name || coord].filter(Boolean).join(' ');
  }
  if (type === 'contacts') {
    const list = Array.isArray(m.contacts) ? m.contacts : [];
    const names = list
      .map((c) => (isObj(c) && isObj(c.name) ? str(c.name.formatted_name) : undefined))
      .filter((n): n is string => !!n);
    return names.length ? `[Kontakt] ${names.join(', ')}` : '[Kontakt]';
  }
  if (type === 'system') {
    const body = str(isObj(m.system) ? m.system.body : undefined);
    return body ? `[System] ${body}` : '[System]';
  }
  if (type === 'order') return str(isObj(m.order) ? m.order.text : undefined) ?? '[Bestellung]';
  if (type === 'media_placeholder') return '[Medium] In der Historie nicht mehr verfügbar';
  if (type === 'unsupported' || type === 'unknown' || type === 'errors') return '[Nachricht ohne Text]';
  const media = isObj(m[type]) ? m[type] : null;
  if (media && (MEDIA[type] || str(media.mime_type) || str(media.id))) {
    const label = MEDIA[type] ?? 'Medium';
    const extra = str(media.filename) ?? str(media.mime_type);
    const caption = str(media.caption);
    const head = extra ? `[${label} · ${extra}]` : `[${label}]`;
    return caption ? `${head} ${caption}` : head;
  }
  if (Array.isArray(m.errors)) return '[Nachricht ohne Text]';
  return null;
}


/** Metadaten eines Mediums. Die ID bleibt am Anhang, nie im Text, und es wird nichts abgerufen. */
function readAttachment(m: Obj): MessageAttachment | null {
  const type = str(m.type) ?? '';
  if (!MEDIA[type]) return null;
  const media = isObj(m[type]) ? m[type] : null;
  if (!media) return null;
  const kind = (type === 'image' || type === 'video' || type === 'audio' || type === 'document' || type === 'sticker' ? type : 'other') as MessageAttachment['kind'];
  const filename = str(media.filename);
  const mime = str(media.mime_type);
  const mediaId = str(media.id);
  const caption = str(media.caption);
  return {
    kind,
    ...(filename ? { filename } : {}),
    ...(mime ? { mime } : {}),
    ...(mediaId ? { mediaId } : {}),
    ...(caption ? { caption } : {}),
  };
}

/** WhatsApp-Profilnamen. Nimmt die Kontaktliste oder das ganze `value` (Feld `contacts`). */
function profileNames(list: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const items = Array.isArray(list) ? list : isObj(list) && Array.isArray(list.contacts) ? list.contacts : [];
  for (const c of items) {
    if (!isObj(c)) continue;
    const name = isObj(c.profile) ? str(c.profile.name)?.trim().slice(0, 200) : undefined;
    const phone = e164(str(c.wa_id) ?? '');
    if (name && phone) names.set(phone, name);
  }
  return names;
}

/**
 * Cloud-API-Webhook → Import-Stapel. Idempotent über die WhatsApp-Nachrichten-ID.
 * Echos aus der Business-App (`smb_message_echoes`) werden ausgehend. Historie und
 * `smb_app_state_sync` werden gelesen; Kontakte aus der App legt der Import nicht an
 * (Verknüpfung nur über die Telefonnummer, damit niemand doppelt entsteht).
 */
export function parseWhatsAppWebhook(payload: unknown, opts: WhatsAppParseOptions = {}): WhatsAppImport {
  const batch = emptyBatch();
  const found = new Map<string, ImportedMessage>();
  let cursor: string | null = null;
  let complete = true;
  let historySeen = false;
  let relevant = false;

  const put = (next: ImportedMessage) => {
    const prev = found.get(next.externalId);
    if (!prev) {
      found.set(next.externalId, next);
    } else {
      const direction = prev.direction === 'out' || next.direction === 'out' ? 'out' : 'in';
      const fromEcho = direction === 'out' && next.direction !== 'out';
      const fromName = next.fromName || prev.fromName;
      const profileName = next.profileName || prev.profileName || fromName;
      const attachments = next.attachments?.length ? next.attachments : prev.attachments;
      found.set(next.externalId, {
        ...next,
        direction,
        from: fromEcho ? prev.from : next.from || prev.from,
        to: fromEcho ? prev.to : next.to || prev.to,
        body: direction === 'out'
          ? (next.direction === 'out' ? next.body || prev.body : prev.body || next.body)
          : next.body || prev.body,
        needsReply: direction === 'out' ? false : next.needsReply,
        sentAt: next.sentAt || prev.sentAt,
        threadId: next.threadId || prev.threadId,
        ...(fromName ? { fromName } : {}),
        ...(profileName ? { profileName } : {}),
        ...(attachments?.length ? { attachments } : {}),
      });
    }
    if (!cursor || next.sentAt > cursor) cursor = next.sentAt;
  };

  const build = (m: Obj, business: string, mode: 'in' | 'out' | 'auto', threadHint: string, fromHistory: boolean, names: Map<string, string>): ImportedMessage | null => {
    if (str(m.group_id)) return null;
    const externalId = (str(m.id) ?? '').slice(0, 500);
    const sentAt = sentAtOf(m.timestamp);
    if (!externalId || !sentAt) return null;
    const fromRaw = str(m.from) ?? '';
    const toRaw = str(m.to) ?? '';
    const fromBusiness = samePhone(fromRaw, business);
    const direction: 'in' | 'out' = mode === 'auto' ? (fromBusiness ? 'out' : 'in') : mode;
    const customerRaw = threadHint || (direction === 'in' ? fromRaw : toRaw);
    const customer = e164(customerRaw);
    const biz = e164(business);
    const from = e164(direction === 'out' ? fromRaw || business : fromRaw) || (direction === 'out' ? biz : '');
    const to = e164(direction === 'out' ? toRaw || customerRaw : toRaw || business) || (direction === 'in' ? biz : '');
    if (!from && !to) return null;
    const bodyRaw = readBody(m);
    if (bodyRaw === null || bodyRaw.trim() === '') return null;
    const seen = fromHistory && isObj(m.history_context) && (m.history_context.status === 'read' || m.history_context.status === 'played');
    const threadId = (customer || customerRaw.trim() || externalId).slice(0, 200);
    const attachment = readAttachment(m);
    const profileName = direction === 'in' ? names.get(from) ?? names.get(customer) ?? names.get(customerRaw) : undefined;
    return {
      channel: 'whatsapp',
      connectionId: WHATSAPP_KUNDEN,
      externalId,
      threadId,
      direction,
      from: (from || fromRaw).slice(0, 500),
      to: (to || toRaw).slice(0, 500),
      body: bodyRaw.replace(/\u0000/g, '').slice(0, 2_400),
      sentAt,
      needsReply: direction === 'in' && !seen,
      ...(profileName ? { fromName: profileName, profileName } : {}),
      ...(attachment ? { attachments: [attachment] } : {}),
    };
  };

  const takeList = (list: unknown, business: string, mode: 'in' | 'out' | 'auto', threadHint: string, fromHistory: boolean, names: Map<string, string> = new Map()) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!isObj(item)) continue;
      const msg = build(item, business, mode, threadHint, fromHistory, names);
      if (msg) put(msg);
    }
  };

  const takeHistory = (history: unknown, business: string, names: Map<string, string>) => {
    historySeen = true;
    if (!Array.isArray(history)) return;
    for (const chunk of history) {
      if (!isObj(chunk)) continue;
      const meta = isObj(chunk.metadata) ? chunk.metadata : {};
      if (typeof meta.progress === 'number' && meta.progress < 100) complete = false;
      const threads = Array.isArray(chunk.threads) ? chunk.threads : [];
      if (threads.length === 0 && Array.isArray(chunk.messages)) takeList(chunk.messages, business, 'auto', '', true, names);
      for (const thread of threads) {
        if (!isObj(thread)) continue;
        takeList(thread.messages, business, 'auto', str(thread.id) ?? '', true, names);
      }
    }
  };

  if (!isObj(payload) || payload.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    return { batch, cursor, complete, historySeen, relevant };
  }

  for (const entry of payload.entry) {
    if (!isObj(entry)) continue;
    if (opts.wabaId && idOf(entry.id) !== opts.wabaId) continue;
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      if (!isObj(change)) continue;
      const field = str(change.field);
      if (!field || !['messages', 'smb_message_echoes', 'history', 'smb_app_state_sync'].includes(field)) continue;
      const value = isObj(change.value) ? change.value : null;
      if (!value) continue;
      const meta = isObj(value.metadata) ? value.metadata : {};
      const phoneId = idOf(meta.phone_number_id);
      if (opts.phoneNumberId && phoneId !== opts.phoneNumberId) continue;
      relevant = true;
      const business = str(meta.display_phone_number) ?? '';
      const names = profileNames(value.contacts);
      if (field === 'history' || Array.isArray(value.history)) takeHistory(value.history, business, names);
      const echoes = Array.isArray(value.message_echoes) ? value.message_echoes : field === 'smb_message_echoes' && Array.isArray(value.echoes) ? value.echoes : null;
      if (echoes) takeList(echoes, business, 'out', '', false, names);
      if (Array.isArray(value.messages) && field !== 'history') takeList(value.messages, business, field === 'smb_message_echoes' ? 'out' : 'auto', '', false, names);
    }
  }

  batch.messages = [...found.values()];
  return { batch, cursor, complete, historySeen, relevant };
}
