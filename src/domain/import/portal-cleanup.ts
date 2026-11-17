import type { AppState, Job, Vehicle } from '../types';
import { jobPortalSource } from './portal';
import { portalKeepGroup, type PortalKeep } from './portal-keep';

const SOURCES = ['mydigitalcar', 'nextoz'] as const;
type Source = (typeof SOURCES)[number];

export interface PortalCleanupCounts {
  /** Zu löschende Aufträge je Quelle und Rohstatus. */
  deleteByStatus: Record<Source, Record<string, number>>;
  /** Bleibende Portal-Aufträge je Quelle und Rohstatus. */
  keepByStatus: Record<Source, Record<string, number>>;
  /** Schlechter Status oder ohne Kennung, aber mit Rechnung: unangetastet. */
  keptBecauseInvoice: Record<Source, number>;
  jobs: number;
  vehicles: number;
  contacts: number;
  notices: number;
}

const emptyStatus = (): Record<Source, Record<string, number>> => ({ mydigitalcar: {}, nextoz: {} });

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

function plateOk(raw: string | undefined): boolean {
  const t = (raw ?? '').trim().toLowerCase();
  return t.length > 0 && t !== 'zufällig' && t !== 'zufaellig';
}

function jobHasIdentity(s: AppState, job: Job): boolean {
  const vehicle: Vehicle | undefined = job.vehicleId ? s.vehicles.find((v) => v.id === job.vehicleId) : undefined;
  const vin = (vehicle?.vin || job.portalData?.FIN || '').trim();
  const plates = [vehicle?.plate, job.portalData?.Kennzeichen, job.portalData?.Kennzeichen_Neu, job.portalData?.Kennzeichen_Alt];
  return vin.length > 0 || plates.some(plateOk);
}

function hasInvoice(job: Job): boolean {
  return job.invoiceIds.length > 0 || job.status === 'invoiced' || job.status === 'paid';
}

function statusLabel(job: Job, missingIdentity: boolean): string {
  const raw = job.portalStatus?.trim() || '(leer)';
  return missingIdentity && portalKeepGroup(job.portalStatus) ? `${raw} · ohne FIN/Kennzeichen` : raw;
}

interface Marked { job: Job; source: Source; label: string }

function marked(s: AppState): { drop: Marked[]; keep: Marked[]; invoiced: Record<Source, number> } {
  const drop: Marked[] = [];
  const keep: Marked[] = [];
  const invoiced: Record<Source, number> = { mydigitalcar: 0, nextoz: 0 };
  for (const job of s.jobs) {
    const source = jobPortalSource(job);
    if (!source) continue;
    const group: PortalKeep | null = portalKeepGroup(job.portalStatus);
    const identity = jobHasIdentity(s, job);
    const label = statusLabel(job, !identity);
    if (group && identity) {
      keep.push({ job, source, label });
      continue;
    }
    if (hasInvoice(job)) {
      invoiced[source] += 1;
      keep.push({ job, source, label });
      continue;
    }
    drop.push({ job, source, label });
  }
  return { drop, keep, invoiced };
}

export function planPortalCleanup(s: AppState): PortalCleanupCounts {
  const { drop, keep, invoiced } = marked(s);
  const deleteByStatus = emptyStatus();
  const keepByStatus = emptyStatus();
  for (const row of drop) bump(deleteByStatus[row.source], row.label);
  for (const row of keep) bump(keepByStatus[row.source], row.label);
  const dropIds = new Set(drop.map((row) => row.job.id));
  const notices = s.insights.filter((i) => i.refs.some((r) => r.kind === 'job' && dropIds.has(r.id))
    || (i.dedupeKey.startsWith('job-inv:') && dropIds.has(i.dedupeKey.slice('job-inv:'.length)))).length;
  const removedVehicles = orphanVehicles(s, dropIds);
  const removedContacts = orphanContacts(s, dropIds, removedVehicles);
  return {
    deleteByStatus,
    keepByStatus,
    keptBecauseInvoice: invoiced,
    jobs: drop.length,
    vehicles: removedVehicles.length,
    contacts: removedContacts.length,
    notices,
  };
}

