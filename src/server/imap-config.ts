import 'server-only';

/** Ein Postfach über IMAP. Das Passwort ist ein App-Passwort, nie das Kontopasswort. */
export interface ImapAccount {
  host: string;
  port: number;
  user: string;
  password: string;
}

export type MailSyncId = 'info_mail' | 'gmail' | 'icloud';

/** Standard-Server. info@ und das private Postfach sind beide Verbraucher-Gmail. iCloud bleibt optional. */
export const IMAP_DEFAULTS: Record<MailSyncId, { host: string; port: number }> = {
  info_mail: { host: 'imap.gmail.com', port: 993 },
  gmail: { host: 'imap.gmail.com', port: 993 },
  icloud: { host: 'imap.mail.me.com', port: 993 },
};

export const MAIL_SYNC_IDS: readonly MailSyncId[] = ['info_mail', 'gmail', 'icloud'];

const PREFIX: Record<MailSyncId, string> = {
  info_mail: 'IMAP_INFO_MAIL',
  gmail: 'IMAP_GMAIL',
  icloud: 'IMAP_ICLOUD',
};

/** Liest ein optionales Postfach. Ohne Nutzer oder Passwort: `undefined` (Verbindung bleibt `missing`). */
export function readImapAccount(e: Record<string, string | undefined>, id: MailSyncId, val: (k: string) => string | undefined): ImapAccount | undefined {
  const prefix = PREFIX[id];
  const user = val(`${prefix}_USER`);
  // Gmail zeigt das App-Passwort in Vierergruppen. Die Leerzeichen gehören nicht zum Passwort.
  const password = val(`${prefix}_PASSWORD`)?.replace(/ /g, '');
  if (!user || !password) return undefined;
  const host = val(`${prefix}_HOST`) ?? IMAP_DEFAULTS[id].host;
  const portRaw = val(`${prefix}_PORT`);
  const port = portRaw === undefined ? IMAP_DEFAULTS[id].port : Number(portRaw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${prefix}_PORT ist ungültig`);
  if (port === 143) throw new Error(`${prefix}_PORT: nur TLS (993), unverschlüsseltes IMAP ist nicht erlaubt`);
  return { host, port, user, password };
}
