import { beforeEach, describe, expect, test } from 'vitest';
import { createEmptyState } from '@/data/empty-state';
import { emptyBatch } from '@/domain/import/batch';
import { HOW_TO } from '@/domain/connections';
import { toImportedMessage } from '@/domain/import/mail';
import { mergeBatch } from '@/domain/import/merge';
import { DemoProvider } from '@/domain/actions/demo-provider';
import { createMemoryRepos } from '@/server/db/memory';
import type { Repos } from '@/server/db/repository';
import { parseRawMail, type ImapSession } from '@/server/connectors/imap';
import { ConnectorError } from '@/server/connectors/types';
import { syncConnections, type SyncDeps } from '@/server/sync';
import { dispatchEvents } from '@/server/state-service';

const NOW = new Date('2026-11-12T10:00:00Z');
let repos: Repos;
beforeEach(() => { repos = createMemoryRepos(); });

const account = (password = 'app-password-value') => ({ host: 'imap.gmail.com', port: 993, user: 'privat@example.de', password });

function mail(id: string, body: string, o: { from?: string; to?: string; subject?: string } = {}): string {
  return [
    `From: ${o.from ?? 'Kunde Beispiel <kunde@example.de>'}`,
    `To: ${o.to ?? 'info@example.de'}`,
    `Subject: ${o.subject ?? 'Zulassung'}`,
    'Date: Thu, 12 Nov 2026 10:00:00 +0100',
    `Message-ID: <${id}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');
}

const deps = (p: Partial<SyncDeps> = {}): SyncDeps => ({
  at: () => NOW,
  keys: {},
  fetch: async () => { throw new Error('kein HTTP'); },
  sleep: async () => {},
  now: () => 0,
  budgetMs: 40_000,
  provider: new DemoProvider(),
  ...p,
});

const state = async () => (await repos.state.load()).state;

describe('IMAP-Abruf', () => {
  test('ohne Zugangsdaten bleibt das Postfach missing und der Client wird nicht geöffnet', async () => {
    let opened = false;
    const r = await syncConnections(repos, deps({
      only: ['info_mail', 'gmail', 'icloud'],
      openImap: async () => { opened = true; throw new Error('soll nicht laufen'); },
    }));
    expect(r).toEqual({ info_mail: 'skipped', gmail: 'skipped', icloud: 'skipped' });
    expect(opened).toBe(false);
    expect((await state()).connections.find((c) => c.id === 'info_mail')?.status).toBe('missing');
    expect((await state()).connections.find((c) => c.id === 'gmail')?.status).toBe('missing');
  });

  test('Dedupe über Message-ID, zweiter Lauf legt nichts Neues an', async () => {
    const calls: { which: string; afterUid: number }[] = [];
    const open = async (): Promise<ImapSession> => ({
      async sentMailbox() { return true; },
      async fetchNew(which, afterUid) {
        calls.push({ which, afterUid });
        if (which !== 'inbox') return { messages: [], more: false };
        const rows = [
          { uid: 2, raw: Buffer.from(mail('dup@example.de', 'Hallo')) },
          { uid: 3, raw: Buffer.from(mail('dup@example.de', 'Hallo nochmal')) },
        ].filter((m) => m.uid > afterUid);
        return { messages: rows, more: false };
      },
      async close() {},
    });
    const d = deps({ only: ['gmail'], imap: { gmail: account() }, openImap: open });
    expect(await syncConnections(repos, d)).toMatchObject({ gmail: 'ok' });
    const first = await state();
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0]).toMatchObject({ externalId: 'dup@example.de', body: expect.stringContaining('Hallo nochmal'), channel: 'email', connectionId: 'gmail' });
    expect(JSON.parse(first.connections.find((c) => c.id === 'gmail')!.sync!.cursor!)).toMatchObject({ inboxUid: 3, sentUid: 0, since: '2026-06-01' });
    expect(await syncConnections(repos, d)).toMatchObject({ gmail: 'ok' });
    expect((await state()).messages).toHaveLength(1);
    expect(calls.filter((c) => c.which === 'inbox').map((c) => c.afterUid)).toEqual([0, 3]);
  });

  test('Cursor rückt nur bis zur verarbeiteten UID vor', async () => {
    let round = 0;
    const open = async (): Promise<ImapSession> => ({
      async sentMailbox() { return false; },
      async fetchNew(which, afterUid) {
        if (which !== 'inbox') return { messages: [], more: false };
        round += 1;
        if (round === 1) {
          expect(afterUid).toBe(0);
          return { messages: [{ uid: 4, raw: Buffer.from(mail('a@example.de', 'Erste')) }], more: true };
        }
        expect(afterUid).toBe(4);
        return { messages: [{ uid: 9, raw: Buffer.from(mail('b@example.de', 'Zweite')) }], more: false };
      },
      async close() {},
    });
    const d = deps({ only: ['info_mail'], imap: { info_mail: account() }, openImap: open });
    expect(await syncConnections(repos, d)).toMatchObject({ info_mail: 'partial' });
    expect(JSON.parse((await state()).connections.find((c) => c.id === 'info_mail')!.sync!.cursor!).inboxUid).toBe(4);
    expect(await syncConnections(repos, d)).toMatchObject({ info_mail: 'ok' });
    const s = await state();
    expect(s.messages.map((m) => m.externalId).sort()).toEqual(['a@example.de', 'b@example.de']);
    expect(s.connections.find((c) => c.id === 'info_mail')).toMatchObject({ status: 'connected', sync: { complete: true, failures: 0 } });
  });

  test('Kontakt über die Absenderadresse, Gesendet schlägt den Posteingang', async () => {
    await dispatchEvents(repos, [{
      type: 'mcpChange',
      change: { op: 'createContact', contact: { company: 'zulassung', kind: 'private', name: 'Kunde Beispiel', phones: [], emails: ['kunde@example.de'] } },
    }], { at: () => NOW, provider: new DemoProvider() });
    const open = async (): Promise<ImapSession> => ({
      async sentMailbox() { return true; },
      async fetchNew(which) {
        if (which === 'inbox') {
          return { messages: [{ uid: 1, raw: Buffer.from(mail('thread@example.de', 'Frage', { from: 'Kunde Beispiel <kunde@example.de>', to: 'info@example.de' })) }], more: false };
        }
        return { messages: [{ uid: 7, raw: Buffer.from(mail('thread@example.de', 'Antwort', { from: 'info@example.de', to: 'Kunde Beispiel <kunde@example.de>' })) }], more: false };
      },
      async close() {},
    });
    await syncConnections(repos, deps({ only: ['info_mail'], imap: { info_mail: account() }, openImap: open }));
    const s = await state();
    const contact = s.contacts.find((c) => c.emails.includes('kunde@example.de'));
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0]).toMatchObject({ direction: 'out', needsReply: false, contactId: contact?.id, subject: 'Zulassung' });
    expect(s.messages[0].body).toContain('Antwort');
    expect(s.messages[0].body).not.toContain('Frage');
  });

  test('Anhang steht nicht im Text', async () => {
    const raw = Buffer.from([
      'From: Kunde <kunde@example.de>',
      'To: info@example.de',
      'Subject: Schein',
      'Date: Thu, 12 Nov 2026 10:00:00 +0100',
      'Message-ID: <att@example.de>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="abc"',
      '',
      '--abc',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Bitte um Rueckruf.',
      '',
      '--abc',
      'Content-Type: application/pdf; name="schein.pdf"',
      'Content-Disposition: attachment; filename="schein.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQKUEFZTE9BRA==',
      '',
      '--abc--',
      '',
    ].join('\r\n'));
    const msg = await parseRawMail(raw, 'gmail', 'in', 1, 'inbox');
    expect(msg?.body).toContain('Bitte um Rueckruf.');
    expect(msg?.body).not.toContain('JVBERi0');
    expect(msg?.externalId).toBe('att@example.de');
  });

  test('ohne Zeitbudget bleibt die Quelle missing', async () => {
    let opened = false;
    await syncConnections(repos, deps({
      only: ['gmail'],
      now: () => 5_000,
      budgetMs: 0,
      imap: { gmail: account() },
      openImap: async () => { opened = true; throw new Error('soll nicht verbinden'); },
    }));
    const c = (await state()).connections.find((x) => x.id === 'gmail')!;
    expect(opened).toBe(false);
    expect(c.status).toBe('missing');
    expect(c.sync).toBeUndefined();
  });

  test('Fehlertext enthält das Passwort nicht', async () => {
    const password = 'app-password-value';
    await syncConnections(repos, deps({
      only: ['gmail'],
      imap: { gmail: account(password) },
      openImap: async () => { throw new ConnectorError(`IMAP: Anmeldung abgelehnt ${password}`); },
    }));
    const c = (await state()).connections.find((x) => x.id === 'gmail')!;
    expect(c.status).toBe('error');
    expect(c.lastError).toBe('IMAP: Anmeldung abgelehnt ***');
    expect(JSON.stringify(c)).not.toContain(password);
    expect(c.sync?.failures).toBe(1);
  });
});

describe('Nachrichten und Termine im Merge', () => {
  const seq = () => {
    let n = 0;
    return () => `id-${++n}`;
  };
  const imported = toImportedMessage({
    connectionId: 'gmail', direction: 'in', messageId: 'keep@example.de', from: 'kunde@example.de', to: 'info@example.de',
    subject: 'Betreff', text: 'Text', sentAt: '2026-11-12T09:00:00.000Z',
  })!;

  test('erledigt bleibt erledigt, gleiche Message-ID wird nicht verdoppelt', () => {
    const id = seq();
    const first = mergeBatch(createEmptyState(), { ...emptyBatch(), messages: [imported] }, id).state;
    const marked = { ...first, messages: [{ ...first.messages[0], doneManually: true, needsReply: false }] };
    const again = mergeBatch(marked, { ...emptyBatch(), messages: [{ ...imported, body: 'Betreff\n\nNeu' }] }, id);
    expect(again.added.messages).toBe(0);
    expect(again.state.messages).toHaveLength(1);
    expect(again.state.messages[0]).toMatchObject({ id: 'id-1', doneManually: true, needsReply: false, body: 'Betreff\n\nNeu' });
  });

  test('Termine sind über die externe ID idempotent', () => {
    const id = seq();
    const ev = { connectionId: 'calendar' as const, externalId: 'cal-1', title: 'Termin', startAt: '2026-11-12T09:00:00.000Z', endAt: '2026-11-12T10:00:00.000Z' };
    const first = mergeBatch(createEmptyState(), { ...emptyBatch(), events: [ev, { ...ev, title: 'Termin neu' }] }, id);
    expect(first.added.events).toBe(1);
    expect(first.state.events).toEqual([expect.objectContaining({ id: 'id-1', title: 'Termin neu', externalId: 'cal-1' })]);
    const second = mergeBatch(first.state, { ...emptyBatch(), events: [{ ...ev, title: 'Später' }] }, id);
    expect(second.added.events).toBe(0);
    expect(second.state.events).toHaveLength(1);
    expect(second.state.events[0].title).toBe('Später');
  });
});

test('Anleitungen nennen App-Passwort und die Variablen', () => {
  expect(HOW_TO.gmail).toMatch(/Bestätigung in zwei Schritten/);
  expect(HOW_TO.gmail).toMatch(/App-Passwörter/);
  expect(HOW_TO.gmail).toMatch(/IMAP_GMAIL_USER/);
  expect(HOW_TO.gmail).toMatch(/imap\.gmail\.com/);
  expect(HOW_TO.info_mail).toMatch(/@gmail\.com/);
  expect(HOW_TO.info_mail).toMatch(/IMAP_INFO_MAIL_USER/);
  expect(HOW_TO.info_mail).toMatch(/IMAP_INFO_MAIL_HOST/);
  expect(HOW_TO.icloud).toMatch(/App-spezifische Passwörter/);
  expect(HOW_TO.icloud).toMatch(/IMAP_ICLOUD_USER/);
  expect(HOW_TO.icloud).toMatch(/imap\.mail\.me\.com/);
});
