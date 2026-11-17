import { CONNECTION_CATALOG } from '../connections';
import type { AppState, Connection, Contact, ExternalRef, Job, PostalAddress, Vehicle } from '../types';

/**
 * myDigitalCar-Export (web.mydigitalcar.de): Semikolon, UTF-8, eine Kopfzeile.
 * Rein. Legt Halter, Fahrzeug und Auftrag an und schreibt jede Spalte nach
 * `job.portalData` (inkl. leerer Zellen, Sicherheitscodes, PIN, Steuer-IBAN).
 */

/** Obergrenze für eine Portion (Zeichen). Größere Exporte in mehreren Aufrufen, jeder mit Kopfzeile. */
export const MDC_CSV_MAX_CHARS = 3_200_000;

export const MDC_COLUMNS = [
  'Zulassungsstelle_STBA', 'Ex_Vorgangsnummer', 'artDesVorfalls', 'Regionale_GK_Nr', 'Betriebsnummer',
  'Halter_Np_Vorname', 'Halter_Np_Nachname', 'Halter_Unternehmen', 'Halter_Strasse', 'Halter_Hausnummer',
  'Halter_Plz', 'Halter_Ort', 'FIN', 'Zweirad', 'VerwendungFzg', 'Demontagebetrieb', 'Ausstellungsdatum',
  'Exportland', 'HU_Datum', 'HU_Art', 'Kennzeichen_Neu', 'KZ_Pin', 'Kennzeichen_Alt', 'KZ_vorne_code',
  'KZ_hinten_code', 'KZ_AB_Reservierung', 'Feinstaubplakette', 'Evb_Nummer', 'ZB1_Nummer', 'ZB1_Sicherheitscode',
  'ZB2_Nummer', 'ZB2_Sicherheitscode', 'HSN', 'TSN', 'Steuer_IBAN', 'Steuer_BIC', 'Steuer_Zahlweise',
  'Steuer_GK_ID_Zoll', 'Status',
] as const;

export type MdcColumn = (typeof MDC_COLUMNS)[number];

/** Lesbare Leistung. UM/WG/AB/NZ/UG wie vom Inhaber vorgegeben; WZ ist die Wiederzulassung auf denselben Halter. */
export const MDC_SERVICE: Record<string, string> = {
  UM: 'Umschreibung',
  WG: 'Wiederzulassung',
  AB: 'Abmeldung',
  NZ: 'Neuzulassung',
  UG: 'Umkennzeichnung',
  WZ: 'Wiederzulassung auf denselben Halter',
  SO: 'Sonstiges',
};

export const MDC_PORTAL_STATUSES = ['Genehmigt', 'Versandfertig', 'Eingereicht', 'Gespeichert', 'Abgelehnt', 'Fehler', 'Fehler (B)', 'Fehler (T)'] as const;

const CONNECTION = 'mydigitalcar' as const;

export interface MdcRow {
  line: number;
  raw: Record<string, string>;
  /** Ex_Vorgangsnummer, sonst Hash der ganzen Zeile. */
  externalId: string;
}

export interface MdcParseError { line?: number; vorgang?: string; message: string }

export type MdcParseResult =
  | { ok: true; rows: MdcRow[]; duplicates: number; errors: MdcParseError[] }
  | { ok: false; error: string };

export interface EntityCounts { created: number; updated: number; skipped: number }

export interface MdcImportResult {
  state: AppState;
  rows: number;
  duplicates: number;
  contacts: EntityCounts;
  vehicles: EntityCounts;
  jobs: EntityCounts;
  errors: MdcParseError[];
  /** Kopfzeile fehlt oder die Datei ist zu groß: Zustand unverändert. */
  error?: string;
}

const cell = (raw: Record<string, string>, key: string) => (raw[key] ?? '').trim();

export function serviceName(code: string): string {
  const c = code.trim().toUpperCase();
  return MDC_SERVICE[c] ?? (c ? `Vorgang ${c}` : 'Zulassung');
}

/**
 * Rohstatus → Auftragsstatus. Eingereicht bleibt `open`: `waiting_customer` heißt in der App
 * „wartet auf Kunde“, der Antrag liegt aber bei der Zulassungsstelle. Der Rohstatus bleibt im Feld.
 */
export function mapMdcStatus(raw: string): { status: Job['status']; problem: boolean } {
  const norm = raw.trim().toLowerCase();
  if (norm === 'genehmigt' || norm === 'versandfertig') return { status: 'done', problem: false };
  if (norm === 'abgelehnt' || norm.startsWith('fehler')) return { status: 'open', problem: true };
  return { status: 'open', problem: false };
}

