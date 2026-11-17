import 'server-only';

import type { ActionProvider } from '@/domain/actions/machine';
import { isFetchableMailbox } from '@/domain/connections';
import type { StoreEvent } from '@/domain/events';
import { mailWindowStart } from '@/domain/import/mail';
import type { ConnectionId } from '@/domain/types';
import type { Repos } from './db/repository';
import { asMailError, pullImap, type ImapSession } from './connectors/imap';
import { openImapFlow } from './connectors/imap-flow';
import { ConnectorError } from './connectors/types';
import type { ImapAccount } from './imap-config';
import { dispatchEvents } from './state-service';
import { sanitizeError } from './sync';

export type MailOutcome = 'ok' | 'partial' | 'error' | 'skipped';

export interface MailDeps {
  at: () => Date;
  now: () => number;
  /** Gemeinsames Budget aller Postfächer dieses Laufs, in Millisekunden. */
  budgetMs: number;
  provider: ActionProvider;
  accounts: ImapAccount[];
  /** Nur diese Verbindungs-IDs. Fehlt die Liste, laufen alle eingerichteten Postfächer. */
  only?: string[];
  configError?: string;
  openImap?: (account: ImapAccount) => Promise<ImapSession>;
}

export interface MailboxResult {
  id: string;
  outcome: MailOutcome;
  added: number;
  error?: string;
}

/** Ein Postfach darf den Lauf der anderen nicht aufbrauchen. */
const PER_MAILBOX_MS = 110_000;

export function mailSecrets(accounts: readonly { password?: string }[]): string[] {
  return accounts.map((a) => a.password).filter((p): p is string => !!p);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ConnectorError('IMAP: Zeitüberschreitung')), ms);
  });
  // Läuft der Abruf nach der Frist noch, darf seine Ablehnung nicht unbehandelt bleiben.
  void work.catch(() => {});
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Legt konfigurierte Postfächer im Verbindungsstand an, ohne eine Verbindung zu öffnen. */
export async function ensureConfiguredMailboxes(repos: Repos, accounts: readonly ImapAccount[], configError: string | undefined, at: Date, provider: ActionProvider): Promise<void> {
  const state = (await repos.state.load()).state;
  const events: StoreEvent[] = [];
  for (const a of accounts) {
    if (!isFetchableMailbox(a.id)) continue;
    const c = state.connections.find((x) => x.id === a.id);
    if (!c || c.label !== a.label || c.company !== a.company) {
      events.push({ type: 'ensureMailbox', id: a.id, label: a.label, company: a.company });
    }
  }
  const cfg = state.connections.find((c) => (c.id as string) === 'mail_config');
  if (configError) {
    if (!cfg || cfg.status !== 'error' || cfg.lastError !== configError || cfg.label !== 'IMAP-Konten') {
      events.push({ type: 'ensureMailbox', id: 'mail_config' as ConnectionId, label: 'IMAP-Konten', company: null, error: configError });
    }
  } else if (cfg && (cfg.status === 'error' || cfg.lastError)) {
    events.push({ type: 'ensureMailbox', id: 'mail_config' as ConnectionId, label: 'IMAP-Konten', company: null, error: null });
  }
  if (events.length === 0) return;
  await dispatchEvents(repos, events, { at: () => at, provider });
}

/**
 * Ruft jedes eingerichtete Postfach für sich ab. Ein Fehler oder eine Zeitüberschreitung
 * bleibt an diesem Postfach hängen und hält die übrigen nicht auf.
 */
export async function syncMailboxes(repos: Repos, deps: MailDeps): Promise<{ mailboxes: MailboxResult[]; added: number }> {
  try {
    await ensureConfiguredMailboxes(repos, deps.accounts, deps.configError, deps.at(), deps.provider);
  } catch (e) {
    console.error('Postfächer eintragen fehlgeschlagen:', e instanceof Error ? e.name : typeof e);
  }
  const secrets = mailSecrets(deps.accounts);
  const globalDeadline = deps.now() + deps.budgetMs;
  const mailboxes: MailboxResult[] = [];
  const wanted = deps.only;
  const accounts = deps.accounts.filter((a) => !wanted || wanted.includes(a.id));
  if (wanted) {
    for (const id of wanted) {
      if (!deps.accounts.some((a) => a.id === id)) {
        mailboxes.push({ id, outcome: 'skipped', added: 0, error: 'Postfach nicht eingerichtet' });
      }
    }
  }
  for (const account of accounts) {
    const hard = Math.min(globalDeadline, deps.now() + PER_MAILBOX_MS);
    if (deps.now() >= hard) {
      mailboxes.push({ id: account.id, outcome: 'partial', added: 0, error: 'IMAP: Zeitbudget aufgebraucht' });
      continue;
    }
    let session: ImapSession | undefined;
    try {
      const before = (await repos.state.load()).state;
      const conn = before.connections.find((c) => c.id === account.id);
      if (!conn) {
        mailboxes.push({ id: account.id, outcome: 'skipped', added: 0, error: 'Postfach nicht eingerichtet' });
        continue;
      }
      const known = new Set(before.messages.filter((m) => m.connectionId === account.id).map((m) => m.externalId));
      session = await (deps.openImap ?? openImapFlow)(account);
      const soft = hard - 5_000;
      const r = await withTimeout(
        pullImap(account.id, conn.sync?.cursor ?? null, session, { now: deps.now, deadline: soft, since: mailWindowStart(deps.at()), user: account.user }),
        Math.max(1_000, hard - deps.now()),
      );
      const previous = conn.sync?.cursor ?? null;
      // Nichts gelesen: kein Erfolg. Ein Fehler wird sichtbar, ein reines Zeitbudget lässt den Stand unverändert.
      if (r.batch.messages.length === 0 && r.cursor === previous) {
        if (r.warning) throw new ConnectorError(r.warning);
        mailboxes.push({ id: account.id, outcome: 'partial', added: 0 });
        continue;
      }
      if (r.warning && r.batch.messages.length === 0) throw new ConnectorError(r.warning);
      await dispatchEvents(repos, [{
        type: 'importBatch', connectionId: account.id, batch: r.batch, cursor: r.cursor, complete: r.complete,
        ...(r.warning ? { warning: sanitizeError(new ConnectorError(r.warning), secrets) } : {}),
      }], { at: deps.at, provider: deps.provider });
      const after = (await repos.state.load()).state.messages.filter((m) => m.connectionId === account.id);
      const added = after.filter((m) => !known.has(m.externalId)).length;
      mailboxes.push({ id: account.id, outcome: r.complete ? 'ok' : 'partial', added, ...(r.warning ? { error: sanitizeError(new ConnectorError(r.warning), secrets) } : {}) });
    } catch (err) {
      const error = sanitizeError(asMailError(err), secrets);
      mailboxes.push({ id: account.id, outcome: 'error', added: 0, error });
      try {
        await dispatchEvents(repos, [{ type: 'syncFailed', connectionId: account.id, error }], { at: deps.at, provider: deps.provider });
      } catch { /* Speichern des Fehlers scheitert: das nächste Postfach läuft weiter */ }
    } finally {
      await session?.close().catch(() => {});
    }
  }
  return { mailboxes, added: mailboxes.reduce((n, m) => n + m.added, 0) };
}
