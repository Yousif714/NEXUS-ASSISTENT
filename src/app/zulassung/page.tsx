'use client';

import { CountFigure, Figures } from '@/components/Figures';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { MoneyCard } from '@/components/MoneyCard';
import { PageHeader } from '@/components/PageHeader';
import { peopleSummary } from '@/components/people-summary';
import { JOB_STATUS_LABEL, JOB_STATUS_ORDER } from '@/components/zulassung-labels';
import { unallocatedBankPayments, zulassungCustomers, zulassungKpis } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { MONEY_SOURCES, buildBriefing } from '@/domain/briefing';
import { formatBerlinDe, now, todayBerlin } from '@/domain/clock';
import { areaUnreliable } from '@/domain/freshness';
import { formatEuro } from '@/domain/money';

export default function ZulassungPage() {
  const { state } = useAppStore();
  const at = now();
  const today = todayBerlin(at);
  const kpis = zulassungKpis(state, at);
  const money = buildBriefing(state, 'morning', at).money.find((m) => m.company === 'zulassung')!;
  const contactName = (id: string) => state.contacts.find((c) => c.id === id)?.name ?? 'Unbekannt';
  const customers = zulassungCustomers(state, today);
  const overdueCustomers = customers
    .filter((c) => c.overdueCents > 0)
    .sort((a, b) => b.overdueCents - a.overdueCents || a.name.localeCompare(b.name, 'de'));

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

      <ListGroup title="Zahlungen" testId="zulassung-payments">
        <ListRow href="/zulassung/zuordnen" testId="zulassung-match-row" title="Zahlungen zuordnen" subtitle="Sparkassen-Auszug hochladen und zuordnen"
          value={unallocatedBankPayments(state, 'zulassung').length} />
      </ListGroup>

      {JOB_STATUS_ORDER.map((status) => {
        const jobs = state.jobs.filter((j) => j.status === status);
        if (jobs.length === 0) return null;
        return (
          <ListGroup key={status} title={`Aufträge: ${JOB_STATUS_LABEL[status]}`} testId={`jobs-${status}`}>
            {jobs.map((j) => {
              const v = state.vehicles.find((x) => x.id === j.vehicleId);
              return (
                <ListRow key={j.id} href={`/zulassung/auftraege/${j.id}`} testId={`job-row-${j.id}`}
                  title={v ? `${v.model} · ${v.plate}` : j.service} subtitle={`${contactName(j.contactId)} · ${j.service}`}
                  value={<span className="amount">{formatEuro(j.priceCents)}</span>} />
              );
            })}
          </ListGroup>
        );
      })}

      <ListGroup title="Kunden" testId="customers">
        <ListRow href="/zulassung/kunden" testId="customers-link" title="Kunden"
          subtitle={<span className="wrap-text">{peopleSummary(overdueCustomers.length, overdueCustomers.map((c) => c.name), 'Keine überfälligen Kunden')}</span>}
          value={customers.length} />
      </ListGroup>
    </>
  );
}
