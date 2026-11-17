import { describe, expect, test } from 'vitest';

import { pullCalendar, CALENDAR_MAX_BYTES } from '@/server/connectors/calendar';
import { syncConnections, syncSecrets } from '@/server/sync';
import { ConnectorError, type PullContext } from '@/server/connectors/types';
import { parseCalendarUrls } from '@/server/env';

const NOW = Date.parse('2026-11-12T10:00:00Z');
const URL1 = 'https://calendar.example.de/private-GEHEIM123/basic.ics';
const URL2 = 'https://cal2.example.de/secret-TOKEN456/basic.ics';
const ICS = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a\r\nSUMMARY:Test\r\nDTSTART:20261112T120000Z\r\nEND:VEVENT\r\nEND:VCALENDAR';
const ctx = (f: typeof fetch, key = URL1): PullContext => ({ fetch: f, key, sleep: async () => {}, now: () => NOW, deadline: NOW + 60_000, known: new Map() });
const ok = (body = ICS) => (async () => new Response(body, { status: 200 })) as typeof fetch;

describe('pullCalendar', () => {
  test('liest Termine und setzt das Fenster', async () => {
    const r = await pullCalendar(null, ctx(ok()));
    expect(r.complete).toBe(true);
    expect(r.batch.events.map((e) => e.externalId)).toEqual(['a']);
    expect(r.batch.eventWindow).toMatchObject({ connectionId: 'calendar', fromAt: '2026-11-10T23:00:00.000Z', toAt: '2026-11-26T23:00:00.000Z' });
  });

  test('mehrere Adressen, doppelte UID nur einmal', async () => {
    const calls: string[] = [];
    const f = (async (u: string) => { calls.push(u); return new Response(ICS, { status: 200 }); }) as unknown as typeof fetch;
    const r = await pullCalendar(null, ctx(f, `${URL1}\n${URL2}`));
    expect(calls).toEqual([URL1, URL2]);
    expect(r.batch.events).toHaveLength(1);
  });

  test('HTTP-Fehler: Meldung ohne Adresse', async () => {
    const err = await pullCalendar(null, ctx((async () => new Response('x', { status: 404 })) as typeof fetch)).catch((e) => e);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.message).toBe('Kalender: Abruf fehlgeschlagen (HTTP 404)');
    expect(err.message).not.toContain('GEHEIM');
  });

  test('Netzfehler mit Adresse im Originaltext bleibt generisch', async () => {
    const err = await pullCalendar(null, ctx((async () => { throw new Error(`connect failed ${URL1}`); }) as typeof fetch)).catch((e) => e);
    expect(err.message).toBe('Kalender: keine Verbindung');
  });

  test('zweiter Kalender scheitert: ganzer Lauf scheitert mit Nummer', async () => {
    const f = (async (u: string) => (u === URL1 ? new Response(ICS) : new Response('', { status: 500 }))) as unknown as typeof fetch;
    const err = await pullCalendar(null, ctx(f, `${URL1}\n${URL2}`)).catch((e) => e);
    expect(err.message).toBe('Kalender 2: Abruf fehlgeschlagen (HTTP 500)');
  });

  test('kein iCal und zu große Datei', async () => {
    expect((await pullCalendar(null, ctx(ok('<html>Login</html>'))).catch((e) => e)).message).toBe('Kalender: Antwort ist kein iCal');
    const big = 'x'.repeat(CALENDAR_MAX_BYTES + 1);
    expect((await pullCalendar(null, ctx(ok(big))).catch((e) => e)).message).toBe('Kalender: Datei zu groß');
  });
});

describe('Umgebung', () => {
  test('Adressen: Komma, Zeilenumbruch, webcal, Duplikate, nur https', () => {
    expect(parseCalendarUrls(`webcal://a.example/x.ics, ${URL1}\n${URL1}\nhttp://unsicher.example/x\n  `)).toEqual(['https://a.example/x.ics', URL1]);
    expect(parseCalendarUrls(undefined)).toEqual([]);
    expect(parseCalendarUrls('   ')).toEqual([]);
  });

  test('syncSecrets maskiert jede einzelne Adresse', () => {
    expect(syncSecrets({ calendar: `${URL1}\n${URL2}` })).toEqual(expect.arrayContaining([URL1, URL2]));
  });
});

describe('syncConnections', () => {
  test('ohne Adresse: übersprungen, Verbindung bleibt missing', async () => {
    const out = await syncConnections({} as never, { keys: {}, only: ['calendar'], now: () => NOW, budgetMs: 1000 } as never);
    expect(out.calendar).toBe('skipped');
  });
});
