'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';

import { ActionSheet } from '@/components/ActionSheet';
import { IconChevron } from '@/components/Icons';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { Bubble, RichText, TimeStamp, placeMessages } from '@/components/Messages';
import { PageHeader } from '@/components/PageHeader';
import { useAI } from '@/data/ai-client';
import { useAppStore } from '@/data/store';
import { replyAction, replyActionId } from '@/domain/action-factory';
import { formatBerlin, now, todayBerlin } from '@/domain/clock';
import { contractsOfContact, membershipContractOf } from '@/domain/ledger/contracts';
import { senderLabel } from '@/domain/mail-text';
import { DOC_LABEL, classifyJobMessage, jobActivity } from '@/domain/matching/job-messages';
import { toE164 } from '@/domain/matching/messages';
import type { Action, AppState, Contact, Job, Message, MessageAttachment } from '@/domain/types';

const CHANNEL_LABEL: Record<Message['channel'], string> = { whatsapp: 'WhatsApp', email: 'E-Mail' };

function contactHref(s: AppState, c: Contact): string | null {
  if (c.company === 'zulassung') return `/zulassung/kunden/${c.id}`;
  const contract = membershipContractOf(s, c.id) ?? contractsOfContact(s, c.id)[0];
  return contract ? `/nexus/mitglieder/${contract.id}` : null;
}

function BackLink() {
  return (
    <Link href="/nachrichten" className="nav-button back-button">
      <IconChevron className="back-chevron" size={20} />
      <span>Nachrichten</span>
    </Link>
  );
}

function decodeThreadId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/** Erkannte Unterlagen bzw. Auftrag als kleine Marken unter einer eingehenden Blase. */
function MessageTags({ body, incoming }: { body: string; incoming: boolean }) {
  if (!incoming) return null;
  const { kind, docs } = classifyJobMessage(body);
  if (!kind) return null;
  return (
    <div className="imsg-tags" data-testid="message-tags">
      {docs.length === 0
        ? <span className="chip">{kind === 'auftrag' ? 'Auftrag' : 'Nachweis'}</span>
        : docs.map((d) => <span key={d} className="chip">{DOC_LABEL[d]}</span>)}
    </div>
  );
}

function AttachmentView({ file }: { file: MessageAttachment }) {
  const name = file.filename || (file.kind === 'image' ? 'Bild' : file.kind === 'document' ? 'Dokument' : 'Datei');
  if (file.kind === 'image') {
    return (
      <figure className="wa-media" data-testid="wa-media">
        <div className="wa-media-frame" aria-hidden="true">{name}</div>
        <figcaption>{file.caption || name}{file.mime ? ` · ${file.mime}` : ''}</figcaption>
      </figure>
    );
  }
  return <p className="wa-file" data-testid="wa-file">{name}{file.mime ? ` · ${file.mime}` : ''}{file.caption ? ` · ${file.caption}` : ''}</p>;
}

function jobOption(job: Job, state: AppState): string {
  const plate = job.vehicleId ? state.vehicles.find((v) => v.id === job.vehicleId)?.plate : undefined;
  const mark = job.draft ? 'Entwurf' : job.portalSource === 'nextoz' ? 'nextOZ' : job.portalSource === 'mydigitalcar' ? 'myDigitalCar' : '';
  return [job.service, plate, mark].filter(Boolean).join(' · ');
}

