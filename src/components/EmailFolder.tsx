'use client';

import Link from 'next/link';

import { CollapsibleSection } from '@/components/CollapsibleSection';
import { useAppStore } from '@/data/store';
import { formatBerlin, now, todayBerlin } from '@/domain/clock';
import { buildInbox, initialsOf, type InboxRow } from '@/domain/inbox';

/** E-Mails bleiben gespeichert, nur nicht im WhatsApp-Tab. Zugeklappt, System noch einmal extra. */
export function EmailFolder() {
  const { state } = useAppStore();
  const at = now();
  const today = todayBerlin(at);
  const rows = buildInbox(state, at, state.settings.replyThresholdHours, 'email');
  if (rows.length === 0) return null;
  const people = rows.filter((r) => !r.system);
  const system = rows.filter((r) => r.system);
  const time = (iso: string) => {
    const d = new Date(iso);
    return todayBerlin(d) === today ? formatBerlin(d, 'HH:mm') : formatBerlin(d, 'dd.MM.');
  };

  return (
    <CollapsibleSection id="zulassung-email" title="E-Mail" count={rows.length} defaultOpen={false} testId="zulassung-email">
      {people.length === 0 ? <p className="empty-card">Keine persönlichen Mails.</p> : <MailList rows={people} time={time} />}
      {system.length > 0 && (
        <CollapsibleSection id="zulassung-email-system" title="System" count={system.length} defaultOpen={false} testId="zulassung-email-system">
          <MailList rows={system} time={time} />
        </CollapsibleSection>
      )}
    </CollapsibleSection>
  );
}

function MailList({ rows, time }: { rows: InboxRow[]; time: (iso: string) => string }) {
  return (
    <ul className="inbox-list" data-testid="email-list">
      {rows.map((r) => (
        <li key={r.threadId}>
          <Link href={`/nachrichten/${encodeURIComponent(r.threadId)}`} className="inbox-row" data-testid="email-row">
            <span className="inbox-avatar" aria-hidden="true">{initialsOf(r.name)}</span>
            <span className="inbox-main">
              <span className="inbox-top">
                <span className="inbox-name">{r.name}</span>
                <time className="inbox-time" dateTime={r.lastAt}>{time(r.lastAt)}</time>
              </span>
              {r.subject && <span className="inbox-subject">{r.subject}</span>}
              <span className="inbox-preview">{r.preview || '—'}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
