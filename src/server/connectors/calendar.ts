import 'server-only';

import { addDaysIso, todayBerlin } from '@/domain/clock';
import { emptyBatch, type ImportBatch } from '@/domain/import/batch';
import { parseIcs } from '@/domain/import/ics';

import { ConnectorError, type PullContext, type PullResult } from './types';

export const CALENDAR_MAX_BYTES = 5 * 1024 * 1024;
export const CALENDAR_TIMEOUT_MS = 15_000;
/** Fenster um heute: ein Tag zurück, 14 Tage voraus. */
export const CALENDAR_DAYS_BACK = 1;
export const CALENDAR_DAYS_AHEAD = 14;

/** Antworttext mit hartem Größenlimit. Bricht beim Überschreiten ab. */
async function readLimited(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > CALENDAR_MAX_BYTES) throw new ConnectorError('Kalender: Datei zu groß');
  if (!res.body) {
    const t = await res.text();
    if (t.length > CALENDAR_MAX_BYTES) throw new ConnectorError('Kalender: Datei zu groß');
    return t;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CALENDAR_MAX_BYTES) {
      await reader.cancel().catch(() => {});
      throw new ConnectorError('Kalender: Datei zu groß');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Liest die geheimen iCal-Adressen (`ctx.key`, durch Zeilenumbruch getrennt). Nur lesen.
 * Meldungen enthalten nie die Adresse (nur die laufende Nummer des Kalenders).
 * Scheitert ein Kalender, scheitert der ganze Lauf: sonst würden dessen Termine im Fenster entfernt.
 */
export async function pullCalendar(_cursor: string | null, ctx: PullContext): Promise<PullResult> {
  const urls = ctx.key.split('\n').map((u) => u.trim()).filter(Boolean);
  const today = todayBerlin(new Date(ctx.now()));
  const window = { from: addDaysIso(today, -CALENDAR_DAYS_BACK), to: addDaysIso(today, CALENDAR_DAYS_AHEAD) };
  const batch: ImportBatch = emptyBatch();
  const seen = new Set<string>();
  let fromAt = '';
  let toAt = '';
  for (const [i, url] of urls.entries()) {
    const label = urls.length > 1 ? `Kalender ${i + 1}` : 'Kalender';
    if (ctx.now() >= ctx.deadline) throw new ConnectorError(`${label}: Zeitbudget erreicht`);
    let res: Response;
    try {
      res = await ctx.fetch(url, { headers: { accept: 'text/calendar, text/plain, */*' }, redirect: 'follow', signal: AbortSignal.timeout(CALENDAR_TIMEOUT_MS) });
    } catch {
      throw new ConnectorError(`${label}: keine Verbindung`); // Originalfehler kann die Adresse enthalten
    }
    if (!res.ok) throw new ConnectorError(`${label}: Abruf fehlgeschlagen (HTTP ${res.status})`);
    let text: string;
    try {
      text = await readLimited(res);
    } catch (e) {
      throw e instanceof ConnectorError ? new ConnectorError(e.message.replace('Kalender', label)) : new ConnectorError(`${label}: Abruf fehlgeschlagen`);
    }
    if (!/BEGIN:VCALENDAR/i.test(text)) throw new ConnectorError(`${label}: Antwort ist kein iCal`);
    const r = parseIcs(text, 'calendar', window);
    fromAt = r.fromAt;
    toAt = r.toAt;
    for (const e of r.events) {
      if (seen.has(e.externalId)) continue;
      seen.add(e.externalId);
      batch.events.push(e);
    }
  }
  if (fromAt) batch.eventWindow = { connectionId: 'calendar', fromAt, toAt };
  return { batch, cursor: null, complete: true };
}
