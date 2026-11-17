'use client';

import { useState } from 'react';

import { reloadTo } from '@/data/mode';
import { useAdoptState } from '@/data/store';
import type { AppState } from '@/domain/types';

/** Echtmodus: dieses eine Postfach jetzt abrufen und den neuen Stand übernehmen. */
export function FetchMailButton({ id }: { id: string }) {
  const adopt = useAdoptState();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async () => {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/sync/mail', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.status === 401) {
        reloadTo('/anmelden');
        return;
      }
      const body = await res.json().catch(() => ({})) as { state?: AppState; added?: number; error?: string };
      if (res.status === 429) setMsg('Bitte kurz warten');
      else if (!res.ok) setMsg(body.error ?? 'Abruf fehlgeschlagen');
      else {
        if (body.state) adopt(body.state);
        const added = body.added ?? 0;
        setMsg(body.error ? body.error : added > 0 ? `${added} neue Nachrichten` : 'Abgerufen, nichts Neues');
      }
    } catch {
      setMsg('Abruf fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="mail-fetch">
      <button type="button" className="btn btn-secondary btn-small" data-testid={`mail-fetch-${id}`} disabled={busy} onClick={run}>
        {busy ? 'Ruft ab …' : 'Jetzt abrufen'}
      </button>
      {msg ? <span role="status" className="mail-fetch-msg">{msg}</span> : null}
    </span>
  );
}
