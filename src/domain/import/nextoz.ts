import { CONNECTION_CATALOG } from '../connections';
import type { AppState, Connection, ExternalRef, IsoDate, Job, Vehicle } from '../types';
import {
  MDC_CSV_MAX_CHARS, parseSemicolonCsv,
  type EntityCounts, type MdcImportResult, type MdcParseError, type MdcParseResult,
} from './mydigitalcar';
import { parseDeAmountCents, parseDotAmountCents } from './sparkasse';

/**
 * nextOZ-Anträge (dashboard.nextoz.de, Liste ohne eigene Exportfunktion, selbst als CSV):
 * Semikolon, UTF-8, eine Kopfzeile.
 * Externe ID = Auftragsnummer ohne führendes '#'. 'Nr' ist nur die Listenposition.
 * Halter fehlt in dieser Liste: Auftrag ohne Kontakt.
 * Fahrzeug nur bei FIN oder echtem Kennzeichen. 'Zufällig' ist kein Kennzeichen.
 */

export const NEXTOZ_COLUMNS = [
  'Nr', 'Auftragsnummer', 'Kennzeichen', 'FIN', 'Antragsart', 'Datum', 'Status', 'Fehler', 'Amtsgebuehr',
] as const;

export type NextozColumn = (typeof NEXTOZ_COLUMNS)[number];

/**
 * nextOZ-Antragsart. WG ist die Wiederinbetriebsetzung (Wiederzulassung nach einer Abmeldung),
 * nicht die myDigitalCar-Leistung „Wiederzulassung“. UM ist die Ummeldung, nicht die Umschreibung.
 * WZ ist die Wiederzulassung. Der Rohwert bleibt in `portalData.Antragsart`.
 */
export const NEXTOZ_SERVICE: Record<string, string> = {
  AB: 'Abmeldung',
  WG: 'Wiederinbetriebsetzung',
  UM: 'Ummeldung',
  NZ: 'Neuzulassung',
  WZ: 'Wiederzulassung',
  HA: 'Halterdatenänderung',
};

const CONNECTION = 'nextoz' as const;

const PROBLEM_STATUS = new Set(['fehler', 'abgelehnt', 'signaturfehler', 'signatur abgelehnt']);

export interface NextozRow {
  line: number;
  raw: Record<string, string>;
  /** Auftragsnummer ohne führendes '#', sonst Hash der Zeile ohne die Listenposition `Nr`. */
  externalId: string;
}

const cell = (raw: Record<string, string>, key: string) => (raw[key] ?? '').trim();
const normVin = (vin: string) => vin.trim().toUpperCase().replace(/[\s-]/g, '');
const normPlate = (plate: string) => plate.trim().toUpperCase().replace(/\s+/g, ' ');

export function nextozServiceName(code: string): string {
  const c = code.trim().toUpperCase();
  return NEXTOZ_SERVICE[c] ?? (c ? `Vorgang ${c}` : 'Zulassung');
}

/**
 * Rohstatus → Auftragsstatus. Entwurf, Signatur läuft und In Bearbeitung bleiben offen.
 * Fehler, Abgelehnt, Signaturfehler und Signatur abgelehnt bleiben offen und sind ein Problem.
 */
export function mapNextozStatus(raw: string): { status: Job['status']; problem: boolean } {
  const norm = raw.trim().toLowerCase();
  if (norm === 'erfolgreich') return { status: 'done', problem: false };
  if (PROBLEM_STATUS.has(norm)) return { status: 'open', problem: true };
  return { status: 'open', problem: false };
}

