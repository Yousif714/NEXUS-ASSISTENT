'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useMemo, useState } from 'react';

import { ActionSheet } from '@/components/ActionSheet';
import { IconChevron } from '@/components/Icons';
import { Bubble, RichText, TimeStamp, placeMessages } from '@/components/Messages';
import { PageHeader } from '@/components/PageHeader';
import { buildThreads, filterThreads, type WaFilter } from '@/components/wa-threads';
import { useAI } from '@/data/ai-client';
import { useAppStore } from '@/data/store';
import { replyAction, replyActionId } from '@/domain/action-factory';
import { formatBerlin, now, todayBerlin } from '@/domain/clock';
import { contractsOfContact, membershipContractOf } from '@/domain/ledger/contracts';
import type { Action, AppState, Contact, Job, Message, MessageAttachment } from '@/domain/types';

const FILTERS: { id: WaFilter; label: string }[] = [
  { id: 'all', label: 'Alle' },
  { id: 'unanswered', label: 'Unbeantwortet' },
  { id: 'job', label: 'Mit Auftrag' },
  { id: 'unassigned', label: 'Ohne Zuordnung' },
];

const KIND = { order: 'Auftrag', proof: 'Nachweis' } as const;

function contactHref(s: AppState, c: Contact): string | null {
  if (c.company === 'zulassung') return `/zulassung/kunden/${c.id}`;
  const contract = membershipContractOf(s, c.id) ?? contractsOfContact(s, c.id)[0];
  return contract ? `/nexus/mitglieder/${contract.id}` : null;
}

function AttachmentView({ file }: { file: MessageAttachment }) {
  const name = file.filename || (file.kind === 'image' ? 'Bild' : file.kind === 'document' ? 'Dokument' : 'Datei');
  const caption = file.caption;
  if (file.kind === 'image') {
    return (
      <figure className="wa-media" data-testid="wa-media">
        <div className="wa-media-frame" aria-hidden="true">{name}</div>
        <figcaption>{caption || name}{file.mime ? ` · ${file.mime}` : ''}</figcaption>
      </figure>
    );
  }
  const label = `${name}${file.mime ? ` · ${file.mime}` : ''}`;
  return (
    <p className="wa-file" data-testid="wa-file">
      {file.mediaId ? <span className="wa-file-link">{label}</span> : label}
      {caption ? <span className="wa-file-caption">{caption}</span> : null}
    </p>
  );
}

function timeOf(m: Message, today: string) {
  const d = new Date(m.sentAt);
  return todayBerlin(d) === today ? formatBerlin(d, 'HH:mm') : formatBerlin(d, 'dd.MM. HH:mm');
}

