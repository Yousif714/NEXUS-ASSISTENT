import type { Locator } from '@playwright/test';

/** Öffnet einen Abschnitt, wenn er zu ist. Ein schon offener Abschnitt bleibt offen. */
export async function ensureOpen(section: Locator) {
  const open = await section.evaluate((el) => !(el instanceof HTMLDetailsElement) || el.open);
  if (!open) await section.locator('summary').click();
}
