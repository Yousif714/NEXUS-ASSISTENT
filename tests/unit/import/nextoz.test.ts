import { describe, expect, test } from 'vitest';
import { createEmptyState } from '@/data/empty-state';
import { applyEvent } from '@/data/engine';
import { MDC_COLUMNS, applyMydigitalcarImport, matchesPortalFilter, mdcVorgang } from '@/domain/import/mydigitalcar';
import {
  NEXTOZ_COLUMNS, applyNextozImport, mapNextozStatus, nextozServiceName, parseNextozCsv,
} from '@/domain/import/nextoz';
import { applyPortalImport, jobPortalSource } from '@/domain/import/portal';
import type { Job } from '@/domain/types';
import { NOW_0930 } from '../helpers';

const at = '2026-11-17T08:00:00.000Z';
const seq = () => { let n = 0; return () => `id-${++n}`; };
const ctx = { at: NOW_0930, isDemo: true, newId: seq() };

function line(partial: Partial<Record<(typeof NEXTOZ_COLUMNS)[number], string>> = {}): string {
  return NEXTOZ_COLUMNS.map((c) => partial[c] ?? '').join(';');
}
function csv(rows: string[]): string {
  return `${NEXTOZ_COLUMNS.join(';')}\n${rows.join('\n')}\n`;
}

const um = {
  Nr: '1', Auftragsnummer: '#9cc78db5', Kennzeichen: 'OB AS 97', FIN: '5YJXCCE23GF022507',
  Antragsart: 'UM', Datum: '2026-11-10', Status: 'Signatur läuft', Fehler: '', Amtsgebuehr: '',
};
const ab = {
  Nr: '14', Auftragsnummer: '#15fb2748', Kennzeichen: 'HER KK 157', FIN: 'VF1RFB00964389643',
  Antragsart: 'AB', Datum: '2026-09-29', Status: 'In Bearbeitung (Weitergeleitet)', Fehler: '', Amtsgebuehr: '',
};
const wg = {
  Nr: '1283', Auftragsnummer: '#b6867cee', Kennzeichen: 'BO JD 1003', FIN: 'ZFA3120000J267737',
  Antragsart: 'WG', Datum: '2025-07-23', Status: 'Erfolgreich', Fehler: '', Amtsgebuehr: '12.40',
};

