'use client';

import { useState } from 'react';

import { BackLink } from '@/components/BackLink';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { Segmented } from '@/components/Segmented';
import { TrafficDot } from '@/components/TrafficDot';
import { memberRows } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { now, todayBerlin } from '@/domain/clock';
import { formatEuro } from '@/domain/money';

type Filter = 'all' | 'overdue';

/** Verträge der Mitglieder, nach Rückstand. Die NEXUS-Seite zeigt nur die kompakte Karte. */
export default function VertraegePage() {
  const { state } = useAppStore();
  const [filter, setFilter] = useState<Filter>('all');
  const today = todayBerlin(now());
  const rows = memberRows(state, today).sort((a, b) => b.arrearsCents - a.arrearsCents || a.name.localeCompare(b.name, 'de'));
  const shown = filter === 'overdue' ? rows.filter((r) => r.traffic !== 'green' && !r.onHold) : rows;

  return (
    <>
      <PageHeader title="Mitglieder" subtitle={`${rows.length} Verträge`} trailing={<BackLink href="/nexus" label="NEXUS" />} />

      <section className="list-group" aria-labelledby="members-title">
        <div className="list-group-headline">
          <h2 id="members-title" className="list-group-title">Mitglieder</h2>
          <Segmented name="member-filter" legend="Mitglieder filtern" value={filter} onChange={setFilter}
            options={[{ value: 'all', label: 'Alle' }, { value: 'overdue', label: 'Überfällig' }]} />
        </div>
        <ul className="list-group-body">
          {shown.length === 0 && <li><ListRow title="Niemand überfällig." /></li>}
          {shown.map((r) => (
            <li key={r.contractId}>
              <ListRow href={`/nexus/mitglieder/${r.contractId}`} testId={`member-row-${r.contractId}`}
                leading={r.notConnected ? undefined : <TrafficDot traffic={r.onHold ? 'grey' : r.traffic} />} title={r.name}
                subtitle={[
                  ...(r.kindLabel !== 'Mitgliedschaft' ? [r.kindLabel] : []),
                  r.billing === 'legacy' ? (r.notConnected ? 'Überweisung · Bank nicht verbunden' : 'Überweisung') : (r.notConnected ? 'Stripe · nicht verbunden' : 'Stripe'),
                  ...(r.onHold ? ['ruht'] : []),
                ].join(' · ')}
                value={!r.notConnected && r.arrearsCents > 0 ? <span className="amount arrears-value">{formatEuro(r.arrearsCents)}</span> : undefined} />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
