'use client';

import { Children, type ReactNode } from 'react';

import { CollapsibleSection } from './CollapsibleSection';

/** Gruppierte Liste mit Einzug (iOS-Einstellungen). Jedes Kind (`ListRow`/`TaskRow`) wird eine Zeile mit Haarlinie dazwischen. Mit Titel ist die Liste einklappbar. */
export function ListGroup({ title, children, testId, sectionId, defaultOpen = true }: {
  title?: string;
  children: ReactNode;
  testId?: string;
  /** Schlüssel für den gemerkten Zustand. Fehlt er, gilt `testId` oder der Titel. */
  sectionId?: string;
  /** Nur der erste Blick. Danach gilt der gemerkte Zustand. */
  defaultOpen?: boolean;
}) {
  const items = Children.toArray(children);
  const body = (
    <ul className="list-group-body">
      {items.map((row, i) => (
        <li key={(row as { key?: string | null }).key ?? i}>{row}</li>
      ))}
    </ul>
  );
  if (!title) {
    return <section className="list-group" data-testid={testId}>{body}</section>;
  }
  return (
    <CollapsibleSection id={sectionId ?? testId ?? title} title={title} count={items.length} defaultOpen={defaultOpen} testId={testId}>
      {body}
    </CollapsibleSection>
  );
}
