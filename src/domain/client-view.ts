import type { AppState, Job } from '@/domain/types';

/** Spalten, die die Auftragsliste braucht. Der Rest (PIN, Codes, IBAN) kommt erst auf der Auftragsseite. */
const LIST_PORTAL_KEYS = ['Auftragsnummer', 'Ex_Vorgangsnummer'] as const;

const KEEP_INSIGHT = new Set(['open', 'snoozed', 'dismissed']);

function slimJob(job: Job): Job {
  const data = job.portalData;
  if (!data) return job;
  const portalData: Record<string, string> = {};
  for (const key of LIST_PORTAL_KEYS) {
    const value = data[key];
    if (value) portalData[key] = value;
  }
  const dropped = Object.keys(data).some((key) => data[key] && !LIST_PORTAL_KEYS.includes(key as (typeof LIST_PORTAL_KEYS)[number]));
  return { ...job, portalData, ...(dropped ? { portalDetail: true } : {}) };
}

/**
 * Was der Browser bekommt. Erledigte und veraltete Hinweise sowie die Portal-Rohspalten
 * bleiben auf dem Server: die Liste wird kleiner, Geheimnisse aus dem CSV stehen nicht in jeder Seite.
 */
export function slimForClient(state: AppState): AppState {
  return {
    ...state,
    insights: state.insights.filter((i) => KEEP_INSIGHT.has(i.status)),
    jobs: state.jobs.map(slimJob),
  };
}
