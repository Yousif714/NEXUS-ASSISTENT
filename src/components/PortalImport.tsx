'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useAppStore } from '@/data/store';
import { formatIsoDe, now } from '@/domain/clock';
import { decodeListFile } from '@/domain/import/portal-list';
import { MDC_CSV_MAX_CHARS, MDC_PORTAL_STATUSES, matchesPortalFilter, mdcResultText, mdcVorgang } from '@/domain/import/mydigitalcar';
import { applyPortalImport, matchesPortalSource, PORTAL_LABEL, PORTAL_SOURCES, type PortalSource } from '@/domain/import/portal';
import type { Job } from '@/domain/types';

export const PORTAL_LIST_CAP = 40;

/** Etikett, welches Portal den Auftrag geliefert hat. */
export function PortalBadge({ source }: { source: PortalSource }) {
  return <span className="portal-badge" data-source={source} data-testid={`portal-badge-${source}`}>{PORTAL_LABEL[source]}</span>;
}

export function PortalUploadLink({ source }: { source: PortalSource }) {
  return <Link href={`/zulassung#portal-${source}`} className="btn btn-secondary btn-small">{PORTAL_LABEL[source]} hochladen</Link>;
}

export function jobPortalBadge(job: Job) {
  return job.portalSource ? <PortalBadge source={job.portalSource} /> : null;
}

export function portalVehicleTitle(v: { model: string; plate: string; vin: string }): string {
  const plate = v.plate.trim();
  if (plate) return `${v.model} · ${plate}`;
  if (v.vin.trim()) return `${v.model} · FIN ${v.vin.trim()}`;
  return v.model || 'Fahrzeug';
}

export function portalJobSubtitle(name: string, job: Job): string {
  const vorgang = mdcVorgang(job);
  const date = job.requestedOn ? formatIsoDe(job.requestedOn) : '';
  return [name, job.service, job.portalStatus, date, vorgang].filter(Boolean).join(' · ');
}

/** Filter: alle Portale, nur myDigitalCar oder nur nextOZ. */
export function PortalSourceFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">Portal
      <select data-testid="portal-source-filter" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="all">Alle</option>
        {PORTAL_SOURCES.map((s) => <option key={s} value={s}>{PORTAL_LABEL[s]}</option>)}
      </select>
    </label>
  );
}

/** Filter auf den Rohstatus des Portals, plus Probleme (Fehler, Abgelehnt). */
export function PortalStatusFilter({ value, onChange, statuses }: { value: string; onChange: (v: string) => void; statuses: string[] }) {
  const known = new Set<string>(MDC_PORTAL_STATUSES);
  const extra = statuses.filter((s) => s && !known.has(s));
  return (
    <label className="field">Portalstatus
      <select data-testid="portal-status-filter" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="all">Alle</option>
        <option value="problem">Probleme (Fehler, Abgelehnt)</option>
        {MDC_PORTAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        {extra.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </label>
  );
}

export function filterPortalJobs(jobs: Job[], source: string, status: string): Job[] {
  return jobs.filter((j) => matchesPortalSource(j, source) && matchesPortalFilter(j, status));
}

/** CSV eines Portals wählen, prüfen und übernehmen. myDigitalCar und nextOZ bleiben getrennte Quellen. */
export function PortalCsvUpload({ source }: { source: PortalSource }) {
  const { state, dispatch } = useAppStore();
  const label = PORTAL_LABEL[source];
  const [csv, setCsv] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const planned = csv ? applyPortalImport(state, source, csv, () => 'preview', now().toISOString()) : null;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setSummary(null);
    setCsv(null);
    setError(null);
    if (file.size > MDC_CSV_MAX_CHARS) {
      setError('Die Datei ist zu groß (über 3 MB). Bitte in Portionen mit derselben Kopfzeile exportieren.');
      return;
    }
    const text = decodeListFile(new Uint8Array(await file.arrayBuffer()));
    const probe = applyPortalImport(state, source, text, () => 'preview', now().toISOString());
    if (probe.error) {
      setError(probe.error);
      return;
    }
    setCsv(text);
  }

  async function take() {
    if (!csv || !planned || planned.error) return;
    setBusy(true);
    const { ok } = await dispatch({ type: 'importPortalCsv', source, csv });
    setBusy(false);
    if (ok === false) return;
    setSummary(mdcResultText(planned, label));
    setCsv(null);
  }

  return (
    <section className="list-group" id={`portal-${source}`} data-testid={`portal-upload-${source}`} aria-labelledby={`portal-${source}-title`}>
      <h2 id={`portal-${source}-title`} className="list-group-title">{label}</h2>
      <div className="note-card sim-form">
        <p className="list-row-subtitle">
          {source === 'mydigitalcar'
            ? 'Export von web.mydigitalcar.de (Semikolon, UTF-8). Ein erneuter Import aktualisiert den Status und legt nichts doppelt an.'
            : 'Anträge-Liste von dashboard.nextoz.de (Semikolon, UTF-8, Kopfzeile Nr;Auftragsnummer;Kennzeichen;FIN;Antragsart;Datum;Status;Fehler;Amtsgebuehr). Nr ist nur die Listenposition. Ein erneuter Import aktualisiert den Status und legt nichts doppelt an.'}
        </p>
        <label className="field">{label}-Datei
          <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {planned && !planned.error && (
          <div data-testid={`portal-preview-${source}`}>
            <p className="list-row-title">{planned.rows} Vorgänge · {planned.duplicates} Dubletten · {planned.errors.length} Zeilen mit Fehler</p>
            <p className="list-row-subtitle">{planned.contacts.created} Kunden neu · {planned.vehicles.created} Fahrzeuge neu · {planned.jobs.created} Aufträge neu, {planned.jobs.updated} aktualisiert</p>
            <div className="card-buttons">
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { void take(); }}>Übernehmen</button>
            </div>
          </div>
        )}
        {summary && <p className="list-row-title" role="status" data-testid={`portal-summary-${source}`}>{summary}</p>}
      </div>
    </section>
  );
}
