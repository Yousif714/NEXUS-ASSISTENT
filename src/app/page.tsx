'use client';

import Link from 'next/link';
import { useId, useState } from 'react';

import { FeedList, FeedSection } from '@/components/FeedSection';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { MoneyCard } from '@/components/MoneyCard';
import { MoreMenu } from '@/components/MoreMenu';
import { PageHeader } from '@/components/PageHeader';
import { TaskRow } from '@/components/TaskRow';
import { openInsights } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { MONEY_SOURCES, buildBriefing, renderBriefingText } from '@/domain/briefing';
import { berlinParts, formatBerlin, formatBerlinDe, now, todayBerlin } from '@/domain/clock';
import { buildHeuteFeed } from '@/domain/heute';
import { notConnected } from '@/domain/connections';
import { areaUnreliable } from '@/domain/freshness';
import { openReplies } from '@/domain/matching/messages';
import type { StoredInsight } from '@/domain/types';

function CoachTip({ tip, onTake, onLater, onNever }: { tip: StoredInsight; onTake: () => void; onLater: () => void; onNever: () => void }) {
  const href = tip.refs[0]?.href;
  return (
    <section className="list-group" data-testid="coach-tip">
      <h2 className="list-group-title">Coach-Tipp</h2>
      <div className="coach-card">
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

export default function HeutePage() {
  const { state, dispatch, mode } = useAppStore();
  const [showBriefing, setShowBriefing] = useState(false);
  const briefingId = useId();
  const at = now();

  const briefing = buildBriefing(state, 'morning', at);
  const feed = buildHeuteFeed(state, at);
  const dueToday = feed.find((s) => s.id === 'faellig');
  const later = feed.filter((s) => s.id !== 'faellig');
  const allOpen = openInsights(state);
  const coachTip = briefing.coach[0];
  const replies = openReplies(state.messages, at, state.settings.replyThresholdHours);
  const today = todayBerlin(at);
  const todayCalls = state.calls.filter((c) => berlinParts(new Date(c.startsAt)).date === today).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const onDone = (key: string) => dispatch({ type: 'dismissInsight', key });
  const onLater = (key: string) => dispatch({ type: 'snoozeInsight', key });
  const header = <PageHeader title="Heute" subtitle={formatBerlinDe(at, 'EEEE, d. MMMM')} trailing={<MoreMenu />} />;

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
        <h2 className="feed-heading feed-heading-first">Heute</h2>

        <ListGroup title="Wichtig heute" testId="top-insights">
          {briefing.top.length === 0
            ? <ListRow key="empty" title="Alles erledigt." />
            : briefing.top.map((i) => <TaskRow key={i.dedupeKey} insight={i} onDone={() => onDone(i.dedupeKey)}
                onLater={() => onLater(i.dedupeKey)} />)}
          <ListRow key="all" href="/hinweise" title={`Alle Hinweise (${allOpen.length})`} testId="all-insights-link" />
        </ListGroup>

        <ListGroup title="Termine heute" testId="events-today">
          {briefing.events.length === 0 && todayCalls.length === 0 && <ListRow key="empty" title="Keine Termine heute." />}
          {briefing.events.map((e) => (
            <ListRow key={e.id} title={e.title} subtitle={e.location} value={formatBerlin(new Date(e.startAt), 'HH:mm')} />
          ))}
          {todayCalls.map((c) => (
            <ListRow key={c.id} href={`/nexus/calls/${c.id}`} title={c.topic} subtitle="Call" value={formatBerlin(new Date(c.startsAt), 'HH:mm')} />
          ))}
        </ListGroup>

        {dueToday && <FeedList title={`Fällig heute (${dueToday.entries.length})`} testId="feed-faellig" entries={dueToday.entries} onDone={onDone} onLater={onLater} />}

        <section className="money-cards" aria-label="Geld">
          {briefing.money.map((m) => (
            <MoneyCard key={m.company} company={m.company} openCents={m.openCents} overdueCents={m.overdueCents}
              stale={areaUnreliable(MONEY_SOURCES[m.company], state.connections, at)} />
          ))}
        </section>

        <ListGroup title="Nachrichten" testId="replies" sectionId="heute-nachrichten" defaultOpen>
          {replies.length === 0
            ? <ListRow key="empty" title="Keine offenen Antworten." />
            : replies.map(({ message: m, waitingHours }) => (
              <ListRow key={m.id} href={`/nachrichten/${m.threadId}`} testId="reply-row"
                title={state.contacts.find((c) => c.id === m.contactId)?.name ?? m.from}
                subtitle={m.body} value={`${waitingHours} Std.`} />
            ))}
        </ListGroup>

        {coachTip && (
          <CoachTip key={coachTip.dedupeKey} tip={coachTip}
            onTake={() => dispatch({ type: 'dismissInsight', key: coachTip.dedupeKey })}
            onLater={() => dispatch({ type: 'snoozeInsight', key: coachTip.dedupeKey })}
            onNever={() => dispatch({ type: 'suppressCoach', key: coachTip.dedupeKey })} />
        )}

        <section className="briefing">
          <button type="button" className="nav-button" aria-expanded={showBriefing} aria-controls={briefingId} onClick={() => setShowBriefing((v) => !v)}>
            {showBriefing ? 'Morgenbriefing ausblenden' : 'Morgenbriefing ansehen'}
          </button>
          <div id={briefingId} className="briefing-panel" data-testid="briefing-text" hidden={!showBriefing}>
            {renderBriefingText(briefing)}
          </div>
        </section>
      </section>

      {later.map((section) => <FeedSection key={section.id} section={section} onDone={onDone} onLater={onLater} />)}
    </>
  );
}
