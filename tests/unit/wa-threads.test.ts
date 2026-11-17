import { describe, expect, test } from 'vitest';
import { buildThreads, filterThreads } from '@/components/wa-threads';
import type { Message } from '@/domain/types';
import { msg } from './helpers';

const m = (p: Partial<Message>): Message => msg(p);

describe('WhatsApp-Unterhaltungen', () => {
  test('Name, sonst Profilname, sonst Nummer; neueste oben; Badge nur ohne Antwort', () => {
    const threads = buildThreads([
      m({ id: 'a1', threadId: '+49111', from: '+49111', body: 'alt', sentAt: '2026-11-01T10:00:00Z', needsReply: true, profileName: 'Lea Beispiel' }),
      m({ id: 'b1', threadId: 't-schmidt', contactId: 'd-schmidt', from: '+49209111222', body: 'Frage', sentAt: '2026-11-02T10:00:00Z', needsReply: true }),
      m({ id: 'b2', threadId: 't-schmidt', contactId: 'd-schmidt', direction: 'out', body: 'Antwort', sentAt: '2026-11-02T11:00:00Z' }),
    ], [{ id: 'd-schmidt', company: 'zulassung', kind: 'dealer', name: 'Autohaus Schmidt', phones: [], emails: [] }]);
    expect(threads.map((t) => t.title)).toEqual(['Autohaus Schmidt', 'Lea Beispiel']);
    expect(threads[0].unanswered).toBe(0);
    expect(threads[1].unanswered).toBe(1);
    expect(filterThreads(threads, 'unanswered', '').map((t) => t.threadId)).toEqual(['+49111']);
    expect(filterThreads(threads, 'unassigned', 'lea').map((t) => t.title)).toEqual(['Lea Beispiel']);
    expect(filterThreads(threads, 'job', '')).toEqual([]);
  });
});
