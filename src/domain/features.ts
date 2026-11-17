import type { AppState, ConnectionId, ExternalRef, Job, Message } from './types';

/**
 * WhatsApp in der App (Inhaber 17.11.2026: „Entfern WhatsApp aus der App“).
 * Aus: kein Tab, keine Wartet-Zahlen, keine WhatsApp-Hinweise, Webhook speichert nichts.
 * Vorhandene Nachrichten bleiben in der Datenbank, werden aber nicht ausgeliefert.
 */
export const WHATSAPP_IN_APP = false;

/**
 * Portale myDigitalCar und nextOZ (Inhaber 17.11.2026: „Entfern MDC und next oz auch“).
 * Aus: keine Portal-Aufträge, -Fahrzeuge, -Kunden, -Hinweise, kein Import. Daten bleiben in der Datenbank.
 */
export const PORTALS_IN_APP = false;

const PORTAL_CONNECTIONS = new Set<ConnectionId>(['mydigitalcar', 'nextoz']);

export const showMessage = (m: Pick<Message, 'channel'>): boolean => WHATSAPP_IN_APP || m.channel !== 'whatsapp';
export const showJob = (j: Pick<Job, 'portalSource'>): boolean => PORTALS_IN_APP || !j.portalSource;
export const showConnection = (id: ConnectionId): boolean =>
  (WHATSAPP_IN_APP || id !== 'whatsapp_kunden') && (PORTALS_IN_APP || !PORTAL_CONNECTIONS.has(id));

/** Nur aus einem Portal bekannt (alle Fremdschlüssel gehören myDigitalCar oder nextOZ). */
const portalOnly = (refs: ExternalRef[] | undefined): boolean =>
  !!refs && refs.length > 0 && refs.every((r) => PORTAL_CONNECTIONS.has(r.connectionId));

/** Zustand für Anzeige und Hinweise: ohne ausgeschaltete Bereiche. Gespeichert wird immer der volle Zustand. */
export function visibleState(s: AppState): AppState {
  if (WHATSAPP_IN_APP && PORTALS_IN_APP) return s;
  const messages = s.messages.filter(showMessage);
  const connections = s.connections.filter((c) => showConnection(c.id));
  if (PORTALS_IN_APP) return { ...s, messages, connections };
  const jobs = s.jobs.filter(showJob);
  const jobVehicles = new Set(jobs.map((j) => j.vehicleId));
  const vehicles = s.vehicles.filter((v) => jobVehicles.has(v.id) || !portalOnly(v.externalRefs));
  const used = new Set<string>();
  for (const x of [...jobs, ...vehicles, ...s.invoices, ...s.contracts, ...messages, ...s.payments, ...(s.orderConfirmations ?? [])]) {
    const id = (x as { contactId?: string | null }).contactId;
    if (id) used.add(id);
  }
  const contacts = s.contacts.filter((c) => used.has(c.id) || !portalOnly(c.externalRefs));
  return { ...s, messages, connections, jobs, vehicles, contacts };
}
