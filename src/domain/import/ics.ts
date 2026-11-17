import { TZDate } from '@date-fns/tz';

import { addDaysIso, berlinLocalToUtc, type IsoDate } from '@/domain/clock';
import type { ImportedEvent } from '@/domain/import/batch';
import type { ConnectionId } from '@/domain/types';

/**
 * Reiner iCal-Parser (RFC 5545) für den Kalender-Abruf. Nur lesen.
 *
 * Unterstützt: VEVENT mit UID, SUMMARY, LOCATION, DTSTART/DTEND (UTC `Z`, TZID, schwebend = Europe/Berlin,
 * ganztägig `VALUE=DATE`), Zeilenfaltung, Text-Escapes, STATUS:CANCELLED (weggelassen),
 * RRULE mit FREQ=DAILY oder WEEKLY (INTERVAL, COUNT, UNTIL, BYDAY ohne Zahlenpräfix, WKST), EXDATE und
 * RECURRENCE-ID-Abweichungen (ersetzen das betroffene Vorkommen).
 * NICHT unterstützt (Serie wird übersprungen und in `skipped` gezählt): MONTHLY, YEARLY und alle anderen
 * Regeln (BYMONTHDAY, BYSETPOS, BYDAY mit Zahl wie 1MO, RDATE, ...).
 */
export interface IcsWindow { from: IsoDate; to: IsoDate }
export interface IcsResult { events: ImportedEvent[]; skipped: number; fromAt: string; toAt: string }

const BERLIN = 'Europe/Berlin';
const MAX_STEPS = 20_000;

interface Prop { params: Record<string, string>; value: string }
type Props = Record<string, Prop[]>;
interface When { allDay: boolean; date: IsoDate; time: string; tz: string; ms: number }

/** Zeilenfaltung auflösen (Fortsetzungszeilen beginnen mit Leerzeichen oder Tab). */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(' ') || raw.startsWith('\t')) && out.length) out[out.length - 1] += raw.slice(1);
    else out.push(raw);
  }
  return out;
}

export function unescapeText(v: string): string {
  return v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

function splitOutsideQuotes(s: string, sep: string, limit = Infinity): string[] {
  const parts: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (ch === sep && !quoted && parts.length < limit - 1) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function parseLine(line: string): { name: string; prop: Prop } | null {
  const [head, value] = splitOutsideQuotes(line, ':', 2);
  if (value === undefined) return null;
  const [name, ...rest] = splitOutsideQuotes(head, ';');
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), prop: { params, value } };
}

const validTz = (tz: string): boolean => Number.isFinite(new TZDate(2026, 0, 1, 12, 0, 0, 0, tz).getTime());

function instant(date: IsoDate, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss] = time.split(':').map(Number);
  return tz === 'UTC' ? Date.UTC(y, m - 1, d, hh, mm, ss) : new TZDate(y, m - 1, d, hh, mm, ss, 0, tz).getTime();
}

function parseWhen(p: Prop | undefined): When | null {
  if (!p) return null;
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(p.value.trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (m[4] === undefined || p.params.VALUE === 'DATE') {
    return { allDay: true, date, time: '00:00:00', tz: BERLIN, ms: berlinLocalToUtc(date, '00:00').getTime() };
  }
  const time = `${m[4]}:${m[5]}:${m[6]}`;
  const tz = m[7] ? 'UTC' : (p.params.TZID ?? BERLIN);
  if (!validTz(tz)) return null;
  return { allDay: false, date, time, tz, ms: instant(date, time, tz) };
}

const sameKey = (w: When): string => (w.allDay ? `d:${w.date}` : `t:${w.ms}`);

interface Rule { freq: 'DAILY' | 'WEEKLY'; interval: number; count?: number; until?: Prop; byday: number[]; wkst: number }
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function parseRule(value: string): Rule | null {
  const kv: Record<string, string> = {};
  for (const part of value.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) kv[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }
  const freq = kv.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY') return null;
  const supported = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'WKST']);
  if (Object.keys(kv).some((k) => !supported.has(k))) return null;
  const interval = kv.INTERVAL === undefined ? 1 : Number(kv.INTERVAL);
  if (!Number.isInteger(interval) || interval < 1) return null;
  const count = kv.COUNT === undefined ? undefined : Number(kv.COUNT);
  if (count !== undefined && (!Number.isInteger(count) || count < 1)) return null;
  const byday: number[] = [];
  if (kv.BYDAY !== undefined) {
    if (freq === 'DAILY') return null;
    for (const d of kv.BYDAY.split(',')) {
      const i = DAYS.indexOf(d.trim().toUpperCase());
      if (i < 0) return null; // z. B. 1MO
      byday.push(i);
    }
  }
  const wkst = kv.WKST === undefined ? 1 : DAYS.indexOf(kv.WKST.toUpperCase());
  if (wkst < 0) return null;
  return { freq, interval, ...(count !== undefined ? { count } : {}), ...(kv.UNTIL ? { until: { params: {}, value: kv.UNTIL } } : {}), byday, wkst };
}

