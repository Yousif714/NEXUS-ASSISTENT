import { connection } from 'next/server';
import { realNow } from '@/domain/clock';
import { authorizeMcp } from '@/server/mcp/auth';
import { mcpHandler } from '@/server/mcp/handler';
import { boundedRequest, jsonError, MCP_RATE_LIMIT, withNoStore } from '@/server/mcp/http';
import { allowRequest, clientKey } from '@/server/rate-limit';
import { readEnv } from '@/server/env';
import { getRepos } from '@/server/registry';

export const maxDuration = 60;

async function handle(req: Request): Promise<Response> {
  const env = readEnv();
  if (!env.mcpApiKey) return jsonError('MCP ist deaktiviert', 503);
  const next = await boundedRequest(req);
  if (next instanceof Response) return next;
  const allowed = await allowRequest(getRepos().state, `mcp:${clientKey(next, env.sessionSecret)}`, MCP_RATE_LIMIT, realNow());
  if (!allowed) return jsonError('Zu viele Anfragen', 429);
  const auth = authorizeMcp(next.headers.get('authorization'), env.mcpApiKey);
  if (!auth.ok) return jsonError(auth.error, auth.status);
  return withNoStore(await mcpHandler(next));
}

// `connection()` zuerst: sonst rendert der Build (cacheComponents) GET vor und liest dabei die Umgebung.
export async function GET(req: Request) {
  await connection();
  return handle(req);
}

export async function POST(req: Request) {
  await connection();
  return handle(req);
}

export async function DELETE(req: Request) {
  await connection();
  return handle(req);
}
