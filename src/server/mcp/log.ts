import 'server-only';
import { realNow } from '@/domain/clock';
import { getRepos } from '@/server/registry';
import { appendAudit } from '@/server/state-service';

/** Protokolliert einen MCP-Werkzeugaufruf (Herkunft `mcp`), über denselben Speicherpfad wie die übrigen Änderungen. */
export async function logMcpTool(tool: string, detail?: string): Promise<void> {
  const text = detail ? `MCP ${tool}: ${detail}` : `MCP ${tool}`;
  await appendAudit(getRepos(), { actor: 'assistant', text, source: 'mcp' }, realNow());
}