export default function ThreadPage() {
  const { threadId: rawId } = useParams<{ threadId: string }>();
  const threadId = decodeThreadId(rawId);
  const { state, dispatch, mode } = useAppStore();
  const ai = useAI();
  const at = now();
  const today = todayBerlin(at);

  const messages = state.messages.filter((m) => m.threadId === threadId).sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  const last = messages.at(-1);
  const lastIn = messages.filter((m) => m.direction === 'in').at(-1);
  const contactId = messages.find((m) => m.contactId)?.contactId ?? null;
  const contact = state.contacts.find((c) => c.id === contactId) ?? null;
  const threadSource = { messages, vehicles: state.vehicles, contacts: state.contacts };
  const jobs = state.jobs.filter((j) => jobActivity(j, threadSource).length > 0 || messages.some((m) => m.jobId === j.id));
  const linkedJobId = [...messages].reverse().find((m) => m.jobId)?.jobId ?? '';

  const actionId = lastIn ? replyActionId(lastIn.id) : null;
  const stored = state.actions.find((a) => a.id === actionId);
  const needsDraft = !!lastIn && last?.direction === 'in' && !stored;

  const [draft, setDraft] = useState<{ forId: string; text: string } | null>(null);
  const [later, setLater] = useState(false);
  const [assignContact, setAssignContact] = useState(contactId ?? '');
  const [assignJob, setAssignJob] = useState(linkedJobId);

  useEffect(() => {
    if (!needsDraft || !lastIn || draft?.forId === lastIn.id) return;
    let cancelled = false;
    ai.draftReply(threadId).then((text) => {
      if (!cancelled) setDraft({ forId: lastIn.id, text });
    }, () => {});
    return () => {
      cancelled = true;
    };
    // Nur neu entwerfen, wenn sich die eingehende Nachricht ändert.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsDraft, lastIn?.id]);

  if (!last) {
    return (
      <>
        <PageHeader title="Nachricht" trailing={<BackLink />} />
        <div className="empty-state">Diese Unterhaltung gibt es nicht.</div>
      </>
    );
  }

  const fromName = [...messages].reverse().find((m) => m.direction === 'in' && (m.fromName || m.profileName))?.fromName
    ?? [...messages].reverse().find((m) => m.profileName)?.profileName;
  const name = contact?.name ?? senderLabel(lastIn?.from ?? last.from, { fromName, profileName: fromName });
  const channel = (lastIn ?? last).channel;
  const rawPhone = channel === 'whatsapp' ? toE164(lastIn?.from ?? last.to) : '';
  const phone = /^\+\d{6,15}$/.test(rawPhone) ? rawPhone : null;

  let action: Action | null = stored ?? null;
  if (!action && lastIn && actionId && draft?.forId === lastIn.id) {
    action = replyAction({ lastIn, contact, threadId, text: draft.text, at, isDemo: mode === 'demo' });
  }

  const ensureStored = (a: Action) => {
    if (!stored) dispatch({ type: 'createAction', action: a });
  };
  const send = (a: Action) => {
    ensureStored(a);
    dispatch({ type: 'approveAction', id: a.id, version: a.version, via: 'app' });
  };
  const edit = (a: Action, text: string) => {
    ensureStored(a);
    dispatch({ type: 'editAction', id: a.id, payload: { ...a.payload, text } });
  };

  const time = (m: Message) => {
    const d = new Date(m.sentAt);
    return todayBerlin(d) === today ? `Heute ${formatBerlin(d, 'HH:mm')}` : formatBerlin(d, 'dd.MM. HH:mm');
  };
  const contactLink = contact && contactHref(state, contact);
  const jobChoices = [...state.jobs].sort((a, b) => Number(b.contactId === contact?.id) - Number(a.contactId === contact?.id) || a.service.localeCompare(b.service, 'de'));

  return (
    <>
      <PageHeader title={name} trailing={<BackLink />} subtitle={<>
        {CHANNEL_LABEL[channel]}
        {phone && <> · <a className="thread-phone" href={`tel:${phone}`} data-testid="thread-phone">{phone}</a></>}
        {phone && contact && fromName && fromName !== contact.name && <> · „{fromName}“</>}
      </>} />

      <ol className="imsg-list" data-testid="thread-messages">
        {placeMessages(messages, (m) => m.direction, (m) => m.sentAt).map((p) => (
          <Fragment key={p.item.id}>
            {p.stamp && <TimeStamp dateTime={p.item.sentAt}>{time(p.item)}</TimeStamp>}
            <li className="imsg-row" data-side={p.side} data-first={p.first}>
              <Bubble side={p.side} tail={p.tail}>
                <RichText text={p.item.body} />
                {p.item.attachments?.map((file, i) => <AttachmentView key={file.mediaId ?? file.filename ?? i} file={file} />)}
              </Bubble>
              <MessageTags body={p.item.body} incoming={p.item.direction === 'in'} />
            </li>
          </Fragment>
        ))}
      </ol>

      {(jobs.length > 0 || contactLink) && (
        <ListGroup>
          {jobs.map((job) => {
            const vehicle = job.vehicleId ? state.vehicles.find((v) => v.id === job.vehicleId) : undefined;
            return (
              <ListRow key={job.id} href={`/zulassung/auftraege/${job.id}`} testId={`thread-job-${job.id}`} title={`Auftrag: ${job.service}`}
                subtitle={[vehicle && `${vehicle.model} · ${vehicle.plate}`, job.portalStatus].filter(Boolean).join(' · ') || undefined} />
            );
          })}
          {contact && contactLink && <ListRow key="contact" href={contactLink} title={contact.name} subtitle="Kontakt ansehen" />}
        </ListGroup>
      )}

      <form className="wa-assign" data-testid="wa-assign" onSubmit={(e) => {
        e.preventDefault();
        dispatch({ type: 'assignThread', threadId, contactId: assignContact || null, jobId: assignJob || null });
      }}>
        <label className="field">Kontakt
          <select value={assignContact} data-testid="wa-contact" onChange={(e) => setAssignContact(e.target.value)}>
            <option value="">Nicht zugeordnet</option>
            {state.contacts.filter((c) => c.company === 'zulassung' || c.id === assignContact).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label className="field">Auftrag
          <select value={assignJob} data-testid="wa-job" onChange={(e) => setAssignJob(e.target.value)}>
            <option value="">Keiner</option>
            {jobChoices.map((j) => <option key={j.id} value={j.id}>{jobOption(j, state)}</option>)}
          </select>
        </label>
        <button type="submit" className="btn btn-secondary">Zuordnung speichern</button>
      </form>

      {lastIn && (stored || last.direction === 'in') && (
        later ? (
          <button type="button" className="btn btn-secondary btn-block" onClick={() => setLater(false)}>Antwortentwurf anzeigen</button>
        ) : action ? (
          <ActionSheet action={action} onSend={() => send(action)} onEdit={(text) => edit(action, text)} onLater={() => setLater(true)}
            onRetry={() => dispatch({ type: 'retryAction', id: action.id })} onCheck={() => dispatch({ type: 'checkAction', id: action.id })} />
        ) : (
          <div className="action-sheet action-sheet-loading" role="status">Entwurf wird vorbereitet …</div>
        )
      )}
    </>
  );
}
