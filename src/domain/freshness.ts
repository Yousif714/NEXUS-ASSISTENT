import { formatBerlin } from './clock';
import type { Connection, ConnectionId } from './types';

export const STALE_AFTER_MINUTES = 45;

/** Abweichende Frist je Verbindung: die Portal-Mitgliederliste (30 Tage) und der Sparkasse-Auszug (7 Tage) werden von Hand hochgeladen. */
export const STALE_AFTER_MINUTES_BY_CONNECTION: Partial<Record<ConnectionId, number>> = {
  portal_nexus: 30 * 24 * 60,
  bank_sparkasse: 7 * 24 * 60,
  mydigitalcar: 30 * 24 * 60,
  nextoz: 30 * 24 * 60,
};

export function staleAfterMinutes(id: ConnectionId): number {
  return STALE_AFTER_MINUTES_BY_CONNECTION[id] ?? STALE_AFTER_MINUTES;
}

export function sourceFreshness(c: Connection, now: Date): 'fresh' | 'stale' | 'error' | 'missing' {
  if (c.status === 'missing') return 'missing';
  if (c.status === 'error') return 'error';
  if (!c.lastSuccessAt) return 'stale';
  const ageMin = (now.getTime() - Date.parse(c.lastSuccessAt)) / 60_000;
  return ageMin > staleAfterMinutes(c.id) ? 'stale' : 'fresh';
}

/** Ganze Minuten seit dem letzten erfolgreichen Abruf (`null`, wenn nie abgerufen). */
export function ageMinutes(c: Connection, now: Date): number | null {
  if (!c.lastSuccessAt) return null;
  return Math.floor((now.getTime() - Date.parse(c.lastSuccessAt)) / 60_000);
}

/** Altersanzeige: Minuten bis zur ersten Stunde, danach Datum und Uhrzeit (Europe/Berlin). */
export function ageText(c: Connection, at: Date): string {
  const age = ageMinutes(c, at);
  if (age === null) return 'Noch nie abgerufen';
  if (age < 60) return `Stand vor ${age} Min.`;
  return `Stand vom ${formatBerlin(new Date(c.lastSuccessAt as string), 'dd.MM.yyyy, HH:mm')} Uhr`;
}

const known = (sources: ConnectionId[], connections: Connection[], take: (c: Connection, now: Date) => boolean, now: Date): ConnectionId[] =>
  sources.filter((id) => {
    const c = connections.find((x) => x.id === id);
    return !!c && take(c, now);
  });

/** Verbunden, aber Fehler oder zu alt. `missing` zählt nicht. Unbekannte IDs werden ignoriert. */
export function areaStale(sources: ConnectionId[], connections: Connection[], now: Date): ConnectionId[] {
  return known(sources, connections, (c, at) => {
    const f = sourceFreshness(c, at);
    return f === 'stale' || f === 'error';
  }, now);
}

/** Katalog-Quellen ohne Zugang (Status `missing`), etwa von ensureCatalogConnections ergänzt. */
export function areaNotConnected(sources: ConnectionId[], connections: Connection[], now: Date): ConnectionId[] {
  return known(sources, connections, (c, at) => sourceFreshness(c, at) === 'missing', now);
}

/** Kein Urteil: nicht verbunden, Fehler oder zu alt. */
export function areaUnreliable(sources: ConnectionId[], connections: Connection[], now: Date): ConnectionId[] {
  return known(sources, connections, (c, at) => sourceFreshness(c, at) !== 'fresh', now);
}
