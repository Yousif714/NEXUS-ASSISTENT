'use client';

import { useState } from 'react';

import { BackLink } from '@/components/BackLink';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { CONTACT_KIND_LABEL } from '@/components/zulassung-labels';
import { matchesCustomer, zulassungCustomers } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { now, todayBerlin } from '@/domain/clock';
import { formatEuro } from '@/domain/money';

export default function KundenPage() {
  const { state } = useAppStore();
  const customers = zulassungCustomers(state, todayBerlin(now()));
  const [query, setQuery] = useState('');
  const shown = customers.filter((c) => matchesCustomer(c, query, CONTACT_KIND_LABEL[c.kind]));
  const open = customers.reduce((n, c) => n + c.openCents, 0);

  return (
    <>
      <PageHeader title="Kunden" subtitle={customers.length === 0 ? undefined : `${customers.length} Kunden · offen ${formatEuro(open)}`}
        trailing={<BackLink href="/zulassung" label="Zulassung" />} />

      {customers.length > 0 && (
        <label className="field customer-search">Suche
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name oder Kennzeichen"
            autoComplete="off" data-testid="customer-search" />
        </label>
      )}

      {customers.length === 0 && <div className="empty-state">Keine Kunden.</div>}
      {customers.length > 0 && shown.length === 0 && <div className="empty-state">Kein Kunde passt zur Suche.</div>}
      {shown.length > 0 && (
        <ListGroup title="Kunden" testId="customer-list">
          {shown.map((c) => (
            <ListRow key={c.id} href={`/zulassung/kunden/${c.id}`} testId={`customer-row-${c.id}`} title={c.name}
              subtitle={<span className="wrap-text">{[
                CONTACT_KIND_LABEL[c.kind],
                c.jobs === 1 ? '1 Auftrag' : `${c.jobs} Aufträge`,
                c.overdueCents > 0 ? `überfällig ${formatEuro(c.overdueCents)}` : null,
              ].filter(Boolean).join(' · ')}</span>}
              value={c.openCents > 0 ? <span className="amount">{formatEuro(c.openCents)}</span> : undefined} />
          ))}
        </ListGroup>
      )}
    </>
  );
}
