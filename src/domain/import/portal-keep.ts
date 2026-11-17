/** Welche Portal-Status übernommen werden. Alles andere (Entwurf, leer, in Bearbeitung) bleibt draußen. */

export type PortalKeep = 'genehmigt' | 'abgelehnt' | 'fehler';

/**
 * Rohstatus beider Portale auf drei Gruppen.
 * Genehmigt: Genehmigt, Versandfertig, Erfolgreich, Abgeschlossen.
 * Abgelehnt: Abgelehnt, Signatur abgelehnt.
 * Fehler: Fehler, Fehler (B), Fehler (T), Signaturfehler.
 */
export function portalKeepGroup(raw: string | undefined): PortalKeep | null {
  const norm = (raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (norm === 'genehmigt' || norm === 'versandfertig' || norm === 'erfolgreich' || norm === 'abgeschlossen') return 'genehmigt';
  if (norm === 'abgelehnt' || norm === 'signatur abgelehnt') return 'abgelehnt';
  if (norm === 'fehler' || norm.startsWith('fehler ') || norm.startsWith('fehler(') || norm === 'signaturfehler') return 'fehler';
  return null;
}
