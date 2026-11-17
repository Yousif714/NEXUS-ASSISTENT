import { classifyJobMessage, type DocKind } from '@/domain/matching/job-messages';
import { openReplies, toE164 } from '@/domain/matching/messages';
import type { Contact, Message } from '@/domain/types';

/** Eine Unterhaltung im Postfach (wie die Chatliste in WhatsApp). */
export interface InboxRow {
  threadId: string;
  channel: Message['channel'];
  contactId: string | null;
  /** Kontaktname, sonst WhatsApp-Profilname, sonst Nummer bzw. Adresse. */
  name: string;
  phone: string | null;
  preview: string;
  lastAt: string;
  lastDirection: Message['direction'];
  count: number;
  /** Stunden, die die älteste unbeantwortete Nachricht wartet; `null` = nichts offen. */
  waitingHours: number | null;
  overdue: boolean;
  hasOrder: boolean;
  docs: DocKind[];
  /** Kleingeschriebener Suchtext (Name, Nummer, alle Texte). */
  search: string;
}

export type InboxFilter = 'all' | 'waiting' | 'orders';

const validPhone = (raw: string): string | null => {
  const p = toE164(raw);
  return /^\+\d{6,15}$/.test(p) ? p : null;
};

export function buildInbox(s: { messages: Message[]; contacts: Contact[] }, at: Date, thresholdHours: number): InboxRow[] {
  const threads = new Map<string, Message[]>();
  for (const m of s.messages) {
    const key = `${m.channel}|${m.threadId}`;
    const list = threads.get(key);
    if (list) list.push(m);
    else threads.set(key, [m]);
  }
  const rows: InboxRow[] = [];
  for (const list of threads.values()) {
    list.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    const last = list[list.length - 1];
    const incoming = list.filter((m) => m.direction === 'in');
    const counterpart = incoming.at(-1)?.from ?? last.to;
    const contactId = list.findLast((m) => m.contactId)?.contactId ?? null;
    const contact = contactId ? s.contacts.find((c) => c.id === contactId) : undefined;
    const phone = last.channel === 'whatsapp' ? validPhone(counterpart) : null;
    const fromName = incoming.findLast((m) => m.fromName)?.fromName;
    const waiting = openReplies(list, at, 0);
    const waitingHours = waiting.length ? Math.max(...waiting.map((w) => w.waitingHours)) : null;
    const classes = incoming.map((m) => classifyJobMessage(m.body));
    const name = contact?.name ?? fromName ?? phone ?? counterpart;
    rows.push({
      threadId: last.threadId,
      channel: last.channel,
      contactId,
      name,
      phone,
      preview: last.body,
      lastAt: last.sentAt,
      lastDirection: last.direction,
      count: list.length,
      waitingHours,
      overdue: waitingHours !== null && waitingHours >= thresholdHours,
      hasOrder: classes.some((c) => c.kind !== null),
      docs: [...new Set(classes.flatMap((c) => c.docs))],
      search: [name, fromName ?? '', phone ?? '', counterpart, ...list.map((m) => m.body)].join('\n').toLowerCase(),
    });
  }
  return rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export function filterInbox(rows: InboxRow[], filter: InboxFilter, query: string): InboxRow[] {
  const q = query.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const phoneQuery = digits.length >= 4 && /^[\d\s+\-/()]+$/.test(q) ? (digits.startsWith('0') && !digits.startsWith('00') ? `49${digits.slice(1)}` : digits.replace(/^00/, '')) : null;
  return rows.filter((r) => {
    if (filter === 'waiting' && r.waitingHours === null) return false;
    if (filter === 'orders' && !r.hasOrder) return false;
    if (!q) return true;
    if (phoneQuery && r.phone?.replace(/\D/g, '').includes(phoneQuery)) return true;
    return r.search.includes(q);
  });
}

export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w));
  if (words.length === 0) return '#';
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}
