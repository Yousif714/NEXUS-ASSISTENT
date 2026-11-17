import 'server-only';

import { readImapAccounts, type ImapAccount } from './imap-config';

export interface ServerEnv {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  sessionSecret: string;
  ownerSetupToken: string;
  cronSecret: string;
  appOrigin: string;
  testMemoryDb: boolean;
  /** Optionale Integrationsschlüssel; fehlen sie, bleibt die Verbindung `missing`. */
  stripeRestrictedKey?: string;
  stripeWebhookSecret?: string;
  /** Schreibschlüssel für die Stripe-Umstellung; fehlt er, läuft sie als Demo. */
  stripeWriteKey?: string;
  /** Basis-URL der Zahlungslinks (`PAYMENT_LINK_BASE_URL`, sonst `APP_ORIGIN`). */
  paymentLinkBaseUrl: string;
  lexwareNexusApiKey?: string;
  lexwareZulassungApiKey?: string;
  qontoLogin?: string;
  qontoSecretKey?: string;
  anthropicApiKey?: string;
  /** Geheime iCal-Adressen (`CALENDAR_ICS_URLS`, https). Fehlt die Angabe, bleibt der Kalender `missing`. Nie loggen. */
  calendarIcsUrls?: string[];
  /** Optionaler Schlüssel für den externen MCP-Connector. Fehlt er, bleibt `/api/mcp` geschlossen. */
  mcpApiKey?: string;
  /** IMAP-Postfächer. Fehlt ein Eintrag, bleibt die Quelle `missing`. */
  imapAccounts: ImapAccount[];
  /** IMAP_ACCOUNTS ist unbrauchbar. Enthält nie ein Passwort. */
  imapConfigError?: string;
  /**
   * WhatsApp Cloud API (Kundennummer, Coexistence). Fehlt das App-Geheimnis bzw. der Verify-Token,
   * nimmt der Webhook nichts an und `whatsapp_kunden` bleibt `missing`. Der Zugriffstoken wird nur
   * aufbewahrt; dieser Stand sendet keine Nachrichten.
   */
  whatsappPhoneNumberId?: string;
  whatsappAccessToken?: string;
  whatsappAppSecret?: string;
  whatsappVerifyToken?: string;
  whatsappWabaId?: string;
}

const SUPABASE = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
const ALWAYS = ['SESSION_SECRET', 'OWNER_SETUP_TOKEN', 'CRON_SECRET', 'APP_ORIGIN'] as const;

/** Adressen getrennt durch Komma oder Zeilenumbruch; `webcal://` wird zu `https://`. Alles außer https wird verworfen. */
export function parseCalendarUrls(raw: string | undefined): string[] {
  const out: string[] = [];
  for (const part of (raw ?? '').split(/[,\r\n]+/)) {
    const u = part.trim().replace(/^webcal:\/\//i, 'https://');
    if (/^https:\/\/\S+$/i.test(u) && !out.includes(u)) out.push(u);
  }
  return out;
}

/** Liest die Server-Umgebung. Wirft mit allen fehlenden Variablen auf einmal. Keine NEXT_PUBLIC_-Variablen. */
export function readEnv(e: Record<string, string | undefined> = process.env): ServerEnv {
  const val = (k: string) => (e[k] && e[k]!.trim() ? e[k] : undefined);
  const testMemoryDb = e.NEXUS_TEST_MEMORY_DB === '1';
  if (testMemoryDb && e.VERCEL) throw new Error('NEXUS_TEST_MEMORY_DB ist auf Vercel nicht erlaubt');
  const required = [...(testMemoryDb ? [] : SUPABASE), ...ALWAYS];
  const missing = required.filter((k) => !val(k));
  if (missing.length) throw new Error(`Fehlende Umgebungsvariablen: ${missing.join(', ')}`);
  const sessionSecret = val('SESSION_SECRET')!;
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET muss mindestens 32 Zeichen lang sein');
  const imap = readImapAccounts(e);
  const calendarUrls = parseCalendarUrls(e.CALENDAR_ICS_URLS);
  return {
    supabaseUrl: val('SUPABASE_URL'),
    supabaseServiceRoleKey: val('SUPABASE_SERVICE_ROLE_KEY'),
    sessionSecret,
    ownerSetupToken: val('OWNER_SETUP_TOKEN')!,
    cronSecret: val('CRON_SECRET')!,
    appOrigin: val('APP_ORIGIN')!,
    testMemoryDb,
    stripeRestrictedKey: val('STRIPE_RESTRICTED_KEY'),
    stripeWebhookSecret: val('STRIPE_WEBHOOK_SECRET'),
    stripeWriteKey: val('STRIPE_WRITE_KEY'),
    paymentLinkBaseUrl: val('PAYMENT_LINK_BASE_URL') ?? val('APP_ORIGIN')!,
    lexwareNexusApiKey: val('LEXWARE_NEXUS_API_KEY'),
    lexwareZulassungApiKey: val('LEXWARE_ZULASSUNG_API_KEY'),
    qontoLogin: val('QONTO_LOGIN'),
    qontoSecretKey: val('QONTO_SECRET_KEY'),
    anthropicApiKey: val('ANTHROPIC_API_KEY'),
    mcpApiKey: val('MCP_API_KEY'),
    ...(calendarUrls.length ? { calendarIcsUrls: calendarUrls } : {}),
    imapAccounts: imap.accounts,
    ...(imap.configError ? { imapConfigError: imap.configError } : {}),
    whatsappPhoneNumberId: val('WHATSAPP_PHONE_NUMBER_ID'),
    whatsappAccessToken: val('WHATSAPP_ACCESS_TOKEN'),
    whatsappAppSecret: val('WHATSAPP_APP_SECRET'),
    whatsappVerifyToken: val('WHATSAPP_VERIFY_TOKEN'),
    whatsappWabaId: val('WHATSAPP_WABA_ID'),
  };
}
