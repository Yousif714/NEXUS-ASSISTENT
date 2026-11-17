import { NextResponse, connection } from 'next/server';
import { realNow } from '@/domain/clock';
import { WHATSAPP_KUNDEN, parseWhatsAppWebhook } from '@/domain/import/whatsapp';
import { verifyWhatsAppSignature, verifyWhatsAppToken } from '@/server/connectors/whatsapp-signature';
import { readEnv } from '@/server/env';
import { getActionProvider, getRepos } from '@/server/registry';
import { dispatchEvents } from '@/server/state-service';

// Historien-Stücke können groß sein; das Sync-Budget von Stripe liegt darunter.
export const maxDuration = 60;

const MAX_BODY = 8_000_000;

// Keine Sitzung: Meta ruft ohne Login auf. Die Echtheit sichert die Signatur bzw. der Verify-Token.
// Dieser Endpunkt speichert nur. Es gibt keinen Versand.

export async function GET(req: Request) {
  await connection();
  const token = readEnv().whatsappVerifyToken;
  if (!token) return NextResponse.json({ error: 'Nicht eingerichtet' }, { status: 503 });
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const given = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && challenge && verifyWhatsAppToken(given, token)) {
    return new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  return NextResponse.json({ error: 'Verifizierung abgelehnt' }, { status: 403 });
}

export async function POST(req: Request) {
  await connection();
  const env = readEnv();
  if (!env.whatsappAppSecret) return NextResponse.json({ error: 'Nicht eingerichtet' }, { status: 503 });
  if (Number(req.headers.get('content-length')) > MAX_BODY) return NextResponse.json({ error: 'Zu groß' }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: 'Zu groß' }, { status: 413 });
  const sig = verifyWhatsAppSignature(raw, req.headers.get('x-hub-signature-256'), env.whatsappAppSecret);
  if (!sig.ok) return NextResponse.json({ error: 'Signatur ungültig' }, { status: 401 });
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'JSON ungültig' }, { status: 400 });
  }
  const parsed = parseWhatsAppWebhook(payload, { phoneNumberId: env.whatsappPhoneNumberId, wabaId: env.whatsappWabaId });
  if (!parsed.relevant) return NextResponse.json({ received: true, ignored: true });
  const repos = getRepos();
  try {
    const prev = (await repos.state.load()).state.connections.find((c) => c.id === WHATSAPP_KUNDEN);
    await dispatchEvents(repos, [{
      type: 'importBatch',
      connectionId: WHATSAPP_KUNDEN,
      batch: parsed.batch,
      cursor: parsed.cursor ?? prev?.sync?.cursor ?? null,
      complete: parsed.historySeen ? parsed.complete : (prev?.sync?.complete ?? true),
    }], { at: realNow, provider: getActionProvider() });
  } catch (e) {
    console.error('WhatsApp-Webhook: Speichern fehlgeschlagen:', e instanceof Error ? e.name : typeof e);
    return NextResponse.json({ error: 'Speichern fehlgeschlagen' }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
