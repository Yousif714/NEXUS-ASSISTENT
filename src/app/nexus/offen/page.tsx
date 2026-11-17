'use client';

import { BackLink } from '@/components/BackLink';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { TrafficDot } from '@/components/TrafficDot';
import { useAppStore } from '@/data/store';
import { MONEY_SOURCES } from '@/domain/briefing';
import { formatIsoDe, now, todayBerlin } from '@/domain/clock';
import { notConnected } from '@/domain/connections';
import { areaUnreliable } from '@/domain/freshness';
import { nexusReceivables } from '@/domain/ledger/receivables';
import { formatEuro } from '@/domain/money';
import { runsViaStripe } from '@/domain/takeover/status';

export default function OffenPage() {
  const { state } = useAppStore();
  const at = now();
  const { items, totalCents, overdueCents } = nexusReceivables(state, todayBerlin(at));
  const blocking = areaUnreliable([...MONEY_SOURCES.nexus, 'lexware_nexus'], state.connections, at);
  const missingOnly = blocking.length > 0 && notConnected(blocking, state.connections);

  return (
    <>
      <PageHeader title="Offen" subtitle="Alle offenen Forderungen" trailing={<BackLink href="/nexus" label="NEXUS" />} />

      {blocking.length > 0 ? (
        <p className="note-card" data-testid="stale-note">{missingOnly ? 'Nicht verbunden, um das zu beurteilen.' : 'Datenstand zu alt, um das zu beurteilen.'}</p>
      ) : (
        <>
          <ListGroup title="Summe">
            <ListRow testId="receivables-total" title="Summe offen" value={<span className="amount">{formatEuro(totalCents)}</span>}
              subtitle={<>davon überfällig <span className="amount">{formatEuro(overdueCents)}</span></>} />
          </ListGroup>

          <ListGroup title="Forderungen">
            {items.length === 0 && <ListRow title="Nichts offen." />}
            {items.map((r) => (
              <ListRow key={r.key} testId={`receivable-${r.key}`} href={r.kind === 'contract' ? `/nexus/mitglieder/${r.id}` : undefined}
                leading={<TrafficDot traffic={r.traffic} />} title={<>{r.name}{r.kind === 'contract' && runsViaStripe(state, r.id) && <> <span className="chip">läuft über Stripe</span></>}</>}
                subtitle={`${r.source} · ${r.label} · ${r.daysOverdue > 0 ? `fällig seit ${formatIsoDe(r.dueDate)}` : `fällig am ${formatIsoDe(r.dueDate)}`}`}
                value={<span className="amount">{formatEuro(r.amountCents)}</span>} />
            ))}
          </ListGroup>
        </>
      )}
    </>
  );
}
