import { describe, expect, test } from 'vitest';
import { buildInbox, filterInbox, initialsOf } from '@/domain/inbox';
import type { Contact, Message } from '@/domain/types';

const msg = (over: Partial<Message>): Message => ({
  id: 'm', channel: 'whatsapp', connectionId: 'whatsapp_kunden', externalId: 'w', threadId: '+491715551234',
  direction: 'in', from: '+491715551234', to: '+491511111111', body: '', sentAt: '2026-11-17T08:00:00.000Z',
  contactId: null, jobId: null, needsReply: false, ...over,
});
const anna: Contact = { id: 'c1', company: 'zulassung', kind: 'private', name: 'Anna Beispiel', phones: ['0171 5551234'], emails: [] };
const at = new Date('2026-11-17T12:00:00.000Z');

const messages = [
  msg({ id: 'a1', body: 'Bitte ummelden BOT-AB 123', contactId: 'c1', needsReply: true, sentAt: '2026-11-17T09:00:00.000Z' }),
  msg({ id: 'a2', body: '[Bild] Fahrzeugschein', contactId: 'c1', needsReply: true, sentAt: '2026-11-17T09:05:00.000Z' }),
  msg({ id: 'b1', threadId: '+491605550000', from: '+491605550000', body: 'Danke!', fromName: 'Max Muster', sentAt: '2026-11-17T11:00:00.000Z' }),
  msg({ id: 'b2', threadId: '+491605550000', direction: 'out', from: '+491511111111', to: '+491605550000', body: 'Gern', sentAt: '2026-11-17T11:30:00.000Z' }),
  msg({ id: 'e1', channel: 'email', connectionId: 'gmail', threadId: 'mail-1', from: 'x@example.de', body: 'Rechnung', sentAt: '2026-11-16T08:00:00.000Z' }),
];

describe('buildInbox', () => {
  test('eine Zeile je Unterhaltung, neueste zuerst, mit Name, Nummer, Vorschau, Warten und Markern', () => {
    const rows = buildInbox({ messages, contacts: [anna] }, at, 2);
    expect(rows.map((r) => r.threadId)).toEqual(['+491605550000', '+491715551234', 'mail-1']);
    const anna1 = rows[1];
    expect(anna1).toMatchObject({
      name: 'Anna Beispiel', phone: '+491715551234', preview: '[Bild] Fahrzeugschein', count: 2,
      waitingHours: 3, hasOrder: true, docs: ['zb1'], contactId: 'c1', channel: 'whatsapp',
    });
    expect(rows[0]).toMatchObject({ name: 'Max Muster', waitingHours: null, lastDirection: 'out' });
    expect(rows[2]).toMatchObject({ channel: 'email', name: 'x@example.de', phone: null, system: false });
  });
  test('System-Mail: Anzeigename, Kurztext, zählt nicht als Warten', () => {
    const url = 'https://accounts.google.com/AccountChooser?Email=very-long-token-that-must-not-stretch-the-card';
    const raw = msg({
      id: 'g1', channel: 'email', connectionId: 'gmail', threadId: 'g-1', needsReply: true,
      from: '"Google" <no-reply@accounts.google.com>',
      subject: 'Sicherheitswarnung',
      body: `Sicherheitswarnung\n\n[image: Google] Jemand hat sich angemeldet. ${url} List-Unsubscribe`,
      sentAt: '2026-11-17T04:10:00.000Z',
    });
    const rows = buildInbox({ messages: [raw], contacts: [] }, at, 2);
    expect(rows[0]).toMatchObject({ name: 'Google', subject: 'Sicherheitswarnung', system: true, waitingHours: null });
    expect(rows[0].preview).not.toMatch(/https?:/);
    expect(rows[0].preview).not.toMatch(/\[image:/i);
    expect(rows[0].preview.length).toBeLessThan(180);
    expect(filterInbox(rows, 'waiting', '')).toEqual([]);
    expect(filterInbox(rows, 'all', '').map((r) => r.threadId)).toEqual(['g-1']);
  });
  test('WhatsApp-Tab enthält keine E-Mail, Zähler auch nicht', () => {
    const mail = msg({
      id: 'e2', channel: 'email', connectionId: 'gmail', threadId: 'mail-2', from: 'kunde@example.de',
      body: 'Bitte Zulassung BOT-ZZ 1', needsReply: true, sentAt: '2026-11-17T11:40:00.000Z',
    });
    const rows = buildInbox({ messages: [...messages, mail], contacts: [anna] }, at, 2, 'whatsapp');
    expect(rows.every((r) => r.channel === 'whatsapp')).toBe(true);
    expect(rows.map((r) => r.threadId)).not.toContain('mail-2');
    expect(filterInbox(rows, 'waiting', '').map((r) => r.threadId)).toEqual(['+491715551234']);
    expect(filterInbox(rows, 'orders', 'bot-zz')).toEqual([]);
    expect(filterInbox(rows, 'all', 'BOT-AB').map((r) => r.threadId)).toEqual(['+491715551234']);
    const mails = buildInbox({ messages: [...messages, mail], contacts: [anna] }, at, 2, 'email');
    expect(mails.map((r) => r.threadId).sort()).toEqual(['mail-1', 'mail-2']);
  });
  test('filtern: Warten, Aufträge, Suche nach Name, Nummer, Text', () => {
    const rows = buildInbox({ messages, contacts: [anna] }, at, 2);
    expect(filterInbox(rows, 'waiting', '').map((r) => r.threadId)).toEqual(['+491715551234']);
    expect(filterInbox(rows, 'orders', '').map((r) => r.threadId)).toEqual(['+491715551234']);
    expect(filterInbox(rows, 'all', 'max').map((r) => r.threadId)).toEqual(['+491605550000']);
    expect(filterInbox(rows, 'all', '0160 555').map((r) => r.threadId)).toEqual(['+491605550000']);
    expect(filterInbox(rows, 'all', 'bot-ab').map((r) => r.threadId)).toEqual(['+491715551234']);
  });
  test('Initialen', () => {
    expect(initialsOf('Anna Beispiel')).toBe('AB');
    expect(initialsOf('+491605550000')).toBe('#');
    expect(initialsOf('max')).toBe('M');
  });
});
