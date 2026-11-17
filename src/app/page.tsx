'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

import { FeedList, FeedSection } from '@/components/FeedSection';
import { CountFigure, Figures } from '@/components/Figures';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { MoneyCard } from '@/components/MoneyCard';
import { MoreMenu } from '@/components/MoreMenu';
import { PageHeader } from '@/components/PageHeader';
import { TaskRow } from '@/components/TaskRow';
import { openInsights } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { showConnection } from '@/domain/features';
import { MONEY_SOURCES, buildBriefing, renderBriefingText } from '@/domain/briefing';
import { berlinParts, formatBerlin, formatBerlinDe, now, todayBerlin } from '@/domain/clock';
import { buildHeuteFeed } from '@/domain/heute';
import { notConnected } from '@/domain/connections';
import { ageText, areaUnreliable, messageStand, sourceFreshness } from '@/domain/freshness';
import type { AppState, StoredInsight } from '@/domain/types';

import './heute.css';

function CoachTip({ tip, onTake, onLater, onNever }: { tip: StoredInsight; onTake: () => void; onLater: () => void; onNever: () => void }) {
  const href = tip.refs[0]?.href;
  return (
    <section className="list-group" data-testid="coach-tip">
      <div className="coach-card heute-coach">
        <div className="heute-coach-label">Coach-Tipp</div>
        <div className="coach-title">{href ? <Link href={href}>{tip.title}</Link> : tip.title}</div>
        {tip.body && <p className="coach-body">{tip.body}</p>}
        <div className="coach-buttons">
          <button type="button" className="btn btn-primary" onClick={onTake}>Übernehmen</button>
          <button type="button" className="btn btn-secondary" onClick={onLater}>Später</button>
          <button type="button" className="btn btn-plain" onClick={onNever}>Nicht mehr vorschlagen</button>
        </div>
      </div>
    </section>
  );
}

function TechStatus({ state, at }: { state: AppState; at: Date }) {
  const problems = state.connections.filter((c) => showConnection(c.id)).flatMap((c) => {
    const freshness = sourceFreshness(c, at);
    if (freshness === 'fresh') return [];
    const subtitle = freshness === 'error' ? (c.lastError || 'Störung') : freshness === 'missing' ? 'Nicht verbunden' : ageText(c, at);
    return [{ id: c.id, title: c.label, subtitle }];
  });
  return (
    <ListGroup title="Technik" testId="tech-status" sectionId="heute-technik" defaultOpen={problems.length > 0}>
      {problems.length === 0
        ? <ListRow key="ok" title="Quellen in Ordnung" />
        : problems.map((p) => <ListRow key={p.id} href="/verbindungen" title={p.title} subtitle={p.subtitle} />)}
    </ListGroup>
  );
}

