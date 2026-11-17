import { NextResponse } from 'next/server';
import { requireSession } from '@/server/auth/session';
import { getRepos } from '@/server/registry';

/** Portalspalten eines Auftrags. Die Liste schickt sie nicht mit. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await requireSession())) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 });
  const { id } = await ctx.params;
  if (!id || id.length > 80) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
  const job = (await getRepos().state.load()).state.jobs.find((j) => j.id === id);
  if (!job) return NextResponse.json({ error: 'Nicht gefunden' }, { status: 404 });
  return NextResponse.json({ portalData: job.portalData ?? null }, { headers: { 'cache-control': 'no-store' } });
}
