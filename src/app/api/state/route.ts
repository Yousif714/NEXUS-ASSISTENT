import { NextResponse } from 'next/server';
import { realNow } from '@/domain/clock';
import { requireSession } from '@/server/auth/session';
import { readEnv } from '@/server/env';
import { ensureConfiguredMailboxes } from '@/server/mail-sync';
import { getActionProvider, getRepos } from '@/server/registry';
import { loadState } from '@/server/state-service';

export async function GET() {
  // Erst die Sitzung (Cookies): das macht die Route dynamisch.
  if (!(await requireSession())) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 });
  const repos = getRepos();
  const env = readEnv();
  try {
    await ensureConfiguredMailboxes(repos, env.imapAccounts, env.imapConfigError, realNow(), getActionProvider());
  } catch (e) {
    console.error('Postfächer eintragen fehlgeschlagen:', e instanceof Error ? e.name : typeof e);
  }
  const state = await loadState(repos, realNow());
  return NextResponse.json({ state }, { headers: { 'cache-control': 'no-store' } });
}
