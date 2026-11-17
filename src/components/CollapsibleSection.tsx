'use client';

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';

import { IconChevron } from './Icons';

const STORAGE = 'nexus-sections';
const EVENT = 'nexus-sections';

const ready = new Set<string>();

function read(id: string): boolean | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, unknown>;
    return typeof map[id] === 'boolean' ? map[id] : null;
  } catch {
    return null;
  }
}

function write(id: string, open: boolean) {
  try {
    const raw = localStorage.getItem(STORAGE);
    const map = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    map[id] = open;
    localStorage.setItem(STORAGE, JSON.stringify(map));
  } catch {
    // Privater Modus: der Zustand gilt dann nur für diesen Blick.
  }
  ready.add(id);
  window.dispatchEvent(new Event(EVENT));
}

function useSectionOpen(id: string, defaultOpen: boolean): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const handler = () => onChange();
      window.addEventListener(EVENT, handler);
      const timer = window.setTimeout(() => {
        ready.add(id);
        onChange();
      }, 0);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener(EVENT, handler);
      };
    },
    () => (ready.has(id) ? (read(id) ?? defaultOpen) : defaultOpen),
    () => defaultOpen,
  );
}

/**
 * Abschnitt mit Pfeil und Zähler. Der Zustand liegt unter `nexus-sections` in localStorage.
 * Der Zähler bleibt sichtbar, auch wenn der Abschnitt zu ist.
 */
export function CollapsibleSection({
  id, title, count, defaultOpen = false, children, testId, variant = 'list',
}: {
  id: string;
  title: string;
  count?: number;
  defaultOpen?: boolean;
  children: ReactNode;
  testId?: string;
  variant?: 'list' | 'nav';
}) {
  const open = useSectionOpen(id, defaultOpen);
  const nav = variant === 'nav';
  const ref = useRef<HTMLDetailsElement>(null);
  useJumpTarget(testId, id, ref);
  return (
    <details
      ref={ref}
      id={testId}
      className={nav ? 'nav-group' : 'fold list-group'}
      data-testid={testId}
      open={open}
      onToggle={(e) => {
        const next = e.currentTarget.open;
        if (next === open) return;
        write(id, next);
      }}
    >
      <summary className={nav ? 'nav-group-summary' : 'collapse-summary'}>
        <IconChevron className="collapse-chevron" />
        {nav ? <span className="nav-group-label">{title}</span> : <h2 className="collapse-title">{title}</h2>}
        {count !== undefined && <span className="collapse-count">{count}</span>}
      </summary>
      <div className={nav ? 'nav-group-body' : 'collapse-body'}>{children}</div>
    </details>
  );
}

/** Sprung per Link (`#testId`): Abschnitt öffnen und in den Blick holen. */
function useJumpTarget(anchor: string | undefined, id: string, ref: React.RefObject<HTMLDetailsElement | null>) {
  useEffect(() => {
    if (!anchor) return;
    const jump = () => {
      if (window.location.hash !== `#${anchor}`) return;
      write(id, true);
      requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    };
    jump();
    window.addEventListener('hashchange', jump);
    return () => window.removeEventListener('hashchange', jump);
  }, [anchor, id, ref]);
}
