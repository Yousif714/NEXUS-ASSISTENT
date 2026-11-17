import { mdcVorgang } from '@/domain/import/mydigitalcar';
import { extractPlates, extractVins, plateInText, toE164 } from '@/domain/matching/messages';
import type { Contact, Job, Message, Vehicle } from '@/domain/types';

/** Unterlagen, die Kunden für eine Zulassung schicken. */
export type DocKind = 'zb1' | 'zb2' | 'evb' | 'vollmacht' | 'sepa' | 'ausweis' | 'gewerbe' | 'coc' | 'hu';

export const DOC_LABEL: Record<DocKind, string> = {
  zb1: 'Fahrzeugschein (ZB I)',
  zb2: 'Fahrzeugbrief (ZB II)',
  evb: 'eVB',
  vollmacht: 'Vollmacht',
  sepa: 'SEPA-Mandat',
  ausweis: 'Ausweis',
  gewerbe: 'Gewerbenachweis',
  coc: 'CoC',
  hu: 'HU/TÜV',
};

// Reihenfolge = Reihenfolge im Ergebnis. Muster laufen auf kleingeschriebenem Text.
const DOC_PATTERNS: [DocKind, RegExp][] = [
  ['zb1', /fahrzeugschein|zulassungsbescheinigung\s*teil\s*(?:1|i)(?![iv])|\bzb\s*(?:1|i)(?![iv])\b/],
  ['zb2', /fahrzeugbrief|zulassungsbescheinigung\s*teil\s*(?:2|ii)\b|\bzb\s*(?:2|ii)\b/],
  ['evb', /\bevb\b|versicherungsbestätigung|doppelkarte/],
  ['vollmacht', /vollmacht/],
  ['sepa', /\bsepa\b|lastschrift|einzugsermächtigung/],
  ['ausweis', /personalausweis|\bausweis|\bperso\b|reisepass/],
  ['gewerbe', /gewerbeanmeldung|gewerbeschein|handelsregister/],
  ['coc', /\bcoc\b|übereinstimmungsbescheinigung/],
  ['hu', /\btüv\b|hu-bericht|hauptuntersuchung/],
];

const ORDER_RE = /ummeld|anmeld|abmeld|zulass|neuzulassung|umschreib|wunschkennzeichen|kennzeichen reserv|außerbetrieb|stilleg|auftrag/;
const MEDIA_RE = /^\[(?:bild|dokument)\b/;

export type JobMessageKind = 'auftrag' | 'nachweis';

export interface JobMessageClass { kind: JobMessageKind | null; docs: DocKind[] }

/**
 * Was eine Nachricht für den Zulassungsdienst ist. Unterlagen (oder ein Bild/Dokument) → Nachweis,
 * sonst Auftragswörter → Auftrag. Rein textbasiert: Bildinhalte werden hier nicht gelesen.
 */
export function classifyJobMessage(body: string): JobMessageClass {
  const t = body.toLowerCase();
  const docs = DOC_PATTERNS.filter(([, re]) => re.test(t)).map(([k]) => k);
  if (docs.length > 0 || MEDIA_RE.test(t)) return { kind: 'nachweis', docs };
  if (ORDER_RE.test(t)) return { kind: 'auftrag', docs };
  return { kind: null, docs };
}

export interface JobMessageEntry {
  messageId: string;
  threadId: string;
  sentAt: string;
  direction: Message['direction'];
  kind: JobMessageKind | null;
  docs: DocKind[];
  /** Kontaktname, sonst WhatsApp-Profilname, bei eigenen Nachrichten „Du“. */
  senderName: string | null;
  senderPhone: string | null;
  body: string;
}

type Source = { messages: Message[]; vehicles: Vehicle[]; contacts: Contact[] };

function entryOf(m: Message, contacts: Contact[]): JobMessageEntry {
  const { kind, docs } = classifyJobMessage(m.body);
  const out = m.direction === 'out';
  const raw = out ? null : toE164(m.from);
  const phone = raw && /^\+\d{6,15}$/.test(raw) ? raw : null;
  const contact = !out && m.contactId ? contacts.find((c) => c.id === m.contactId) : undefined;
  const byPhone = !out && !contact && phone ? contacts.find((c) => c.phones.some((p) => toE164(p) === phone)) : undefined;
  return {
    messageId: m.id,
    threadId: m.threadId,
    sentAt: m.sentAt,
    direction: m.direction,
    kind,
    docs,
    senderName: out ? 'Du' : (contact ?? byPhone)?.name ?? m.fromName ?? m.profileName ?? null,
    senderPhone: phone,
    body: m.body,
  };
}

function mentionsJob(m: Message, job: Job, vehicle: Vehicle | undefined): boolean {
  if (m.jobId === job.id) return true;
  const upper = m.body.toUpperCase();
  if (vehicle?.plate && plateInText(vehicle.plate, upper)) return true;
  if (vehicle?.vin && vehicle.vin.length === 17 && extractVins(upper).includes(vehicle.vin.toUpperCase())) return true;
  const vorgang = mdcVorgang(job)?.trim().toUpperCase();
  if (vorgang && vorgang.length >= 5) {
    const esc = vorgang.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![A-Z0-9])${esc}(?![A-Z0-9])`).test(upper)) return true;
  }
  return false;
}

/** Alle Nachrichten zu einem Auftrag (gespeicherte Zuordnung, Kennzeichen, FIN, Vorgangsnummer), neueste zuerst. */
export function jobActivity(job: Job, s: Source): JobMessageEntry[] {
  const vehicle = s.vehicles.find((v) => v.id === job.vehicleId);
  return s.messages
    .filter((m) => m.channel === 'whatsapp' && mentionsJob(m, job, vehicle))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    .map((m) => entryOf(m, s.contacts));
}

export interface UnlinkedOrderEntry extends JobMessageEntry { plates: string[]; vins: string[] }

/** Eingehende Aufträge und Nachweise aus WhatsApp, zu denen es noch keinen Auftrag gibt. Neueste zuerst. */
export function unlinkedOrderMessages(s: Source & { jobs: Job[] }): UnlinkedOrderEntry[] {
  const vehiclesById = new Map(s.vehicles.map((v) => [v.id, v]));
  return s.messages
    .filter((m) => m.channel === 'whatsapp' && m.direction === 'in' && !m.jobId)
    .filter((m) => classifyJobMessage(m.body).kind !== null)
    .filter((m) => !s.jobs.some((j) => mentionsJob(m, j, j.vehicleId ? vehiclesById.get(j.vehicleId) : undefined)))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))
    .map((m) => ({ ...entryOf(m, s.contacts), plates: extractPlates(m.body), vins: extractVins(m.body) }));
}
