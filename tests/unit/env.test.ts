import { describe, expect, test } from 'vitest';
import { readEnv } from '@/server/env';

const FULL = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  SESSION_SECRET: 's'.repeat(32),
  OWNER_SETUP_TOKEN: 'setup',
  CRON_SECRET: 'cron',
  APP_ORIGIN: 'https://nexus.example',
};

describe('readEnv', () => {
  test('vollständige Umgebung wird gelesen', () => {
    expect(readEnv(FULL)).toEqual({
      supabaseUrl: FULL.SUPABASE_URL, supabaseServiceRoleKey: FULL.SUPABASE_SERVICE_ROLE_KEY, sessionSecret: FULL.SESSION_SECRET,
      ownerSetupToken: 'setup', cronSecret: 'cron', appOrigin: 'https://nexus.example', testMemoryDb: false,
      paymentLinkBaseUrl: 'https://nexus.example',
    });
  });

  test('Qonto-Schlüssel optional', () => expect(readEnv(FULL).qontoLogin).toBeUndefined());
  test('Qonto-Schlüssel gelesen', () => expect(readEnv({ ...FULL, QONTO_LOGIN: 'l', QONTO_SECRET_KEY: 's' })).toMatchObject({ qontoLogin: 'l', qontoSecretKey: 's' }));

  test('Schlüssel sind optional', () => {
    const e = readEnv(FULL);
    expect([e.stripeRestrictedKey, e.stripeWebhookSecret, e.lexwareNexusApiKey, e.lexwareZulassungApiKey]).toEqual([undefined, undefined, undefined, undefined]);
  });

  test('Schlüssel werden gelesen (leer = fehlt)', () => {
    const e = readEnv({ ...FULL, STRIPE_RESTRICTED_KEY: 'rk', STRIPE_WEBHOOK_SECRET: 'wh', LEXWARE_NEXUS_API_KEY: 'lx', LEXWARE_ZULASSUNG_API_KEY: '  ' });
    expect(e).toMatchObject({ stripeRestrictedKey: 'rk', stripeWebhookSecret: 'wh', lexwareNexusApiKey: 'lx' });
    expect(e.lexwareZulassungApiKey).toBeUndefined();
  });

  test('alle fehlenden Variablen werden genannt', () => {
    expect(() => readEnv({})).toThrow('Fehlende Umgebungsvariablen: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SESSION_SECRET, OWNER_SETUP_TOKEN, CRON_SECRET, APP_ORIGIN');
    expect(() => readEnv({ ...FULL, CRON_SECRET: '', APP_ORIGIN: undefined })).toThrow('Fehlende Umgebungsvariablen: CRON_SECRET, APP_ORIGIN');
  });

  test('ohne Supabase und ohne Testmodus → Fehler', () => {
    const { SUPABASE_URL: _u, SUPABASE_SERVICE_ROLE_KEY: _k, ...rest } = FULL;
    expect(() => readEnv(rest)).toThrow('Fehlende Umgebungsvariablen: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  });

  test('Testmodus ohne Supabase ist erlaubt, aber nicht auf Vercel', () => {
    const { SUPABASE_URL: _u, SUPABASE_SERVICE_ROLE_KEY: _k, ...rest } = FULL;
    expect(readEnv({ ...rest, NEXUS_TEST_MEMORY_DB: '1' }).testMemoryDb).toBe(true);
    expect(() => readEnv({ ...rest, NEXUS_TEST_MEMORY_DB: '1', VERCEL: '1' })).toThrow(/NEXUS_TEST_MEMORY_DB/);
    expect(() => readEnv({ ...FULL, NEXUS_TEST_MEMORY_DB: '1', VERCEL: '1' })).toThrow(/NEXUS_TEST_MEMORY_DB/);
    expect(readEnv({ ...FULL, NEXUS_TEST_MEMORY_DB: 'true' }).testMemoryDb).toBe(false);
  });

  test('SESSION_SECRET muss mindestens 32 Zeichen haben', () => {
    expect(() => readEnv({ ...FULL, SESSION_SECRET: 's'.repeat(31) })).toThrow(/SESSION_SECRET/);
  });
});

test('MCP_API_KEY optional, leer zählt als nicht gesetzt', () => {
  expect(readEnv(FULL).mcpApiKey).toBeUndefined();
  expect(readEnv({ ...FULL, MCP_API_KEY: ' ' }).mcpApiKey).toBeUndefined();
  expect(readEnv({ ...FULL, MCP_API_KEY: 'mcp-test-key' }).mcpApiKey).toBe('mcp-test-key');
});

test('ANTHROPIC_API_KEY optional', () => {
  expect(readEnv(FULL).anthropicApiKey).toBeUndefined();
  expect(readEnv({ ...FULL, ANTHROPIC_API_KEY: ' ' }).anthropicApiKey).toBeUndefined();
  expect(readEnv({ ...FULL, ANTHROPIC_API_KEY: 'sk-ant-x' }).anthropicApiKey).toBe('sk-ant-x');
});

describe('IMAP-Umgebung', () => {
  test('ohne Zugangsdaten bleibt jedes Postfach ungesetzt', () => {
    const e = readEnv(FULL);
    expect(e.imapGmail).toBeUndefined();
    expect(e.imapInfoMail).toBeUndefined();
    expect(e.imapIcloud).toBeUndefined();
  });
  test('Gmail und info@ sind Gmail-IMAP, iCloud hat den Apple-Server', () => {
    const e = readEnv({
      ...FULL,
      IMAP_GMAIL_USER: 'privat@example.de',
      IMAP_GMAIL_PASSWORD: 'abcd efgh ijkl mnop',
      IMAP_INFO_MAIL_USER: 'info@example.de',
      IMAP_INFO_MAIL_PASSWORD: 'info-app-pass',
      IMAP_ICLOUD_USER: 'icloud@example.de',
      IMAP_ICLOUD_PASSWORD: 'apple-app-pass',
    });
    expect(e.imapGmail).toEqual({ host: 'imap.gmail.com', port: 993, user: 'privat@example.de', password: 'abcdefghijklmnop' });
    expect(e.imapInfoMail).toEqual({ host: 'imap.gmail.com', port: 993, user: 'info@example.de', password: 'info-app-pass' });
    expect(e.imapIcloud).toEqual({ host: 'imap.mail.me.com', port: 993, user: 'icloud@example.de', password: 'apple-app-pass' });
  });
  test('nur Passwort oder nur Nutzer zählt als nicht verbunden', () => {
    expect(readEnv({ ...FULL, IMAP_GMAIL_PASSWORD: 'geheim' }).imapGmail).toBeUndefined();
    expect(readEnv({ ...FULL, IMAP_INFO_MAIL_USER: 'info@example.de' }).imapInfoMail).toBeUndefined();
  });
  test('Host und Port lassen sich überschreiben, Port 143 nicht', () => {
    expect(readEnv({ ...FULL, IMAP_INFO_MAIL_USER: 'a@example.de', IMAP_INFO_MAIL_PASSWORD: 'pw', IMAP_INFO_MAIL_HOST: 'imap.example.de', IMAP_INFO_MAIL_PORT: '993' }).imapInfoMail)
      .toMatchObject({ host: 'imap.example.de', port: 993 });
    expect(() => readEnv({ ...FULL, IMAP_GMAIL_USER: 'a@example.de', IMAP_GMAIL_PASSWORD: 'pw', IMAP_GMAIL_PORT: '143' })).toThrow(/nur TLS/);
    expect(() => readEnv({ ...FULL, IMAP_GMAIL_USER: 'a@example.de', IMAP_GMAIL_PASSWORD: 'pw', IMAP_GMAIL_PORT: 'kein' })).toThrow(/IMAP_GMAIL_PORT/);
  });
});

test('STRIPE_WRITE_KEY optional, PAYMENT_LINK_BASE_URL fällt auf APP_ORIGIN zurück', () => {
  const a = readEnv(FULL);
  expect([a.stripeWriteKey, a.paymentLinkBaseUrl]).toEqual([undefined, 'https://nexus.example']);
  const b = readEnv({ ...FULL, STRIPE_WRITE_KEY: 'sk_x', PAYMENT_LINK_BASE_URL: 'https://pay.example' });
  expect([b.stripeWriteKey, b.paymentLinkBaseUrl]).toEqual(['sk_x', 'https://pay.example']);
});