describe('nextOZ-CSV', () => {
  test('Beispielzeilen: Kopfzeile, Auftragsnummer ohne #, Original und alle Spalten', () => {
    const parsed = parseNextozCsv(`\uFEFF${csv([line(um), line(ab), line(wg)])}`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows.map((r) => r.externalId)).toEqual(['9cc78db5', '15fb2748', 'b6867cee']);
    expect(parsed.rows[0].raw.Auftragsnummer).toBe('#9cc78db5');
    expect(parsed.rows[0].raw.Nr).toBe('1');
    for (const col of NEXTOZ_COLUMNS) expect(parsed.rows[0].raw).toHaveProperty(col);
    expect(parsed.rows[0].raw.Fehler).toBe('');
    expect(parsed.rows[0].raw.Amtsgebuehr).toBe('');
  });

  test('Nr ist keine ID: gleiche Auftragsnummer, andere Position, eine Zeile', () => {
    const parsed = parseNextozCsv(csv([
      line(um),
      line({ ...um, Nr: '99', Status: 'Erfolgreich' }),
    ]));
    expect(parsed.ok && parsed.duplicates).toBe(1);
    expect(parsed.ok && parsed.rows).toHaveLength(1);
    expect(parsed.ok && parsed.rows[0].externalId).toBe('9cc78db5');
    expect(parsed.ok && parsed.rows[0].raw.Nr).toBe('99');
    expect(parsed.ok && parsed.rows[0].raw.Status).toBe('Erfolgreich');
  });

  test('ohne Auftragsnummer zählt der Zeilen-Hash ohne Nr', () => {
    const bare = { Kennzeichen: 'OB AS 1', FIN: 'WVWZZZ1KZAW000009', Antragsart: 'AB', Datum: '2026-01-01', Status: 'Entwurf' };
    const parsed = parseNextozCsv(csv([
      line({ ...bare, Nr: '1' }),
      line({ ...bare, Nr: '9' }),
      line({ ...bare, Nr: '3', Kennzeichen: 'OB AS 2' }),
    ]));
    expect(parsed.ok && parsed.duplicates).toBe(1);
    expect(parsed.ok && parsed.rows).toHaveLength(2);
    expect(parsed.ok && parsed.rows.every((r) => r.externalId.startsWith('row:') && r.externalId !== '1' && r.externalId !== '9')).toBe(true);
  });

  test('fehlende Kopfspalte lehnt ab', () => {
    const s = createEmptyState();
    const r = applyNextozImport(s, 'Nr;Auftragsnummer\n1;#abc\n', seq(), at);
    expect(r.error).toMatch(/Kopfzeile/);
    expect(r.state).toBe(s);
  });

  test('Antragsart, anders als myDigitalCar bei UM, WG und WZ', () => {
    expect(nextozServiceName('AB')).toBe('Abmeldung');
    expect(nextozServiceName('WG')).toBe('Wiederinbetriebsetzung');
    expect(nextozServiceName('UM')).toBe('Ummeldung');
    expect(nextozServiceName('NZ')).toBe('Neuzulassung');
    expect(nextozServiceName('WZ')).toBe('Wiederzulassung');
    expect(nextozServiceName('HA')).toBe('Halterdatenänderung');
    expect(nextozServiceName('xx')).toBe('Vorgang XX');
  });

  test('Status: erledigt, offen, Problem-Flag', () => {
    expect(mapNextozStatus('Erfolgreich')).toEqual({ status: 'done', problem: false });
    expect(mapNextozStatus('Entwurf')).toEqual({ status: 'open', problem: false });
    expect(mapNextozStatus('Signatur läuft')).toEqual({ status: 'open', problem: false });
    expect(mapNextozStatus('In Bearbeitung (Eingegangen)')).toEqual({ status: 'open', problem: false });
    expect(mapNextozStatus('In Bearbeitung (Weitergeleitet)')).toEqual({ status: 'open', problem: false });
    for (const raw of ['Fehler', 'Abgelehnt', 'Signaturfehler', 'Signatur abgelehnt']) {
      expect(mapNextozStatus(raw)).toEqual({ status: 'open', problem: true });
    }
    expect(mapNextozStatus('Unbekannt')).toEqual({ status: 'open', problem: false });
    expect(matchesPortalFilter({ portalStatus: 'Signatur abgelehnt' }, 'problem')).toBe(true);
    expect(matchesPortalFilter({ portalStatus: 'Signaturfehler' }, 'problem')).toBe(true);
    expect(matchesPortalFilter({ portalStatus: 'Signatur läuft' }, 'problem')).toBe(false);
    expect(matchesPortalFilter({ portalStatus: 'In Bearbeitung (Weitergeleitet)' }, 'problem')).toBe(false);
  });

  test('Beispielzeilen: nur Erfolgreich, in Bearbeitung wird übersprungen', () => {
    const r = applyNextozImport(createEmptyState(), csv([line(um), line(ab), line(wg)]), seq(), at);
    expect(r.error).toBeUndefined();
    expect(r.skipped).toBe(2);
    expect(r.contacts).toEqual({ created: 0, updated: 0, skipped: 0 });
    expect(r.vehicles.created).toBe(1);
    expect(r.jobs.created).toBe(1);
    expect(r.state.contacts).toHaveLength(0);
    expect(r.state.jobs.every((j) => j.contactId === null && j.portalSource === 'nextoz')).toBe(true);
    const byId = Object.fromEntries(r.state.jobs.map((j) => [j.externalRefs?.[0].externalId, j]));
    expect(byId['9cc78db5']).toBeUndefined();
    expect(byId['15fb2748']).toBeUndefined();
    expect(byId.b6867cee).toMatchObject({
      service: 'Wiederinbetriebsetzung', status: 'done', portalStatus: 'Erfolgreich', portalProblem: false,
      priceCents: 1240, requestedOn: '2025-07-23',
    });
    expect(mdcVorgang(byId.b6867cee)).toBe('#b6867cee');
    expect(byId.b6867cee.portalData?.Antragsart).toBe('WG');
    expect(byId.b6867cee.portalData?.Amtsgebuehr).toBe('12.40');
    expect(r.state.vehicles.map((v) => v.plate)).toEqual(['BO JD 1003']);
    expect(r.state.connections.find((c) => c.id === 'nextoz')).toMatchObject({ status: 'connected', lastSuccessAt: at });
    expect(r.state.connections.find((c) => c.id === 'mydigitalcar')!.status).toBe('missing');
    expect(matchesPortalFilter(byId.b6867cee, 'problem')).toBe(false);
    expect(jobPortalSource(byId.b6867cee)).toBe('nextoz');
  });

  test('Zufällig und fehlende FIN werden übersprungen, Fehler mit FIN bleibt', () => {
    const r = applyNextozImport(createEmptyState(), csv([
      line({ Nr: '2', Auftragsnummer: '#aabbccdd', Kennzeichen: 'Zufällig', FIN: '', Antragsart: 'NZ', Datum: '2026-11-01', Status: 'Entwurf' }),
      line({ Nr: '3', Auftragsnummer: '#onlyfin', Kennzeichen: 'Zufällig', FIN: 'WVWZZZ1KZAW000010', Antragsart: 'HA', Datum: '2026-11-02', Status: 'Signaturfehler', Fehler: 'Unterschrift fehlt', Amtsgebuehr: '12,40' }),
    ]), seq(), at);
    expect(r.skipped).toBe(1);
    expect(r.jobs.created).toBe(1);
    expect(r.vehicles.created).toBe(1);
    expect(r.state.contacts).toHaveLength(0);
    expect(r.state.jobs.find((j) => j.externalRefs?.[0].externalId === 'aabbccdd')).toBeUndefined();
    expect(r.state.vehicles).toHaveLength(1);
    expect(r.state.vehicles[0]).toMatchObject({ vin: 'WVWZZZ1KZAW000010', plate: '', contactId: null });
    const problem = r.state.jobs.find((j) => j.externalRefs?.[0].externalId === 'onlyfin');
    expect(problem).toMatchObject({
      service: 'Halterdatenänderung', status: 'open', portalProblem: true, portalStatus: 'Signaturfehler', priceCents: 1240,
    });
    expect(problem?.portalData?.Fehler).toBe('Unterschrift fehlt');
    expect(matchesPortalFilter(problem!, 'problem')).toBe(true);
    expect(matchesPortalFilter(problem!, 'Signaturfehler')).toBe(true);
  });

  test('erneuter Import aktualisiert über die Auftragsnummer, Nr darf sich ändern', () => {
    const first = applyNextozImport(createEmptyState(), csv([line({ ...um, Status: 'Genehmigt' })]), seq(), at);
    const second = applyNextozImport(first.state, csv([line({ ...um, Nr: '50', Status: 'Erfolgreich', Amtsgebuehr: '12.40' })]), seq(), at);
    expect(second.jobs).toEqual({ created: 0, updated: 1, skipped: 0 });
    expect(second.state.jobs).toHaveLength(1);
    expect(second.state.jobs[0].id).toBe(first.state.jobs[0].id);
    expect(second.state.jobs[0]).toMatchObject({ status: 'done', portalStatus: 'Erfolgreich', priceCents: 1240 });
    expect(second.state.jobs[0].portalData?.Nr).toBe('50');
    expect(second.state.jobs[0].portalData?.Auftragsnummer).toBe('#9cc78db5');
    const kept = applyNextozImport(second.state, csv([line({ ...um, Nr: '50', Status: 'Erfolgreich', Amtsgebuehr: '' })]), seq(), at);
    expect(kept.state.jobs[0].priceCents).toBe(1240);
    const third = applyNextozImport(second.state, csv([line({ ...um, Nr: '50', Status: 'Erfolgreich', Amtsgebuehr: '12.40' })]), seq(), at);
    expect(third.jobs).toEqual({ created: 0, updated: 0, skipped: 1 });
    const bareId = applyNextozImport(third.state, csv([line({ ...um, Nr: '50', Auftragsnummer: '9cc78db5', Status: 'Erfolgreich', Amtsgebuehr: '12.40' })]), seq(), at);
    expect(bareId.jobs.created).toBe(0);
    expect(bareId.state.jobs).toHaveLength(1);
    expect(bareId.state.jobs[0].id).toBe(first.state.jobs[0].id);
    expect(bareId.state.jobs[0].externalRefs?.[0].externalId).toBe('9cc78db5');
  });

  test('abgerechnet und gesetzter Preis bleiben, leere Gebühr nullt nicht', () => {
    const first = applyNextozImport(createEmptyState(), csv([line(wg)]), seq(), at);
    const priced: Job = { ...first.state.jobs[0], status: 'invoiced', priceCents: 8900, invoiceIds: ['i-1'], notes: 'bleibt' };
    const again = applyNextozImport({ ...first.state, jobs: [priced] }, csv([line({ ...wg, Amtsgebuehr: '', Status: 'Fehler', Fehler: 'Amt' })]), seq(), at);
    expect(again.state.jobs[0]).toMatchObject({
      status: 'invoiced', priceCents: 8900, invoiceIds: ['i-1'], notes: 'bleibt', portalStatus: 'Fehler', portalProblem: true,
    });
    expect(again.state.jobs[0].portalData?.Fehler).toBe('Amt');
  });

  test('Fahrzeug über FIN oder Kennzeichen mit myDigitalCar zusammenführen', () => {
    const ids = seq();
    const mdc = applyMydigitalcarImport(createEmptyState(), `${MDC_COLUMNS.join(';')}\n${MDC_COLUMNS.map((c) => {
      const v: Record<string, string> = {
        Ex_Vorgangsnummer: '9001', artDesVorfalls: 'NZ', Status: 'Genehmigt',
        Halter_Np_Vorname: 'Erika', Halter_Np_Nachname: 'Beispiel', Halter_Plz: '46236',
        FIN: '5YJXCCE23GF022507', Kennzeichen_Neu: 'MD CI 100',
      };
      return v[c] ?? '';
    }).join(';')}\n`, ids, at);
    expect(mdc.state.vehicles).toHaveLength(1);
    const merged = applyPortalImport(mdc.state, 'nextoz', csv([
      line({ ...um, Status: 'Erfolgreich' }),
      line({ Nr: '8', Auftragsnummer: '#plateonly', Kennzeichen: 'MD CI 100', FIN: '', Antragsart: 'WZ', Datum: '2026-08-01', Status: 'Erfolgreich' }),
    ]), ids, at);
    expect(merged.state.vehicles).toHaveLength(1);
    expect(merged.state.vehicles[0].id).toBe(mdc.state.vehicles[0].id);
    expect(merged.state.vehicles[0]).toMatchObject({ plate: 'MD CI 100', vin: '5YJXCCE23GF022507' });
    expect(merged.state.vehicles[0].contactId).toBe(mdc.state.contacts[0].id);
    const refs = merged.state.vehicles[0].externalRefs ?? [];
    expect(refs.some((r) => r.connectionId === 'mydigitalcar')).toBe(true);
    expect(refs.some((r) => r.connectionId === 'nextoz' && r.externalId === 'fin:5YJXCCE23GF022507')).toBe(true);
    expect(refs.some((r) => r.connectionId === 'nextoz' && r.externalId === 'plate:MD CI 100')).toBe(true);
    expect(merged.state.jobs.filter((j) => j.portalSource === 'nextoz')).toHaveLength(2);
    expect(merged.state.jobs.filter((j) => j.portalSource === 'nextoz').every((j) => j.contactId === null)).toBe(true);
    expect(merged.state.jobs.filter((j) => j.portalSource === 'mydigitalcar')).toHaveLength(1);
    expect(merged.state.contacts).toHaveLength(1);
  });

  test('gleiche Vorgangsnummer eines anderen Portals bleibt ein eigener Auftrag', () => {
    const oz = applyPortalImport(createEmptyState(), 'nextoz', csv([line({ ...um, Auftragsnummer: '9001', Status: 'Genehmigt' })]), seq(), at);
    const foreign: Job = {
      ...oz.state.jobs[0], id: 'mdc-1', portalSource: 'mydigitalcar',
      externalRefs: [{ connectionId: 'mydigitalcar', externalId: '9001' }],
    };
    const again = applyPortalImport({ ...oz.state, jobs: [...oz.state.jobs, foreign] }, 'nextoz', csv([line({ ...um, Auftragsnummer: '9001', Status: 'Erfolgreich' })]), seq(), at);
    expect(again.jobs.created).toBe(0);
    expect(again.state.jobs.filter((j) => j.portalSource === 'mydigitalcar')).toHaveLength(1);
    expect(again.state.jobs.filter((j) => j.portalSource === 'nextoz')).toHaveLength(1);
    expect(again.state.jobs.find((j) => j.portalSource === 'nextoz')?.portalStatus).toBe('Erfolgreich');
  });

  test('Ereignis übernimmt nextOZ und lässt myDigitalCar unverbunden', () => {
    const r = applyEvent(createEmptyState(), { type: 'importPortalCsv', source: 'nextoz', csv: csv([line(ab), line({ ...wg, Status: 'Abgelehnt', Fehler: 'abgelehnt vom Amt' })]) }, ctx);
    expect(r.state.audit.at(-1)?.text).toMatch(/nextOZ übernommen: 1 Aufträge neu/);
    expect(r.state.audit.at(-1)?.text).toMatch(/1 übersprungen/);
    expect(r.state.connections.find((c) => c.id === 'nextoz')!.status).toBe('connected');
    expect(r.state.connections.find((c) => c.id === 'mydigitalcar')!.status).toBe('missing');
    expect(r.state.jobs.find((j) => j.portalStatus === 'Abgelehnt')).toMatchObject({ portalProblem: true, portalSource: 'nextoz' });
    expect(r.state.jobs.find((j) => j.portalStatus === 'Abgelehnt')?.portalData?.Fehler).toBe('abgelehnt vom Amt');
  });

  test('optionale Halter-Spalten legen den Kontakt an und verknüpfen Auftrag und Fahrzeug', () => {
    const cols = [...NEXTOZ_COLUMNS, 'Halter-Typ', 'Halter-Name', 'Halter-Strasse', 'Halter-Hausnummer', 'Halter-PLZ', 'Halter-Ort'];
    const row = (extra: Record<string, string>) => cols.map((c) => extra[c] ?? (wg as Record<string, string>)[c] ?? '').join(';');
    const file = `${cols.join(';')}\n${row({
      'Halter-Typ': 'Person', 'Halter-Name': 'Erika Beispiel', 'Halter-Strasse': 'Hauptstraße',
      'Halter-Hausnummer': '12', 'Halter-PLZ': '46236', 'Halter-Ort': 'Bottrop',
    })}\n${row({
      Nr: '2', Auftragsnummer: '#zweite', Kennzeichen: 'BO XX 1', FIN: 'WVWZZZ1KZAW000099', Antragsart: 'NZ',
      'Halter-Typ': 'Firma', 'Halter-Name': 'Autohaus Beispiel', 'Halter-PLZ': '45127', 'Halter-Ort': 'Essen',
    })}\n${row({
      Nr: '3', Auftragsnummer: '#dritte', Kennzeichen: 'BO YY 2', FIN: 'WVWZZZ1KZAW000098', Antragsart: 'AB',
      'Halter-Name': 'Erika Beispiel', 'Halter-PLZ': '46236',
    })}\n`;
    const first = applyNextozImport(createEmptyState(), file, seq(), at);
    expect(first.contacts).toMatchObject({ created: 2 });
    expect(first.state.contacts.map((c) => c.name).sort()).toEqual(['Autohaus Beispiel', 'Erika Beispiel']);
    expect(first.state.contacts.find((c) => c.name === 'Autohaus Beispiel')).toMatchObject({ kind: 'dealer', address: { postalCode: '45127', city: 'Essen' } });
    const erika = first.state.contacts.find((c) => c.name === 'Erika Beispiel')!;
    expect(erika).toMatchObject({ kind: 'private', address: { street: 'Hauptstraße', houseNumber: '12', postalCode: '46236', city: 'Bottrop' } });
    const linked = first.state.jobs.filter((j) => j.contactId === erika.id);
    expect(linked).toHaveLength(2);
    expect(first.state.vehicles.filter((v) => v.contactId === erika.id)).toHaveLength(2);
    const again = applyNextozImport(first.state, file, seq(), at);
    expect(again.contacts.created).toBe(0);
    expect(again.state.contacts).toHaveLength(2);
    expect(again.state.jobs.find((j) => j.externalRefs?.[0].externalId === 'b6867cee')?.id).toBe(first.state.jobs.find((j) => j.externalRefs?.[0].externalId === 'b6867cee')?.id);
  });

  test('Halter trifft einen bestehenden Kontakt über Name und PLZ', () => {
    const cols = [...NEXTOZ_COLUMNS, 'Halter-Name', 'Halter-PLZ'];
    const file = `${cols.join(';')}\n${cols.map((c) => (c === 'Halter-Name' ? 'Erika Beispiel' : c === 'Halter-PLZ' ? '46236' : (wg as Record<string, string>)[c] ?? '')).join(';')}\n`;
    const base = createEmptyState();
    base.contacts = [{
      id: 'c-alt', company: 'zulassung', kind: 'private', name: 'Erika Beispiel', phones: [], emails: [],
      address: { postalCode: '46236', city: 'Bottrop' },
    }];
    const r = applyNextozImport(base, file, seq(), at);
    expect(r.contacts.created).toBe(0);
    expect(r.state.contacts).toHaveLength(1);
    expect(r.state.jobs[0].contactId).toBe('c-alt');
    expect(r.state.vehicles[0].contactId).toBe('c-alt');
    expect(r.state.contacts[0].externalRefs?.[0]).toEqual({ connectionId: 'nextoz', externalId: 'erika beispiel|46236' });
  });
});