export default function HeutePage() {
  const { state, dispatch, mode } = useAppStore();
  const [showBriefing, setShowBriefing] = useState(false);
  const briefingId = useId();
  const at = now();

  const briefing = buildBriefing(state, 'morning', at);
  const feed = buildHeuteFeed(state, at);
  const dueToday = feed.find((s) => s.id === 'faellig');
  const later = feed.filter((s) => s.id !== 'faellig');
  const overdueCount = feed.find((s) => s.id === 'ueberfaellig')?.entries.length ?? 0;
  const allOpen = openInsights(state);
  const coachTip = briefing.coach[0];
  const today = todayBerlin(at);
  const todayCalls = state.calls.filter((c) => berlinParts(new Date(c.startsAt)).date === today).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const onDone = (key: string) => dispatch({ type: 'dismissInsight', key });
  const onLater = (key: string) => dispatch({ type: 'snoozeInsight', key });
  const stand = messageStand(state.connections, at);
  const header = <PageHeader title="Heute" subtitle={[formatBerlinDe(at, 'EEEE, d. MMMM'), stand].filter(Boolean).join(' · ')} trailing={<MoreMenu />} />;
  const replyInsights = allOpen.filter((i) => i.type === 'reply_waiting');
  const topKeys = new Set(briefing.top.map((i) => i.dedupeKey));
  const moreReplies = replyInsights.filter((i) => !topKeys.has(i.dedupeKey));

  // Echtmodus ohne eine einzige Verbindung: Weg zur Einrichtung statt leerer Karten.
  if (mode === 'real' && notConnected(state.connections.map((c) => c.id), state.connections)) {
    return (
      <>
        {header}
        <ListGroup title="Einrichtung" testId="setup-hint">
          <ListRow key="setup" href="/verbindungen" title={<span className="wrap-text">Noch nichts verbunden – zur Einrichtung</span>}
            subtitle={<span className="wrap-text">Verbinde deine Quellen, dann erscheinen hier Aufgaben, Termine und Zahlen.</span>} />
        </ListGroup>
      </>
    );
  }

  return (
    <>
      {header}

      <section data-testid="feed-heute">
        <section data-testid="replies">
        <ListGroup title="Heute zu tun" testId="top-insights" sectionId="heute-tun">
          {briefing.top.length === 0
            ? <ListRow key="empty" title="Nichts Dringendes." />
            : briefing.top.map((i) => <TaskRow key={i.dedupeKey} insight={i} onDone={() => onDone(i.dedupeKey)}
                onLater={() => onLater(i.dedupeKey)} />)}
          <ListRow key="all" href="/hinweise" title={`Alle Hinweise (${allOpen.length})`} testId="all-insights-link" />
        </ListGroup>
        {moreReplies.length > 0 && (
          <ListGroup title="Weitere Antworten" testId="more-replies" sectionId="heute-weitere-antworten">
            {moreReplies.map((i) => <TaskRow key={i.dedupeKey} insight={i} onDone={() => onDone(i.dedupeKey)} onLater={() => onLater(i.dedupeKey)} />)}
          </ListGroup>
        )}
        </section>


        {dueToday && <FeedList title={`Fällig heute (${dueToday.entries.length})`} testId="feed-faellig" entries={dueToday.entries} onDone={onDone} onLater={onLater} />}

        <Figures>
          <CountFigure label="Heute wichtig" value={briefing.top.length} testId="figure-top" href="#top-insights" />
          <CountFigure label="Termine heute" value={briefing.events.length + todayCalls.length} testId="figure-events" href="#events-today" />
          <CountFigure label="Überfällig" value={overdueCount} testId="figure-overdue" alert={overdueCount > 0} href="#feed-ueberfaellig" />
        </Figures>

        <section className="money-cards" aria-label="Geld">
          {briefing.money.map((m) => (
            <MoneyCard key={m.company} company={m.company} href={m.company === 'nexus' ? '/nexus/offen' : '/zulassung/kunden'} openCents={m.openCents} overdueCents={m.overdueCents}
              stale={areaUnreliable(MONEY_SOURCES[m.company], state.connections, at)} />
          ))}
        </section>

        <TechStatus state={state} at={at} />

        <div className="heute-cols">
        <div className="heute-main">
          {later.map((section) => <FeedSection key={section.id} section={section} onDone={onDone} onLater={onLater}
            defaultOpen={section.id === 'ueberfaellig' ? false : undefined} />)}
        </div>
        <aside className="heute-side">
        <ListGroup title="Termine heute" testId="events-today">
          {briefing.events.length === 0 && todayCalls.length === 0 && <ListRow key="empty" title="Keine Termine heute." />}
          {briefing.events.map((e) => (
            <ListRow key={e.id} title={e.title} subtitle={e.location} value={formatBerlin(new Date(e.startAt), 'HH:mm')} />
          ))}
          {todayCalls.map((c) => (
            <ListRow key={c.id} href={`/nexus/calls/${c.id}`} title={c.topic} subtitle="Call" value={formatBerlin(new Date(c.startsAt), 'HH:mm')} />
          ))}
        </ListGroup>
        {coachTip && (
          <CoachTip key={coachTip.dedupeKey} tip={coachTip}
            onTake={() => dispatch({ type: 'dismissInsight', key: coachTip.dedupeKey })}
            onLater={() => dispatch({ type: 'snoozeInsight', key: coachTip.dedupeKey })}
            onNever={() => dispatch({ type: 'suppressCoach', key: coachTip.dedupeKey })} />
        )}
        <section className="briefing">
          <ListGroup testId="briefing-group">
            <button key="toggle" type="button" className="list-row heute-briefing-toggle" aria-expanded={showBriefing} aria-controls={briefingId}
              onClick={() => setShowBriefing((v) => !v)}>
              <span className="list-row-text"><span className="list-row-title">{showBriefing ? 'Morgenbriefing ausblenden' : 'Morgenbriefing ansehen'}</span></span>
            </button>
          </ListGroup>
          <div id={briefingId} className="briefing-panel" data-testid="briefing-text" hidden={!showBriefing}>
            {renderBriefingText(briefing)}
          </div>
        </section>
        </aside>
        </div>
      </section>
    </>
  );
}
