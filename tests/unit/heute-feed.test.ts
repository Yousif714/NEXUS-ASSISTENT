import { describe, expect, test } from 'vitest';

import { refresh } from '@/data/store';
import { createDemoState } from '@/data/seed';
import { buildHeuteFeed, type HeuteLine } from '@/domain/heute';
import type { StoredInsight, Subscription } from '@/domain/types';
import { NOW_0930 as NOW, ins, inv, msg, sptx, stateWith } from './helpers';

const stored = (key: string, p: Partial<StoredInsight> = {}): StoredInsight => ({
  ...ins(key), status: 'open', createdAt: '2026-11-12T06:00:00Z', ...p,
});

const lines = (entries: { kind: string; title?: string; subtitle?: string; key?: string }[]): string[] =>
  entries.filter((e): e is HeuteLine => e.kind === 'line').map((e) => `${e.key} ${e.title} ${e.subtitle}`);

const sub = (p: Partial<Subscription> = {}): Subscription => ({
  id: 'sub1', connectionId: 'stripe_nexus', externalId: 'sub_A', stripeCustomerId: 'cus_A',
  customerName: 'Neu Mitglied', customerEmail: 'neu@example.de', productName: 'NEXUS Mitgliedschaft',
  amountCents: 30000, priceCents: 30000, currency: 'eur', interval: 'month',
  startDate: '2026-11-01', anchorDay: 1, cancelAt: null, endDate: '2027-04-01', installments: 6,
  status: 'active', disputes: [], contractId: null, confirmedPriceCents: null, confirmedEndDate: null, ...p,
});

