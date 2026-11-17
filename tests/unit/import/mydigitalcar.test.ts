import { vi, describe, expect, test } from 'vitest';
import { createEmptyState } from '@/data/empty-state';
import { applyEvent } from '@/data/engine';
import { detectJobsNotInvoiced } from '@/domain/detectors/jobs';
import {
  MDC_COLUMNS, applyMydigitalcarImport, mapMdcStatus, mdcVorgang, parseMydigitalcarCsv, serviceName,
} from '@/domain/import/mydigitalcar';
import { applyPortalImport } from '@/domain/import/portal';
import type { AppState, Job } from '@/domain/types';
import { NOW_0930 } from '../helpers';
// Portal-Verhalten bei eingeschaltetem Schalter (in der App derzeit aus, siehe src/domain/features.ts).
vi.mock('@/domain/features', async (orig) => ({ ...(await orig<typeof import('@/domain/features')>()), PORTALS_IN_APP: true }));


const at = '2026-11-17T08:00:00.000Z';
const seq = () => { let n = 0; return () => `id-${++n}`; };
const ctx = { at: NOW_0930, isDemo: true, newId: seq() };

function line(partial: Partial<Record<(typeof MDC_COLUMNS)[number], string>> & Record<string, string> = {}, extra: Record<string, string> = {}): string {
  const base = MDC_COLUMNS.map((c) => partial[c] ?? '');
  return [...base, ...Object.values(extra)].join(';');
}
function csv(rows: string[], extraHeader = ''): string {
  return `${MDC_COLUMNS.join(';')}${extraHeader}\n${rows.join('\n')}\n`;
}

const person = {
  Ex_Vorgangsnummer: '9001', artDesVorfalls: 'NZ', Status: 'Genehmigt',
  Halter_Np_Vorname: 'Erika', Halter_Np_Nachname: 'Beispiel', Halter_Plz: '46236', Halter_Ort: 'Bottrop',
  Halter_Strasse: 'Hauptstraße', Halter_Hausnummer: '12',
  FIN: 'WVWZZZ1KZAW000001', Kennzeichen_Neu: 'MD CI 100', HSN: '0603', TSN: 'AAA',
  ZB1_Sicherheitscode: 'ZB1-GEHEIM', ZB2_Sicherheitscode: 'ZB2-GEHEIM', KZ_Pin: '1234',
  Steuer_IBAN: 'DE89370400440532013000', Steuer_BIC: 'COBADEFFXXX', Evb_Nummer: 'EVB1234567',
};