/** Führende '#' entfernen. Leer, wenn danach nichts übrig ist. */
export function nextozOrderId(auftragsnummer: string): string {
  return auftragsnummer.trim().replace(/^#+/, '').trim();
}

/** 'Zufällig' und leer sind kein Kennzeichen. Sonst normalisiert (Großbuchstaben, einfache Leerzeichen). */
export function nextozPlate(kennzeichen: string): string | null {
  const t = kennzeichen.trim();
  if (!t) return null;
  const folded = t.toLowerCase();
  if (folded === 'zufällig' || folded === 'zufaellig') return null;
  const plate = normPlate(t);
  return plate || null;
}

/** Amtsgebühr in Cent. Punkt (`12.40`) oder deutsches Komma (`12,40`). Leer oder unlesbar → 0. */
export function parseNextozFeeCents(raw: string): number {
  const t = raw.trim();
  if (!t) return 0;
  const parsed = t.includes(',') ? parseDeAmountCents(t) : parseDotAmountCents(t);
  if (parsed === null || parsed < 0) return 0;
  return parsed;
}

/** `YYYY-MM-DD` oder `null`. */
export function parseNextozDate(raw: string): IsoDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function fnv(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x811c9dc5);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

function rowKey(raw: Record<string, string>, columns: string[]): string {
  const id = nextozOrderId(cell(raw, 'Auftragsnummer'));
  if (id) return id;
  const body = columns.filter((c) => c !== 'Nr').map((c) => raw[c] ?? '').join('\u001e');
  return `row:${fnv(body)}`;
}

export function parseNextozCsv(csv: string): MdcParseResult {
  if (csv.length > MDC_CSV_MAX_CHARS) {
    return { ok: false, error: 'Die Datei ist zu groß. Bitte in mehreren Portionen mit derselben Kopfzeile importieren.' };
  }
  const table = parseSemicolonCsv(csv);
  if ('error' in table) return { ok: false, error: table.error };
  const missing = NEXTOZ_COLUMNS.filter((c) => !table.columns.includes(c));
  if (missing.length > 0) return { ok: false, error: `Kopfzeile unvollständig, es fehlen: ${missing.join(', ')}` };
  const seen = new Map<string, number>();
  const rows: NextozRow[] = [];
  let duplicates = 0;
  table.rows.forEach((cells, index) => {
    const raw: Record<string, string> = {};
    table.columns.forEach((col, i) => {
      if (!col || raw[col] !== undefined) return;
      raw[col] = (cells[i] ?? '').trim();
    });
    const externalId = rowKey(raw, table.columns);
    const prev = seen.get(externalId);
    const row: NextozRow = { line: index + 2, raw, externalId };
    if (prev !== undefined) {
      duplicates++;
      rows[prev] = row;
      return;
    }
    seen.set(externalId, rows.length);
    rows.push(row);
  });
  return { ok: true, rows, duplicates, errors: [] };
}

function portalDataOf(raw: Record<string, string>, columns: readonly string[]): Record<string, string> {
  const known = new Set<string>(NEXTOZ_COLUMNS);
  const out: Record<string, string> = {};
  for (const k of [...NEXTOZ_COLUMNS, ...columns.filter((c) => !known.has(c))]) out[k] = (raw[k] ?? '').trim();
  return out;
}

function withRef(refs: ExternalRef[] | undefined, ref: ExternalRef): ExternalRef[] {
  const list = refs ?? [];
  if (list.some((r) => r.connectionId === ref.connectionId && r.externalId === ref.externalId)) return list;
  return [...list, ref];
}

const zero = (): EntityCounts => ({ created: 0, updated: 0, skipped: 0 });
const bump = (c: EntityCounts, kind: keyof EntityCounts) => { c[kind] += 1; };

function touch(counts: EntityCounts, before: unknown, after: unknown, created: boolean) {
  if (created) bump(counts, 'created');
  else if (JSON.stringify(before) !== JSON.stringify(after)) bump(counts, 'updated');
  else bump(counts, 'skipped');
}

function markConnected(connections: Connection[], at: string): Connection[] {
  let found = false;
  const next = connections.map((c) => {
    if (c.id !== CONNECTION) return c;
    found = true;
    const row: Connection = { ...c, status: 'connected', lastSuccessAt: at, sync: { cursor: null, complete: true, failures: 0 } };
    delete row.lastError;
    return row;
  });
  if (found) return next;
  const label = CONNECTION_CATALOG.find((c) => c.id === CONNECTION)?.label ?? 'nextOZ';
  return [...next, { id: CONNECTION, company: 'zulassung', label, status: 'connected', lastSuccessAt: at, sync: { cursor: null, complete: true, failures: 0 } }];
}

/**
 * Führt nextOZ-Anträge in den Zustand. Gleicher Auftrag = Auftragsnummer ohne '#',
 * unabhängig von `Nr`. Gleiches Fahrzeug = FIN, sonst Kennzeichen, auch aus myDigitalCar.
 * Ein gesetzter Preis wird nicht genullt; abgerechnet oder bezahlt bleibt stehen.
 */
export function applyNextozImport(state: AppState, csv: string, newId: () => string, at: string): MdcImportResult {
  const parsed = parseNextozCsv(csv);
  const blank = { state, rows: 0, duplicates: 0, contacts: zero(), vehicles: zero(), jobs: zero(), errors: [] as MdcParseError[] };
  if (!parsed.ok) return { ...blank, error: parsed.error };

  const contacts = state.contacts.slice();
  const vehicles = state.vehicles.slice();
  const jobs = state.jobs.slice();
  const vinAt = new Map<string, number>();
  const plateAt = new Map<string, number>();
  const jobAt = new Map<string, number>();

  vehicles.forEach((v, i) => {
    const vin = normVin(v.vin);
    if (vin) vinAt.set(vin, i);
    const plate = normPlate(v.plate);
    if (plate) plateAt.set(plate, i);
    for (const r of v.externalRefs ?? []) {
      if (r.externalId.startsWith('fin:')) vinAt.set(normVin(r.externalId.slice(4)), i);
      if (r.externalId.startsWith('plate:')) plateAt.set(normPlate(r.externalId.slice(6)), i);
    }
  });
  jobs.forEach((j, i) => {
    for (const r of j.externalRefs ?? []) if (r.connectionId === CONNECTION) jobAt.set(r.externalId, i);
  });

  const counts = { contacts: zero(), vehicles: zero(), jobs: zero() };
  const columns = Object.keys(parsed.rows[0]?.raw ?? {});

  for (const row of parsed.rows) {
    const vin = normVin(cell(row.raw, 'FIN'));
    const plate = nextozPlate(cell(row.raw, 'Kennzeichen'));
    let vehicle: Vehicle | undefined;
    if (vin || plate) {
      const vehicleRef: ExternalRef = { connectionId: CONNECTION, externalId: vin ? `fin:${vin}` : `plate:${plate}` };
      let vi = vin ? vinAt.get(vin) : undefined;
      if (vi === undefined && plate) {
        const byPlate = plateAt.get(plate);
        if (byPlate !== undefined) {
          const otherVin = normVin(vehicles[byPlate].vin);
          if (!vin || !otherVin || otherVin === vin) vi = byPlate;
        }
      }
      const prevVehicle = vi === undefined ? undefined : vehicles[vi];
      vehicle = prevVehicle
        ? {
          ...prevVehicle,
          vin: prevVehicle.vin.trim() ? prevVehicle.vin : vin,
          plate: prevVehicle.plate.trim() ? prevVehicle.plate : (plate ?? ''),
          externalRefs: withRef(prevVehicle.externalRefs, vehicleRef),
        }
        : {
          id: newId(),
          contactId: null,
          vin,
          plate: plate ?? '',
          model: 'unbekannt',
          externalRefs: [vehicleRef],
        };
      if (vi === undefined) {
        vi = vehicles.length;
        vehicles.push(vehicle);
        bump(counts.vehicles, 'created');
      } else {
        vehicles[vi] = vehicle;
        touch(counts.vehicles, prevVehicle, vehicle, false);
      }
      if (normVin(vehicle.vin)) vinAt.set(normVin(vehicle.vin), vi);
      if (normPlate(vehicle.plate)) plateAt.set(normPlate(vehicle.plate), vi);
    }

    const mapped = mapNextozStatus(cell(row.raw, 'Status'));
    const data = portalDataOf(row.raw, columns);
    const fee = parseNextozFeeCents(cell(row.raw, 'Amtsgebuehr'));
    const parsedDate = parseNextozDate(cell(row.raw, 'Datum'));
    const jobRef: ExternalRef = { connectionId: CONNECTION, externalId: row.externalId };
    const ji = jobAt.get(row.externalId);
    const prevJob = ji === undefined ? undefined : jobs[ji];
    const keepBilling = prevJob?.status === 'invoiced' || prevJob?.status === 'paid';
    const requestedOn = parsedDate ?? prevJob?.requestedOn;
    const priceCents = keepBilling
      ? prevJob.priceCents
      : (fee > 0 ? fee : (prevJob && prevJob.priceCents > 0 ? prevJob.priceCents : 0));
    const job: Job = prevJob
      ? {
        ...prevJob,
        vehicleId: vehicle ? vehicle.id : prevJob.vehicleId,
        contactId: prevJob.contactId,
        service: nextozServiceName(cell(row.raw, 'Antragsart')),
        status: keepBilling ? prevJob.status : mapped.status,
        doneAt: keepBilling ? prevJob.doneAt : (mapped.status === 'done' ? prevJob.doneAt : null),
        priceCents,
        externalRefs: withRef(prevJob.externalRefs, jobRef),
        portalSource: CONNECTION,
        portalStatus: cell(row.raw, 'Status'),
        portalProblem: mapped.problem,
        portalData: data,
        ...(requestedOn ? { requestedOn } : {}),
      }
      : {
        id: newId(),
        vehicleId: vehicle?.id ?? null,
        contactId: null,
        service: nextozServiceName(cell(row.raw, 'Antragsart')),
        location: 'online',
        priceCents,
        status: mapped.status,
        doneAt: null,
        invoiceIds: [],
        externalRefs: [jobRef],
        portalSource: CONNECTION,
        portalStatus: cell(row.raw, 'Status'),
        portalProblem: mapped.problem,
        portalData: data,
        ...(requestedOn ? { requestedOn } : {}),
      };
    if (ji === undefined) {
      jobAt.set(row.externalId, jobs.length);
      jobs.push(job);
      bump(counts.jobs, 'created');
    } else {
      jobs[ji] = job;
      touch(counts.jobs, prevJob, job, false);
    }
  }

  return {
    state: { ...state, contacts, vehicles, jobs, connections: markConnected(state.connections, at) },
    rows: parsed.rows.length,
    duplicates: parsed.duplicates,
    ...counts,
    errors: [],
  };
}