const weekday = (date: IsoDate): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Lokale Kalendertage aller Vorkommen ab DTSTART, aufsteigend, bis `lastDate` (einschließlich). */
function* occurrenceDates(start: IsoDate, rule: Rule, lastDate: IsoDate): Generator<IsoDate> {
  if (rule.freq === 'DAILY') {
    for (let k = 0; k < MAX_STEPS; k++) {
      const d = addDaysIso(start, k * rule.interval);
      if (d > lastDate) return;
      yield d;
    }
    return;
  }
  const days = rule.byday.length ? [...rule.byday] : [weekday(start)];
  const offsets = days.map((d) => (d - rule.wkst + 7) % 7).sort((a, b) => a - b);
  const weekStart0 = addDaysIso(start, -((weekday(start) - rule.wkst + 7) % 7));
  for (let w = 0; w < MAX_STEPS; w++) {
    const base = addDaysIso(weekStart0, w * rule.interval * 7);
    if (base > lastDate) return;
    for (const o of offsets) {
      const d = addDaysIso(base, o);
      if (d >= start && d <= lastDate) yield d;
    }
  }
}

/** ICS-Text → Termine im Fenster [from, to] (Tage in Europe/Berlin). Externe IDs: `UID`, bei Serien `UID@YYYY-MM-DD`. */
export function parseIcs(text: string, connectionId: ConnectionId, window: IcsWindow): IcsResult {
  const fromAt = berlinLocalToUtc(window.from, '00:00').getTime();
  const toAt = berlinLocalToUtc(addDaysIso(window.to, 1), '00:00').getTime();
  const overlaps = (s: number, e: number) => s < toAt && (e > fromAt || (e === s && s >= fromAt));
  const vevents: Props[] = [];
  let cur: Props | null = null;
  let nested = 0;
  for (const line of unfold(text)) {
    const up = line.toUpperCase();
    if (up === 'BEGIN:VEVENT') { cur = {}; nested = 0; continue; }
    if (!cur) continue;
    if (up === 'END:VEVENT') { vevents.push(cur); cur = null; continue; }
    if (up.startsWith('BEGIN:')) { nested++; continue; }
    if (up.startsWith('END:')) { nested--; continue; }
    if (nested > 0) continue;
    const p = parseLine(line);
    if (p) (cur[p.name] ??= []).push(p.prop);
  }

  let skipped = 0;
  const out = new Map<string, ImportedEvent>();
  const overrides = new Map<string, Set<string>>(); // UID → ersetzte Vorkommen
  const add = (ext: string, p: Props, s: number, e: number): void => {
    if (!overlaps(s, e)) return;
    const title = unescapeText(p.SUMMARY?.[0]?.value ?? '').trim() || '(ohne Titel)';
    const location = unescapeText(p.LOCATION?.[0]?.value ?? '').trim();
    out.set(ext, { connectionId, externalId: ext, title, startAt: new Date(s).toISOString(), endAt: new Date(e).toISOString(), ...(location ? { location } : {}) });
  };
  const cancelled = (p: Props) => p.STATUS?.[0]?.value.trim().toUpperCase() === 'CANCELLED';
  const endOf = (p: Props, start: When): number => {
    const end = parseWhen(p.DTEND?.[0]);
    if (end && end.ms >= start.ms) return end.ms;
    return start.allDay ? berlinLocalToUtc(addDaysIso(start.date, 1), '00:00').getTime() : start.ms;
  };

  // 1) Abweichungen (RECURRENCE-ID) zuerst, damit die Serie das Vorkommen auslässt.
  for (const p of vevents) {
    const uid = p.UID?.[0]?.value.trim();
    const rid = parseWhen(p['RECURRENCE-ID']?.[0]);
    if (!uid || !rid) continue;
    (overrides.get(uid) ?? overrides.set(uid, new Set()).get(uid)!).add(sameKey(rid));
    const start = parseWhen(p.DTSTART?.[0]);
    if (!start || cancelled(p)) continue;
    add(`${uid}@${rid.date}`, p, start.ms, endOf(p, start));
  }

  // 2) Einzeltermine und Serien.
  for (const p of vevents) {
    const uid = p.UID?.[0]?.value.trim();
    if (!uid || p['RECURRENCE-ID']) continue;
    const start = parseWhen(p.DTSTART?.[0]);
    if (!start) { skipped++; continue; }
    if (cancelled(p)) continue;
    const endMs = endOf(p, start);
    const rrule = p.RRULE?.[0];
    if (!rrule) {
      if (p.RDATE) skipped++;
      else add(uid, p, start.ms, endMs);
      continue;
    }
    const rule = parseRule(rrule.value);
    if (!rule || p.RDATE) { skipped++; continue; }
    const ex = new Set<string>(overrides.get(uid) ?? []);
    for (const x of p.EXDATE ?? []) {
      for (const v of x.value.split(',')) {
        const w = parseWhen({ params: x.params, value: v });
        if (w) ex.add(sameKey(w));
      }
    }
    const until = rule.until ? parseWhen(rule.until) : null;
    const last = addDaysIso(window.to, 1); // ein Tag Puffer für Zeitzonen
    const spanMs = endMs - start.ms;
    let n = 0;
    for (const date of occurrenceDates(start.date, rule, last)) {
      const ms = start.allDay ? berlinLocalToUtc(date, '00:00').getTime() : instant(date, start.time, start.tz);
      if (until && (until.allDay ? date > until.date : ms > until.ms)) break;
      if (rule.count !== undefined && ++n > rule.count) break;
      if (ex.has(start.allDay ? `d:${date}` : `t:${ms}`)) continue;
      add(`${uid}@${date}`, p, ms, ms + spanMs);
    }
  }
  const events = [...out.values()].sort((a, b) => a.startAt.localeCompare(b.startAt) || a.externalId.localeCompare(b.externalId));
  return { events, skipped, fromAt: new Date(fromAt).toISOString(), toAt: new Date(toAt).toISOString() };
}
