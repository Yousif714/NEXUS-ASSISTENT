import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));

import { DELETE, GET, POST } from '@/app/api/mcp/route';
import { authorizeMcp } from '@/server/mcp/auth';
import { MCP_MAX_BODY_BYTES, MCP_RATE_LIMIT } from '@/server/mcp/http';
import { clientKey } from '@/server/rate-limit';
import { getRepos, resetTestRepos } from '@/server/registry';

const KEY = 'mcp-test-key-nicht-cron';
const ENV = {
  NEXUS_TEST_MEMORY_DB: '1',
  SESSION_SECRET: 's'.repeat(40),
  OWNER_SETUP_TOKEN: 'setup-token-123',
  CRON_SECRET: 'c'.repeat(20),
  APP_ORIGIN: 'https://nexus.example.de',
  MCP_API_KEY: KEY,
};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  resetTestRepos();
});

const mcpHeaders = (auth?: string, extra?: Record<string, string>) => {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'x-forwarded-for': '10.0.0.8',
    ...extra,
  };
  if (auth !== undefined) headers.authorization = auth;
  return headers;
};

function parseBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  const data = [...trimmed.matchAll(/^data: (.*)$/gm)].map((m) => m[1]).filter((l) => l && l !== '[DONE]');
  const last = data.at(-1);
  return last ? JSON.parse(last) : { raw: trimmed };
}

async function call(method: 'GET' | 'POST' | 'DELETE', body?: unknown, auth?: string, extra?: Record<string, string>) {
  const headers = mcpHeaders(auth, extra);
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const req = new Request('http://localhost/api/mcp', init);
  const res = method === 'GET' ? await GET(req) : method === 'DELETE' ? await DELETE(req) : await POST(req);
  const text = await res.text();
  return { status: res.status, text, json: parseBody(text), cache: res.headers.get('cache-control') };
}

function toolText(json: unknown): string {
  const result = json as { result?: { content?: { text?: string }[]; isError?: boolean }; error?: { message?: string } };
  return result.result?.content?.[0]?.text ?? result.error?.message ?? '';
}

describe('authorizeMcp', () => {
  test('nur das exakte Bearer-Geheimnis gilt, längenunabhängig', () => {
    expect(authorizeMcp(null, KEY).ok).toBe(false);
    expect(authorizeMcp('Bearer falsch', KEY).ok).toBe(false);
    expect(authorizeMcp(`Bearer ${'c'.repeat(20)}`, KEY).ok).toBe(false);
    expect(authorizeMcp('Bearer ', KEY).ok).toBe(false);
    expect(authorizeMcp(`Bearer ${KEY} `, KEY).ok).toBe(false);
    expect(authorizeMcp(`Bearer ${KEY}`, KEY)).toEqual({ ok: true });
  });
});

describe('/api/mcp Auth', () => {
  test('ohne MCP_API_KEY → 503, auch mit Bearer', async () => {
    vi.stubEnv('MCP_API_KEY', '');
    const res = await call('POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, `Bearer ${KEY}`);
    expect(res.status).toBe(503);
    expect(res.json).toEqual({ error: 'MCP ist deaktiviert' });
  });

  test('fehlender oder falscher Schlüssel → 401, Cron-Geheimnis öffnet nicht', async () => {
    expect((await call('POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
    expect((await call('GET', undefined, 'Bearer falsch')).status).toBe(401);
    const cron = await call('POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, `Bearer ${'c'.repeat(20)}`);
    expect(cron.status).toBe(401);
    expect(cron.json).toEqual({ error: 'Nicht erlaubt' });
  });

  test('zu großer Body → 413', async () => {
    const res = await call('POST', 'x'.repeat(MCP_MAX_BODY_BYTES + 1), `Bearer ${KEY}`);
    expect(res.status).toBe(413);
  });

  test('Limit je Minute → 429', async () => {
    const ip = '10.9.9.9';
    const key = `mcp:${clientKey(new Request('http://localhost/api/mcp', { headers: { 'x-forwarded-for': ip } }), ENV.SESSION_SECRET)}`;
    const at = new Date();
    for (const t of [at, new Date(at.getTime() + 60_000)]) {
      const minute = t.toISOString().slice(0, 16);
      for (let i = 0; i < MCP_RATE_LIMIT; i++) await getRepos().state.claimJobRun(`rl:${key}:${minute}:${i}`, t);
    }
    const res = await call('POST', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, `Bearer ${KEY}`, { 'x-forwarded-for': ip });
    expect(res.status).toBe(429);
  });
});

describe('/api/mcp Werkzeuge', () => {
  const rpc = (method: string, params?: unknown, id = 1) => call('POST', { jsonrpc: '2.0', id, method, params }, `Bearer ${KEY}`);

  test('listet Lese- und Schreibwerkzeuge', async () => {
    const res = await rpc('tools/list');
    expect(res.status, res.text).toBe(200);
    expect(res.cache).toContain('no-store');
    const names = ((res.json as { result?: { tools?: { name: string }[] } }).result?.tools ?? []).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['list_contacts', 'overview', 'create_contact', 'complete_commitment', 'dismiss_proposal']));
    expect(names.some((n) => n.includes('stripe') || n.includes('refund') || n.includes('passkey'))).toBe(false);
  });

  test('legt einen Kontakt an und liest ihn wieder', async () => {
    const created = await rpc('tools/call', {
      name: 'create_contact',
      arguments: { company: 'nexus', kind: 'member', name: 'Erika Muster', phones: ['+4915112345678'], emails: ['erika@example.de'] },
    });
    expect(created.status, created.text).toBe(200);
    const payload = JSON.parse(toolText(created.json)) as { ok?: boolean; id?: string; error?: string };
    expect(payload.error).toBeUndefined();
    expect(payload.ok).toBe(true);
    expect(payload.id).toMatch(/^[0-9a-f-]{36}$/);

    const listed = await rpc('tools/call', { name: 'list_contacts', arguments: { query: 'Erika', limit: 50 } }, 2);
    const page = JSON.parse(toolText(listed.json)) as { items: { name: string; emails: string[] }[]; total: number };
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ name: 'Erika Muster', emails: ['erika@example.de'] });

    const state = (await getRepos().state.load()).state;
    const audits = state.audit.filter((a) => a.source === 'mcp');
    expect(audits.some((a) => a.text === 'Kontakt angelegt: Erika Muster')).toBe(true);
    expect(audits.some((a) => a.text === 'MCP create_contact')).toBe(true);
    expect(audits.some((a) => a.text.startsWith('MCP list_contacts'))).toBe(true);
    expect(state.contacts).toHaveLength(1);
  });

  test('overview antwortet und ein unbekannter Kontakt wird abgelehnt', async () => {
    const view = await rpc('tools/call', { name: 'overview', arguments: {} });
    const body = JSON.parse(toolText(view.json)) as { openInvoices: unknown; overduePayments: unknown };
    expect(body.openInvoices).toEqual([]);
    expect(body.overduePayments).toEqual([]);

    const denied = await rpc('tools/call', {
      name: 'create_action',
      arguments: { title: 'Abbuchung', actionType: 'stripe_takeover', company: 'nexus', payload: {} },
    }, 3);
    expect(denied.status, denied.text).toBe(200);
    expect(toolText(denied.json).length).toBeGreaterThan(0);
    expect((await getRepos().state.load()).state.actions).toHaveLength(0);
  });
});
