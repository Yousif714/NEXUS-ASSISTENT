import { describe, expect, test } from 'vitest';

import { emptyBatch } from '@/domain/import/batch';
import { parseIcs } from '@/domain/import/ics';
import { mergeBatch } from '@/domain/import/merge';
import { createDemoState } from '@/data/seed';

const W = { from: '2026-11-11', to: '2026-11-26' }; // heute = 2026-11-12
const cal = (...events: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.map((e) => `BEGIN:VEVENT\n${e}\nEND:VEVENT`), 'END:VCALENDAR'].join('\r\n');
const parse = (text: string) => parseIcs(text, 'calendar', W);

describe('parseIcs', () => {
  test('UTC, Escapes und Zeilenfaltung', () => {
    const r = parse(cal('UID:a1\nSUMMARY:Termin mit\\, Komma und\r\n  Falte\nLOCATION:Hauptstr. 1\\; Köln\nDTSTART:20261112T080000Z\nDTEND:20261112T090000Z'));
    expect(r.events).toEqual([{ connectionId: 'calendar', externalId: 'a1', title: 'Termin mit, Komma und Falte', location: 'Hauptstr. 1; Köln', startAt: '2026-11-12T08:00:00.000Z', endAt: '2026-11-12T09:00:00.000Z' }]);
  });

  test('TZID Europe/Berlin (Winter und Sommer) und schwebende Zeit', () => {
    const r = parseIcs(cal(
      'UID:w\nSUMMARY:W\nDTSTART;TZID=Europe/Berlin:20261112T100000\nDTEND;TZID=Europe/Berlin:20261112T110000',
      'UID:f\nSUMMARY:F\nDTSTART:20261113T100000',
    ), 'calendar', W);
    expect(r.events.map((e) => [e.externalId, e.startAt, e.endAt])).toEqual([
      ['w', '2026-11-12T09:00:00.000Z', '2026-11-12T10:00:00.000Z'],
      ['f', '2026-11-13T09:00:00.000Z', '2026-11-13T09:00:00.000Z'],
    ]);
    const summer = parseIcs(cal('UID:s\nSUMMARY:S\nDTSTART;TZID=Europe/Berlin:20260715T100000'), 'calendar', { from: '2026-07-14', to: '2026-07-20' });
    expect(summer.events[0].startAt).toBe('2026-07-15T08:00:00.000Z');
  });

  test('ganztägig: Berliner Mitternacht, DTEND exklusiv, ohne DTEND ein Tag', () => {
    const r = parse(cal(
      'UID:g1\nSUMMARY:Urlaub\nDTSTART;VALUE=DATE:20261114\nDTEND;VALUE=DATE:20261116',
      'UID:g2\nSUMMARY:Feiertag\nDTSTART;VALUE=DATE:20261120',
    ));
    expect(r.events[0]).toMatchObject({ externalId: 'g1', startAt: '2026-11-13T23:00:00.000Z', endAt: '2026-11-15T23:00:00.000Z' });
    expect(r.events[1]).toMatchObject({ externalId: 'g2', startAt: '2026-11-19T23:00:00.000Z', endAt: '2026-11-20T23:00:00.000Z' });
  });

  test('Fenster: außerhalb weggelassen, laufender Termin bleibt', () => {
    const r = parse(cal(
      'UID:alt\nSUMMARY:Alt\nDTSTART:20261001T080000Z\nDTEND:20261001T090000Z',
      'UID:spaet\nSUMMARY:Spät\nDTSTART:20261201T080000Z',
      'UID:lang\nSUMMARY:Lang\nDTSTART:20261001T080000Z\nDTEND:20261201T080000Z',
    ));
    expect(r.events.map((e) => e.externalId)).toEqual(['lang']);
  });

  test('STATUS:CANCELLED entfällt', () => {
    expect(parse(cal('UID:c\nSUMMARY:X\nSTATUS:CANCELLED\nDTSTART:20261112T080000Z')).events).toEqual([]);
  });

  test('RRULE weekly mit BYDAY, EXDATE und Schlüssel mit Datum', () => {
    const r = parse(cal('UID:s\nSUMMARY:Jour fixe\nDTSTART;TZID=Europe/Berlin:20261005T090000\nDTEND;TZID=Europe/Berlin:20261005T100000\nRRULE:FREQ=WEEKLY;BYDAY=MO,TH\nEXDATE;TZID=Europe/Berlin:20261116T090000'));
    expect(r.events.map((e) => e.externalId)).toEqual(['s@2026-11-12', 's@2026-11-19', 's@2026-11-23', 's@2026-11-26']);
    expect(r.events[0]).toMatchObject({ startAt: '2026-11-12T08:00:00.000Z', endAt: '2026-11-12T09:00:00.000Z' });
  });

  test('RRULE weekly: INTERVAL, COUNT und UNTIL', () => {
    const base = 'UID:s\nSUMMARY:S\nDTSTART:20261105T080000Z\n';
    expect(parse(cal(`${base}RRULE:FREQ=WEEKLY;INTERVAL=2`)).events.map((e) => e.externalId)).toEqual(['s@2026-11-19']);
    expect(parse(cal(`${base}RRULE:FREQ=WEEKLY;COUNT=2`)).events.map((e) => e.externalId)).toEqual(['s@2026-11-12']);
    expect(parse(cal(`${base}RRULE:FREQ=WEEKLY;UNTIL=20261118T000000Z`)).events.map((e) => e.externalId)).toEqual(['s@2026-11-12']);
  });

  test('RRULE daily mit COUNT ab Serienbeginn und EXDATE als Liste', () => {
    const r = parse(cal('UID:d\nSUMMARY:D\nDTSTART;VALUE=DATE:20261110\nRRULE:FREQ=DAILY;COUNT=5\nEXDATE;VALUE=DATE:20261112,20261113'));
    expect(r.events.map((e) => e.externalId)).toEqual(['d@2026-11-11', 'd@2026-11-14']);
  });

  test('RECURRENCE-ID ersetzt ein Vorkommen', () => {
    const r = parse(cal(
      'UID:s\nSUMMARY:Serie\nDTSTART:20261105T080000Z\nDTEND:20261105T090000Z\nRRULE:FREQ=WEEKLY',
      'UID:s\nRECURRENCE-ID:20261112T080000Z\nSUMMARY:Verschoben\nDTSTART:20261112T150000Z\nDTEND:20261112T160000Z',
    ));
    expect(r.events.find((e) => e.externalId === 's@2026-11-12')).toMatchObject({ title: 'Verschoben', startAt: '2026-11-12T15:00:00.000Z' });
    expect(r.events.filter((e) => e.externalId === 's@2026-11-12')).toHaveLength(1);
  });

  test('komplexe RRULE (monatlich, 1MO) wird übersprungen und gezählt', () => {
    const r = parse(cal(
      'UID:m\nSUMMARY:M\nDTSTART:20261112T080000Z\nRRULE:FREQ=MONTHLY',
      'UID:n\nSUMMARY:N\nDTSTART:20261112T080000Z\nRRULE:FREQ=WEEKLY;BYDAY=1MO',
      'UID:ok\nSUMMARY:OK\nDTSTART:20261112T080000Z',
    ));
    expect(r.events.map((e) => e.externalId)).toEqual(['ok']);
    expect(r.skipped).toBe(2);
  });

  test('VALARM-Zeilen stören nicht', () => {
    const r = parse(cal('UID:v\nSUMMARY:Echt\nDTSTART:20261112T080000Z\nBEGIN:VALARM\nSUMMARY:Alarm\nEND:VALARM'));
    expect(r.events[0].title).toBe('Echt');
  });
});

