import type { AppState, Job } from '../types';
import { applyMydigitalcarImport, mdcResultText, type MdcImportResult } from './mydigitalcar';

/**
 * Zulassungsportale als getrennte Quellen. Die CSV-Zuordnung hängt am Portal:
 * myDigitalCar ist hinterlegt, nextOZ ist registriert und wartet auf die eigene Zuordnung.
 * Nichts wird zwischen den Portalen zusammengeworfen.
 */

export const PORTAL_SOURCES = ['mydigitalcar', 'nextoz'] as const;
export type PortalSource = (typeof PORTAL_SOURCES)[number];

export const PORTAL_LABEL: Record<PortalSource, string> = {
  mydigitalcar: 'myDigitalCar',
  nextoz: 'nextOZ',
};

export function isPortalSource(v: unknown): v is PortalSource {
  return v === 'mydigitalcar' || v === 'nextoz';
}

/** nextOZ-Importer kommt hier dazu, sobald die Spalten feststehen. Bis dahin `null`. */
const IMPORTERS: Record<PortalSource, ((state: AppState, csv: string, newId: () => string, at: string) => MdcImportResult) | null> = {
  mydigitalcar: applyMydigitalcarImport,
  nextoz: null,
};

export const NEXTOZ_UNMAPPED = 'Die Spaltenzuordnung für nextOZ ist noch nicht hinterlegt. Es wird nichts übernommen und nichts mit myDigitalCar vermischt.';

const zero = () => ({ created: 0, updated: 0, skipped: 0 });

export function applyPortalImport(state: AppState, source: PortalSource, csv: string, newId: () => string, at: string): MdcImportResult {
  const run = IMPORTERS[source];
  if (!run) {
    return {
      state, rows: 0, duplicates: 0, contacts: zero(), vehicles: zero(), jobs: zero(), errors: [],
      error: source === 'nextoz' ? NEXTOZ_UNMAPPED : `Für ${PORTAL_LABEL[source]} ist keine Zuordnung hinterlegt.`,
    };
  }
  return run(state, csv, newId, at);
}

export function portalResultText(source: PortalSource, r: MdcImportResult): string {
  return mdcResultText(r, PORTAL_LABEL[source]);
}

export function jobPortalSource(job: Pick<Job, 'portalSource' | 'externalRefs'>): PortalSource | null {
  if (job.portalSource) return job.portalSource;
  const ref = job.externalRefs?.find((r) => r.connectionId === 'mydigitalcar' || r.connectionId === 'nextoz');
  if (ref?.connectionId === 'mydigitalcar' || ref?.connectionId === 'nextoz') return ref.connectionId;
  return null;
}

/** `all` oder eine Portal-Quelle. Aufträge ohne Portal bleiben nur bei `all` sichtbar. */
export function matchesPortalSource(job: Pick<Job, 'portalSource' | 'externalRefs'>, source: string): boolean {
  if (!source || source === 'all') return true;
  return jobPortalSource(job) === source;
}

/** Anzeigename. Ohne Halter bleibt der Auftrag ohne Kontakt, das Portal steht in der Bezeichnung. */
export function jobContactLabel(job: Pick<Job, 'contactId' | 'portalSource'>, contacts: { id: string; name: string }[]): string {
  if (job.contactId) return contacts.find((c) => c.id === job.contactId)?.name ?? 'Unbekannt';
  return job.portalSource ? `Halter unbekannt (${PORTAL_LABEL[job.portalSource]})` : 'Halter unbekannt';
}
