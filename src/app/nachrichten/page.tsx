'use client';

import './inbox.css';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { useAppStore } from '@/data/store';
import { formatBerlin, now, todayBerlin } from '@/domain/clock';
import { buildInbox, filterInbox, initialsOf, type InboxFilter, type InboxRow } from '@/domain/inbox';

const FILTERS: { id: InboxFilter; label: string }[] = [
  { id: 'all', label: 'Alle' },
  { id: 'waiting', label: 'Wartet' },
  { id: 'orders', label: 'Aufträge' },
];

/** Nur WhatsApp: eine Zeile je Chat. E-Mails liegen beim Zulassungsdienst. */
export default function InboxPage() {
  const { state } = useAppStore();
  const at = now();
  const today = todayBerlin(at);
  const [filter, setFilter] = useState<InboxFilter>('all');
  // Direkter Einstieg aus einer Kachel, z. B. /nachrichten?filter=waiting
  useEffect(() => {
    const f = new URLSearchParams(window.location.search).get('filter');
    // Einmalig nach dem Laden: die Adresse ist erst im Browser bekannt (kein Abgleich beim Vorrendern).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (f === 'waiting' || f === 'orders') setFilter(f);
  }, []);
  const [query, setQuery] = useState('');

  const rows = buildInbox(state, at, state.settings.replyThresholdHours, 'whatsapp');
  const shown = filterInbox(rows, filter, query);
  const waiting = rows.filter((r) => r.waitingHours !== null).length;
  const time = (iso: string) => {
    const d = new Date(iso);
    return todayBerlin(d) === today ? formatBerlin(d, 'HH:mm') : formatBerlin(d, 'dd.MM.');
  };

  return (
    <>
      <PageHeader title="WhatsApp" subtitle={waiting > 0 ? `${waiting} warten auf Antwort` : 'Alles beantwortet'} />

      <div className="inbox-tools">
        <label className="field inbox-search">Suche
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, Nummer oder Kennzeichen"
            autoComplete="off" data-testid="inbox-search" />
        </label>
        <div className="wa-filters" role="toolbar" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="wa-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="empty-state">{rows.length === 0 ? 'Noch keine WhatsApp-Nachrichten.' : 'Nichts passt zum Filter.'}</div>
      ) : (
        <ul className="inbox-list" data-testid="inbox-list">
          {shown.map((r) => <ChatRow key={r.threadId} row={r} time={time(r.lastAt)} />)}
        </ul>
      )}
    </>
  );
}

function ChatRow({ row, time }: { row: InboxRow; time: string }) {
  return (
    <li>
      <Link href={`/nachrichten/${encodeURIComponent(row.threadId)}`} className="inbox-row" data-testid="inbox-row"
        data-waiting={row.unread > 0} data-overdue={row.overdue}>
        <span className="inbox-avatar" aria-hidden="true">{initialsOf(row.name)}</span>
        <span className="inbox-main">
          <span className="inbox-top">
            <span className="inbox-name">{row.name}</span>
            <time className="inbox-time" dateTime={row.lastAt}>{time}</time>
          </span>
          <span className="inbox-line">
            <span className="inbox-preview">
              {row.lastDirection === 'out' && <span className="inbox-you">Du: </span>}{row.preview || '—'}
            </span>
            {row.unread > 0 && <span className="inbox-badge" data-testid="inbox-wait">{row.unread}</span>}
          </span>
        </span>
      </Link>
    </li>
  );
}
