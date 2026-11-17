import { emailsIn } from '@/domain/import/mail';
import { isAutomatedMail } from '@/domain/mail-text';
import type { Contact, Job, Message, Vehicle } from '@/domain/types';

export function normalizePhone(s: string): string {
  let t = s.replace(/[\s\-/()]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  else if (t.startsWith('0')) t = '+49' + t.slice(1);
  return t;
}

/** Normalisierte Nummer, wenn sie wie eine Telefonnummer aussieht (+ und 6–15 Ziffern), sonst `null`. */
export function validPhone(s: string): string | null {
  const t = normalizePhone(s.trim());
  return /^\+\d{6,15}$/.test(t) ? t : null;
}

/**
 * Kanonische E.164-Form.
 * Führende 0 wird +49, 00 wird +, reine Ziffern mit Ländervorwahl (so schickt WhatsApp sie) bekommen +.
 */
export function toE164(s: string): string {
  const t = normalizePhone(s);
  if (t.startsWith('+')) return t;
  if (/^\d{8,15}$/.test(t)) return `+${t}`;
  return t;
}

const PLATE_RE = /(?<![A-Za-zÄÖÜ0-9])([A-ZÄÖÜ]{1,3})[- ]([A-Z]{1,2}) ?(\d{1,4}[EH]?)(?![A-Za-z0-9])/g;

export function extractPlates(text: string): string[] {
  return [...text.toUpperCase().matchAll(PLATE_RE)].map((m) => `${m[1]}-${m[2]} ${m[3]}`);
}

export function extractVins(text: string): string[] {
  return [...text.toUpperCase().matchAll(/(?<![A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])/g)]
    .map((m) => m[0])
    .filter((v) => /\d/.test(v));
}

/** Bekanntes Kennzeichen im (großgeschriebenen) Text, Trenner optional, mit Wortgrenzen: „BOT-MK 45“ trifft nicht „BOT-MK 456“. */
export function plateInText(plate: string, upperText: string): boolean {
  const m = /^([A-ZÄÖÜ]{1,3})[- ]?([A-Z]{1,2}) ?(\d{1,4}[EH]?)$/.exec(plate.toUpperCase().trim());
  if (!m) return false;
  return new RegExp(`(?<![A-ZÄÖÜ0-9])${m[1]}[- ]?${m[2]}[- ]?${m[3]}(?![A-Z0-9])`).test(upperText);
}

type MatchInput = Pick<Message, 'from' | 'to' | 'direction' | 'body'>;

export function matchMessage(
  m: MatchInput,
  contacts: Contact[],
  vehicles: Vehicle[],
  jobs: Job[],
): { contactId: string | null; jobId: string | null } {
  const counterpart = m.direction === 'in' ? m.from : m.to;
  let contactId: string | null = null;
  let jobId: string | null = null;

  const phone = toE164(counterpart);
  if (/^\+\d{6,15}$/.test(phone)) contactId = contacts.find((c) => c.phones.some((p) => toE164(p) === phone))?.id ?? null;
  if (!contactId) {
    const addr = counterpart.toLowerCase();
    contactId = contacts.find((c) => c.emails.some((e) => e && addr.includes(e.toLowerCase())))?.id ?? null;
  }

  const body = m.body.toUpperCase();
  const vins = extractVins(body);
  const vehicle = vehicles.find((v) => plateInText(v.plate, body)) ?? vehicles.find((v) => vins.includes(v.vin.toUpperCase()));
  if (vehicle) {
    contactId ??= vehicle.contactId;
    const open = jobs
      .filter((j) => j.vehicleId === vehicle.id && j.status !== 'paid')
      .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
    jobId = open[0]?.id ?? null;
  }
  return { contactId, jobId };
}

/** Kanonische Rufnummer, sonst `null`. `+49`, `0049`, `0…` und die reine Ziffernfolge von WhatsApp fallen zusammen. */
export function phoneKey(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const t = toE164(raw.trim());
  return /^\+\d{6,15}$/.test(t) ? t : null;
}

type PartyIndex = { byPhone: Map<string, string>; byEmail: Map<string, string> };

function indexContacts(contacts: readonly Contact[]): PartyIndex {
  const byPhone = new Map<string, string>();
  const byEmail = new Map<string, string>();
  for (const c of contacts) {
    for (const p of c.phones) {
      const k = phoneKey(p);
      if (k && !byPhone.has(k)) byPhone.set(k, c.id);
    }
    for (const e of c.emails) {
      const k = e.trim().toLowerCase();
      if (k && !byEmail.has(k)) byEmail.set(k, c.id);
    }
  }
  return { byPhone, byEmail };
}

/** Schlüssel derselben Person: normalisierte Nummer, E-Mail, Kontakt. Der Thread zählt nur im selben Kanal. */
function partyKeys(m: Message, ix: PartyIndex): string[] {
  const keys = new Set<string>();
  const raw = m.direction === 'in' ? m.from : m.to;
  const phones = new Set<string>();
  const direct = phoneKey(raw);
  if (direct) phones.add(direct);
  const threadPhone = phoneKey(m.threadId);
  if (threadPhone) phones.add(threadPhone);
  const emails = emailsIn(raw);
  const contactIds = new Set<string>();
  if (m.contactId) contactIds.add(m.contactId);
  for (const p of phones) {
    const id = ix.byPhone.get(p);
    if (id) contactIds.add(id);
  }
  for (const e of emails) {
    const id = ix.byEmail.get(e);
    if (id) contactIds.add(id);
  }
  for (const id of contactIds) keys.add(`c:${id}`);
  for (const p of phones) keys.add(`tel:${p}`);
  for (const e of emails) keys.add(`mail:${e}`);
  keys.add(`th:${m.channel}:${m.threadId}`);
  return [...keys];
}

/**
 * Dieselbe Person, unabhängig von Kanal, Gerät und Thread.
 * Telefon und E-Mail werden normalisiert; ein Kontakt verbindet beide Kanäle.
 */
export function sameParty(a: Message, b: Message, contacts: readonly Contact[] = []): boolean {
  const ix = indexContacts(contacts);
  const right = new Set(partyKeys(b, ix));
  return partyKeys(a, ix).some((k) => right.has(k));
}

function pushTime(map: Map<string, number[]>, key: string, at: number) {
  const list = map.get(key);
  if (list) list.push(at);
  else map.set(key, [at]);
}

/** Eingehende Nachrichten, auf die noch keine spätere Ausgangsnachricht an dieselbe Person folgt. */
export function pendingReplies(messages: Message[], contacts: readonly Contact[] = []): Message[] {
  const ix = indexContacts(contacts);
  const times = new Map<string, number[]>();
  for (const m of messages) {
    if (m.direction !== 'out') continue;
    const at = Date.parse(m.sentAt);
    if (!Number.isFinite(at)) continue;
    for (const key of partyKeys(m, ix)) pushTime(times, key, at);
  }
  const result: Message[] = [];
  for (const msg of messages) {
    if (msg.direction !== 'in' || !msg.needsReply || msg.doneManually || isAutomatedMail(msg)) continue;
    const sent = Date.parse(msg.sentAt);
    if (!Number.isFinite(sent)) continue;
    const answered = partyKeys(msg, ix).some((key) => times.get(key)?.some((t) => t > sent));
    if (!answered) result.push(msg);
  }
  return result;
}

export function openReplies(
  messages: Message[],
  now: Date,
  thresholdHours: number,
  contacts: readonly Contact[] = [],
): { message: Message; waitingHours: number }[] {
  const result: { message: Message; waitingHours: number }[] = [];
  for (const msg of pendingReplies(messages, contacts)) {
    const waitingHours = Math.floor((now.getTime() - Date.parse(msg.sentAt)) / 3_600_000);
    if (waitingHours >= thresholdHours) result.push({ message: msg, waitingHours });
  }
  return result;
}
