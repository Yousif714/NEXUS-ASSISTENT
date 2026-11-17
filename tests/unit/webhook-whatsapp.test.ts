import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { verifyWhatsAppSignature, verifyWhatsAppToken } from '@/server/connectors/whatsapp-signature';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));

import { createEmptyState } from '@/data/empty-state';
import { GET, POST } from '@/app/api/webhooks/whatsapp/route';
import { POST as mcpPost } from '@/app/api/mcp/route';
import { getRepos, resetTestRepos } from '@/server/registry';
import { seed } from './takeover/setup';
// WhatsApp-Verhalten bei eingeschaltetem Schalter (in der App derzeit aus, siehe src/domain/features.ts).
vi.mock('@/domain/features', async (orig) => ({ ...(await orig<typeof import('@/domain/features')>()), WHATSAPP_IN_APP: true, showMessage: () => true, visibleState: <S,>(s: S) => s }));


const SECRET = 'app-secret-test';
const VERIFY = 'verify-token-test';
const sign = (body: string, secret = SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

const BIZ = '491511111111';
const CUSTOMER = '491715551234';
const meta = { display_phone_number: BIZ, phone_number_id: 'pn-1' };

function envelope(changes: unknown[]) {
  return JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba-1', changes }] });
}

const inbound = envelope([{
  field: 'messages',
  value: { metadata: meta, messages: [{ from: CUSTOMER, id: 'wamid.1', timestamp: '1731800000', type: 'text', text: { body: 'Ist die Zulassung fertig?' } }] },
}]);

const echo = envelope([{
  field: 'smb_message_echoes',
  value: {
    metadata: meta,
    message_echoes: [{ from: BIZ, to: CUSTOMER, id: 'wamid.echo', timestamp: '1731800001', type: 'text', text: { body: 'Heute fertig.' } }],
  },
}]);

const post = (body: string, sig: string | null, headers: Record<string, string> = {}) => POST(new Request('http://localhost/api/webhooks/whatsapp', {
  method: 'POST', body, headers: { ...(sig ? { 'x-hub-signature-256': sig } : {}), ...headers },
}));

const state = () => getRepos().state.load().then((r) => r.state);

function toolJson(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const msg = JSON.parse(trimmed) as { result?: { content?: { text?: string }[] } };
    return JSON.parse(msg.result?.content?.[0]?.text ?? 'null');
  }
  const data = [...trimmed.matchAll(/^data: (.*)$/gm)].map((m) => m[1]).filter((l) => l && l !== '[DONE]');
  const msg = JSON.parse(data.at(-1) ?? 'null') as { result?: { content?: { text?: string }[] } };
  return JSON.parse(msg.result?.content?.[0]?.text ?? 'null');
}

describe('verifyWhatsAppSignature', () => {
  test('gültige Signatur', () => expect(verifyWhatsAppSignature(inbound, sign(inbound), SECRET)).toEqual({ ok: true }));
  test('falsches Geheimnis', () => expect(verifyWhatsAppSignature(inbound, sign(inbound, 'other'), SECRET)).toEqual({ ok: false, reason: 'signature' }));
  test('veränderter Body', () => expect(verifyWhatsAppSignature(inbound + ' ', sign(inbound), SECRET).ok).toBe(false));
  test('fehlender Header', () => expect(verifyWhatsAppSignature(inbound, null, SECRET)).toEqual({ ok: false, reason: 'missing' }));
  test('falsches Format', () => expect(verifyWhatsAppSignature(inbound, 'sha256=abc', SECRET)).toEqual({ ok: false, reason: 'format' }));
  test('Großschreibung im Header', () => expect(verifyWhatsAppSignature(inbound, sign(inbound).toUpperCase(), SECRET).ok).toBe(true));
  test('Token nur bei gleicher Länge und gleichem Wert', () => {
    expect(verifyWhatsAppToken(VERIFY, VERIFY)).toBe(true);
    expect(verifyWhatsAppToken('falsch', VERIFY)).toBe(false);
    expect(verifyWhatsAppToken(null, VERIFY)).toBe(false);
    expect(verifyWhatsAppToken(VERIFY + 'x', VERIFY)).toBe(false);
  });
});

