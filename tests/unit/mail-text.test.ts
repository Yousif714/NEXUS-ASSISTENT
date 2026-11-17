import { describe, expect, test } from 'vitest';
import { toImportedMessage } from '@/domain/import/mail';
import { isAutomatedMail, plainPreview, senderLabel } from '@/domain/mail-text';

describe('Mail-Text', () => {
  test('Anzeigename aus dem Kopf, Vorschau ohne Bild und Adresse', () => {
    expect(senderLabel('"Google" <no-reply@accounts.google.com>')).toBe('Google');
    const preview = plainPreview('Sicherheitswarnung [image: Google] Mehr unter https://accounts.google.com/very/long/path');
    expect(preview).toBe('Sicherheitswarnung Mehr unter');
    expect(preview).not.toContain('http');
  });

  test('No-Reply, Google-Konto, Newsletter und Meta sind System', () => {
    expect(isAutomatedMail({ channel: 'email', from: 'Mailer-Daemon <mailer-daemon@example.de>' })).toBe(true);
    expect(isAutomatedMail({ channel: 'email', from: 'notifications@shop.example.de' })).toBe(true);
    expect(isAutomatedMail({ channel: 'email', from: 'News <news@example.de>', subject: 'Newsletter Mai' })).toBe(true);
    expect(isAutomatedMail({ channel: 'email', from: 'Meta <noreply@facebookmail.com>' })).toBe(true);
    expect(isAutomatedMail({ channel: 'email', from: 'Kunde <kunde@example.de>', subject: 'Zulassung' })).toBe(false);
    expect(isAutomatedMail({ channel: 'whatsapp', from: 'no-reply@example.de' })).toBe(false);
  });

  test('Import setzt automatische Mails nicht auf Antwort', () => {
    const msg = toImportedMessage({
      connectionId: 'gmail', direction: 'in', messageId: '<g@accounts.google.com>',
      from: '"Google" <no-reply@accounts.google.com>', to: 'ich@example.de',
      subject: 'Sicherheitswarnung', text: 'Jemand hat sich angemeldet.', sentAt: '2026-11-17T04:10:00.000Z',
    });
    expect(msg).toMatchObject({ automated: true, needsReply: false, subject: 'Sicherheitswarnung' });
    const letter = toImportedMessage({
      connectionId: 'gmail', direction: 'in', messageId: '<n@example.de>',
      from: 'Blatt <blatt@example.de>', to: 'ich@example.de', subject: 'Mai', text: 'Neuigkeiten',
      sentAt: '2026-11-17T04:10:00.000Z', listUnsubscribe: true,
    });
    expect(letter).toMatchObject({ automated: true, needsReply: false });
  });
});
