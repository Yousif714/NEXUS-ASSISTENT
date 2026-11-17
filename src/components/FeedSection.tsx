'use client';

import type { HeuteEntry, HeuteSection } from '@/domain/heute';
import { formatEuro } from '@/domain/money';

import { IconChevron } from './Icons';
import { ListGroup } from './ListGroup';
import { ListRow } from './ListRow';
import { TaskRow } from './TaskRow';

/** Zeilen eines Heute-Abschnitts: Hinweise bleiben Aufgaben, alles andere eine Listenzeile. */
export function FeedList({ entries, onDone, onLater, overdue = false, title, testId }: {
  entries: HeuteEntry[];
  onDone: (key: string) => void;
  onLater: (key: string) => void;
  overdue?: boolean;
  title?: string;
  testId?: string;
}) {
  return (
    <ListGroup title={title} testId={testId}>
      {entries.map((e) => (e.kind === 'insight' ? (
        <TaskRow key={e.insight.dedupeKey} insight={e.insight}
          onDone={() => onDone(e.insight.dedupeKey)} onLater={() => onLater(e.insight.dedupeKey)} />
      ) : (
        <ListRow key={e.key} href={e.href} testId={`feed-${e.key}`} title={e.title}
          subtitle={<span className="wrap-text">{e.subtitle}</span>}
          value={e.amountCents !== undefined ? <span className={overdue ? 'amount arrears-value' : 'amount'}>{formatEuro(e.amountCents)}</span> : undefined} />
      )))}
    </ListGroup>
  );
}

/** Abschnitt mit Überschrift. Lange Listen starten zu, die Anzahl steht daneben. */
export function FeedSection({ section, onDone, onLater }: {
  section: HeuteSection;
  onDone: (key: string) => void;
  onLater: (key: string) => void;
}) {
  const n = section.entries.length;
  const list = <FeedList entries={section.entries} onDone={onDone} onLater={onLater} overdue={section.id === 'ueberfaellig'} />;
  if (!section.collapsed) {
    return (
      <section data-testid={`feed-${section.id}`}>
        <h2 className="feed-heading">{section.title} ({n})</h2>
        {list}
      </section>
    );
  }
  return (
    <details className="feed-section" data-testid={`feed-${section.id}`}>
      <summary className="feed-summary">
        <span>{section.title}</span>
        <span className="feed-summary-side">
          <span className="feed-count">{n}</span>
          <IconChevron className="feed-chevron" />
        </span>
      </summary>
      {list}
    </details>
  );
}
