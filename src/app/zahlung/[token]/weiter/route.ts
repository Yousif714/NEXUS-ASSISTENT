import { realNow } from '@/domain/clock';
import { readEnv } from '@/server/env';
import { allowRequest, clientKey, hashKey } from '@/server/rate-limit';
import { getRepos, getStripeWriter } from '@/server/registry';
import { createCheckoutForToken } from '@/server/takeover';

const TOO_MANY = 'Zu viele Aufrufe, bitte kurz warten.';
const NO_STORE = { 'cache-control': 'no-store' };

/** Nur POST: Link-Vorschauen (GET) legen so nie eine Checkout-Sitzung an. */
export async function GET() {
  return new Response('Nicht erlaubt', { status: 405, headers: { allow: 'POST', ...NO_STORE } });
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const env = readEnv();
  const repos = getRepos();
  const at = realNow();
  const ok = (await allowRequest(repos.state, `weiter-ip:${clientKey(req, env.sessionSecret)}`, 10, at))
    && (await allowRequest(repos.state, `weiter-tok:${hashKey(token, env.sessionSecret)}`, 5, at));
  if (!ok) return new Response(TOO_MANY, { status: 429, headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE } });
  const page = `/zahlung/${encodeURIComponent(token)}`;
  let r: Awaited<ReturnType<typeof createCheckoutForToken>>;
  try {
    r = await createCheckoutForToken(repos, getStripeWriter(), token, env.paymentLinkBaseUrl);
  } catch (err) {
    // Fehlertexte der Konnektoren sind schon ohne Schlüssel; nie den Token loggen.
    console.error('zahlung/weiter: Checkout konnte nicht angelegt werden:', err instanceof Error ? err.message : 'unbekannt');
    return new Response(null, { status: 303, headers: { location: `${page}?fehler=1`, ...NO_STORE } });
  }
  const location = r.kind === 'redirect' ? r.url : page;
  return new Response(null, { status: 303, headers: { location, ...NO_STORE } });
}
