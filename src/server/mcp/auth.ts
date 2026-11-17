import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s: string) => createHash('sha256').update(s).digest();

export type McpAuthResult = { ok: true } | { ok: false; status: 401; error: 'Nicht erlaubt' };

/**
 * Vergleicht `Authorization: Bearer <MCP_API_KEY>` in konstanter Zeit.
 * Beide Seiten werden gehasht, damit ungleiche Längen `timingSafeEqual` nicht werfen und nichts verraten.
 */
export function authorizeMcp(authorization: string | null, apiKey: string): McpAuthResult {
  const expected = digest(`Bearer ${apiKey}`);
  const got = digest(authorization ?? '');
  if (!timingSafeEqual(got, expected)) return { ok: false, status: 401, error: 'Nicht erlaubt' };
  return { ok: true };
}
