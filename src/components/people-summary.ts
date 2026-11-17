/** Untertitel einer Personen-Karte: Anzahl überfällig und die ersten beiden Namen. */
export function peopleSummary(overdue: number, names: string[], empty: string): string {
  if (overdue <= 0) return empty;
  const shown = names.filter(Boolean).slice(0, 2);
  const head = overdue === 1 ? '1 überfällig' : `${overdue} überfällig`;
  if (shown.length === 0) return head;
  return `${head} · ${shown.join(', ')}${overdue > shown.length ? ' …' : ''}`;
}
