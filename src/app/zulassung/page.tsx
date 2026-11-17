'use client';

import { useEffect, useState } from 'react';

import './zulassung.css';

import { EmailFolder } from '@/components/EmailFolder';
import { CountFigure, Figures } from '@/components/Figures';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { MoneyCard } from '@/components/MoneyCard';
import { PageHeader } from '@/components/PageHeader';
import { peopleSummary } from '@/components/people-summary';
import { filterPortalJobs, jobPortalBadge, PORTAL_LIST_CAP, portalJobSubtitle, portalVehicleTitle, PortalCsvUpload, PortalSourceFilter, PortalStatusFilter } from '@/components/PortalImport';
import { JOB_STATUS_LABEL, JOB_STATUS_ORDER } from '@/components/zulassung-labels';
import { unallocatedBankPayments, zulassungCustomers, zulassungKpis } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { MONEY_SOURCES, buildBriefing } from '@/domain/briefing';
import { formatBerlinDe, now, todayBerlin } from '@/domain/clock';
import { areaUnreliable } from '@/domain/freshness';
import { jobBilling } from '@/domain/billing';
import { jobContactLabel, jobPortalSource } from '@/domain/import/portal';
import { DOC_LABEL, unlinkedOrderMessages } from '@/domain/matching/job-messages';
import { formatBerlin } from '@/domain/clock';
import { formatEuro } from '@/domain/money';
import type { Job } from '@/domain/types';

const jobAmount = (j: Job) => (j.portalData && j.priceCents === 0 ? '–' : formatEuro(j.priceCents));