function orphanVehicles(s: AppState, dropIds: Set<string>): string[] {
  const stay = new Set(s.jobs.filter((j) => !dropIds.has(j.id) && j.vehicleId).map((j) => j.vehicleId as string));
  return s.vehicles.filter((v) => {
    if (stay.has(v.id)) return false;
    const refs = v.externalRefs ?? [];
    const portal = refs.some((r) => r.connectionId === 'mydigitalcar' || r.connectionId === 'nextoz');
    const other = refs.some((r) => r.connectionId !== 'mydigitalcar' && r.connectionId !== 'nextoz');
    return portal && !other;
  }).map((v) => v.id);
}

function orphanContacts(s: AppState, dropIds: Set<string>, vehicleIds: string[]): string[] {
  const goneVehicles = new Set(vehicleIds);
  const used = new Set<string>();
  for (const j of s.jobs) if (!dropIds.has(j.id) && j.contactId) used.add(j.contactId);
  for (const v of s.vehicles) if (!goneVehicles.has(v.id) && v.contactId) used.add(v.contactId);
  for (const i of s.invoices) if (i.contactId) used.add(i.contactId);
  for (const c of s.contracts) used.add(c.contactId);
  for (const m of s.messages) if (m.contactId) used.add(m.contactId);
  for (const c of s.commitments) used.add(c.contactId);
  for (const o of s.orderConfirmations ?? []) if (o.contactId) used.add(o.contactId);
  for (const l of s.ibanLinks) used.add(l.contactId);
  for (const t of s.takeovers ?? []) used.add(t.contactId);
  return s.contacts.filter((c) => {
    if (used.has(c.id)) return false;
    const refs = c.externalRefs ?? [];
    const portal = refs.some((r) => r.connectionId === 'mydigitalcar' || r.connectionId === 'nextoz');
    const other = refs.some((r) => r.connectionId !== 'mydigitalcar' && r.connectionId !== 'nextoz');
    return portal && !other;
  }).map((c) => c.id);
}

/** Löscht Portal-Aufträge außerhalb der drei Statusgruppen und ohne FIN/Kennzeichen. Rechnungen und Handaufträge bleiben. */
export function applyPortalCleanup(s: AppState): { state: AppState; counts: PortalCleanupCounts } {
  const counts = planPortalCleanup(s);
  if (counts.jobs === 0) return { state: s, counts };
  const { drop } = marked(s);
  const dropIds = new Set(drop.map((row) => row.job.id));
  const vehicleIds = new Set(orphanVehicles(s, dropIds));
  const contactIds = new Set(orphanContacts(s, dropIds, [...vehicleIds]));
  const jobs = s.jobs.filter((j) => !dropIds.has(j.id));
  const vehicles = s.vehicles.filter((v) => !vehicleIds.has(v.id));
  const contacts = s.contacts.filter((c) => !contactIds.has(c.id));
  const insights = s.insights.filter((i) => {
    if (i.dedupeKey.startsWith('job-inv:') && dropIds.has(i.dedupeKey.slice('job-inv:'.length))) return false;
    if (i.refs.some((r) => r.kind === 'job' && dropIds.has(r.id))) return false;
    return true;
  });
  return { state: { ...s, jobs, vehicles, contacts, insights }, counts };
}

/** Echte Fehlermeldung für das Werkzeug, gekürzt. `conflict` bleibt der bekannte Hinweis. */
export function portalCleanupFailure(err: unknown): string {
  if (err instanceof Error && err.message === 'conflict') return 'Gleichzeitige Änderung, bitte erneut versuchen';
  const raw = err instanceof Error ? err.message : '';
  const clean = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
  return clean || 'Aufräumen fehlgeschlagen';
}

export function portalCleanupText(counts: PortalCleanupCounts, dryRun: boolean): string {
  const verb = dryRun ? 'würde löschen' : 'gelöscht';
  return `Portal-Aufräumen (${dryRun ? 'Probe' : 'ausgeführt'}): ${counts.jobs} Aufträge ${verb}, ${counts.vehicles} Fahrzeuge, ${counts.contacts} Kontakte, ${counts.notices} Hinweise`;
}
