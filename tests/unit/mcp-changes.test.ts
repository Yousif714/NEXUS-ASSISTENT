import { describe, expect, test } from 'vitest';
import { createEmptyState } from '@/data/empty-state';
import { applyEvent } from '@/data/engine';
import { applyMcpChange, type McpChange } from '@/domain/mcp-changes';
import { scrub } from '@/server/mcp/view';
import type { AppState } from '@/domain/types';

const at = new Date('2026-11-16T10:00:00.000Z');
const ctx = { at, newId: () => 'id-1' };

function apply(s: AppState, change: McpChange) {
  return applyMcpChange(s, change, ctx);
}

describe('applyMcpChange', () => {
  test('legt einen Kontakt an und protokolliert die Herkunft mcp', () => {
    const s = createEmptyState();
    const r = applyEvent(s, {
      type: 'mcpChange',
      change: { op: 'createContact', contact: { company: 'nexus', kind: 'member', name: 'Erika Muster', phones: ['015112345678'], emails: ['Erika@example.de'] } },
    }, { at, isDemo: false, newId: () => 'c-1' });
    expect(r.state.contacts).toEqual([expect.objectContaining({ id: 'c-1', name: 'Erika Muster', phones: ['+4915112345678'], emails: ['erika@example.de'] })]);
    expect(r.state.audit.at(-1)).toMatchObject({ actor: 'assistant', source: 'mcp', text: 'Kontakt angelegt: Erika Muster', isDemo: false });
  });

  test('erledigt eine Zusage und lehnt Geld-Aktionen ab', () => {
    const base = apply(createEmptyState(), {
      op: 'createContact', contact: { company: 'zulassung', kind: 'dealer', name: 'Autohaus', phones: [], emails: [] },
    }).state;
    const created = apply(base, {
      op: 'createCommitment', contactId: 'id-1', kind: 'callback', text: 'Zurückrufen', dueAt: '2026-12-01T18:00:00.000Z',
    });
    expect(created.state.commitments[0]).toMatchObject({ status: 'open', messageId: 'mcp', contactId: 'id-1' });
    const done = apply(created.state, { op: 'completeCommitment', id: 'id-1' });
    expect(done.state.commitments[0].status).toBe('kept');
    expect(apply(done.state, { op: 'completeCommitment', id: 'id-1' }).unchanged).toBe(true);

    const money = apply(base, {
      op: 'createAction', title: 'Abbuchen', actionType: 'stripe_takeover' as never, company: 'nexus', payload: {},
    });
    expect(money.error).toMatch(/nicht erlaubt/);
    expect(apply(base, { op: 'createCommitment', contactId: 'fehlt', kind: 'other', text: 'x', dueAt: '2026-12-01T18:00:00.000Z' }).error).toMatch(/nicht gefunden/);
    expect(apply(base, { op: 'createNote', text: 'eVB fehlt', contactId: 'id-1' }).state.contacts[0].notes).toContain('eVB fehlt');
  });

  test('scrub entfernt Zahlungslinks', () => {
    expect(scrub({ link: 'https://pay.example/zahlung/tok', note: 'siehe https://nexus.example/zahlung/abc?x=1 bitte' })).toEqual({
      note: 'siehe [Zahlungslink entfernt] bitte',
    });
  });
});
