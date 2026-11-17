import { expect, test } from '@playwright/test';

test('Postfach: Chatliste, Filter, Suche, Unterhaltung mit Weg zurück', async ({ page }) => {
  await page.goto('/nachrichten?reset=1');
  await expect(page.getByTestId('tab-nachrichten')).toHaveAttribute('aria-current', 'page');
  const rows = page.getByTestId('inbox-row');
  await expect(rows.first()).toBeVisible();
  const total = await rows.count();

  await page.getByRole('button', { name: 'Wartet', exact: true }).click();
  const waiting = await rows.count();
  expect(waiting).toBeLessThanOrEqual(total);
  for (let i = 0; i < waiting; i++) await expect(rows.nth(i).getByTestId('inbox-wait')).toBeVisible();

  await page.getByRole('button', { name: 'Alle', exact: true }).click();
  await page.getByTestId('inbox-search').fill('zzzz-gibt-es-nicht');
  await expect(page.getByText('Nichts passt zum Filter.')).toBeVisible();
  await page.getByTestId('inbox-search').fill('');

  await rows.first().click();
  await expect(page.getByTestId('thread-messages')).toBeVisible();
  await page.getByRole('link', { name: 'Nachrichten' }).first().click();
  await expect(page).toHaveURL(/\/nachrichten$/);
});
