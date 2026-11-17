'use client';

import { CountFigure, Figure, Figures } from '@/components/Figures';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { MoneyCard } from '@/components/MoneyCard';
import { PageHeader } from '@/components/PageHeader';
import { peopleSummary } from '@/components/people-summary';
import { linksToShare, memberRows, portalRows, switchableTakeovers, nexusForecast, stripeLexCases, unallocatedBankPayments } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { MONEY_SOURCES, buildBriefing } from '@/domain/briefing';
import { formatBerlin, formatBerlinDe, now, todayBerlin } from '@/domain/clock';
import { areaUnreliable } from '@/domain/freshness';
import { deriveProposals } from '@/domain/import/proposals';
import { nexusReceivables } from '@/domain/ledger/receivables';
import { formatEuro } from '@/domain/money';
import { portalSummary } from '@/domain/portal';

import './nexus.css';

export default function NexusPage() {
  const { state } = useAppStore();
  const at = now();
  const today = todayBerlin(at);

  const money = buildBriefing(state, 'morning', at).money.find((m) => m.company === 'nexus')!;
  const forecast = nexusForecast(state, today);
  const members = memberRows(state, today).sort((a, b) => b.arrearsCents - a.arrearsCents || a.name.localeCompare(b.name, 'de'));
  const overdueRows = members.filter((r) => r.traffic !== 'green' && !r.onHold);
  const receivables = nexusReceivables(state, today);
  const toMatch = unallocatedBankPayments(state).length + stripeLexCases(state).length;
  const switchable = switchableTakeovers(state, at);
  const unsentLinks = linksToShare(state).open.length;
  const openProposals = deriveProposals(state).length;
  const portal = portalSummary(portalRows(state, today));
  const calls = [...state.calls].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const contentOpen = state.content.filter((c) => c.stage !== 'published').length;

  return (
    <>
      <PageHeader title="NEXUS" />

      <Figures title="Überblick" columns={4}>
        <CountFigure label="Mitglieder" value={members.length} testId="kpi-members" />
        <CountFigure label="Überfällig" value={overdueRows.length} testId="kpi-overdue" />
        <CountFigure label="Zuordnen" value={toMatch} testId="kpi-match" />
        <Figure label="Offen" cents={receivables.totalCents} testId="kpi-open-cents" />
      </Figures>

      <section className="money-cards" aria-label="Geld">
        <MoneyCard company="nexus" openCents={money.openCents} overdueCents={money.overdueCents} stale={areaUnreliable(MONEY_SOURCES.nexus, state.connections, at)} />
      </section>

      <ListGroup title="Mitglieder" testId="members">
        <ListRow href="/nexus/vertraege" testId="members-link" title="Mitglieder"
          subtitle={<span className="wrap-text">{peopleSummary(overdueRows.length, [...new Set(overdueRows.map((r) => r.name))], 'Niemand überfällig')}</span>}
          value={members.length} />
        <ListRow key="open" href="/nexus/offen" title={`Offen (${formatEuro(receivables.totalCents)})`} testId="open-link" />
        <ListRow key="forecast" testId="forecast" title={`Monatsvorschau ${formatBerlinDe(at, 'MMMM yyyy')}`}
          subtitle={<>erwartet <span className="amount">{formatEuro(forecast.expectedCents)}</span>, davon <span className="amount">{formatEuro(forecast.atRiskCents)}</span> wackelig</>} />
      </ListGroup>

      <ListGroup title="Calls" sectionId="nexus-calls" defaultOpen={false}>
        {calls.map((c) => (
          <ListRow key={c.id} href={`/nexus/calls/${c.id}`} title={c.topic}
            subtitle={`${formatBerlin(new Date(c.startsAt), 'dd.MM.yyyy, HH:mm')} Uhr`} value={`Folien ${c.slides.length}/${c.slideCount}`} />
        ))}
      </ListGroup>

      <ListGroup title="Content" sectionId="nexus-content" defaultOpen={false}>
        <ListRow key="content" href="/nexus/content" title="Content-Board" value={`${contentOpen} in Arbeit`} />
      </ListGroup>

      <div className="nexus-tools">
        <ListGroup title="Werkzeuge & Import" testId="nexus-tools" sectionId="nexus-tools" defaultOpen={false}>
          <ListRow key="match" href="/nexus/zuordnen" title={`Zahlungen zuordnen (${toMatch})`} testId="match-link" />
          <ListRow key="portal" href="/nexus/mitglieder" testId="portal-link" title={`Portal-Mitglieder (${portal.total})`}
            value={portal.total === 0 ? 'Liste einfügen' : `${portal.noInvoice} ohne Rechnung`} />
          {openProposals > 0 ? (
            <ListRow key="proposals" href="/nexus/mitglieder/vorschlaege" testId="proposals-card"
              title={openProposals === 1 ? '1 Vertrag zum Bestätigen' : `${openProposals} Verträge zum Bestätigen`} />
          ) : null}
          <ListRow key="takeover" href={unsentLinks > 0 ? '/nexus/umstellung#links' : '/nexus/umstellung'} testId="takeover-link" title="Umstellung auf Stripe"
            subtitle={unsentLinks > 0 ? (unsentLinks === 1 ? '1 Link noch nicht gesendet' : `${unsentLinks} Links noch nicht gesendet`) : undefined}
            value={switchable === 0 ? undefined : `${switchable} umstellbar`} />
        </ListGroup>
      </div>
    </>
  );
}
