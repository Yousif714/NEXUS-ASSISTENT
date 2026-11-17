import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { SetupChecklist } from '@/components/SetupChecklist';
import type { Connection } from '@/domain/types';

const row = (id: Connection['id'], status: Connection['status'], lastError?: string): Connection => ({
  id, company: null, label: id === 'info_mail' ? 'info@-Postfach' : id, status, lastSuccessAt: status === 'missing' ? null : '2026-11-12T09:00:00Z',
  ...(lastError ? { lastError } : {}),
});

describe('Postfach in der Einrichtung', () => {
  test('zeigt „Jetzt abrufen“ je Postfach und den Fehlertext, nicht bei anderen Quellen', () => {
    const html = renderToStaticMarkup(createElement(SetupChecklist, {
      connections: [
        row('info_mail', 'error', 'IMAP: Anmeldung abgelehnt'),
        row('gmail', 'connected'),
        row('mail_buero' as Connection['id'], 'missing'),
        row('mail_config' as Connection['id'], 'error', 'IMAP_ACCOUNTS ist kein gültiges JSON'),
        row('stripe_nexus', 'missing'),
      ],
    }));
    expect(html).toContain('Jetzt abrufen');
    expect(html).toContain('data-testid="mail-fetch-info_mail"');
    expect(html).toContain('data-testid="mail-fetch-gmail"');
    expect(html).toContain('data-testid="mail-fetch-mail_buero"');
    expect(html).not.toContain('data-testid="mail-fetch-mail_config"');
    expect(html).not.toContain('data-testid="mail-fetch-stripe_nexus"');
    expect(html).toContain('Störung: IMAP: Anmeldung abgelehnt');
    expect(html).toContain('IMAP_ACCOUNTS ist kein gültiges JSON');
  });
});
