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

/**
 * Sparkasse (Zulassungsdienst) in der App (Inhaber 18.11.2026: lässt sich nicht automatisch abrufen → raus).
 * Aus: kein Upload, kein „Zahlungen zuordnen“, keine Hinweise zu nicht zugeordneten Sparkassen-Zahlungen.
 * Offene Beträge des Zulassungsdienstes kommen aus Lexware; bisherige Zuordnungen bleiben gültig.
 */
export const SPARKASSE_IN_APP = false;

const PORTAL_CONNECTIONS = new Set<ConnectionId>(['mydigitalcar', 'nextoz']);

export const showMessage = (m: Pick<Message, 'channel'>): boolean => WHATSAPP_IN_APP || m.channel !== 'whatsapp';
export const showJob = (j: Pick<Job, 'portalSource'>): boolean => PORTALS_IN_APP || !j.portalSource;
export const showConnection = (id: ConnectionId): boolean =>
  (WHATSAPP_IN_APP || id !== 'whatsapp_kunden') && (PORTALS_IN_APP || !PORTAL_CONNECTIONS.has(id)) && (SPARKASSE_IN_APP || id !== 'bank_sparkasse');

/** Nur aus einem Portal bekannt (alle Fremdschlüssel gehören myDigitalCar oder nextOZ). */
const portalOnly = (refs: ExternalRef[] | undefined): boolean =>
  !!refs && refs.length > 0 && refs.every((r) => PORTAL_CONNECTIONS.has(r.connectionId));

/** Zustand für Anzeige und Hinweise: ohne ausgeschaltete Bereiche. Gespeichert wird immer der volle Zustand. */
export function visibleState(s: AppState): AppState {
  if (WHATSAPP_IN_APP && PORTALS_IN_APP && SPARKASSE_IN_APP) return s;
  const messages = s.messages.filter(showMessage);
  const connections = s.connections.filter((c) => showConnection(c.id));
  // Sparkasse aus: nur noch bereits zugeordnete Sparkassen-Zahlungen (sie tragen die bisherigen Zuordnungen).
  const allocated = SPARKASSE_IN_APP ? null : new Set(s.allocations.map((a) => a.paymentId));
  const payments = allocated ? s.payments.filter((p) => p.connectionId !== 'bank_sparkasse' || allocated.has(p.id)) : s.payments;
  if (PORTALS_IN_APP) return { ...s, messages, connections, payments };
  const jobs = s.jobs.filter(showJob);
  const jobVehicles = new Set(jobs.map((j) => j.vehicleId));
  const vehicles = s.vehicles.filter((v) => jobVehicles.has(v.id) || !portalOnly(v.externalRefs));
  const used = new Set<string>();
  for (const x of [...jobs, ...vehicles, ...s.invoices, ...s.contracts, ...messages, ...payments, ...(s.orderConfirmations ?? [])]) {
    const id = (x as { contactId?: string | null }).contactId;
    if (id) used.add(id);
  }
  const contacts = s.contacts.filter((c) => used.has(c.id) || !portalOnly(c.externalRefs));
  return { ...s, messages, connections, payments, jobs, vehicles, contacts };
}
