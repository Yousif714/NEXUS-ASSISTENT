'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';

import { BackLink } from '@/components/BackLink';
import { ListGroup } from '@/components/ListGroup';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { filterPortalJobs, jobPortalBadge, portalJobSubtitle, PortalSourceFilter, PortalStatusFilter } from '@/components/PortalImport';
import { CONTACT_KIND_LABEL, INVOICE_STATUS_LABEL, JOB_STATUS_LABEL } from '@/components/zulassung-labels';
import { customerInvoiceRows, customerPayments } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { showMessage } from '@/domain/features';
import { formatBerlin, formatIsoDe } from '@/domain/clock';
import { formatAddress } from '@/domain/import/mydigitalcar';
import { formatEuro } from '@/domain/money';
import type { Message } from '@/domain/types';

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const { state } = useAppStore();
  const [portal, setPortal] = useState('all');
  const [portalStatus, setPortalStatus] = useState('all');
  const back = <BackLink href="/zulassung" label="Zulassungsdienst" />;
  const contact = state.contacts.find((c) => c.id === id && c.company === 'zulassung');

  if (!contact) {
    return (
      <>
        <PageHeader title="Kunde" trailing={back} />
        <div className="empty-state">Diesen Kunden gibt es nicht.</div>
      </>
    );
  }

  const vehicles = state.vehicles.filter((v) => v.contactId === id);
  const jobs = filterPortalJobs(state.jobs.filter((j) => j.contactId === id), portal, portalStatus);
  const address = formatAddress(contact.address);
  const invoices = customerInvoiceRows(state, id);
  const payments = customerPayments(state, id);
  // Je Unterhaltung die jüngste Nachricht, neueste Unterhaltung zuerst.
  const latestByThread = new Map<string, Message>();
  for (const m of state.messages.filter((x) => x.contactId === id && showMessage(x))) {
    const prev = latestByThread.get(m.threadId);
    if (!prev || m.sentAt > prev.sentAt) latestByThread.set(m.threadId, m);
  }
  const threads = [...latestByThread.values()].sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  return (
    <>
      <PageHeader title={contact.name} subtitle={[CONTACT_KIND_LABEL[contact.kind], address, ...contact.phones, ...contact.emails].filter(Boolean).join(' · ')} trailing={back} />

      <ListGroup title="Fahrzeuge" testId="vehicles">
        {vehicles.length === 0
          ? <ListRow key="none" title="Keine Fahrzeuge." />
          : vehicles.map((v) => <ListRow key={v.id} title={v.plate.trim() || (v.vin.trim() ? `FIN ${v.vin}` : 'ohne Kennzeichen')} subtitle={[`${v.model} · FIN ${v.vin || '–'}`, v.hsn || v.tsn ? `HSN/TSN ${v.hsn ?? '–'}/${v.tsn ?? '–'}` : ''].filter(Boolean).join(' · ')} />)}
      </ListGroup>

      <section className="list-group" aria-label="Portalfilter">
        <h2 className="list-group-title">Portale</h2>
        <div className="note-card sim-form">
          <PortalSourceFilter value={portal} onChange={setPortal} />
          <PortalStatusFilter value={portalStatus} onChange={setPortalStatus}
            statuses={[...new Set(state.jobs.filter((j) => j.contactId === id).map((j) => j.portalStatus).filter((s): s is string => !!s))]} />
        </div>
      </section>

      <ListGroup title="Aufträge" testId="customer-jobs">
        {jobs.length === 0
          ? <ListRow key="none" title="Keine Aufträge." />
          : jobs.map((j) => {
            const v = state.vehicles.find((x) => x.id === j.vehicleId);
            const amount = j.portalData && j.priceCents === 0 ? '–' : formatEuro(j.priceCents);
            return (
              <ListRow key={j.id} href={`/zulassung/auftraege/${j.id}`} testId={`job-row-${j.id}`}
                title={<>{j.service} {jobPortalBadge(j)}</>}
                subtitle={`${v?.plate.trim() ? `${v.plate} · ` : ''}${portalJobSubtitle(JOB_STATUS_LABEL[j.status], j)}`}
                value={<span className="amount">{amount}</span>} />
            );
          })}
      </ListGroup>

      <ListGroup title="Offene Rechnungen" testId="customer-invoices">
        {invoices.length === 0
          ? <ListRow key="none" title="Keine offenen Rechnungen." />
          : invoices.map(({ invoice: i, openCents, paidCents }) => (
            <ListRow key={i.id} testId={`invoice-${i.id}`} title={i.number}
              subtitle={<><span className={i.status === 'overdue' ? 'arrears-value' : undefined}>{INVOICE_STATUS_LABEL[i.status]}</span> · fällig {formatIsoDe(i.dueDate)}{paidCents > 0 ? ` · ${formatEuro(paidCents)} von ${formatEuro(i.totalCents)} bezahlt` : ''}</>}
              value={<span className="amount">{formatEuro(openCents)}</span>} />
          ))}
      </ListGroup>

      <ListGroup title="Zahlungen" testId="customer-payments">
        {payments.length === 0
          ? <ListRow key="none" title="Keine Zahlungen." />
          : payments.map((p) => (
            <ListRow key={p.key} testId={`payment-row-${p.key}`} title={p.invoiceNumber}
              subtitle={`${formatIsoDe(p.bookedOn)}${p.paidInLexware ? ' · in Lexware schon bezahlt' : ''}${p.isReturn ? ' · Rückbuchung' : ''}`}
              value={<span className="amount">{formatEuro(p.amountCents)}</span>} />
          ))}
      </ListGroup>

      <ListGroup title="Letzte Nachrichten" testId="customer-messages">
        {threads.length === 0
          ? <ListRow key="none" title="Keine Nachrichten." />
          : threads.map((m) => (
            <ListRow key={m.threadId} href={`/nachrichten/${m.threadId}`} testId={`message-row-${m.threadId}`} title={m.body}
              subtitle={`${m.direction === 'in' ? contact.name : 'Du'} · ${formatBerlin(new Date(m.sentAt), 'dd.MM. HH:mm')}`} />
          ))}
      </ListGroup>
    </>
  );
}
