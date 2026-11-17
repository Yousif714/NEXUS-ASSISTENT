import { describe, expect, test } from 'vitest';
import { createMemoryRepos } from '@/server/db/memory';
import { requestWhatsAppHistoryOnce } from '@/server/whatsapp-history';

const at = new Date('2026-11-17T10:00:00Z');

describe('requestWhatsAppHistoryOnce', () => {
  test('ohne Token kein Aufruf', async () => {
    let called = false;
    const r = await requestWhatsAppHistoryOnce(createMemoryRepos(), { whatsappPhoneNumberId: 'pn' }, at, (async () => {
      called = true;
      return new Response(null, { status: 200 });
    }) as typeof fetch);
    expect(r).toBe('skipped');
    expect(called).toBe(false);
  });

  test('fordert nur die Historie an und merkt sich den Erfolg', async () => {
    const repos = createMemoryRepos();
    const urls: string[] = [];
    let body = '';
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      urls.push(String(url));
      body = String(init?.body ?? '');
      expect(String(init?.headers && (init.headers as Record<string, string>).authorization)).toBe('Bearer token');
      expect(String(url)).not.toContain('/messages');
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const env = { whatsappPhoneNumberId: 'pn 1', whatsappAccessToken: 'token' };
    expect(await requestWhatsAppHistoryOnce(repos, env, at, fetchImpl)).toBe('requested');
    expect(urls).toEqual(['https://graph.facebook.com/v21.0/pn%201/smb_app_data']);
    expect(JSON.parse(body)).toEqual({ messaging_product: 'whatsapp', sync_type: 'history' });
    expect(await requestWhatsAppHistoryOnce(repos, env, at, fetchImpl)).toBe('done');
    expect(urls).toHaveLength(1);
  });
});