export function isPortalProblem(job: { portalStatus?: string; portalProblem?: boolean }): boolean {
  if (job.portalProblem) return true;
  const norm = (job.portalStatus ?? '').trim().toLowerCase();
  return norm === 'abgelehnt' || norm.startsWith('fehler');
}

/** `all` zeigt alles, `problem` nur Fehler und Abgelehnt, sonst exakter Rohstatus. */
export function matchesPortalFilter(job: { portalStatus?: string; portalProblem?: boolean }, filter: string): boolean {
  if (!filter || filter === 'all') return true;
  if (filter === 'problem') return isPortalProblem(job);
  return (job.portalStatus ?? '') === filter;
}

export function mdcVorgang(job: Pick<Job, 'externalRefs' | 'portalData' | 'portalSource'>): string | null {
  const source = job.portalSource ?? CONNECTION;
  const id = job.externalRefs?.find((r) => r.connectionId === source)?.externalId;
  if (id && !id.startsWith('row:')) return id;
  const fromRow = job.portalData?.Ex_Vorgangsnummer?.trim();
  return fromRow || null;
}

export function formatAddress(a?: PostalAddress): string {
  if (!a) return '';
  const street = [a.street, a.houseNumber].filter(Boolean).join(' ');
  const city = [a.postalCode, a.city].filter(Boolean).join(' ');
  return [street, city].filter(Boolean).join(', ');
}

export function mdcResultText(r: Pick<MdcImportResult, 'jobs' | 'contacts' | 'vehicles' | 'duplicates' | 'errors'>, label = 'myDigitalCar'): string {
  const extra = [
    r.duplicates ? `${r.duplicates} Dubletten` : '',
    r.errors.length ? `${r.errors.length} Zeilen mit Fehler` : '',
  ].filter(Boolean);
  return `${label} übernommen: ${r.jobs.created} Aufträge neu, ${r.jobs.updated} aktualisiert, ${r.jobs.skipped} unverändert, ${r.contacts.created} Kunden neu, ${r.vehicles.created} Fahrzeuge neu${extra.length ? `, ${extra.join(', ')}` : ''}`;
}

const holderKey = (name: string, postalCode: string) => `${name.trim().toLowerCase().replace(/\s+/g, ' ')}|${postalCode.trim()}`;
const normVin = (vin: string) => vin.trim().toUpperCase().replace(/[\s-]/g, '');
const normPlate = (plate: string) => plate.trim().toUpperCase().replace(/\s+/g, ' ');

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

/** Semikolon-CSV mit Anführungszeichen und Zeilenumbrüchen in Feldern. */
function parseSemicolon(text: string): { rows: string[][]; columns: string[] } | { error: string } {
  const s = text.replace(/^\uFEFF/, '');
  const table: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => {
    pushField();
    if (row.some((c) => c.trim() !== '')) table.push(row);
    row = [];
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ';') pushField();
    else if (c === '\n') pushRow();
    else if (c === '\r') {
      if (s[i + 1] === '\n') i++;
      pushRow();
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) pushRow();
  if (table.length === 0) return { error: 'Die Datei ist leer.' };
  const columns = table[0].map((c) => c.trim());
  return { rows: table.slice(1), columns };
}

export function parseMydigitalcarCsv(csv: string): MdcParseResult {
  if (csv.length > MDC_CSV_MAX_CHARS) {
    return { ok: false, error: 'Die Datei ist zu groß. Bitte in mehreren Portionen mit derselben Kopfzeile importieren.' };
  }
  const table = parseSemicolon(csv);
  if ('error' in table) return { ok: false, error: table.error };
  const missing = MDC_COLUMNS.filter((c) => !table.columns.includes(c));
  if (missing.length > 0) return { ok: false, error: `Kopfzeile unvollständig, es fehlen: ${missing.join(', ')}` };
  const seen = new Map<string, number>();
  const rows: MdcRow[] = [];
  let duplicates = 0;
  table.rows.forEach((cells, index) => {
    const raw: Record<string, string> = {};
    table.columns.forEach((col, i) => {
      if (!col || raw[col] !== undefined) return;
      raw[col] = (cells[i] ?? '').trim();
    });
    const vorgang = cell(raw, 'Ex_Vorgangsnummer');
    const externalId = vorgang || `row:${fnv(table.columns.map((c) => raw[c] ?? '').join('\u001e'))}`;
    const prev = seen.get(externalId);
    if (prev !== undefined) {
      duplicates++;
      rows[prev] = { line: index + 2, raw, externalId };
      return;
    }
    seen.set(externalId, rows.length);
    rows.push({ line: index + 2, raw, externalId });
  });
  return { ok: true, rows, duplicates, errors: [] };
}

