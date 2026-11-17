import { NextResponse } from 'next/server';
import { realNow } from '@/domain/clock';
import { isFetchableMailbox } from '@/domain/connections';
import { requireSession } from '@/server/auth/session';
import { syncMailboxes } from '@/server/mail-sync';
import { getMailDeps, getRepos } from '@/server/registry';
import { loadState } from '@/server/state-service';

// Fluid Compute, gleiche Obergrenze wie der Mail-Cron.
export const maxDuration = 300;

/** „Jetzt abrufen“ für ein einzelnes Postfach. Höchstens einmal pro Minute und Postfach. */
export async function POST(req: Request) {
  if (!(await requireSession())) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 });
  let id = '';
  try {
    const body = await req.json() as { id?: unknown };
    id = typeof body.id === 'string' ? body.id : '';
  } catch {
    id = '';
  }
  if (!isFetchableMailbox(id)) return NextResponse.json({ error: 'Unbekanntes Postfach' }, { status: 400 });
  const repos = getRepos();
  const at = realNow();
  if (!(await repos.state.claimJobRun(`mail-manual:${id}:${at.toISOString().slice(0, 16)}`, at))) {
    return NextResponse.json({ error: 'Bitte kurz warten, dieses Postfach wurde gerade abgerufen.' }, { status: 429 });
  }
  try {
    const result = await syncMailboxes(repos, getMailDeps({ only: [id] }));
    const row = result.mailboxes.find((m) => m.id === id);
    const state = await loadState(repos, realNow());
    return NextResponse.json({
      state,
      id,
      added: row?.added ?? 0,
      outcome: row?.outcome ?? 'skipped',
      ...(row?.error ? { error: row.error } : {}),
    }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('Mail-Abruf fehlgeschlagen:', e instanceof Error ? e.name : typeof e);
    return NextResponse.json({ error: 'Abruf fehlgeschlagen' }, { status: 502 });
  }
}
