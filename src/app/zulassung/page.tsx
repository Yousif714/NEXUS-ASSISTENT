'use client';

import { useState } from 'react';

import { CountFigure, Figures } from '@/components/Figures';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { MoneyCard } from '@/components/MoneyCard';
import { PageHeader } from '@/components/PageHeader';
import { filterPortalJobs, jobPortalBadge, PORTAL_LIST_CAP, portalJobSubtitle, PortalCsvUpload, PortalSourceFilter, PortalStatusFilter } from '@/components/PortalImport';
import { CONTACT_KIND_LABEL, JOB_STATUS_LABEL, JOB_STATUS_ORDER } from '@/components/zulassung-labels';
import { unallocatedBankPayments, zulassungKpis } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { MONEY_SOURCES, buildBriefing } from '@/domain/briefing';
import { formatBerlinDe, now } from '@/domain/clock';
import { areaUnreliable } from '@/domain/freshness';
import { formatEuro } from '@/domain/money';
import type { Job } from '@/domain/types';

const jobAmount = (j: Job) => (j.portalData && j.priceCents === 0 ? '–' : formatEuro(j.priceCents));

export default function ZulassungPage() {
  const { state } = useAppStore();
  const at = now();
  const [portal, setPortal] = useState('all');
  const [portalStatus, setPortalStatus] = useState('all');
  const [caps, setCaps] = useState<Record<string, number>>({});
  const kpis = zulassungKpis(state, at);
  const money = buildBriefing(state, 'morning', at).money.find((m) => m.company === 'zulassung')!;
  const contactName = (id: string) => state.contacts.find((c) => c.id === id)?.name ?? 'Unbekannt';
  const customers = state.contacts.filter((c) => c.company === 'zulassung').sort((a, b) => a.name.localeCompare(b.name, 'de'));

  return (
    <>
      <PageHeader title="Zulassungsdienst" subtitle={formatBerlinDe(at, 'EEEE, d. MMMM')} />

      <Figures title="Heute" columns={4}>
        <CountFigure label="Heute erledigt" value={kpis.doneToday} testId="kpi-done-today" />
        <CountFigure label="Offen" value={kpis.open} testId="kpi-open" />
        <CountFigure label="Wartet auf Kunde" value={kpis.waiting} testId="kpi-waiting" />
        <CountFigure label="Nicht abgerechnet" value={kpis.notInvoiced ?? '–'} testId="kpi-not-invoiced" />
      </Figures>

      <section className="money-cards" aria-label="Geld">
        <MoneyCard company="zulassung" openCents={money.openCents} overdueCents={money.overdueCents}
          stale={areaUnreliable(MONEY_SOURCES.zulassung, state.connections, at)} />
      </section>

      <PortalCsvUpload source="mydigitalcar" />
      <PortalCsvUpload source="nextoz" />

      <section className="list-group" aria-label="Portalfilter" data-testid="portal-filters">
        <h2 className="list-group-title">Portale</h2>
        <div className="note-card sim-form">
          <PortalSourceFilter value={portal} onChange={setPortal} />
          <PortalStatusFilter value={portalStatus} onChange={setPortalStatus}
            statuses={[...new Set(state.jobs.map((j) => j.portalStatus).filter((s): s is string => !!s))]} />
        </div>
      </section>

      <ListGroup title="Zahlungen" testId="zulassung-payments">
        <ListRow href="/zulassung/zuordnen" testId="zulassung-match-row" title="Zahlungen zuordnen" subtitle="Sparkassen-Auszug hochladen und zuordnen"
          value={unallocatedBankPayments(state, 'zulassung').length} />
      </ListGroup>

      {filterPortalJobs(state.jobs, portal, portalStatus).length === 0 && (portal !== 'all' || portalStatus !== 'all') && (
        <p className="empty-card" data-testid="portal-filter-empty">Keine Aufträge für diese Portalauswahl.</p>
      )}

      {JOB_STATUS_ORDER.map((status) => {
        const jobs = filterPortalJobs(state.jobs.filter((j) => j.status === status), portal, portalStatus);
        if (jobs.length === 0) return null;
        const cap = caps[status] ?? PORTAL_LIST_CAP;
        const shown = jobs.slice(0, cap);
        return (
          <ListGroup key={status} title={`Aufträge: ${JOB_STATUS_LABEL[status]}`} testId={`jobs-${status}`}>
            {shown.map((j) => {
              const v = state.vehicles.find((x) => x.id === j.vehicleId);
              return (
                <ListRow key={j.id} href={`/zulassung/auftraege/${j.id}`} testId={`job-row-${j.id}`}
                  title={<>{v ? `${v.model} · ${v.plate}` : j.service} {jobPortalBadge(j)}</>}
                  subtitle={portalJobSubtitle(contactName(j.contactId), j)}
                  value={<span className="amount">{jobAmount(j)}</span>} />
              );
            })}
            {jobs.length > shown.length && (
              <ListRow key="more" title="Weitere anzeigen" testId={`jobs-more-${status}`}
                accessory={<button type="button" className="btn btn-secondary btn-small" onClick={() => setCaps((c) => ({ ...c, [status]: cap + PORTAL_LIST_CAP }))}>{jobs.length - shown.length} weitere</button>} />
            )}
          </ListGroup>
        );
      })}

      <ListGroup title="Kunden" testId="customers">
        {customers.map((c) => {
          const n = state.jobs.filter((j) => j.contactId === c.id).length;
          return (
            <ListRow key={c.id} href={`/zulassung/kunden/${c.id}`} testId={`customer-row-${c.id}`} title={c.name}
              subtitle={`${CONTACT_KIND_LABEL[c.kind]} · ${n === 1 ? '1 Auftrag' : `${n} Aufträge`}`} />
          );
        })}
      </ListGroup>
    </>
  );
}
