import { expect, test } from '@playwright/test';

test('Kacheln führen weiter: Heute, NEXUS, Zulassung', async ({ page }) => {
  await page.goto('/?reset=1');
  await page.getByRole('link', { name: 'Termine heute öffnen' }).click();
  await expect(page.getByTestId('events-today')).toBeVisible();

  await page.goto('/');
  await page.getByRole('link', { name: 'Überfällig öffnen' }).click();
  await expect(page.getByTestId('feed-ueberfaellig')).toHaveJSProperty('open', true);

  await page.goto('/nexus');
  await page.getByRole('link', { name: 'Zuordnen öffnen' }).click();
  await expect(page).toHaveURL(/\/nexus\/zuordnen$/);

  await page.goto('/zulassung');
  await page.getByRole('link', { name: 'Wartet auf Kunde öffnen' }).click();
  await expect(page.getByTestId('jobs-waiting_customer')).toHaveJSProperty('open', true);
  await page.getByTestId('money-card-zulassung').getByRole('link').click();
  await expect(page).toHaveURL(/\/zulassung\/kunden$/);
});
