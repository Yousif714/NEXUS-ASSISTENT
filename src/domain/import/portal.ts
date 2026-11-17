import type { AppState, Job } from '../types';
import { applyMydigitalcarImport, mdcResultText, type MdcImportResult } from './mydigitalcar';
import { applyNextozImport } from './nextoz';

/**
 * Zulassungsportale als getrennte Quellen. Jedes Portal hat seine eigene CSV-Zuordnung.
 * Nichts wird zwischen den Portalen zusammengeworfen; Fahrzeuge treffen sich nur über FIN oder Kennzeichen.
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

const IMPORTERS: Record<PortalSource, (state: AppState, csv: string, newId: () => string, at: string) => MdcImportResult> = {
  mydigitalcar: applyMydigitalcarImport,
  nextoz: applyNextozImport,
};

export function applyPortalImport(state: AppState, source: PortalSource, csv: string, newId: () => string, at: string): MdcImportResult {
  return IMPORTERS[source](state, csv, newId, at);
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
