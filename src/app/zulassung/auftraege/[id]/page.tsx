'use client';

import { useParams } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { DemoBadge } from '@/components/DemoBadge';
import { Figure, Figures } from '@/components/Figures';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { PortalBadge, portalVehicleTitle } from '@/components/PortalImport';
import { Segmented } from '@/components/Segmented';
import { INVOICE_STATUS_LABEL, JOB_STATUS_LABEL, LOCATION_LABEL } from '@/components/zulassung-labels';
import { invoiceCandidates } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { jobInvoiceDraftAction, jobInvoiceDraftId } from '@/domain/action-factory';
import { jobBilling } from '@/domain/billing';
import { formatBerlin, formatIsoDe, now } from '@/domain/clock';
import { mdcVorgang } from '@/domain/import/mydigitalcar';
import { jobContactLabel, PORTAL_LABEL } from '@/domain/import/portal';
import { formatEuro } from '@/domain/money';
import type { Job } from '@/domain/types';

type Switchable = 'open' | 'waiting_customer' | 'done';
const SWITCH_OPTIONS: { value: Switchable; label: string }[] = [
  { value: 'open', label: JOB_STATUS_LABEL.open },
  { value: 'waiting_customer', label: JOB_STATUS_LABEL.waiting_customer },
  { value: 'done', label: JOB_STATUS_LABEL.done },
];
const isSwitchable = (s: Job['status']): s is Switchable => s === 'open' || s === 'waiting_customer' || s === 'done';

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch, mode } = useAppStore();
  const at = now();
  const back = <BackLink href="/zulassung" label="Zulassungsdienst" />;
  const job = state.jobs.find((j) => j.id === id);

  if (!job) {
    return (
      <>
        <PageHeader title="Auftrag" trailing={back} />
        <div className="empty-state">Diesen Auftrag gibt es nicht.</div>
      </>
    );
  }

  const contact = job.contactId ? state.contacts.find((c) => c.id === job.contactId) : undefined;
  const name = jobContactLabel(job, state.contacts);
  const vehicle = state.vehicles.find((v) => v.id === job.vehicleId);
  const { invoicedCents, restCents: rest } = jobBilling(state, job);
  const linked = job.invoiceIds.flatMap((iid) => state.invoices.filter((i) => i.id === iid));
  const candidates = invoiceCandidates(state, job.id);
  const lastMessage = [...state.messages]
    .filter((m) => m.jobId === job.id || (job.contactId !== null && m.contactId === job.contactId && !m.jobId))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt))[0];

  const draftId = jobInvoiceDraftId(job.id);
  const draft = state.actions.find((a) => a.id === draftId);
  const draftPayload = draft?.payload as { amountCents: number; text: string } | undefined;
  const prepareDraft = () => {
    const action = jobInvoiceDraftAction({ job, contactName: name, plate: vehicle?.plate ?? null, restCents: rest, at, isDemo: mode === 'demo' });
    dispatch({ type: 'createAction', action });
  };

  return (
    <>
      <PageHeader title={job.service} subtitle={<>{name}{vehicle?.plate.trim() ? <> · {vehicle.plate}</> : null}</>} badge={<>{job.portalSource && <PortalBadge source={job.portalSource} />}{mode === 'demo' ? <DemoBadge /> : null}</>} trailing={back} />

      <ListGroup title="Auftrag" testId="job-details">
        <ListRow key="vehicle" title="Fahrzeug" testId="job-vehicle" value={vehicle ? portalVehicleTitle(vehicle) : '–'} />
        <ListRow key="service" title="Leistung" value={job.service} />
        <ListRow key="location" title="Standort" value={LOCATION_LABEL[job.location]} />
        <ListRow key="customer" href={contact ? `/zulassung/kunden/${contact.id}` : undefined} title="Kunde" value={<span data-testid="job-customer">{name}</span>} />
        <ListRow key="price" title="Preis" value={<span className="amount" data-testid="job-price">{job.portalData && job.priceCents === 0 ? '–' : formatEuro(job.priceCents)}</span>} />
        {job.notes ? <ListRow key="notes" title="Notiz" subtitle={job.notes} /> : null}
      </ListGroup>

      {job.portalSource && (
        <ListGroup title={PORTAL_LABEL[job.portalSource]} testId="job-portal">
          <ListRow key="source" title="Portal" value={<span data-testid="job-portal-source">{PORTAL_LABEL[job.portalSource]}</span>} />
          <ListRow key="vorgang" title="Vorgangsnummer" value={<span data-testid="job-vorgang">{mdcVorgang(job) ?? '–'}</span>} />
          <ListRow key="pstatus" title="Portalstatus" value={<span data-testid="job-portal-status" className={job.portalProblem ? 'arrears-value' : undefined}>{job.portalStatus || '–'}</span>} />
          {job.requestedOn ? <ListRow key="datum" title="Vorgangsdatum" testId="job-portal-date" value={formatIsoDe(job.requestedOn)} /> : null}
          {job.portalData?.Fehler ? <ListRow key="fehler" title="Fehlertext" testId="job-portal-error" value={job.portalData.Fehler} /> : null}
          {job.portalProblem ? <ListRow key="problem" title="Problem" testId="job-portal-problem" value="Portal meldet Fehler oder Ablehnung" /> : null}
          {Object.entries(job.portalData ?? {})
            .filter(([k, v]) => v && k !== 'Ex_Vorgangsnummer' && k !== 'Status' && k !== 'Auftragsnummer' && !(k === 'Datum' && job.requestedOn) && !(k === 'Fehler' && job.portalData?.Fehler))
            .map(([k, v]) => <ListRow key={k} title={k.replace(/_/g, ' ')} value={v} testId={`portal-field-${k}`} />)}
        </ListGroup>
      )}

      <section className="list-group" aria-labelledby="status-title">
        <h2 id="status-title" className="list-group-title">Status</h2>
        {isSwitchable(job.status) ? (
          <Segmented name="job-status" legend="Auftragsstatus" value={job.status} options={SWITCH_OPTIONS}
            onChange={(status) => dispatch({ type: 'setJobStatus', jobId: job.id, status })} />
        ) : (
          <p className="note-card" data-testid="job-status">{JOB_STATUS_LABEL[job.status]}</p>
        )}
        {job.doneAt && <p className="confirm-line">Erledigt am {formatBerlin(new Date(job.doneAt), 'dd.MM.yyyy, HH:mm')} Uhr</p>}
      </section>

      <ListGroup title="Letzte Kommunikation">
        {lastMessage ? (
          <ListRow key="msg" href={`/nachrichten/${lastMessage.threadId}`} testId="last-message"
            title={lastMessage.body} subtitle={`${lastMessage.direction === 'in' ? name : 'Du'} · ${formatBerlin(new Date(lastMessage.sentAt), 'dd.MM. HH:mm')}`} />
        ) : (
          <ListRow key="none" title="Keine Nachrichten." />
        )}
      </ListGroup>

      <ListGroup title="Verknüpfte Rechnungen" testId="linked-invoices">
        {linked.length === 0
          ? <ListRow key="none" title="Noch keine Rechnung zugeordnet." />
          : linked.map((i) => (
            <ListRow key={i.id} title={i.number} subtitle={`${formatIsoDe(i.issuedOn)} · ${INVOICE_STATUS_LABEL[i.status]}`}
              value={<span className="amount">{formatEuro(i.totalCents)}</span>} />
          ))}
      </ListGroup>

      <Figures title="Abrechnung">
        <Figure label="Abgerechnet" cents={invoicedCents} testId="job-invoiced" />
        <Figure label="Rest" cents={rest} testId="job-rest" strong />
      </Figures>

      {candidates.length > 0 && (
        <ListGroup title="Passende Rechnungen" testId="invoice-candidates">
          {candidates.map((i) => (
            <ListRow key={i.id} testId={`invoice-candidate-${i.id}`} title={i.number}
              subtitle={`${formatIsoDe(i.issuedOn)}${i.text ? ` · ${i.text}` : ''}`}
              value={<span className="amount">{formatEuro(i.totalCents)}</span>}
              accessory={<button type="button" className="btn btn-secondary btn-small" aria-label={`Rechnung ${i.number} zuordnen`}
                onClick={() => dispatch({ type: 'linkInvoiceToJob', jobId: job.id, invoiceId: i.id })}>Zuordnen</button>} />
          ))}
        </ListGroup>
      )}

      {(rest > 0 || draft) && (
        <div className="member-actions">
          <button type="button" className="btn btn-primary" onClick={prepareDraft} disabled={!!draft}>Rechnungsentwurf vorbereiten (Demo)</button>
          <div role="status" className="confirm-line" data-testid="invoice-draft-status">
            {draft && draftPayload && (
              <>
                Entwurf angelegt: {draft.title} · {draftPayload.text} · <span className="amount">{formatEuro(draftPayload.amountCents)}</span> <DemoBadge />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
