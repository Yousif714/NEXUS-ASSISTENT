'use client';

import Link from 'next/link';
import { useState } from 'react';

import { CollapsibleSection } from '@/components/CollapsibleSection';
import { IconChat, IconMail } from '@/components/Icons';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { Segmented } from '@/components/Segmented';
import { useAppStore } from '@/data/store';
import { formatBerlin, now, todayBerlin } from '@/domain/clock';
import { buildInbox, filterInbox, initialsOf, type InboxFilter, type InboxRow } from '@/domain/inbox';
import { plainPreview } from '@/domain/mail-text';
import { DOC_LABEL, unlinkedOrderMessages } from '@/domain/matching/job-messages';

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'Alle' },
  { value: 'waiting', label: 'Wartet' },
  { value: 'orders', label: 'Aufträge' },
];

export default function InboxPage() {
  const { state } = useAppStore();
  const at = now();
  const today = todayBerlin(at);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [query, setQuery] = useState('');

  const rows = buildInbox(state, at, state.settings.replyThresholdHours);
  const shown = filterInbox(rows, filter, query);
  const people = shown.filter((r) => !r.system);
  const system = filter === 'all' ? shown.filter((r) => r.system) : [];
  const waiting = rows.filter((r) => !r.system && r.waitingHours !== null).length;
  const newOrders = unlinkedOrderMessages(state);
  const time = (iso: string) => {
    const d = new Date(iso);
    return todayBerlin(d) === today ? formatBerlin(d, 'HH:mm') : formatBerlin(d, 'dd.MM.');
  };

  return (
    <>
      <PageHeader title="Nachrichten" subtitle={waiting > 0 ? `${waiting} warten auf Antwort` : 'Alles beantwortet'} />

      {newOrders.length > 0 && (
        <ListGroup title="Neu aus WhatsApp – noch kein Auftrag" testId="inbox-new-orders" sectionId="inbox-new-orders" defaultOpen>
          {newOrders.map((e) => (
            <ListRow key={e.messageId} href={`/nachrichten/${encodeURIComponent(e.threadId)}`} testId={`new-order-${e.messageId}`}
              title={<span className="wrap-text">{plainPreview(e.body, 120)}</span>}
              subtitle={<span className="wrap-text">
                {e.kind === 'auftrag' ? 'Auftrag' : 'Nachweis'}{e.docs.length ? ` (${e.docs.map((d) => DOC_LABEL[d]).join(', ')})` : ''}
                {' · '}{e.senderName ?? 'Unbekannt'}{e.senderPhone ? ` · ${e.senderPhone}` : ''}
                {e.plates.length ? ` · ${e.plates.join(', ')}` : ''}
              </span>}
              value={time(e.sentAt)} />
          ))}
        </ListGroup>
      )}

      <div className="inbox-tools">
        <label className="field inbox-search">Suche
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, Nummer oder Kennzeichen"
            autoComplete="off" data-testid="inbox-search" />
        </label>
        <Segmented name="inbox-filter" legend="Filter" value={filter} options={FILTERS} onChange={setFilter} />
      </div>

      {people.length === 0 && system.length === 0 ? (
        <div className="empty-state">{rows.length === 0 ? 'Noch keine Nachrichten.' : 'Nichts passt zum Filter.'}</div>
      ) : people.length > 0 ? (
        <InboxCards rows={people} time={time} />
      ) : null}
      {system.length > 0 && (
        <CollapsibleSection id="inbox-system" title="System" count={system.length} defaultOpen={false} testId="inbox-system">
          <InboxCards rows={system} time={time} />
        </CollapsibleSection>
      )}
    </>
  );
}

function InboxCards({ rows, time }: { rows: InboxRow[]; time: (iso: string) => string }) {
  return (
    <ul className="inbox-list" data-testid="inbox-list">
      {rows.map((r) => (
        <li key={`${r.channel}|${r.threadId}`}>
          <Link href={`/nachrichten/${encodeURIComponent(r.threadId)}`} className="inbox-row" data-testid="inbox-row"
            data-waiting={r.waitingHours !== null && !r.system} data-overdue={r.overdue} data-system={r.system || undefined}>
            <span className="inbox-avatar" aria-hidden="true">{initialsOf(r.name)}</span>
            <span className="inbox-main">
              <span className="inbox-top">
                <span className="inbox-name">{r.name}</span>
                <time className="inbox-time" dateTime={r.lastAt}>{time(r.lastAt)}</time>
              </span>
              {r.subject && <span className="inbox-subject">{r.subject}</span>}
              <span className="inbox-preview">
                {r.lastDirection === 'out' && <span className="inbox-you">Du: </span>}{r.preview || '—'}
              </span>
              <span className="inbox-meta">
                <span className="inbox-channel" data-channel={r.channel} aria-label={r.channel === 'email' ? 'E-Mail' : 'WhatsApp'}>
                  {r.channel === 'email' ? <IconMail size={14} /> : <IconChat size={14} />}
                </span>
                {r.system && <span className="chip" data-testid="inbox-system-chip">System</span>}
                {r.phone && r.name !== r.phone && <span className="inbox-phone">{r.phone}</span>}
                {r.hasOrder && <span className="chip" data-kind="order">Auftrag</span>}
                {r.docs.map((d) => <span key={d} className="chip" data-kind="doc">{DOC_LABEL[d]}</span>)}
                {!r.system && r.waitingHours !== null && (
                  <span className="inbox-wait" data-testid="inbox-wait">wartet {r.waitingHours < 1 ? '< 1' : r.waitingHours} Std.</span>
                )}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
