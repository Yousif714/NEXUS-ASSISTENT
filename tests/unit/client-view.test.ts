import { describe, expect, test } from 'vitest';
import { slimForClient } from '@/domain/client-view';
import { stateWith, ins } from './helpers';

describe('slimForClient', () => {
  test('lässt offene Hinweise und die Listenspalten, streicht den Rest der Portalzeile', () => {
    const state = stateWith({
      insights: [
        { ...ins('a'), status: 'open', createdAt: '2026-11-12T08:00:00Z' },
        { ...ins('b'), status: 'done', createdAt: '2026-11-12T08:00:00Z', resolvedAt: '2026-11-12T08:00:00Z' },
        { ...ins('c'), status: 'dismissed', createdAt: '2026-11-12T08:00:00Z' },
      ],
      jobs: [{
        id: 'j1', vehicleId: null, contactId: null, service: 'Zulassung', location: 'bottrop', priceCents: 0,
        status: 'open', doneAt: null, invoiceIds: [], portalSource: 'mydigitalcar',
        portalData: { Auftragsnummer: 'A-1', PIN: 'geheim-pin', Steuer_IBAN: 'DE89370400440532013099' },
      }],
    });
    const slim = slimForClient(state);
    expect(slim.insights.map((i) => i.dedupeKey)).toEqual(['a', 'c']);
    expect(slim.jobs[0].portalData).toEqual({ Auftragsnummer: 'A-1' });
    expect(slim.jobs[0].portalDetail).toBe(true);
    expect(JSON.stringify(slim.jobs)).not.toContain('geheim-pin');
    expect(JSON.stringify(slim.jobs)).not.toContain('DE89370400440532013099');
  });
});