describe('Heute-Feed', () => {
  test('legt auch das ab, was nicht heute fällig ist, und klappt lange Abschnitte zu', () => {
    const base = stateWith();
    const s = stateWith({
      connections: base.connections.map((c) => (c.id === 'bank_sparkasse' ? { ...c, status: 'missing' as const, lastSuccessAt: null } : c)),
      invoices: [
        inv('late', 4000, { dueDate: '2026-10-01', status: 'overdue', number: 'RE-LATE' }),
        inv('today', 1500, { dueDate: '2026-11-12', number: 'RE-TODAY' }),
        inv('soon', 2000, { dueDate: '2026-11-20', number: 'RE-SOON' }),
        inv('paid', 9000, { dueDate: '2026-10-01', status: 'paid', openCents: 0, number: 'RE-PAID' }),
      ],
      payments: [sptx({ id: 'sp1', amountCents: 1500, payerName: 'Max Mustermann', bookedOn: '2026-11-11' })],
      messages: [msg({ id: 'm1', threadId: 't-demir', contactId: 'd-mueller' })],
      commitments: [
        { id: 'past', messageId: 'm1', contactId: 'd-mueller', kind: 'invoice', text: 'Rechnung schicken', dueAt: '2026-11-11T17:00:00Z', status: 'open' },
        { id: 'later', messageId: 'm1', contactId: 'd-schmidt', kind: 'callback', text: 'Rückruf nächste Woche', dueAt: '2026-11-20T17:00:00Z', status: 'open' },
        { id: 'kept', messageId: 'm1', contactId: 'd-schmidt', kind: 'other', text: 'erledigt', dueAt: '2026-11-01T17:00:00Z', status: 'kept' },
      ],
      events: [
        { id: 'today', title: 'Heute Termin', startAt: '2026-11-12T09:00:00Z', endAt: '2026-11-12T10:00:00Z' },
        { id: 'later', title: 'Händlertermin', startAt: '2026-11-13T09:00:00Z', endAt: '2026-11-13T10:00:00Z', location: 'Bottrop' },
        { id: 'past', title: 'Vergangen', startAt: '2026-11-01T09:00:00Z', endAt: '2026-11-01T10:00:00Z' },
      ],
      calls: [
        { id: 'call-today', series: 'SEELE', startsAt: '2026-11-12T19:00:00Z', topic: 'SEELE heute', slideCount: 1, slidesStatus: 'todo', slides: [] },
        { id: 'call-later', series: 'Finance', startsAt: '2026-11-19T18:00:00Z', topic: 'Finance später', slideCount: 1, slidesStatus: 'todo', slides: [] },
      ],
      subscriptions: [sub()],
      insights: [
        stored('a', { priority: 'now', title: 'A', type: 'job_not_invoiced' }),
        stored('b', { priority: 'now', title: 'B', type: 'job_not_invoiced' }),
        stored('c', { priority: 'now', title: 'C', type: 'job_not_invoiced' }),
        stored('d', { priority: 'info', title: 'D bleibt', type: 'invoice_overdue' }),
        stored('coach', { priority: 'info', title: 'Tipp', type: 'coach_quick_reply' }),
        stored('reply', { priority: 'now', title: 'Wartet', type: 'reply_waiting' }),
        stored('stale', { priority: 'info', title: 'Alt', type: 'stale_source' }),
      ],
    });
    const feed = buildHeuteFeed(s, NOW);
    const section = (id: string) => feed.find((x) => x.id === id);

    const faellig = lines(section('faellig')!.entries);
    expect(faellig.some((t) => t.includes('invoice:today') && t.includes('RE-TODAY'))).toBe(true);
    expect(faellig.some((t) => t.includes('RE-LATE') || t.includes('RE-SOON'))).toBe(false);
    expect(section('faellig')!.collapsed).toBe(false);

    const late = lines(section('ueberfaellig')!.entries);
    expect(late.some((t) => t.includes('invoice:late') && t.includes('RE-LATE'))).toBe(true);
    expect(late.some((t) => t.includes('commitment:past') && t.includes('Autohaus Müller') && t.includes('Rechnung schicken'))).toBe(true);
    expect(late.some((t) => t.includes('RE-PAID') || t.includes('commitment:kept'))).toBe(false);

    const offen = section('offen')!;
    const offenLines = lines(offen.entries);
    expect(offenLines.some((t) => t.includes('invoice:soon') && t.includes('RE-SOON'))).toBe(true);
    expect(offenLines.some((t) => t.includes('payment:sp1') && t.includes('Max Mustermann'))).toBe(true);
    expect(offenLines.some((t) => t.includes('proposal:') && t.includes('Neu Mitglied'))).toBe(true);
    expect(offenLines.some((t) => t.includes('RE-LATE'))).toBe(false);
    const insightTitles = offen.entries.flatMap((e) => (e.kind === 'insight' ? [e.insight.title] : []));
    expect(insightTitles).toEqual(['D bleibt']);

    const soon = lines(section('demnaechst')!.entries);
    expect(soon.some((t) => t.includes('event:later') && t.includes('Händlertermin') && t.includes('Bottrop'))).toBe(true);
    expect(soon.some((t) => t.includes('call:call-later') && t.includes('Finance später'))).toBe(true);
    expect(soon.some((t) => t.includes('commitment:later') && t.includes('Rückruf'))).toBe(true);
    expect(soon.some((t) => t.includes('Heute Termin') || t.includes('Vergangen') || t.includes('SEELE heute'))).toBe(false);

    const sources = lines(section('quellen')!.entries);
    expect(sources).toEqual(['source:bank_sparkasse bank_sparkasse Nicht verbunden']);
    expect(section('quellen')!.collapsed).toBe(false);
  });

  test('mehr als vier Einträge starten zugeklappt', () => {
    const s = stateWith({
      invoices: [1, 2, 3, 4, 5].map((n) => inv(`i${n}`, n * 100, { dueDate: '2026-10-0' + n, status: 'overdue', number: `RE-${n}` })),
    });
    const late = buildHeuteFeed(s, NOW).find((x) => x.id === 'ueberfaellig')!;
    expect(late.entries).toHaveLength(5);
    expect(late.collapsed).toBe(true);
    expect(late.title).toBe('Überfällig');
  });

  test('Demo lässt künftige Termine, offene und überfällige Rechnungen und fehlende Quellen stehen', () => {
    const feed = buildHeuteFeed(refresh(createDemoState(), NOW), NOW);
    const text = (id: string) => lines(feed.find((x) => x.id === id)!.entries).join('\n');
    expect(text('ueberfaellig')).toContain('RE-Z-2026-290');
    expect(text('ueberfaellig')).toContain('Herr Demir');
    expect(text('offen')).toContain('RE-Z-2026-311');
    expect(text('offen')).toContain('S. Yilmaz');
    expect(text('demnaechst')).toContain('Händlertermin');
    expect(text('demnaechst')).not.toContain('Zulassungsstelle');
    expect(text('quellen')).toContain('Sparkasse (Zulassung)');
    expect(text('quellen')).toContain('Nicht verbunden');
    expect(feed.find((x) => x.id === 'ueberfaellig')!.collapsed).toBe(true);
    const spotlight = new Set(feed.flatMap((sec) => sec.entries.flatMap((e) => (e.kind === 'insight' ? [e.insight.dedupeKey] : []))));
    expect(spotlight.has('reply:m-schmidt-in-1')).toBe(false);
  });
});
