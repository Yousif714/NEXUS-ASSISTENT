import 'server-only';

import type { Repos } from './db/repository';

const GRAPH = 'https://graph.facebook.com/v21.0';

export interface WhatsAppHistoryEnv {
  whatsappPhoneNumberId?: string;
  whatsappAccessToken?: string;
}

/**
 * Einmalig die Coexistence-Historie anstoßen. Meta schickt eingehende und ausgehende
 * Nachrichten danach an den Webhook. Es wird keine Nachricht an einen Kunden gesendet.
 */
export async function requestWhatsAppHistoryOnce(
  repos: Repos,
  env: WhatsAppHistoryEnv,
  at: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<'skipped' | 'requested' | 'failed' | 'done'> {
  const phoneId = env.whatsappPhoneNumberId?.trim();
  const token = env.whatsappAccessToken?.trim();
  if (!phoneId || !token) return 'skipped';
  const known = await repos.state.recentJobRuns(new Date(0));
  if (known.includes('whatsapp-history-once')) return 'done';
  const day = at.toISOString().slice(0, 10);
  if (!(await repos.state.claimJobRun(`whatsapp-history:${day}`, at))) return 'done';
  try {
    const res = await fetchImpl(`${GRAPH}/${encodeURIComponent(phoneId)}/smb_app_data`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: 'history' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error('WhatsApp-Historie abgelehnt:', res.status);
      return 'failed';
    }
    await repos.state.claimJobRun('whatsapp-history-once', at);
    return 'requested';
  } catch (e) {
    console.error('WhatsApp-Historie:', e instanceof Error ? e.name : typeof e);
    return 'failed';
  }
}
