import { NextResponse } from 'next/server';
import { slimForClient } from '@/domain/client-view';
import { realNow } from '@/domain/clock';
import { requireSession } from '@/server/auth/session';
import { getRepos } from '@/server/registry';
import { loadState } from '@/server/state-service';
import { visibleState } from '@/domain/features';

export async function GET() {
  // Erst die Sitzung (Cookies): das macht die Route dynamisch.
  // Postfächer legt der Mail-Abruf an. Hier nicht noch einmal den ganzen Bestand lesen.
  if (!(await requireSession())) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 });
  const state = slimForClient(await loadState(getRepos(), realNow()));
  return NextResponse.json({ state: visibleState(state) }, { headers: { 'cache-control': 'no-store' } });
}
