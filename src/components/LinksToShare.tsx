'use client';

import { useState } from 'react';

import type { LinkToShare } from '@/data/selectors';
import { formatIsoDe } from '@/domain/clock';
import { shareText } from '@/domain/takeover/texts';
import { whatsappUrl } from '@/domain/takeover/whatsapp';

import { absoluteLink, useOrigin } from './TakeoverCard';
import { ListGroup } from './ListGroup';

function LinkCard({ item, origin, onShared }: { item: LinkToShare; origin: string; onShared: (shared: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const text = shareText({ name: item.name, link: absoluteLink(item.link, origin), rates: item.rates });
  const wa = item.phone ? whatsappUrl(item.phone, text) : null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="share-card" data-testid={`share-card-${item.contractId}`}>
      <div className="share-card-head">
        <span className="share-card-name">{item.name}</span>
        {item.sharedOn && <span className="share-card-date">{`gesendet ${formatIsoDe(item.sharedOn)}`}</span>}
      </div>
      <textarea className="action-sheet-editor" readOnly rows={6} aria-label={`Nachricht an ${item.name}`} value={text} />
      <div className="member-actions">
        {wa && <a className="btn btn-primary" href={wa} target="_blank" rel="noopener noreferrer">In WhatsApp öffnen</a>}
        <button type="button" className={wa ? 'btn btn-secondary' : 'btn btn-primary'} onClick={copy}>Kopieren</button>
        {item.sharedAt
          ? <button type="button" className="btn btn-plain" onClick={() => onShared(false)}>Doch nicht gesendet</button>
          : <button type="button" className="btn btn-secondary" onClick={() => onShared(true)}>Als gesendet markieren</button>}
      </div>
      <div role="status" className="confirm-line">{copied ? 'Kopiert' : ''}</div>
      {!wa && !item.sharedAt && <p className="confirm-line">{item.phone ? 'Telefonnummer nicht lesbar, bitte Text kopieren.' : 'Keine Telefonnummer hinterlegt, bitte Text kopieren.'}</p>}
    </div>
  );
}

/** Sammelseite „Links zum Verschicken“: bereite Stripe-Links mit Text, WhatsApp-Knopf und Markierung „gesendet“. */
export function LinksToShare({ open, sent, onShared }: { open: LinkToShare[]; sent: LinkToShare[]; onShared: (takeoverId: string, shared: boolean) => void }) {
  const origin = useOrigin();
  if (open.length === 0 && sent.length === 0) return null;
  return (
    <div id="links" className="share-links" data-testid="links">
      <ListGroup title={`Links zum Verschicken (${open.length} offen)`} testId="links-open">
        {open.length === 0
          ? <p key="none" className="share-card-empty">Alle Links sind gesendet.</p>
          : open.map((i) => <LinkCard key={i.takeoverId} item={i} origin={origin} onShared={(v) => onShared(i.takeoverId, v)} />)}
      </ListGroup>
      {sent.length > 0 && (
        <details className="conn-help share-sent" data-testid="links-sent">
          <summary>{`Schon gesendet (${sent.length})`}</summary>
          <ListGroup>
            {sent.map((i) => <LinkCard key={i.takeoverId} item={i} origin={origin} onShared={(v) => onShared(i.takeoverId, v)} />)}
          </ListGroup>
        </details>
      )}
    </div>
  );
}
