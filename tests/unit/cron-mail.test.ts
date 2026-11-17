import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));

import { GET } from '@/app/api/cron/mail/route';
import { POST } from '@/app/api/sync/mail/route';
import { ConnectorError } from '@/server/connectors/types';
import type { ImapAccount } from '@/server/imap-config';
import { getRepos, resetTestRepos, setTestImapOpener } from '@/server/registry';

vi.mock('@/server/auth/session', () => ({ requireSession: async () => true }));

beforeEach(() => {
  vi.stubEnv('NEXUS_TEST_MEMORY_DB', '1');
  vi.stubEnv('SESSION_SECRET', 's'.repeat(40));
  vi.stubEnv('OWNER_SETUP_TOKEN', 'setup-token-123');
  vi.stubEnv('CRON_SECRET', 'c'.repeat(20));
  vi.stubEnv('APP_ORIGIN', 'https://nexus.example.de');
  vi.stubEnv('IMAP_GMAIL_USER', '');
  vi.stubEnv('IMAP_GMAIL_PASSWORD', '');
  resetTestRepos();
  setTestImapOpener(null);
});

describe('GET /api/cron/mail', () => {
  const call = (auth?: string) => GET(new Request('http://x/api/cron/mail', { headers: auth ? { authorization: auth } : {} }));

  test('maxDuration 300 s und eigener Cron, der Tick ruft kein Postfach ab', () => {
    expect(GET).toBeTypeOf('function');
    return import('@/app/api/cron/mail/route').then((route) => {
      expect(route.maxDuration).toBe(300);
    });
  });

  test('falsches Bearer → 401', async () => {
    expect((await call()).status).toBe(401);
    expect((await call('Bearer falsch')).status).toBe(401);
  });

  test('Fehlertext ohne Passwort, zweiter Lauf in demselben Fenster wird übersprungen', async () => {
    const password = 'supergeheim-passwort';
    vi.stubEnv('IMAP_GMAIL_USER', 'privat@example.de');
    vi.stubEnv('IMAP_GMAIL_PASSWORD', password);
    setTestImapOpener(async (a: ImapAccount) => {
      throw new ConnectorError(`IMAP: Anmeldung abgelehnt ${a.password}`);
    });
    const r = await call(`Bearer ${process.env.CRON_SECRET}`);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).not.toContain(password);
    expect(body).toContain('gmail');
    const gmail = (await getRepos().state.load()).state.connections.find((c) => c.id === 'gmail');
    expect(gmail).toMatchObject({ status: 'error', lastError: 'IMAP: Anmeldung abgelehnt ***' });
    expect(JSON.stringify(gmail)).not.toContain(password);
    const again = await call(`Bearer ${process.env.CRON_SECRET}`);
    expect(await again.json()).toEqual({ skipped: true });
  });
});

describe('POST /api/sync/mail', () => {
  test('unbekanntes Postfach → 400, eingerichtetes Postfach liefert die Zahl neuer Nachrichten', async () => {
    expect((await import('@/app/api/sync/mail/route')).maxDuration).toBe(300);
    const bad = await POST(new Request('http://x/api/sync/mail', { method: 'POST', body: JSON.stringify({ id: 'stripe_nexus' }), headers: { 'content-type': 'application/json' } }));
    expect(bad.status).toBe(400);
    vi.stubEnv('IMAP_INFO_MAIL_USER', 'info@example.de');
    vi.stubEnv('IMAP_INFO_MAIL_PASSWORD', 'info-app-passwort');
    setTestImapOpener(async () => ({
      async mailboxes() { return { incoming: '[Gmail]/Alle Nachrichten', sent: null, source: 'all' as const }; },
      async fetchNew() {
        return { messages: [], more: false };
      },
      async close() {},
    }));
    const ok = await POST(new Request('http://x/api/sync/mail', { method: 'POST', body: JSON.stringify({ id: 'info_mail' }), headers: { 'content-type': 'application/json' } }));
    expect(ok.status).toBe(200);
    const body = await ok.json() as { added: number; outcome: string; state: { connections: { id: string; status: string }[] } };
    expect(body.added).toBe(0);
    expect(body.outcome).toBe('ok');
    expect(JSON.stringify(body)).not.toContain('info-app-passwort');
    expect(body.state.connections.find((c) => c.id === 'info_mail')?.status).toBe('connected');
  });
});

test('vercel.json registriert den Mail-Cron neben dem Tick', () => {
  const v = JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: { path: string; schedule: string }[] };
  expect(v.crons).toEqual(expect.arrayContaining([
    { path: '/api/cron/tick', schedule: '*/5 * * * *' },
    { path: '/api/cron/mail', schedule: '*/5 * * * *' },
  ]));
  const tick = readFileSync('src/app/api/cron/tick/route.ts', 'utf8');
  expect(tick).not.toContain('syncMailboxes');
  expect(tick).not.toContain('openImap');
});
