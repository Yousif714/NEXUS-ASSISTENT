import { describe, expect, test } from 'vitest';
import { createEmptyState } from '@/data/empty-state';
import { applyMcpChange } from '@/domain/mcp-changes';
import { applyPortalCleanup, planPortalCleanup, portalCleanupFailure } from '@/domain/import/portal-cleanup';
import type { AppState, Job, StoredInsight, Vehicle } from '@/domain/types';

const at = new Date('2026-11-17T08:00:00.000Z');

function job(p: Partial<Job> & Pick<Job, 'id' | 'portalSource' | 'portalStatus'>): Job {
  return {
    vehicleId: 'v1', contactId: 'c1', service: 'Zulassung', location: 'online', priceCents: 100,
    status: 'done', doneAt: null, invoiceIds: [], ...p,
  };
}

function world(extra: Partial<AppState> = {}): AppState {
  const s = createEmptyState();
  const vehicle: Vehicle = { id: 'v1', contactId: 'c1', vin: 'WVWZZZ1KZAW000001', plate: 'BO AB 1', model: 'unbekannt', externalRefs: [{ connectionId: 'nextoz', externalId: 'fin:WVWZZZ1KZAW000001' }] };
  return {
    ...s,
    contacts: [{ id: 'c1', company: 'zulassung', kind: 'private', name: 'Erika Beispiel', phones: [], emails: [], externalRefs: [{ connectionId: 'nextoz', externalId: 'erika|46236' }] }],
    vehicles: [vehicle],
    jobs: [
      job({ id: 'keep', portalSource: 'nextoz', portalStatus: 'Erfolgreich' }),
      job({ id: 'draft', portalSource: 'nextoz', portalStatus: 'Entwurf' }),
      job({ id: 'open', portalSource: 'mydigitalcar', portalStatus: 'Eingereicht' }),
      job({ id: 'nofin', portalSource: 'nextoz', portalStatus: 'Genehmigt', vehicleId: null }),
      job({ id: 'billed', portalSource: 'nextoz', portalStatus: 'Entwurf', invoiceIds: ['i1'], status: 'invoiced' }),
      job({ id: 'hand', portalStatus: undefined, portalSource: undefined, vehicleId: 'v-hand' }),
    ],
    insights: [
      { dedupeKey: 'job-inv:draft', type: 'job_not_invoiced', company: 'zulassung', priority: 'today', title: 'Entwurf', body: '', refs: [{ kind: 'job', id: 'draft', href: '/x', label: 'x' }], nextStep: '', needsSources: [], status: 'open', createdAt: at.toISOString() },
      { dedupeKey: 'job-inv:keep', type: 'job_not_invoiced', company: 'zulassung', priority: 'today', title: 'Bleibt', body: '', refs: [{ kind: 'job', id: 'keep', href: '/x', label: 'x' }], nextStep: '', needsSources: [], status: 'open', createdAt: at.toISOString() },
    ] satisfies StoredInsight[],
    ...extra,
  };
}

describe('Portal-Aufräumen', () => {
  test('Probe zählt je Quelle und Status und löscht nichts', () => {
    const s = world();
    const plan = planPortalCleanup(s);
    expect(plan.deleteByStatus.nextoz).toMatchObject({ Entwurf: 1, 'Genehmigt · ohne FIN/Kennzeichen': 1 });
    expect(plan.deleteByStatus.mydigitalcar).toEqual({ Eingereicht: 1 });
    expect(plan.keepByStatus.nextoz.Erfolgreich).toBe(1);
    expect(plan.keptBecauseInvoice.nextoz).toBe(1);
    expect(plan.jobs).toBe(3);
    expect(plan.notices).toBe(1);
    expect(applyPortalCleanup(s).state).not.toBe(s);
    expect(s.jobs).toHaveLength(6);
  });

  test('Löschen lässt Rechnung, Handauftrag, Fahrzeug und Kontakt stehen, wenn noch etwas darauf zeigt', () => {
    const r = applyMcpChange(world(), { op: 'cleanupPortalJobs' }, { newId: () => 'x', at });
    const ids = r.state.jobs.map((j) => j.id).sort();
    expect(ids).toEqual(['billed', 'hand', 'keep']);
    expect(r.state.vehicles.map((v) => v.id)).toEqual(['v1']);
    expect(r.state.contacts.map((c) => c.id)).toEqual(['c1']);
    expect(r.state.insights.map((i) => i.dedupeKey)).toEqual(['job-inv:keep']);
    const again = applyPortalCleanup(r.state);
    expect(again.counts.jobs).toBe(0);
    expect(again.state).toBe(r.state);
  });

  test('Fahrzeug und Kontakt ohne weiteren Verweis fallen weg, eine Rechnung schützt den Kontakt', () => {
    const s = world();
    s.jobs = s.jobs.filter((j) => j.id !== 'keep' && j.id !== 'hand' && j.id !== 'billed');
    const lone = applyPortalCleanup(s);
    expect(lone.state.jobs).toEqual([]);
    expect(lone.state.vehicles).toEqual([]);
    expect(lone.state.contacts).toEqual([]);
    const billed = world();
    billed.jobs = [job({ id: 'only', portalSource: 'nextoz', portalStatus: 'Entwurf', invoiceIds: ['i1'] })];
    billed.invoices = [{ id: 'i1', company: 'zulassung', source: 'lexware', connectionId: 'lexware_zulassung', externalId: 'e', contactId: 'c1', number: 'R1', totalCents: 1, openCents: 1, issuedOn: '2026-11-01', dueDate: '2026-11-08', status: 'open' }];
    const kept = applyPortalCleanup(billed);
    expect(kept.state.jobs.map((j) => j.id)).toEqual(['only']);
    expect(kept.state.contacts).toHaveLength(1);
  });

  test('Fehlermeldung gibt den Datenbanktext zurück', () => {
    expect(portalCleanupFailure(new Error('conflict'))).toBe('Gleichzeitige Änderung, bitte erneut versuchen');
    expect(portalCleanupFailure(new Error('Supabase save: canceling statement due to statement timeout'))).toContain('statement timeout');
    expect(portalCleanupFailure(new Error(''))).toBe('Aufräumen fehlgeschlagen');
  });
});