describe('Kalender-Merge', () => {
  const ev = (externalId: string, startAt: string) => ({ connectionId: 'calendar' as const, externalId, title: externalId, startAt, endAt: startAt });
  const win = { connectionId: 'calendar' as const, fromAt: '2026-11-10T23:00:00.000Z', toAt: '2026-11-26T23:00:00.000Z' };

  test('idempotent, aktualisiert und entfernt Verschwundenes im Fenster', () => {
    const s0 = { ...createDemoState(), events: [] };
    const outside = { id: 'x', title: 'außerhalb', startAt: '2026-10-01T08:00:00.000Z', endAt: '2026-10-01T09:00:00.000Z', connectionId: 'calendar' as const, externalId: 'old' };
    const other = { id: 'y', title: 'andere Quelle', startAt: '2026-11-12T08:00:00.000Z', endAt: '2026-11-12T09:00:00.000Z' };
    let n = 0;
    const newId = () => `id${++n}`;
    const batch = { ...emptyBatch(), events: [ev('a', '2026-11-12T08:00:00.000Z'), ev('b', '2026-11-13T08:00:00.000Z')], eventWindow: win };
    const first = mergeBatch({ ...s0, events: [outside, other] }, batch, newId);
    expect(first.added.events).toBe(2);
    const second = mergeBatch(first.state, batch, newId);
    expect(second.added.events).toBe(0);
    expect(second.state.events).toEqual(first.state.events);
    const third = mergeBatch(second.state, { ...batch, events: [batch.events[0]] }, newId);
    expect(third.state.events.map((e) => e.externalId ?? e.id)).toEqual(['old', 'y', 'a']);
  });

  test('leerer Abruf mit Fenster löscht alle Termine der Verbindung im Fenster', () => {
    const s0 = { ...createDemoState(), events: [] };
    const first = mergeBatch(s0, { ...emptyBatch(), events: [ev('a', '2026-11-12T08:00:00.000Z')], eventWindow: win }, () => 'i1');
    const empty = mergeBatch(first.state, { ...emptyBatch(), eventWindow: win }, () => 'i2');
    expect(empty.state.events).toEqual([]);
  });
});
