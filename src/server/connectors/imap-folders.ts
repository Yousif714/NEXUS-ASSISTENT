import 'server-only';

export interface ListedBox {
  path: string;
  specialUse?: string;
}

export interface MailboxChoice {
  /** Ordner, aus dem neue Eingänge kommen. Bei Gmail „Alle Nachrichten“, sonst INBOX. */
  incoming: string;
  /** Gesendet. Bei Gmail leer: der Ausgang steckt schon in „Alle Nachrichten“. */
  sent: string | null;
  source: 'all' | 'inbox';
}

function flag(box: ListedBox): string {
  return (box.specialUse ?? '').toLowerCase();
}

function isAll(path: string): boolean {
  return /all mail|alle nachrichten/i.test(path);
}

function isSentPath(path: string): boolean {
  const p = path.toLowerCase();
  if (/all mail|alle nachrichten|trash|junk|spam|draft|papierkorb|entwurf/.test(p)) return false;
  return /(^|\/)(sent|sent mail|sent messages|gesendet|gesendete|gesendete elemente)($|\/)/.test(p);
}

/**
 * Gmail legt archivierte Mails nicht in INBOX, sondern in `[Gmail]/Alle Nachrichten`
 * (SPECIAL-USE `\All`, englisch `[Gmail]/All Mail`). Nur INBOX zu lesen lässt ein
 * Postfach leer aussehen. Andere Server (iCloud) bleiben bei INBOX und Gesendet.
 */
export function pickImapMailboxes(boxes: ListedBox[]): MailboxChoice {
  const byFlag = (name: string) => boxes.find((b) => flag(b) === name)?.path;
  const all = byFlag('\\all') ?? boxes.find((b) => isAll(b.path))?.path;
  if (all) return { incoming: all, sent: null, source: 'all' };
  const sent = byFlag('\\sent') ?? boxes.find((b) => isSentPath(b.path))?.path ?? null;
  const inbox = byFlag('\\inbox') ?? boxes.find((b) => b.path.toLowerCase() === 'inbox')?.path ?? 'INBOX';
  return { incoming: inbox, sent, source: 'inbox' };
}
