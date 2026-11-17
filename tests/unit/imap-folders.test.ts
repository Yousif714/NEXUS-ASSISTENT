import { describe, expect, test } from 'vitest';
import { pickImapMailboxes } from '@/server/connectors/imap-folders';
import { planAttachments } from '@/server/connectors/imap-parts';

describe('pickImapMailboxes', () => {
  test('deutsches Gmail liest Alle Nachrichten, nicht INBOX', () => {
    const choice = pickImapMailboxes([
      { path: 'INBOX', specialUse: '\\Inbox' },
      { path: '[Gmail]/Gesendet', specialUse: '\\Sent' },
      { path: '[Gmail]/Alle Nachrichten', specialUse: '\\All' },
      { path: '[Gmail]/Papierkorb', specialUse: '\\Trash' },
    ]);
    expect(choice).toEqual({ incoming: '[Gmail]/Alle Nachrichten', sent: '[Gmail]/Gesendet', source: 'all' });
  });

  test('englisches Gmail erkennt All Mail auch ohne SPECIAL-USE', () => {
    expect(pickImapMailboxes([
      { path: 'INBOX' },
      { path: '[Gmail]/All Mail' },
      { path: '[Gmail]/Sent Mail' },
    ])).toEqual({ incoming: '[Gmail]/All Mail', sent: '[Gmail]/Sent Mail', source: 'all' });
  });

  test('iCloud bleibt bei INBOX und Gesendet', () => {
    expect(pickImapMailboxes([
      { path: 'INBOX' },
      { path: 'Sent Messages', specialUse: '\\Sent' },
      { path: 'Drafts', specialUse: '\\Drafts' },
    ])).toEqual({ incoming: 'INBOX', sent: 'Sent Messages', source: 'inbox' });
  });
});

describe('planAttachments', () => {
  test('große Dateien nur als Metadaten, kleine Texte dürfen gelesen werden', () => {
    const plan = planAttachments({
      type: 'multipart/mixed',
      children: [
        { type: 'text/plain', disposition: 'inline', part: '1', size: 20 },
        { type: 'application/pdf', disposition: 'attachment', filename: 'schein.pdf', size: 240_000, part: '2' },
        { type: 'text/plain', disposition: 'attachment', filename: 'notiz.txt', size: 400, part: '3' },
      ],
    });
    expect(plan.notes).toEqual([
      'Anhang: schein.pdf (application/pdf, 234 KB)',
      'Anhang: notiz.txt (text/plain, 400 B)',
    ]);
    expect(plan.smallText.map((p) => p.part)).toEqual(['3']);
  });
});
