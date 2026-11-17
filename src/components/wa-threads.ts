import { pendingReplies } from '@/domain/matching/messages';
import type { Contact, Message } from '@/domain/types';

export type WaFilter = 'all' | 'unanswered' | 'job' | 'unassigned';

export interface WaThread {
  threadId: string;
  channel: Message['channel'];
  title: string;
  phone: string;
  preview: string;
  at: string;
  unanswered: number;
  contactId: string | null;
  jobId: string | null;
  intake: Message['intake'];
}

/** Eine Zeile je Unterhaltung, neueste oben. WhatsApp zuerst, E-Mail bleibt dabei, wenn der Verlauf gerade offen ist. */
export function buildThreads(messages: Message[], contacts: Contact[], focusId?: string): WaThread[] {
  const pending = new Set(pendingReplies(messages, contacts).map((m) => m.id));
  const byId = new Map<string, Message[]>();
  for (const m of messages) {
    if (m.channel !== 'whatsapp' && m.threadId !== focusId) continue;
    const list = byId.get(m.threadId) ?? [];
    list.push(m);
    byId.set(m.threadId, list);
  }
  const threads: WaThread[] = [];
  for (const [threadId, list] of byId) {
    const sorted = [...list].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    const last = sorted[sorted.length - 1];
    const contactId = [...sorted].reverse().find((m) => m.contactId)?.contactId ?? null;
    const contact = contactId ? contacts.find((c) => c.id === contactId) : undefined;
    const profile = [...sorted].reverse().find((m) => m.profileName)?.profileName;
    const inbound = [...sorted].reverse().find((m) => m.direction === 'in');
    const phone = inbound?.from || last.from;
    const title = contact?.name || profile || phone;
    const jobId = [...sorted].reverse().find((m) => m.jobId)?.jobId ?? null;
    const intake = [...sorted].reverse().find((m) => m.intake)?.intake;
    threads.push({
      threadId, channel: last.channel, title, phone, preview: last.body, at: last.sentAt,
      unanswered: sorted.filter((m) => pending.has(m.id)).length, contactId, jobId, intake,
    });
  }
  return threads.sort((a, b) => b.at.localeCompare(a.at) || a.title.localeCompare(b.title, 'de'));
}

export function filterThreads(threads: WaThread[], filter: WaFilter, query: string): WaThread[] {
  const q = query.trim().toLowerCase();
  return threads.filter((t) => {
    if (filter === 'unanswered' && t.unanswered === 0) return false;
    if (filter === 'job' && !t.jobId) return false;
    if (filter === 'unassigned' && t.contactId) return false;
    if (!q) return true;
    return [t.title, t.phone, t.preview, t.threadId].some((part) => part.toLowerCase().includes(q));
  });
}
