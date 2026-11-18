import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));

import { POST } from '@/app/api/webhooks/whatsapp/route';
import { createEmptyState } from '@/data/empty-state';
import { detectReplies } from '@/domain/detectors/replies';
import { PORTALS_IN_APP, SPARKASSE_IN_APP, WHATSAPP_IN_APP, visibleState } from '@/domain/features';
import { getRepos, resetTestRepos } from '@/server/registry';
import type { AppState, Message } from '@/domain/types';
import { seed } from './takeover/setup';

const SECRET = 'app-secret-test';
const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
const msg = (over: Partial<Message>): Message => ({
  id: 'm', channel: 'whatsapp', connectionId: 'whatsapp_kunden', externalId: 'w', threadId: '+491715551234', direction: 'in',
  from: '+491715551234', to: '+491511111111', body: 'Hallo', sentAt: '2026-11-17T05:00:00.000Z', contactId: null, jobId: null, needsReply: true, ...over,
});

describe('WhatsApp aus der App entfernt', () => {
  test('Schalter ist aus', () => expect(WHATSAPP_IN_APP).toBe(false));

  test('Anzeige-Zustand ohne WhatsApp, E-Mails bleiben', () => {
    const s = { ...createEmptyState(), messages: [msg({ id: 'w1' }), msg({ id: 'e1', channel: 'email', connectionId: 'info_mail', from: 'kunde@example.de' })] };
    expect(visibleState(s).messages.map((m) => m.id)).toEqual(['e1']);
  });

  test('keine „wartet auf Antwort“-Hinweise aus WhatsApp, aus E-Mail schon', () => {
    const s = { ...createEmptyState(), messages: [msg({ id: 'w1' }), msg({ id: 'e1', channel: 'email', connectionId: 'info_mail', from: 'kunde@example.de', threadId: 'mail-1' })] };
    const out = detectReplies(s, new Date('2026-11-17T12:00:00.000Z'));
    expect(out.map((i) => i.dedupeKey)).toEqual(['reply:e1']);
  });

  test('Portale aus: Portal-Aufträge, -Fahrzeuge, reine Portal-Kunden und Portal-Verbindungen verschwinden; Rest bleibt', () => {
    expect(PORTALS_IN_APP).toBe(false);
    const base = createEmptyState();
    const s = {
      ...base,
      contacts: [
        { id: 'c-portal', company: 'zulassung' as const, kind: 'private' as const, name: 'Nur Portal', phones: [], emails: [], externalRefs: [{ connectionId: 'mydigitalcar' as const, externalId: 'h1' }] },
        { id: 'c-lex', company: 'zulassung' as const, kind: 'dealer' as const, name: 'Lexware-Kunde', phones: [], emails: [], externalRefs: [{ connectionId: 'lexware_zulassung' as const, externalId: 'l1' }] },
      ],
      vehicles: [
        { id: 'v-portal', contactId: 'c-portal', vin: 'WVWZZZ1KZAW000001', plate: 'BOT-A 1', model: 'Golf', externalRefs: [{ connectionId: 'nextoz' as const, externalId: 'n1' }] },
        { id: 'v-own', contactId: 'c-lex', vin: 'WVWZZZ1KZAW000002', plate: 'BOT-A 2', model: 'Polo' },
      ],
      jobs: [
        { id: 'j-portal', vehicleId: 'v-portal', contactId: 'c-portal', service: 'Ummeldung', location: 'online' as const, priceCents: 0, status: 'open' as const, doneAt: null, invoiceIds: [], portalSource: 'mydigitalcar' as const },
        { id: 'j-own', vehicleId: 'v-own', contactId: 'c-lex', service: 'Zulassung', location: 'bottrop' as const, priceCents: 8900, status: 'open' as const, doneAt: null, invoiceIds: [] },
      ],
    };
    const v = visibleState(s);
    expect(v.jobs.map((j) => j.id)).toEqual(['j-own']);
    expect(v.vehicles.map((x) => x.id)).toEqual(['v-own']);
    expect(v.contacts.map((c) => c.id)).toEqual(['c-lex']);
    expect(v.connections.map((c) => c.id)).not.toContain('mydigitalcar');
    expect(v.connections.map((c) => c.id)).not.toContain('nextoz');
    expect(v.connections.map((c) => c.id)).not.toContain('whatsapp_kunden');
    expect(v.connections.map((c) => c.id)).toContain('lexware_zulassung');
  });

  test('Sparkasse aus: nicht zugeordnete Sparkassen-Zahlungen verschwinden, zugeordnete und Qonto bleiben', () => {
    expect(SPARKASSE_IN_APP).toBe(false);
    const pay = (id: string, connectionId: 'bank_sparkasse' | 'bank_qonto') => ({ id, connectionId, source: 'bank' as const, company: (connectionId === 'bank_qonto' ? 'nexus' : 'zulassung') as 'nexus' | 'zulassung', amountCents: 10000, bookedOn: '2026-11-10', externalId: id }) as unknown as AppState['payments'][number];
    const s = { ...createEmptyState(), payments: [pay('sp-offen', 'bank_sparkasse'), pay('sp-zu', 'bank_sparkasse'), pay('q-offen', 'bank_qonto')],
      allocations: [{ id: 'a1', paymentId: 'sp-zu', invoiceId: 'i1', amountCents: 10000, method: 'manual' }] as unknown as AppState['allocations'] };
    const v = visibleState(s);
    expect(v.payments.map((p) => p.id)).toEqual(['sp-zu', 'q-offen']);
    expect(v.connections.map((c) => c.id)).not.toContain('bank_sparkasse');
  });

  describe('Webhook', () => {
    beforeEach(async () => {
      vi.stubEnv('NEXUS_TEST_MEMORY_DB', '1');
      vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
      vi.stubEnv('OWNER_SETUP_TOKEN', 'setup-token-123');
      vi.stubEnv('CRON_SECRET', 'c'.repeat(20));
      vi.stubEnv('APP_ORIGIN', 'https://nexus.example.de');
      vi.stubEnv('WHATSAPP_APP_SECRET', SECRET);
      vi.stubEnv('WHATSAPP_VERIFY_TOKEN', 'verify');
      vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'pn-1');
      resetTestRepos();
      await seed(getRepos(), createEmptyState());
    });

    test('nimmt an (200), speichert aber nichts', async () => {
      const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba-1', changes: [{ field: 'messages', value: {
        metadata: { display_phone_number: '491511111111', phone_number_id: 'pn-1' },
        messages: [{ from: '491715551234', id: 'wamid.1', timestamp: '1731800000', type: 'text', text: { body: 'Hallo' } }],
      } }] }] });
      const res = await POST(new Request('http://localhost/api/webhooks/whatsapp', { method: 'POST', body, headers: { 'x-hub-signature-256': sign(body) } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, ignored: true });
      expect((await getRepos().state.load()).state.messages).toHaveLength(0);
    });

    test('falsche Signatur bleibt 401', async () => {
      const res = await POST(new Request('http://localhost/api/webhooks/whatsapp', { method: 'POST', body: '{}', headers: { 'x-hub-signature-256': 'sha256=00' } }));
      expect(res.status).toBe(401);
    });
  });
});
