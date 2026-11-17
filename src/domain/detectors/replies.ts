import { emailsIn } from '../import/mail';
import { showMessage } from '../features';
import { openReplies, phoneKey } from '../matching/messages';
import type { AppState, Insight, Message } from '../types';
import { threadRef } from './refs';

/** Eine Person, ein Hinweis. Die älteste unbeantwortete Nachricht bleibt der Schlüssel (Abhaken gilt für sie). */
export function detectReplies(s: AppState, now: Date): Insight[] {
  const open = openReplies(s.messages.filter(showMessage), now, s.settings.replyThresholdHours, s.contacts);
  const groups = new Map<string, typeof open>();
  for (const item of open) {
    const key = replyGroup(item.message);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const insights: Insight[] = [];
  for (const list of groups.values()) {
    const oldest = [...list].sort((a, b) => b.waitingHours - a.waitingHours || a.message.sentAt.localeCompare(b.message.sentAt))[0];
    const m = oldest.message;
    const contact = s.contacts.find((c) => c.id === m.contactId);
    const name = contact?.name ?? m.fromName ?? m.from;
    const extra = list.length > 1 ? `${list.length} Nachrichten. ` : '';
    insights.push({
      dedupeKey: `reply:${m.id}`,
      type: 'reply_waiting',
      company: contact?.company ?? null,
      priority: contact?.kind === 'dealer' && oldest.waitingHours >= 3 ? 'now' : 'today',
      title: `${name} wartet seit ${oldest.waitingHours} Std. auf Antwort`,
      body: `${extra}${m.body}`,
      refs: [threadRef(m.threadId, name)],
      nextStep: 'Antwort senden',
      needsSources: [m.connectionId],
    });
  }
  return insights;
}

function replyGroup(m: Message): string {
  const phone = phoneKey(m.from) ?? phoneKey(m.threadId);
  if (phone) return `tel:${phone}`;
  const email = emailsIn(m.from)[0];
  if (email) return `mail:${email}`;
  return m.contactId ?? m.id;
}
