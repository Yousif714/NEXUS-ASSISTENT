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
      imapAccounts: [],
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
  const byId = (e: ReturnType<typeof readEnv>, id: string) => e.imapAccounts.find((a) => a.id === id);
  test('ohne Zugangsdaten bleibt jedes Postfach ungesetzt', () => {
    expect(readEnv(FULL).imapAccounts).toEqual([]);
    expect(readEnv(FULL).imapConfigError).toBeUndefined();
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
    expect(byId(e, 'gmail')).toMatchObject({ host: 'imap.gmail.com', port: 993, user: 'privat@example.de', password: 'abcdefghijklmnop', label: 'Gmail' });
    expect(byId(e, 'info_mail')).toMatchObject({ host: 'imap.gmail.com', port: 993, user: 'info@example.de', password: 'info-app-pass', company: 'zulassung' });
    expect(byId(e, 'icloud')).toMatchObject({ host: 'imap.mail.me.com', port: 993, user: 'icloud@example.de', password: 'apple-app-pass' });
  });
  test('nur Passwort oder nur Nutzer zählt als nicht verbunden', () => {
    expect(byId(readEnv({ ...FULL, IMAP_GMAIL_PASSWORD: 'geheim' }), 'gmail')).toBeUndefined();
    expect(byId(readEnv({ ...FULL, IMAP_INFO_MAIL_USER: 'info@example.de' }), 'info_mail')).toBeUndefined();
  });
  test('Host und Port lassen sich überschreiben, Port 143 nicht', () => {
    expect(byId(readEnv({ ...FULL, IMAP_INFO_MAIL_USER: 'a@example.de', IMAP_INFO_MAIL_PASSWORD: 'pw', IMAP_INFO_MAIL_HOST: 'imap.example.de', IMAP_INFO_MAIL_PORT: '993' }), 'info_mail'))
      .toMatchObject({ host: 'imap.example.de', port: 993 });
    expect(() => readEnv({ ...FULL, IMAP_GMAIL_USER: 'a@example.de', IMAP_GMAIL_PASSWORD: 'pw', IMAP_GMAIL_PORT: '143' })).toThrow(/nur TLS/);
    expect(() => readEnv({ ...FULL, IMAP_GMAIL_USER: 'a@example.de', IMAP_GMAIL_PASSWORD: 'pw', IMAP_GMAIL_PORT: 'kein' })).toThrow(/IMAP_GMAIL_PORT/);
  });
  test('weiteres Postfach über IMAP_<NAME>_* und JSON, Passwort nie in der Fehlermeldung', () => {
    const secret = 'json-passwort-geheim';
    const e = readEnv({
      ...FULL,
      IMAP_BUERO_USER: 'buero@example.de',
      IMAP_BUERO_PASSWORD: 'pw buero',
      IMAP_ACCOUNTS: JSON.stringify([{ name: 'privat', user: 'privat@example.de', password: 'abcd efgh', label: 'Privat' }]),
    });
    expect(byId(e, 'mail_buero')).toMatchObject({ host: 'imap.gmail.com', port: 993, user: 'buero@example.de', password: 'pwbuero' });
    expect(byId(e, 'mail_privat')).toMatchObject({ label: 'Privat', password: 'abcdefgh', host: 'imap.gmail.com' });
    const broken = readEnv({ ...FULL, IMAP_ACCOUNTS: `[{"password":"${secret}"}` });
    expect(broken.imapConfigError).toBe('IMAP_ACCOUNTS ist kein gültiges JSON');
    expect(JSON.stringify(broken)).not.toContain(secret);
    expect(broken.imapAccounts).toEqual([]);
  });
});

test('WhatsApp-Variablen optional, leer zählt als nicht gesetzt', () => {
  const e = readEnv(FULL);
  expect(e.whatsappPhoneNumberId).toBeUndefined();
  expect(e.whatsappAccessToken).toBeUndefined();
  expect(e.whatsappAppSecret).toBeUndefined();
  expect(e.whatsappVerifyToken).toBeUndefined();
  expect(e.whatsappWabaId).toBeUndefined();
  const set = readEnv({
    ...FULL,
    WHATSAPP_PHONE_NUMBER_ID: '123456',
    WHATSAPP_ACCESS_TOKEN: 'tok',
    WHATSAPP_APP_SECRET: 'sec',
    WHATSAPP_VERIFY_TOKEN: 'ver',
    WHATSAPP_WABA_ID: 'waba',
  });
  expect(set).toMatchObject({
    whatsappPhoneNumberId: '123456', whatsappAccessToken: 'tok', whatsappAppSecret: 'sec', whatsappVerifyToken: 'ver', whatsappWabaId: 'waba',
  });
  expect(readEnv({ ...FULL, WHATSAPP_APP_SECRET: '  ', WHATSAPP_VERIFY_TOKEN: '' }).whatsappAppSecret).toBeUndefined();
});

test('STRIPE_WRITE_KEY optional, PAYMENT_LINK_BASE_URL fällt auf APP_ORIGIN zurück', () => {
  const a = readEnv(FULL);
  expect([a.stripeWriteKey, a.paymentLinkBaseUrl]).toEqual([undefined, 'https://nexus.example']);
  const b = readEnv({ ...FULL, STRIPE_WRITE_KEY: 'sk_x', PAYMENT_LINK_BASE_URL: 'https://pay.example' });
  expect([b.stripeWriteKey, b.paymentLinkBaseUrl]).toEqual(['sk_x', 'https://pay.example']);
});
