import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

export type WhatsAppSignatureResult = { ok: true } | { ok: false; reason: 'missing' | 'format' | 'signature' };

/** HMAC-SHA256 über den Rohkörper, Header `X-Hub-Signature-256: sha256=<hex>`. Vergleich in konstanter Zeit. */
export function verifyWhatsAppSignature(rawBody: string, header: string | null, secret: string): WhatsAppSignatureResult {
  if (!header) return { ok: false, reason: 'missing' };
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return { ok: false, reason: 'format' };
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const got = Buffer.from(match[1], 'hex');
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return { ok: false, reason: 'signature' };
  return { ok: true };
}

/** Verify-Token der Webhook-Einrichtung. Unterschiedliche Längen gelten als ungleich, ohne das Geheimnis zu verraten. */
export function verifyWhatsAppToken(given: string | null, expected: string): boolean {
  if (given === null) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
