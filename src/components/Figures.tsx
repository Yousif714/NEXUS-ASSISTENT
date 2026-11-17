'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { formatEuro } from '@/domain/money';

import { CountUp } from './CountUp';

/** Kennzahlen-Raster (Wallet-Stil) mit Abschnittsüberschrift. */
export function Figures({ title, children, columns }: { title?: string; children: ReactNode; columns?: 4 }) {
  return (
    <section className="list-group" aria-label={title ? undefined : 'Kennzahlen'}>
      {title && <h2 className="list-group-title">{title}</h2>}
      <dl className="figures" data-columns={columns}>{children}</dl>
    </section>
  );
}

/** Eine Kennzahl: Bezeichnung und Betrag (`testId` am Betrag). `arrears`: rot, wenn > 0, sonst neutral. */
export function Figure({ label, cents, testId, strong, arrears, href }: { label: string; cents: number; testId: string; strong?: boolean; arrears?: boolean; href?: string }) {
  return (
    <div className="figure" data-strong={strong} data-tone={arrears ? (cents > 0 ? 'alert' : 'neutral') : undefined}>
      <dt>{label}</dt>
      <dd className="amount" data-testid={testId}><TileValue href={href} label={label}><CountUp value={cents} format={formatEuro} /></TileValue></dd>
    </div>
  );
}

/** Wert einer Kachel; mit `href` wird die ganze Kachel zum Link (siehe `.tile-link` in theme.css). */
function TileValue({ href, label, children }: { href?: string; label: string; children: ReactNode }) {
  if (!href) return <>{children}</>;
  // Sprung innerhalb der Seite: normaler Link, damit „hashchange“ den Abschnitt öffnet.
  if (href.startsWith('#')) return <a href={href} className="tile-link" aria-label={`${label} öffnen`}>{children}</a>;
  return <Link href={href} className="tile-link" aria-label={`${label} öffnen`}>{children}</Link>;
}

/** Eine Kennzahl als Anzahl (oder Platzhalter wie „–“, wenn der Datenstand kein Urteil erlaubt). */
export function CountFigure({ label, value, testId, alert, href }: { label: string; value: number | string; testId: string; alert?: boolean; href?: string }) {
  return (
    <div className="figure" data-tone={alert === undefined ? undefined : alert ? 'alert' : 'neutral'}>
      <dt>{label}</dt>
      <dd data-testid={testId}><TileValue href={href} label={label}>{typeof value === 'number' ? <CountUp value={value} format={String} duration={500} /> : value}</TileValue></dd>
    </div>
  );
}
