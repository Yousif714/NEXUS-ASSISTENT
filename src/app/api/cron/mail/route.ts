import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse, connection } from 'next/server';
import { realNow } from '@/domain/clock';
import { readEnv } from '@/server/env';
import { syncMailboxes } from '@/server/mail-sync';
import { getMailDeps, getRepos } from '@/server/registry';
import { requestWhatsAppHistoryOnce } from '@/server/whatsapp-history';

// Fluid Compute: der Abruf darf länger brauchen als der übrige Takt (dort 60 s).
export const maxDuration = 300;

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Eigener Abruf der Postfächer. Der allgemeine Tick ruft hier nicht mehr an. */
export async function GET(req: Request) {
  await connection();
  const expected = digest(`Bearer ${readEnv().cronSecret}`);
  if (!timingSafeEqual(digest(req.headers.get('authorization') ?? ''), expected)) {
    return NextResponse.json({ error: 'Nicht erlaubt' }, { status: 401 });
  }
  const repos = getRepos();
  const at = realNow();
  // Ein Lauf je fünf Minuten. Überlappt der vorige noch, speichert dieser nichts doppelt.
  const bucket = Math.floor(at.getTime() / 300_000);
  if (!(await repos.state.claimJobRun(`mail-cron:${bucket}`, at))) {
    return NextResponse.json({ skipped: true }, { headers: { 'cache-control': 'no-store' } });
  }
  try {
    // Vor dem Postfach: ein kurzer Aufruf, der ausgehende WhatsApp-Nachrichten vom Handy nachzieht. Sendet nichts an Kunden.
    try { await requestWhatsAppHistoryOnce(repos, readEnv(), at); } catch (e) {
      console.error('WhatsApp-Historie:', e instanceof Error ? e.name : typeof e);
    }
    const result = await syncMailboxes(repos, getMailDeps());
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    console.error('Mail-Abruf fehlgeschlagen:', e instanceof Error ? e.name : typeof e);
    return NextResponse.json({ error: 'Abruf fehlgeschlagen', mailboxes: [], added: 0 }, { headers: { 'cache-control': 'no-store' } });
  }
}