describe('myDigitalCar-CSV', () => {
  test('Kopfzeile, alle Spalten inklusive leerer und der Sicherheitsfelder', () => {
    const parsed = parseMydigitalcarCsv(`\uFEFF${csv([line(person)])}`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(1);
    for (const col of MDC_COLUMNS) expect(parsed.rows[0].raw).toHaveProperty(col);
    expect(parsed.rows[0].raw.ZB1_Sicherheitscode).toBe('ZB1-GEHEIM');
    expect(parsed.rows[0].raw.Exportland).toBe('');
    expect(parsed.rows[0].externalId).toBe('9001');
  });

  test('Anführungszeichen und Extra-Spalte bleiben erhalten', () => {
    const cells = MDC_COLUMNS.map((c) => (c === 'Halter_Strasse' ? '"Hauptstr.; Weg"' : (person[c as keyof typeof person] ?? '')));
    const file = `${MDC_COLUMNS.join(';')};Notiz\n${cells.join(';')};bitte\n`;
    const parsed = parseMydigitalcarCsv(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].raw.Halter_Strasse).toBe('Hauptstr.; Weg');
    expect(parsed.rows[0].raw.Notiz).toBe('bitte');
    const imported = applyMydigitalcarImport(createEmptyState(), file, seq(), at);
    expect(imported.state.jobs[0].portalData).toMatchObject({ Halter_Strasse: 'Hauptstr.; Weg', Notiz: 'bitte', ZB1_Sicherheitscode: 'ZB1-GEHEIM' });
  });

  test('fehlende Kopfspalte lehnt ab, Zustand bleibt', () => {
    const s = createEmptyState();
    const r = applyMydigitalcarImport(s, 'Status;FIN\nGenehmigt;X\n', seq(), at);
    expect(r.error).toMatch(/Kopfzeile/);
    expect(r.state).toBe(s);
    expect(s.connections.find((c) => c.id === 'mydigitalcar')!.status).toBe('missing');
  });

  test('Dublette gleicher Vorgang: letzte Zeile gewinnt', () => {
    const parsed = parseMydigitalcarCsv(csv([
      line({ ...person, Status: 'Gespeichert' }),
      line({ ...person, Status: 'Genehmigt' }),
    ]));
    expect(parsed.ok && parsed.duplicates).toBe(1);
    expect(parsed.ok && parsed.rows[0].raw.Status).toBe('Genehmigt');
  });

  test('ohne Vorgangsnummer dedupliziert der Zeilen-Hash', () => {
    const row = line({ ...person, Ex_Vorgangsnummer: '' });
    const other = line({ ...person, Ex_Vorgangsnummer: '', Kennzeichen_Neu: 'MD CI 9' });
    const parsed = parseMydigitalcarCsv(csv([row, row, other]));
    expect(parsed.ok && parsed.duplicates).toBe(1);
    expect(parsed.ok && parsed.rows).toHaveLength(2);
    expect(parsed.ok && parsed.rows.every((r) => r.externalId.startsWith('row:'))).toBe(true);
  });

  test('Leistungen und Status', () => {
    expect(serviceName('UM')).toBe('Umschreibung');
    expect(serviceName('WG')).toBe('Wiederzulassung');
    expect(serviceName('AB')).toBe('Abmeldung');
    expect(serviceName('NZ')).toBe('Neuzulassung');
    expect(serviceName('UG')).toBe('Umkennzeichnung');
    expect(serviceName('WZ')).toBe('Wiederzulassung auf denselben Halter');
    expect(serviceName('SO')).toBe('Sonstiges');
    expect(serviceName('xx')).toBe('Vorgang XX');
    expect(mapMdcStatus('Genehmigt')).toEqual({ status: 'done', problem: false });
    expect(mapMdcStatus('Versandfertig').status).toBe('done');
    expect(mapMdcStatus('Eingereicht')).toEqual({ status: 'open', problem: false });
    expect(mapMdcStatus('Gespeichert').status).toBe('open');
    expect(mapMdcStatus('Fehler (B)')).toEqual({ status: 'open', problem: true });
    expect(mapMdcStatus('Fehler (T)').problem).toBe(true);
    expect(mapMdcStatus('Abgelehnt').problem).toBe(true);
  });

  test('legt Kunde, Fahrzeug und Auftrag an und speichert jede Spalte', () => {
    const r = applyMydigitalcarImport(createEmptyState(), csv([line(person)]), seq(), at);
    expect(r.error).toBeUndefined();
    expect(r.contacts).toEqual({ created: 1, updated: 0, skipped: 0 });
    expect(r.vehicles.created).toBe(1);
    expect(r.jobs.created).toBe(1);
    const contact = r.state.contacts[0];
    expect(contact).toMatchObject({ name: 'Erika Beispiel', kind: 'private', company: 'zulassung', address: { postalCode: '46236', city: 'Bottrop', street: 'Hauptstraße' } });
    expect(contact.externalRefs).toEqual([{ connectionId: 'mydigitalcar', externalId: 'erika beispiel|46236' }]);
    const vehicle = r.state.vehicles[0];
    expect(vehicle).toMatchObject({ vin: 'WVWZZZ1KZAW000001', plate: 'MD CI 100', model: 'unbekannt', hsn: '0603', tsn: 'AAA' });
    const job = r.state.jobs[0];
    expect(job).toMatchObject({
      service: 'Neuzulassung', location: 'online', priceCents: 0, status: 'done', doneAt: null,
      portalSource: 'mydigitalcar', portalStatus: 'Genehmigt', portalProblem: false,
    });
    expect(mdcVorgang(job)).toBe('9001');
    for (const col of MDC_COLUMNS) expect(job.portalData).toHaveProperty(col);
    expect(job.portalData).toMatchObject({
      ZB1_Sicherheitscode: 'ZB1-GEHEIM', ZB2_Sicherheitscode: 'ZB2-GEHEIM', KZ_Pin: '1234',
      Steuer_IBAN: 'DE89370400440532013000', Steuer_BIC: 'COBADEFFXXX', Evb_Nummer: 'EVB1234567',
      Exportland: '',
    });
    expect(r.state.connections.find((c) => c.id === 'mydigitalcar')).toMatchObject({ status: 'connected', lastSuccessAt: at });
    expect(r.state.connections.find((c) => c.id === 'nextoz')!.status).toBe('missing');
    expect(detectJobsNotInvoiced(r.state)).toEqual([]);
  });

  test('Unternehmen wird Händler, Person steht als Ansprechpartner', () => {
    const r = applyMydigitalcarImport(createEmptyState(), csv([line({
      ...person, Halter_Np_Vorname: 'Max', Halter_Np_Nachname: 'Meier', Halter_Unternehmen: 'Autohaus Beispiel GmbH',
    })]), seq(), at);
    expect(r.state.contacts[0]).toMatchObject({ name: 'Autohaus Beispiel GmbH', kind: 'dealer', contactPersons: ['Max Meier'] });
  });

  test('zweiter Vorgang derselben Person: ein Kontakt, ein Fahrzeug, zwei Aufträge', () => {
    const file = csv([
      line(person),
      line({ ...person, Ex_Vorgangsnummer: '9002', artDesVorfalls: 'UM', Status: 'Abgelehnt', Kennzeichen_Alt: 'E AB 1', Kennzeichen_Neu: '' }),
    ]);
    const r = applyMydigitalcarImport(createEmptyState(), file, seq(), at);
    expect(r.state.contacts).toHaveLength(1);
    expect(r.state.vehicles).toHaveLength(1);
    expect(r.state.jobs).toHaveLength(2);
    expect(r.state.jobs.map((j) => j.service).sort()).toEqual(['Neuzulassung', 'Umschreibung']);
    expect(r.state.vehicles[0].plate).toBe('E AB 1');
    expect(r.contacts).toMatchObject({ created: 1, skipped: 1 });
  });

  test('erneuter Import aktualisiert den Status und dupliziert nicht', () => {
    const first = applyMydigitalcarImport(createEmptyState(), csv([line({ ...person, Status: 'Fehler (B)' })]), seq(), at);
    const second = applyMydigitalcarImport(first.state, csv([line(person)]), seq(), at);
    expect(second.jobs).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(second.state.jobs).toHaveLength(1);
    expect(second.state.jobs[0].id).toBe(first.state.jobs[0].id);
    expect(second.state.jobs[0].status).toBe('done');
    expect(second.state.contacts).toHaveLength(1);
    const third = applyMydigitalcarImport(second.state, csv([line(person)]), seq(), at);
    expect(third.jobs).toEqual({ created: 0, updated: 0, skipped: 1 });
    expect(third.contacts.skipped).toBe(1);
  });

  test('Name und PLZ treffen einen bestehenden Kunden; abgerechnet und Preis bleiben', () => {
    const base = createEmptyState();
    const existing = {
      id: 'c-alt', company: 'zulassung' as const, kind: 'private' as const, name: 'Erika Beispiel',
      phones: ['+491511111'], emails: ['erika@example.de'], address: { postalCode: '46236', city: 'Bottrop' },
    };
    base.contacts = [existing];
    const first = applyMydigitalcarImport(base, csv([line({ ...person, Status: 'Fehler' })]), seq(), at);
    expect(first.state.contacts).toHaveLength(1);
    expect(first.state.contacts[0].id).toBe('c-alt');
    expect(first.state.contacts[0].phones).toEqual(['+491511111']);
    expect(first.state.contacts[0].externalRefs?.[0].connectionId).toBe('mydigitalcar');
    const job = first.state.jobs[0];
    const priced: Job = { ...job, status: 'invoiced', priceCents: 8900, invoiceIds: ['i-1'], notes: 'bleibt', location: 'bottrop', doneAt: at };
    const withPrice: AppState = { ...first.state, jobs: [priced] };
    const again = applyMydigitalcarImport(withPrice, csv([line(person)]), seq(), at);
    expect(again.state.jobs[0]).toMatchObject({ status: 'invoiced', priceCents: 8900, invoiceIds: ['i-1'], notes: 'bleibt', location: 'bottrop', portalStatus: 'Genehmigt' });
  });

  test('ohne Halter wird Fahrzeug und Auftrag angelegt, ohne Kontakt', () => {
    const noName = { ...person, Ex_Vorgangsnummer: '9003', artDesVorfalls: 'AB', Status: 'Genehmigt', Halter_Np_Vorname: '', Halter_Np_Nachname: '', Halter_Unternehmen: '', FIN: 'WVWZZZ1KZAW000003', Kennzeichen_Neu: 'MD CI 300' };
    const first = applyMydigitalcarImport(createEmptyState(), csv([
      line(person),
      line(noName),
      line({ ...person, Ex_Vorgangsnummer: '9004', FIN: '', Kennzeichen_Neu: '', Kennzeichen_Alt: '' }),
    ]), seq(), at);
    expect(first.errors).toEqual([]);
    expect(first.skipped).toBe(1);
    expect(first.contacts.created).toBe(1);
    expect(first.jobs.created).toBe(2);
    const bare = first.state.jobs.find((j) => mdcVorgang(j) === '9003');
    expect(bare).toMatchObject({ contactId: null, service: 'Abmeldung', status: 'done', portalStatus: 'Genehmigt' });
    expect(first.state.vehicles.find((v) => v.vin === 'WVWZZZ1KZAW000003')).toMatchObject({ contactId: null, plate: 'MD CI 300' });
    const namedVehicle = first.state.vehicles.find((v) => v.vin === 'WVWZZZ1KZAW000001')!;
    const again = applyMydigitalcarImport(first.state, csv([
      line(person),
      line(noName),
      line({ ...noName, Ex_Vorgangsnummer: '9005', FIN: 'WVWZZZ1KZAW000001', Kennzeichen_Neu: '' }),
    ]), seq(), at);
    expect(again.jobs).toMatchObject({ created: 1, updated: 0, skipped: 2 });
    expect(again.state.jobs.filter((j) => j.contactId === null)).toHaveLength(2);
    expect(again.state.vehicles.find((v) => v.id === namedVehicle.id)?.contactId).toBe(namedVehicle.contactId);
    const third = applyMydigitalcarImport(again.state, csv([line(person), line(noName)]), seq(), at);
    expect(third.jobs.created).toBe(0);
    expect(third.state.jobs).toHaveLength(again.state.jobs.length);
  });

  test('Portionen und gleicher Vorgang eines anderen Portals bleiben getrennt', () => {
    const a = applyPortalImport(createEmptyState(), 'mydigitalcar', csv([line(person)]), seq(), at);
    const b = applyPortalImport(a.state, 'mydigitalcar', csv([line({ ...person, Ex_Vorgangsnummer: '9002', Status: 'Fehler (T)', FIN: 'WVWZZZ1KZAW000002', Kennzeichen_Neu: 'MD CI 200' })]), seq(), at);
    expect(b.state.jobs).toHaveLength(2);
    const again = applyPortalImport(b.state, 'mydigitalcar', csv([line(person), line({ ...person, Ex_Vorgangsnummer: '9002', Status: 'Fehler (T)', FIN: 'WVWZZZ1KZAW000002', Kennzeichen_Neu: 'MD CI 200' })]), seq(), at);
    expect(again.jobs.created).toBe(0);
    const foreign: Job = {
      ...b.state.jobs[0], id: 'nz-1', portalSource: 'nextoz',
      externalRefs: [{ connectionId: 'nextoz', externalId: '9001' }],
    };
    const mixed = applyPortalImport({ ...b.state, jobs: [...b.state.jobs, foreign] }, 'mydigitalcar', csv([line(person)]), seq(), at);
    expect(mixed.state.jobs.filter((j) => j.portalSource === 'nextoz')).toHaveLength(1);
    expect(mixed.state.jobs.filter((j) => j.externalRefs?.some((r) => r.connectionId === 'mydigitalcar' && r.externalId === '9001'))).toHaveLength(1);
  });

  test('nextOZ-Datei mit myDigitalCar-Kopfzeile schreibt nichts', () => {
    const s = createEmptyState();
    const r = applyPortalImport(s, 'nextoz', csv([line(person)]), seq(), at);
    expect(r.error).toMatch(/Kopfzeile/);
    expect(r.state).toBe(s);
    expect(s.jobs).toHaveLength(0);
    expect(s.connections.find((c) => c.id === 'nextoz')).toMatchObject({ status: 'missing', label: 'nextOZ' });
    const via = applyEvent(s, { type: 'importPortalCsv', source: 'nextoz', csv: 'x' }, ctx);
    expect(via.state.jobs).toHaveLength(0);
    expect(via.state.audit.at(-1)?.text).toMatch(/nextOZ nicht übernommen/);
    expect(via.state.connections.find((c) => c.id === 'nextoz')!.status).toBe('missing');
  });

  test('Ereignis markiert nur myDigitalCar als verbunden', () => {
    const r = applyEvent(createEmptyState(), { type: 'importPortalCsv', source: 'mydigitalcar', csv: csv([line({ ...person, Status: 'Abgelehnt' })]) }, ctx);
    expect(r.state.audit.at(-1)?.text).toMatch(/myDigitalCar übernommen: 1 Aufträge neu/);
    expect(r.state.connections.find((c) => c.id === 'mydigitalcar')!.status).toBe('connected');
    expect(r.state.connections.find((c) => c.id === 'nextoz')!.status).toBe('missing');
    expect(r.state.jobs[0]).toMatchObject({ portalSource: 'mydigitalcar', portalProblem: true, status: 'open' });
  });
});