describe('Route', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubEnv('NEXUS_TEST_MEMORY_DB', '1');
    vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
    vi.stubEnv('OWNER_SETUP_TOKEN', 'setup-token-123');
    vi.stubEnv('CRON_SECRET', 'c'.repeat(20));
    vi.stubEnv('APP_ORIGIN', 'https://nexus.example.de');
    vi.stubEnv('WHATSAPP_APP_SECRET', SECRET);
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', VERIFY);
    vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'pn-1');
    vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'token-nicht-senden');
    vi.stubEnv('WHATSAPP_WABA_ID', '');
    vi.stubEnv('MCP_API_KEY', 'mcp-test-key-nicht-cron');
    resetTestRepos();
    const base = createEmptyState();
    base.contacts = [{ id: 'c-anna', company: 'zulassung', kind: 'private', name: 'Anna Beispiel', phones: ['0171 5551234'], emails: ['anna@example.de'] }];
    await seed(getRepos(), base);
  });

  test('GET: Challenge nur bei passendem Token', async () => {
    const ok = await GET(new Request(`http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=CHALLENGE_123`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/plain');
    expect(await ok.text()).toBe('CHALLENGE_123');
    const bad = await GET(new Request(`http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=falsch&hub.challenge=CHALLENGE_123`));
    expect(bad.status).toBe(403);
    expect(await bad.text()).not.toContain('CHALLENGE_123');
    vi.stubEnv('WHATSAPP_VERIFY_TOKEN', '');
    expect((await GET(new Request('http://localhost/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=&hub.challenge=x'))).status).toBe(503);
  });

  test('ungültige Signatur wird abgelehnt, nichts gespeichert', async () => {
    expect((await post(inbound, 'sha256=' + '0'.repeat(64))).status).toBe(401);
    expect((await post(inbound, null)).status).toBe(401);
    const s = await state();
    expect(s.messages).toEqual([]);
    expect(s.connections.find((c) => c.id === 'whatsapp_kunden')?.status).toBe('missing');
    expect(s.actions).toEqual([]);
  });

  test('ohne App-Geheimnis → 503, nie unsigniert', async () => {
    vi.stubEnv('WHATSAPP_APP_SECRET', '');
    expect((await post(inbound, sign(inbound))).status).toBe(503);
    expect((await post(inbound, null)).status).toBe(503);
    expect((await state()).messages).toEqual([]);
  });

  test('Nachricht wird gespeichert, dedupliziert, verknüpft; die Quelle gilt als verbunden', async () => {
    expect((await post(inbound, sign(inbound))).status).toBe(200);
    const first = await state();
    const msg = first.messages[0];
    expect(msg).toMatchObject({
      channel: 'whatsapp', direction: 'in', externalId: 'wamid.1', contactId: 'c-anna', from: '+491715551234', needsReply: true,
    });
    expect(first.connections.find((c) => c.id === 'whatsapp_kunden')).toMatchObject({ status: 'connected', sync: { complete: true } });
    expect(first.actions.filter((a) => a.type === 'send_whatsapp')).toEqual([]);

    expect((await post(inbound, sign(inbound))).status).toBe(200);
    const second = await state();
    expect(second.messages).toHaveLength(1);
    expect(second.messages[0].id).toBe(msg.id);

    const listed = await mcpPost(new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer mcp-test-key-nicht-cron' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_messages', arguments: { query: 'whatsapp' } } }),
    }));
    const page = toolJson(await listed.text()) as { items: { id: string; channel: string }[] };
    expect(page.items.map((m) => m.channel)).toEqual(['whatsapp']);
    const got = await mcpPost(new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer mcp-test-key-nicht-cron' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_message', arguments: { id: msg.id } } }),
    }));
    const item = toolJson(await got.text()) as { item: { channel: string; externalId: string } };
    expect(item.item).toMatchObject({ channel: 'whatsapp', externalId: 'wamid.1' });
  });

  test('Echo vom Handy wird ausgehend gespeichert und verknüpft', async () => {
    expect((await post(echo, sign(echo))).status).toBe(200);
    const s = await state();
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ direction: 'out', externalId: 'wamid.echo', contactId: 'c-anna', to: '+491715551234', needsReply: false, channel: 'whatsapp' });
    expect(s.actions).toEqual([]);
  });

  test('nur ein Status verbindet die Quelle, ohne eine leere Nachricht anzulegen', async () => {
    const body = envelope([{
      field: 'messages',
      value: { metadata: meta, statuses: [{ id: 'wamid.status', status: 'read', timestamp: '1731800002', recipient_id: CUSTOMER }] },
    }]);
    expect((await post(body, sign(body))).status).toBe(200);
    const s = await state();
    expect(s.messages).toEqual([]);
    expect(s.connections.find((c) => c.id === 'whatsapp_kunden')?.status).toBe('connected');
  });

  test('fremde Telefonnummern-ID wird ignoriert und verbindet nicht', async () => {
    const body = envelope([{
      field: 'messages',
      value: { metadata: { ...meta, phone_number_id: 'pn-fremd' }, messages: [{ from: CUSTOMER, id: 'wamid.x', timestamp: '1731800000', type: 'text', text: { body: 'Nein' } }] },
    }]);
    expect(await (await post(body, sign(body))).json()).toEqual({ received: true, ignored: true });
    const s = await state();
    expect(s.messages).toEqual([]);
    expect(s.connections.find((c) => c.id === 'whatsapp_kunden')?.status).toBe('missing');
  });

  test('Antwort enthält das Geheimnis nicht', async () => {
    expect(await (await post(inbound, 'sha256=nein')).text()).not.toContain(SECRET);
    expect(await (await post(inbound, sign(inbound))).text()).not.toContain('token-nicht-senden');
  });

  test('maxDuration 60 s', async () => expect((await import('@/app/api/webhooks/whatsapp/route')).maxDuration).toBe(60));
});