function holderOf(raw: Record<string, string>): { name: string; kind: Contact['kind']; person?: string; address?: PostalAddress; key: string } | null {
  const company = cell(raw, 'Halter_Unternehmen');
  const person = [cell(raw, 'Halter_Np_Vorname'), cell(raw, 'Halter_Np_Nachname')].filter(Boolean).join(' ');
  const name = (company || person).replace(/\s+/g, ' ').trim();
  if (!name) return null;
  const street = cell(raw, 'Halter_Strasse');
  const houseNumber = cell(raw, 'Halter_Hausnummer');
  const postalCode = cell(raw, 'Halter_Plz');
  const city = cell(raw, 'Halter_Ort');
  const address: PostalAddress = {};
  if (street) address.street = street;
  if (houseNumber) address.houseNumber = houseNumber;
  if (postalCode) address.postalCode = postalCode;
  if (city) address.city = city;
  return {
    name,
    kind: company ? 'dealer' : 'private',
    ...(person && company ? { person } : {}),
    ...(Object.keys(address).length ? { address } : {}),
    key: holderKey(name, postalCode),
  };
}

function portalDataOf(raw: Record<string, string>, columns: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const known = new Set<string>(MDC_COLUMNS);
  const keys = [...MDC_COLUMNS, ...columns.filter((c) => !known.has(c))];
  for (const k of keys) out[k] = (raw[k] ?? '').trim();
  return out;
}

function withRef(refs: ExternalRef[] | undefined, ref: ExternalRef): ExternalRef[] {
  const list = refs ?? [];
  if (list.some((r) => r.connectionId === ref.connectionId && r.externalId === ref.externalId)) return list;
  return [...list, ref];
}

function withPerson(list: string[] | undefined, person: string): string[] {
  if (list?.includes(person)) return list ?? [person];
  return [...(list ?? []), person];
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
  const label = CONNECTION_CATALOG.find((c) => c.id === CONNECTION)?.label ?? 'myDigitalCar';
  return [...next, { id: CONNECTION, company: 'zulassung', label, status: 'connected', lastSuccessAt: at, sync: { cursor: null, complete: true, failures: 0 } }];
}

/**
 * Führt geparste Vorgänge in den Zustand. Gleicher Halter (externalRef, sonst Name+PLZ),
 * gleiches Fahrzeug (FIN, sonst Kennzeichen), gleicher Auftrag (Ex_Vorgangsnummer).
 * Abgerechnet oder bezahlt bleibt stehen; ein gesetzter Preis wird nicht genullt.
 */
