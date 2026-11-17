import { jobBilling } from '../billing';
import { jobPortalSource } from '../import/portal';
import { formatEuro } from '../money';
import type { AppState, Insight, Job } from '../types';
import { jobRef, portalJobsRef } from './refs';

const countDe = new Intl.NumberFormat('de-DE');

function restOf(s: AppState, j: Job): { invoiced: number; rest: number } | null {
  if (j.status !== 'done') return null;
  const { invoicedCents: invoiced, restCents: rest } = jobBilling(s, j);
  return rest > 0 ? { invoiced, rest } : null;
}

function oneJob(s: AppState, j: Job, invoiced: number, rest: number): Insight {
  const name = s.contacts.find((c) => c.id === j.contactId)?.name ?? 'Unbekannt';
  return {
    dedupeKey: `job-inv:${j.id}`,
    type: 'job_not_invoiced',
    company: 'zulassung',
    priority: 'today',
    title: `${name}: ${j.service} noch nicht abgerechnet`,
    body: `Auftrag erledigt, Preis ${formatEuro(j.priceCents)}, davon abgerechnet ${formatEuro(invoiced)}. Es fehlen ${formatEuro(rest)}.`,
    amountCents: rest,
    refs: [jobRef(j.id, `${name} · ${j.service}`)],
    nextStep: 'Rechnung erstellen',
    needsSources: ['lexware_zulassung'],
  };
}

/** Portal-Importe (myDigitalCar, nextOZ) als ein Hinweis. Aufträge von Hand bleiben einzeln. */
export function detectJobsNotInvoiced(s: AppState): Insight[] {
  const out: Insight[] = [];
  const portal: { rest: number }[] = [];
  for (const j of s.jobs) {
    const bill = restOf(s, j);
    if (!bill) continue;
    if (jobPortalSource(j)) portal.push({ rest: bill.rest });
    else out.push(oneJob(s, j, bill.invoiced, bill.rest));
  }
  if (portal.length === 0) return out;
  const n = portal.length;
  const rest = portal.reduce((sum, x) => sum + x.rest, 0);
  const title = n === 1
    ? '1 Portal-Auftrag nicht abgerechnet'
    : `${countDe.format(n)} Portal-Aufträge nicht abgerechnet`;
  out.push({
    dedupeKey: 'job-inv:portal',
    type: 'job_not_invoiced',
    company: 'zulassung',
    priority: 'today',
    title,
    body: `Aus myDigitalCar und nextOZ. Es fehlen zusammen ${formatEuro(rest)}.`,
    amountCents: rest,
    refs: [portalJobsRef('Portal-Aufträge ohne Rechnung')],
    nextStep: 'Liste öffnen',
    needsSources: ['lexware_zulassung'],
  });
  return out;
}
