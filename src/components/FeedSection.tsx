'use client';

import type { HeuteEntry, HeuteSection, HeuteSectionId } from '@/domain/heute';
import { formatEuro } from '@/domain/money';

import { CollapsibleSection } from './CollapsibleSection';
import { ListGroup } from './ListGroup';
import { ListRow } from './ListRow';
import { TaskRow } from './TaskRow';

/** Überfällig und das, was heute fällig ist, starten offen. Der Rest zu. */
const DEFAULT_OPEN: Record<HeuteSectionId, boolean> = {
  faellig: true,
  ueberfaellig: true,
  offen: false,
  demnaechst: false,
  quellen: false,
};

/** Zeilen eines Heute-Abschnitts: Hinweise bleiben Aufgaben, alles andere eine Listenzeile. */
export function FeedList({ entries, onDone, onLater, overdue = false, title, testId }: {
  entries: HeuteEntry[];
  onDone: (key: string) => void;
  onLater: (key: string) => void;
  overdue?: boolean;
  title?: string;
  testId?: string;
}) {
  const rows = entries.map((e) => (e.kind === 'insight' ? (
    <TaskRow key={e.insight.dedupeKey} insight={e.insight}
      onDone={() => onDone(e.insight.dedupeKey)} onLater={() => onLater(e.insight.dedupeKey)} />
  ) : (
    <ListRow key={e.key} href={e.href} testId={`feed-${e.key}`} title={e.title}
      subtitle={<span className="wrap-text">{e.subtitle}</span>}
      value={e.amountCents !== undefined ? <span className={overdue ? 'amount arrears-value' : 'amount'}>{formatEuro(e.amountCents)}</span> : undefined} />
  )));
  if (!title) {
    return (
      <ul className="list-group-body">
        {rows.map((row, i) => <li key={(row as { key?: string | null }).key ?? i}>{row}</li>)}
      </ul>
    );
  }
  return <ListGroup title={title} testId={testId} sectionId={testId} defaultOpen>{rows}</ListGroup>;
}

/** Abschnitt mit Pfeil und Zähler. Überfällig startet offen, der Rest zu. Der Zustand wird gemerkt. */
export function FeedSection({ section, onDone, onLater, defaultOpen }: {
  section: HeuteSection;
  onDone: (key: string) => void;
  onLater: (key: string) => void;
  /** Überschreibt den Standard (z. B. Überfällig zu bei vielen Einträgen). */
  defaultOpen?: boolean;
}) {
  return (
    <CollapsibleSection id={`feed-${section.id}`} title={section.title} count={section.entries.length}
      defaultOpen={defaultOpen ?? DEFAULT_OPEN[section.id]} testId={`feed-${section.id}`}>
      <FeedList entries={section.entries} onDone={onDone} onLater={onLater} overdue={section.id === 'ueberfaellig'} />
    </CollapsibleSection>
  );
}