export function WhatsAppInbox({ threadId }: { threadId?: string }) {
  const router = useRouter();
  const { state, dispatch, mode } = useAppStore();
  const ai = useAI();
  const at = now();
  const today = todayBerlin(at);
  const [filter, setFilter] = useState<WaFilter>('all');
  const [query, setQuery] = useState('');

  const threads = useMemo(() => buildThreads(state.messages, state.contacts, threadId), [state.messages, state.contacts, threadId]);
  const shown = filterThreads(threads, filter, query);
  const active = threads.find((t) => t.threadId === threadId) ?? null;
  const messages = state.messages.filter((m) => m.threadId === threadId).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const last = messages.at(-1);
  const lastIn = [...messages].reverse().find((m) => m.direction === 'in');
  const contact = state.contacts.find((c) => c.id === (active?.contactId ?? '')) ?? null;
  const jobs = [...state.jobs].sort((a, b) => Number(b.contactId === contact?.id) - Number(a.contactId === contact?.id) || a.service.localeCompare(b.service, 'de'));
  const job = state.jobs.find((j) => j.id === active?.jobId);

  const actionId = lastIn ? replyActionId(lastIn.id) : null;
  const stored = state.actions.find((a) => a.id === actionId);
  const needsDraft = !!lastIn && last?.direction === 'in' && !stored && lastIn.channel === 'whatsapp';
  const [draft, setDraft] = useState<{ forId: string; text: string } | null>(null);
  const [later, setLater] = useState(false);

  useEffect(() => {
    if (!needsDraft || !lastIn || !threadId || draft?.forId === lastIn.id) return;
    let cancelled = false;
    ai.draftReply(threadId).then((text) => {
      if (!cancelled) setDraft({ forId: lastIn.id, text });
    }, () => {});
    return () => { cancelled = true; };
    // Entwurf nur neu holen, wenn sich die eingehende Nachricht ändert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsDraft, lastIn?.id, threadId]);

  let action: Action | null = stored ?? null;
  if (!action && lastIn && actionId && threadId && draft?.forId === lastIn.id) {
    action = replyAction({ lastIn, contact, threadId, text: draft.text, at, isDemo: mode === 'demo' });
  }
  const ensureStored = (a: Action) => { if (!stored) dispatch({ type: 'createAction', action: a }); };
  return (
    <div className="wa-app" data-thread={threadId ? 'open' : 'closed'} data-testid="wa-inbox">
      <section className="wa-list" aria-label="Unterhaltungen">
        <PageHeader title="WhatsApp" subtitle={`${threads.length} Unterhaltungen`} />
        <label className="field wa-search">Suche
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, Nummer oder Text" data-testid="wa-search" />
        </label>
        <div className="wa-filters" role="toolbar" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className="wa-chip" aria-pressed={filter === f.id} data-testid={`wa-filter-${f.id}`} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
        {shown.length === 0 && <p className="empty-card">Keine Unterhaltung für diese Auswahl.</p>}
        <ul className="wa-threads">
          {shown.map((t) => (
            <li key={t.threadId}>
              <Link href={`/nachrichten/${encodeURIComponent(t.threadId)}`} className="wa-thread-link" data-active={t.threadId === threadId || undefined} data-testid={`wa-thread-${t.threadId}`}>
                <span className="wa-thread-title">{t.title}</span>
                <span className="wa-thread-time">{timeOf({ sentAt: t.at } as Message, today)}</span>
                <span className="wa-thread-preview">{t.preview}</span>
                {t.unanswered > 0 && <span className="wa-badge" data-testid="wa-badge">{t.unanswered}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="wa-thread" aria-label="Verlauf">
        {!threadId || !last ? (
          <div className="empty-state">Unterhaltung wählen.</div>
        ) : (
          <>
            <header className="wa-thread-head">
              <button type="button" className="nav-button back-button wa-back" onClick={() => router.push('/nachrichten')}>
                <IconChevron className="back-chevron" size={20} />
                <span>Chats</span>
              </button>
              <div>
                <h1 className="wa-thread-name">{active?.title ?? 'WhatsApp'}</h1>
                <p className="wa-thread-sub">{active?.phone}{active?.intake ? ` · ${KIND[active.intake.kind]}` : ''}</p>
              </div>
            </header>
            <ol className="imsg-list wa-bubbles" data-testid="thread-messages">
              {placeMessages(messages, (m) => m.direction, (m) => m.sentAt).map((p) => (
                <Fragment key={p.item.id}>
                  {p.stamp && <TimeStamp dateTime={p.item.sentAt}>{timeOf(p.item, today)}</TimeStamp>}
                  <li className="imsg-row" data-side={p.side} data-first={p.first}>
                    <Bubble side={p.side} tail={p.tail}>
                      <RichText text={p.item.body} />
                      {p.item.attachments?.map((file, i) => <AttachmentView key={`${file.mediaId ?? file.filename ?? i}`} file={file} />)}
                    </Bubble>
                  </li>
                </Fragment>
              ))}
            </ol>
            <Assignment key={`${threadId}:${active?.contactId ?? ''}:${active?.jobId ?? ''}`}
              contacts={state.contacts} jobs={jobs} state={state}
              contactId={active?.contactId ?? ''} jobId={active?.jobId ?? ''}
              onSave={(nextContact, nextJob) => dispatch({ type: 'assignThread', threadId, contactId: nextContact, jobId: nextJob })} />
            {contact && contactHref(state, contact) && <p className="wa-assign-links"><Link href={contactHref(state, contact)!}>Kontakt öffnen</Link></p>}
            {job && <p className="wa-assign-links"><Link href={`/zulassung/auftraege/${job.id}`}>Auftrag öffnen</Link></p>}
            {lastIn && (stored || last.direction === 'in') && (
              later ? (
                <button type="button" className="btn btn-secondary btn-block" onClick={() => setLater(false)}>Antwortentwurf anzeigen</button>
              ) : action ? (
                <ActionSheet action={action} onSend={() => { ensureStored(action); dispatch({ type: 'approveAction', id: action.id, version: action.version, via: 'app' }); }}
                  onEdit={(text) => { ensureStored(action); dispatch({ type: 'editAction', id: action.id, payload: { ...action.payload, text } }); }}
                  onLater={() => setLater(true)}
                  onRetry={() => dispatch({ type: 'retryAction', id: action.id })}
                  onCheck={() => dispatch({ type: 'checkAction', id: action.id })} />
              ) : (
                <div className="action-sheet action-sheet-loading" role="status">Entwurf wird vorbereitet …</div>
              )
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Assignment({ contacts, jobs, state, contactId, jobId, onSave }: {
  contacts: Contact[];
  jobs: Job[];
  state: AppState;
  contactId: string;
  jobId: string;
  onSave: (contactId: string | null, jobId: string | null) => void;
}) {
  const [contact, setContact] = useState(contactId);
  const [job, setJob] = useState(jobId);
  return (
    <form className="wa-assign" data-testid="wa-assign" onSubmit={(e) => { e.preventDefault(); onSave(contact || null, job || null); }}>
      <label className="field">Kontakt
        <select value={contact} data-testid="wa-contact" onChange={(e) => setContact(e.target.value)}>
          <option value="">Nicht zugeordnet</option>
          {contacts.filter((c) => c.company === 'zulassung' || c.id === contact).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </label>
      <label className="field">Auftrag
        <select value={job} data-testid="wa-job" onChange={(e) => setJob(e.target.value)}>
          <option value="">Keiner</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{jobOption(j, state)}</option>)}
        </select>
      </label>
      <button type="submit" className="btn btn-secondary">Zuordnung speichern</button>
    </form>
  );
}

function jobOption(job: Job, state: AppState): string {
  const plate = state.vehicles.find((v) => v.id === job.vehicleId)?.plate;
  const mark = job.draft ? 'Entwurf' : job.portalSource === 'nextoz' ? 'nextOZ' : job.portalSource === 'mydigitalcar' ? 'myDigitalCar' : '';
  return [job.service, plate, mark].filter(Boolean).join(' · ');
}
