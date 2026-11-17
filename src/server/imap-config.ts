import 'server-only';

import type { Company, ConnectionId } from '@/domain/types';

/** Ein Postfach über IMAP. Das Passwort ist ein App-Passwort, nie das Kontopasswort. */
export interface ImapAccount {
  id: ConnectionId;
  label: string;
  company: Company | null;
  host: string;
  port: number;
  user: string;
  password: string;
}

const KNOWN = new Set(['info_mail', 'gmail', 'icloud']);

const LABEL: Record<string, string> = {
  info_mail: 'info@-Postfach',
  gmail: 'Gmail',
  icloud: 'iCloud-Mail',
};

function connectionIdOf(slug: string): ConnectionId {
  return (KNOWN.has(slug) ? slug : `mail_${slug}`) as ConnectionId;
}

function defaultHost(id: string): string {
  return id === 'icloud' ? 'imap.mail.me.com' : 'imap.gmail.com';
}

function defaultLabel(id: string, user: string, explicit?: string): string {
  const raw = (explicit?.trim() || LABEL[id] || user).replace(/[\r\n]+/g, ' ').trim();
  return raw.slice(0, 80) || id;
}

function slugOf(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  return /^[a-z0-9][a-z0-9_]{0,39}$/.test(s) ? s : null;
}

function cleanHost(raw: string | undefined, fallback: string): string | undefined {
  if (raw === undefined) return fallback;
  const host = raw.trim();
  if (!host || host.length > 253 || /[\s/]/.test(host)) return undefined;
  return host;
}

/** Port 143 (Klartext) ist nie erlaubt. Ungültig → `undefined`. */
function cleanPort(raw: string | undefined, fallback: number): number | undefined {
  if (raw === undefined) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === 143) return undefined;
  return port;
}

function passwordOf(raw: string | undefined): string | undefined {
  const password = raw?.replace(/ /g, '').trim();
  return password ? password : undefined;
}

interface Built {
  account?: ImapAccount;
  /** Feste Meldung, ohne Host, Port oder Passwort. */
  error?: string;
}

function build(slug: string | null, userRaw: string | undefined, passwordRaw: string | undefined, hostRaw: string | undefined, portRaw: string | undefined, labelRaw: string | undefined, source: string): Built {
  const user = userRaw?.trim();
  const password = passwordOf(passwordRaw);
  if (!slug || !user || !password || /[\r\n]/.test(user)) return {};
  const id = connectionIdOf(slug);
  const host = cleanHost(hostRaw, defaultHost(id));
  if (!host) return { error: `${source}_HOST ist ungültig` };
  const port = cleanPort(portRaw, 993);
  if (port === undefined) {
    return { error: portRaw === '143' ? `${source}_PORT: nur TLS (993), unverschlüsseltes IMAP ist nicht erlaubt` : `${source}_PORT ist ungültig` };
  }
  return {
    account: { id, label: defaultLabel(id, user, labelRaw), company: id === 'info_mail' ? 'zulassung' : null, host, port, user: user.slice(0, 320), password },
  };
}

const FIELD = /^IMAP_([A-Z0-9_]+)_(USER|PASSWORD|HOST|PORT)$/;

interface Group { user?: string; password?: string; host?: string; port?: string }

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export interface ImapConfig {
  accounts: ImapAccount[];
  /** IMAP_ACCOUNTS ist unbrauchbar. Enthält nie das Passwort. */
  configError?: string;
}

/**
 * Liest IMAP_INFO_MAIL_*, IMAP_GMAIL_*, IMAP_ICLOUD_* und beliebige IMAP_<NAME>_*.
 * IMAP_ACCOUNTS ist ein JSON-Array `{ name, user, password, host?, port?, label? }` und überschreibt dieselbe ID.
 * Host fehlt → imap.gmail.com (iCloud: imap.mail.me.com), Port fehlt → 993.
 */
export function readImapAccounts(e: Record<string, string | undefined>): ImapConfig {
  const groups = new Map<string, Group>();
  for (const [key, value] of Object.entries(e)) {
    const m = FIELD.exec(key);
    if (!m || !value?.trim()) continue;
    const g = groups.get(m[1]) ?? {};
    g[m[2].toLowerCase() as keyof Group] = value.trim();
    groups.set(m[1], g);
  }
  const rank = (prefix: string) => (prefix === 'INFO_MAIL' ? 0 : prefix === 'GMAIL' ? 1 : prefix === 'ICLOUD' ? 2 : 3);
  const accounts: ImapAccount[] = [];
  const seen = new Set<string>();
  for (const prefix of [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
    const g = groups.get(prefix)!;
    const source = `IMAP_${prefix}`;
    const built = build(slugOf(prefix), g.user, g.password, g.host, g.port, undefined, source);
    if (built.error && (g.user || g.password)) throw new Error(built.error);
    if (!built.account || seen.has(built.account.id)) continue;
    seen.add(built.account.id);
    accounts.push(built.account);
  }

  let configError: string | undefined;
  const raw = e.IMAP_ACCOUNTS?.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      configError = 'IMAP_ACCOUNTS ist kein gültiges JSON';
      parsed = null;
    }
    if (Array.isArray(parsed)) {
      let added = 0;
      for (const item of parsed) {
        if (!item || typeof item !== 'object') continue;
        const o = item as Record<string, unknown>;
        const user = str(o.user);
        const password = str(o.password);
        const name = str(o.name) ?? str(o.id) ?? (user ? user.split('@')[0] : undefined);
        if (!user || !password || !name) continue;
        const built = build(slugOf(name), user, password, str(o.host), o.port === undefined || o.port === null ? undefined : String(o.port), str(o.label), 'IMAP_ACCOUNTS');
        if (built.error) {
          configError ??= built.error;
          continue;
        }
        if (!built.account) continue;
        const idx = accounts.findIndex((a) => a.id === built.account!.id);
        if (idx >= 0) accounts[idx] = built.account;
        else accounts.push(built.account);
        added += 1;
      }
      if (parsed.length > 0 && added === 0) configError ??= 'IMAP_ACCOUNTS enthält kein vollständiges Postfach';
    } else if (parsed !== null) {
      configError = 'IMAP_ACCOUNTS ist kein gültiges JSON';
    }
  }
  return { accounts, ...(configError ? { configError } : {}) };
}
