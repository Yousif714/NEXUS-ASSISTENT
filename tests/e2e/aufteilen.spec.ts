import { expect, test } from '@playwright/test';

const SPK_HEADER = '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"';
// Unbekannter Zahler, Verwendungszweck ohne Rechnungsnummern: Aufteilung muss von Hand passieren.
const csv = {
  name: 'umsaetze.csv', mimeType: 'text/csv',
  buffer: Buffer.from(`${SPK_HEADER}\n"DE00360501050000009999";"10.11.26";"10.11.26";"GUTSCHR. UEBERWEISUNG";"Sammelzahlung November";"";"";"";"";"";"";"Fremde Firma";"DE00100000000000000099";"XXXXDEXXXXX";"640,00";"EUR";"Umsatz gebucht"\n`),
};

test('Zahlung frei auf mehrere Rechnungen aufteilen (Suche, Häkchen, Vorschau, bestätigen)', async ({ page }) => {
  // Zuordnungsseite direkt (Sparkasse ist in der App ausgeschaltet, die Seite selbst funktioniert weiter).
  await page.goto('/zulassung/zuordnen?reset=1');
  await page.getByLabel('Kontoauszug-Datei').setInputFiles(csv);
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  const card = page.locator('[data-testid^="match-"]').first();
  const id = (await card.getAttribute('data-testid'))!.slice('match-'.length);
  await card.getByRole('button', { name: /^Auf mehrere Rechnungen aufteilen/ }).click();
  const pick = page.getByTestId(`multi-pick-${id}`);
  await pick.getByLabel('Rechnung suchen (Nummer oder Name)').fill('RE-Z');
  const boxes = pick.getByRole('checkbox');
  await expect(boxes).not.toHaveCount(0);
  expect(await boxes.count()).toBeGreaterThanOrEqual(2);
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(pick.getByTestId(`split-${id}`)).toContainText('Aufteilen:');
  await pick.getByRole('button', { name: 'Auf 2 Rechnungen aufteilen' }).click();
  await expect(page.getByTestId(`match-${id}`)).toHaveCount(0);
});