export function applyMydigitalcarImport(state: AppState, csv: string, newId: () => string, at: string): MdcImportResult {
  const parsed = parseMydigitalcarCsv(csv);
  const blank = { state, rows: 0, duplicates: 0, contacts: zero(), vehicles: zero(), jobs: zero(), errors: [] as MdcParseError[] };
  if (!parsed.ok) return { ...blank, error: parsed.error };

  const contacts = state.contacts.slice();
  const vehicles = state.vehicles.slice();
  const jobs = state.jobs.slice();
  const refAt = new Map<string, number>();
  const nameAt = new Map<string, number>();
  const vinAt = new Map<string, number>();
  const plateAt = new Map<string, number>();
  const jobAt = new Map<string, number>();

  const indexContact = (i: number) => {
    const c = contacts[i];
    for (const r of c.externalRefs ?? []) if (r.connectionId === CONNECTION) refAt.set(r.externalId, i);
    if (c.company === 'zulassung' && c.address?.postalCode) nameAt.set(holderKey(c.name, c.address.postalCode), i);
  };
  contacts.forEach((_, i) => indexContact(i));
  vehicles.forEach((v, i) => {
    const vin = normVin(v.vin);
    if (vin) vinAt.set(vin, i);
    const plate = normPlate(v.plate);
    if (plate) plateAt.set(plate, i);
    for (const r of v.externalRefs ?? []) if (r.connectionId === CONNECTION) {
      if (r.externalId.startsWith('fin:')) vinAt.set(r.externalId.slice(4), i);
      if (r.externalId.startsWith('plate:')) plateAt.set(r.externalId.slice(6), i);
    }
  });
  jobs.forEach((j, i) => {
    for (const r of j.externalRefs ?? []) if (r.connectionId === CONNECTION) jobAt.set(r.externalId, i);
  });

  const counts = { contacts: zero(), vehicles: zero(), jobs: zero() };
  const errors: MdcParseError[] = [];
  const columns = Object.keys(parsed.rows[0]?.raw ?? {});

  for (const row of parsed.rows) {
    const holder = holderOf(row.raw);
    if (!holder) {
      errors.push({ line: row.line, vorgang: row.externalId.startsWith('row:') ? undefined : row.externalId, message: 'Halter fehlt' });
      continue;
    }
    const vin = normVin(cell(row.raw, 'FIN'));
    const plate = normPlate(cell(row.raw, 'Kennzeichen_Neu') || cell(row.raw, 'Kennzeichen_Alt'));
    if (!vin && !plate) {
      errors.push({ line: row.line, vorgang: row.externalId, message: 'Weder FIN noch Kennzeichen' });
      continue;
    }

    const ref: ExternalRef = { connectionId: CONNECTION, externalId: holder.key };
    let ci = refAt.get(holder.key);
    if (ci === undefined && holder.address?.postalCode) ci = nameAt.get(holder.key);
    const prevContact = ci === undefined ? undefined : contacts[ci];
    const contact: Contact = prevContact
      ? {
        ...prevContact,
        name: holder.name,
        kind: holder.kind,
        externalRefs: withRef(prevContact.externalRefs, ref),
        ...(holder.address ? { address: holder.address } : {}),
        ...(holder.person ? { contactPersons: withPerson(prevContact.contactPersons, holder.person) } : {}),
      }
      : {
        id: newId(),
        company: 'zulassung',
        kind: holder.kind,
        name: holder.name,
        phones: [],
        emails: [],
        externalRefs: [ref],
        ...(holder.address ? { address: holder.address } : {}),
        ...(holder.person ? { contactPersons: [holder.person] } : {}),
      };
    if (ci === undefined) {
      ci = contacts.length;
      contacts.push(contact);
      bump(counts.contacts, 'created');
    } else {
      contacts[ci] = contact;
      touch(counts.contacts, prevContact, contact, false);
    }
    indexContact(ci);

    const hsn = cell(row.raw, 'HSN');
    const tsn = cell(row.raw, 'TSN');
    const vehicleRef: ExternalRef = { connectionId: CONNECTION, externalId: vin ? `fin:${vin}` : `plate:${plate}` };
    let vi = vin ? vinAt.get(vin) : plateAt.get(plate);
    const prevVehicle = vi === undefined ? undefined : vehicles[vi];
    const vehicle: Vehicle = prevVehicle
      ? {
        ...prevVehicle,
        contactId: contact.id,
        vin: vin || prevVehicle.vin,
        plate: plate || prevVehicle.plate,
        ...(hsn ? { hsn } : {}),
        ...(tsn ? { tsn } : {}),
        externalRefs: withRef(prevVehicle.externalRefs, vehicleRef),
      }
      : {
        id: newId(),
        contactId: contact.id,
        vin,
        plate,
        model: 'unbekannt',
        externalRefs: [vehicleRef],
        ...(hsn ? { hsn } : {}),
        ...(tsn ? { tsn } : {}),
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

    const mapped = mapMdcStatus(cell(row.raw, 'Status'));
    const data = portalDataOf(row.raw, columns);
    const jobRef: ExternalRef = { connectionId: CONNECTION, externalId: row.externalId };
    const ji = jobAt.get(row.externalId);
    const prevJob = ji === undefined ? undefined : jobs[ji];
    const keepBilling = prevJob?.status === 'invoiced' || prevJob?.status === 'paid';
    const job: Job = prevJob
      ? {
        ...prevJob,
        vehicleId: vehicle.id,
        contactId: contact.id,
        service: serviceName(cell(row.raw, 'artDesVorfalls')),
        status: keepBilling ? prevJob.status : mapped.status,
        doneAt: keepBilling ? prevJob.doneAt : (mapped.status === 'done' ? prevJob.doneAt : null),
        priceCents: prevJob.priceCents > 0 ? prevJob.priceCents : 0,
        externalRefs: withRef(prevJob.externalRefs, jobRef),
        portalSource: CONNECTION,
        portalStatus: cell(row.raw, 'Status'),
        portalProblem: mapped.problem,
        portalData: data,
      }
      : {
        id: newId(),
        vehicleId: vehicle.id,
        contactId: contact.id,
        service: serviceName(cell(row.raw, 'artDesVorfalls')),
        location: 'online',
        priceCents: 0,
        status: mapped.status,
        doneAt: null,
        invoiceIds: [],
        externalRefs: [jobRef],
        portalSource: CONNECTION,
        portalStatus: cell(row.raw, 'Status'),
        portalProblem: mapped.problem,
        portalData: data,
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
    errors,
  };
}