export default function ZulassungPage() {
  const { state } = useAppStore();
  const at = now();
  const [unbilled, setUnbilled] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('abrechnung');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q === 'portal') setUnbilled(true);
  }, []);
  const [portal, setPortal] = useState('all');
  const [portalStatus, setPortalStatus] = useState('all');
  const [caps, setCaps] = useState<Record<string, number>>({});
  const today = todayBerlin(at);
  const kpis = zulassungKpis(state, at);
  const money = buildBriefing(state, 'morning', at).money.find((m) => m.company === 'zulassung')!;
  const contactName = (j: Job) => jobContactLabel(j, state.contacts);
  const customers = zulassungCustomers(state, today);
  const newOrders = unlinkedOrderMessages(state);
  const overdueCustomers = customers
    .filter((c) => c.overdueCents > 0)
    .sort((a, b) => b.overdueCents - a.overdueCents || a.name.localeCompare(b.name, 'de'));

  return (
    <>
      <PageHeader title="Zulassungsdienst" subtitle={formatBerlinDe(at, 'EEEE, d. MMMM')} />

      <div className="zl-top">
      <Figures columns={4}>
        <CountFigure label="Heute erledigt" value={kpis.doneToday} testId="kpi-done-today" href="#jobs-done" />
        <CountFigure label="Offen" value={kpis.open} testId="kpi-open" href={kpis.open > 0 ? '#jobs-open' : '#auftraege'} />
        <CountFigure label="Wartet auf Kunde" value={kpis.waiting} testId="kpi-waiting" href={kpis.waiting > 0 ? '#jobs-waiting_customer' : '#auftraege'} />
        <CountFigure label="Nicht abgerechnet" value={kpis.notInvoiced ?? '–'} testId="kpi-not-invoiced" href="#jobs-done" />
      </Figures>

      <section className="money-cards" aria-label="Geld">
        <MoneyCard company="zulassung" href="/zulassung/kunden" openCents={money.openCents} overdueCents={money.overdueCents}
          stale={areaUnreliable(MONEY_SOURCES.zulassung, state.connections, at)} />
      </section>
      </div>

      <div className="zl-cols">
      <div className="zl-main">
      <div className="zl-jobs-head" id="auftraege">
        <h2 className="list-group-title">Aufträge</h2>
        <section className="zl-filters" aria-label="Portalfilter" data-testid="portal-filters">
          <PortalSourceFilter value={portal} onChange={setPortal} />
          <PortalStatusFilter value={portalStatus} onChange={setPortalStatus}
            statuses={[...new Set(state.jobs.map((j) => j.portalStatus).filter((s): s is string => !!s))]} />
        </section>
      </div>

      {unbilled && (
        <p className="empty-card" data-testid="portal-unbilled-filter">
          Nur Portal-Aufträge, die erledigt und nicht abgerechnet sind. <a href="/zulassung">Alle Aufträge</a>
        </p>
      )}

      {filterPortalJobs(state.jobs, portal, portalStatus).length === 0 && (portal !== 'all' || portalStatus !== 'all') && (
        <p className="empty-card" data-testid="portal-filter-empty">Keine Aufträge für diese Portalauswahl.</p>
      )}

      {JOB_STATUS_ORDER.map((status) => {
        const jobs = filterPortalJobs(state.jobs.filter((j) => {
          if (j.status !== status) return false;
          if (!unbilled) return true;
          return !!jobPortalSource(j) && jobBilling(state, j).restCents > 0;
        }), portal, portalStatus);
        if (jobs.length === 0) return null;
        const cap = caps[status] ?? PORTAL_LIST_CAP;
        const shown = jobs.slice(0, cap);
        return (
          <ListGroup key={status} title={JOB_STATUS_LABEL[status].charAt(0).toUpperCase() + JOB_STATUS_LABEL[status].slice(1)} testId={`jobs-${status}`} sectionId={unbilled && status === 'done' ? 'jobs-unbilled' : `jobs-${status}`} defaultOpen={status === 'open' || (unbilled && status === 'done')}>
            {shown.map((j) => {
              const v = state.vehicles.find((x) => x.id === j.vehicleId);
              return (
                <ListRow key={j.id} href={`/zulassung/auftraege/${j.id}`} testId={`job-row-${j.id}`}
                  title={<>{v ? portalVehicleTitle(v) : j.service} {jobPortalBadge(j)}{j.draft && <span className="draft-badge">Entwurf</span>}</>}
                  subtitle={portalJobSubtitle(contactName(j), j)}
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

      <ListGroup title="Kunden" testId="customers" sectionId="zulassung-kunden" defaultOpen={false}>
        <ListRow href="/zulassung/kunden" testId="customers-link" title="Kunden"
          subtitle={<span className="wrap-text">{peopleSummary(overdueCustomers.length, overdueCustomers.map((c) => c.name), 'Keine überfälligen Kunden')}</span>}
          value={customers.length} />
      </ListGroup>

      <ListGroup title="Zahlungen" testId="zulassung-payments" sectionId="zulassung-zahlungen">
        <ListRow href="/zulassung/zuordnen" testId="zulassung-match-row" title="Zahlungen zuordnen" subtitle="Sparkassen-Auszug hochladen und zuordnen"
          value={unallocatedBankPayments(state, 'zulassung').length} />
      </ListGroup>
      </div>

      <aside className="zl-side">
        {newOrders.length > 0 && (
          <ListGroup title="Neu aus WhatsApp" testId="zulassung-new-orders" sectionId="zulassung-neu-whatsapp">
            {newOrders.slice(0, 6).map((e) => (
              <ListRow key={e.messageId} href={`/nachrichten/${e.threadId}`} testId={`zl-new-order-${e.messageId}`}
                title={<span className="wrap-text zl-clamp">{e.docs.length ? e.docs.map((d) => DOC_LABEL[d]).join(', ') : e.body}</span>}
                subtitle={<span className="wrap-text">{e.kind === 'auftrag' ? 'Auftrag' : 'Nachweis'} · {e.senderName ?? 'Unbekannt'}{e.senderPhone ? ` · ${e.senderPhone}` : ''}</span>}
                value={formatBerlin(new Date(e.sentAt), 'dd.MM.')} />
            ))}
          </ListGroup>
        )}

        <EmailFolder />

        <section className="list-group zl-portals" aria-label="Portale und Import">
          <h2 className="list-group-title">Portale &amp; Import</h2>
          <div className="zl-portal-list">
            <PortalCsvUpload source="mydigitalcar" />
            <PortalCsvUpload source="nextoz" />
          </div>
        </section>
      </aside>
      </div>
    </>
  );
}
