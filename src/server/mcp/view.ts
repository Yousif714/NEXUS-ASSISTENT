import { buildBriefing } from '@/domain/briefing';
import { todayBerlin } from '@/domain/clock';
import { deriveProposals } from '@/domain/import/proposals';
import { contractsOfContact } from '@/domain/ledger/contracts';
import { invoiceOpenCents } from '@/domain/ledger/receivables';
import { memberView } from '@/domain/detectors/members';
import { overdueMembers } from '@/data/selectors';
import type { AppState, Invoice } from '@/domain/types';

export const MCP_PAGE_MAX = 50;

const norm = (t: string) => t.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

export function pageOf<T>(items: T[], limit?: number, offset?: number): { items: T[]; total: number; limit: number; offset: number } {
  const l = Math.min(Math.max(limit ?? 20, 1), MCP_PAGE_MAX);
  const o = Math.max(offset ?? 0, 0);
  return { items: items.slice(o, o + l), total: items.length, limit: l, offset: o };
}

export function matches(query: string | undefined, parts: (string | number | null | undefined)[]): boolean {
  const q = norm(query?.trim() ?? '');
  if (!q) return true;
  return parts.some((p) => p !== null && p !== undefined && norm(String(p)).includes(q));
}

/** Entfernt Zahlungslinks und geheime Felder, bevor etwas den Connector verlässt. */
export function scrub(value: unknown): unknown {
  if (typeof value === 'string') return value.replace(/https?:\/\/\S*\/zahlung\/\S*/gi, '[Zahlungslink entfernt]');
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'token' || k === 'link' || k === 'paymentLink' || k === 'sessionSecret') continue;
    out[k] = scrub(v);
  }
  return out;
}

export function contactName(s: AppState, id: string | null | undefined): string | null {
  if (!id) return null;
  return s.contacts.find((c) => c.id === id)?.name ?? null;
}

export function shapeContact(s: AppState, id: string) {
  const c = s.contacts.find((x) => x.id === id);
  if (!c) return null;
  return scrub({
    ...c,
    contracts: contractsOfContact(s, c.id).map((k) => ({ id: k.id, kind: k.kind ?? 'membership', totalCents: k.totalCents, billing: k.billing })),
  });
}

export function shapeContract(s: AppState, id: string, today: string) {
  const c = s.contracts.find((x) => x.id === id);
  if (!c) return null;
  const v = memberView(s, c.id, today);
  return scrub({
    ...c,
    contactName: v.contact?.name ?? null,
    status: {
      openCents: v.status.openCents, arrearsCents: v.status.arrearsCents, futureCents: v.status.futureCents,
      paidCents: v.status.paidCents, traffic: v.status.traffic, daysOverdue: v.status.daysOverdue,
      oldestUnpaidDue: v.status.oldestUnpaidDue, nextDue: v.status.nextDue,
    },
  });
}

export function shapeInvoice(s: AppState, inv: Invoice) {
  return scrub({
    ...inv,
    contactName: contactName(s, inv.contactId),
    openCents: invoiceOpenCents(s, inv),
  });
}

/** Offene Rechnungen, überfällige Zahlungen, anstehende Zusagen. Beträge in Cent. */
export function overview(s: AppState, now: Date) {
  const today = todayBerlin(now);
  const briefing = buildBriefing(s, 'morning', now);
  const openInvoices = s.invoices
    .map((inv) => ({ inv, openCents: invoiceOpenCents(s, inv) }))
    .filter((x) => x.openCents > 0)
    .sort((a, b) => a.inv.dueDate.localeCompare(b.inv.dueDate));
  const invoiceRow = (x: { inv: Invoice; openCents: number }) => ({
    id: x.inv.id, number: x.inv.number, company: x.inv.company, contactId: x.inv.contactId,
    contactName: contactName(s, x.inv.contactId), dueDate: x.inv.dueDate, status: x.inv.status, openCents: x.openCents,
  });
  const upcoming = s.commitments
    .filter((c) => c.status === 'open' && Date.parse(c.dueAt) >= now.getTime())
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  return {
    asOf: now.toISOString(),
    money: briefing.money,
    openInsightCount: s.insights.filter((i) => i.status === 'open').length,
    openInvoices: openInvoices.slice(0, MCP_PAGE_MAX).map(invoiceRow),
    openInvoiceCount: openInvoices.length,
    overdueInvoices: openInvoices.filter((x) => x.inv.dueDate < today).slice(0, MCP_PAGE_MAX).map(invoiceRow),
    overduePayments: overdueMembers(s, today),
    upcomingCommitments: upcoming.slice(0, MCP_PAGE_MAX).map((c) => ({
      id: c.id, contactId: c.contactId, contactName: contactName(s, c.contactId), kind: c.kind, text: c.text, dueAt: c.dueAt, status: c.status,
    })),
    openProposalCount: deriveProposals(s).length,
    repliesOpen: briefing.repliesOpen,
    staleSources: briefing.staleSources,
  };
}
