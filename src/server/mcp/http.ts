/** Obergrenze für den MCP-Request-Body (die SDK-Grenze liegt höher). */
export const MCP_MAX_BODY_BYTES = 256 * 1024;

/** Anfragen je Minute und Client (gehashte IP), serverlos über `job_runs`. */
export const MCP_RATE_LIMIT = 120;

export function jsonError(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
}

export function withNoStore(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-store');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Liest den Body höchstens einmal und lehnt zu große Anfragen ab, bevor der MCP-Handler sie sieht. */
export async function boundedRequest(req: Request): Promise<Request | Response> {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') return req;
  const declared = req.headers.get('content-length');
  if (declared !== null && Number(declared) > MCP_MAX_BODY_BYTES) return jsonError('Anfrage zu groß', 413);
  const buf = await req.arrayBuffer();
  if (buf.byteLength > MCP_MAX_BODY_BYTES) return jsonError('Anfrage zu groß', 413);
  return new Request(req.url, { method: req.method, headers: req.headers, body: buf.byteLength ? buf : undefined });
}
