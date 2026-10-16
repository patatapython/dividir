import { expect } from '@playwright/test';
import { createGroupAs, gotoHydrated, test } from './support';
import { seedActivity, seedClosedRounds, seedPayments, tokenOf } from './fixtures-db';

test('Movimientos folds to five, unfolds to one page and "Ver más" adds the next one in place', async ({ page }) => {
  const home = await createGroupAs(page, 'Muchos pagos', ['Ana', 'Bea']);
  seedPayments(tokenOf(home), 25);
  await page.reload();

  // D-09: folded to five; the toggle says how much of the whole is loaded, never "todos".
  const cards = page.locator('.movement-card');
  await expect(cards).toHaveCount(5);
  await expect(page.getByRole('link', { name: 'Ver más' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver 20 de 25 · Movimientos', exact: true }).click();
  await expect(cards).toHaveCount(20);
  await expect(cards.nth(5)).toBeFocused();
  await expect(page.locator('.show-more-count')).toHaveText('Mostrando 20 de 25');

  await page.getByRole('link', { name: 'Ver más' }).click();
  await page.waitForURL(/\?mostrar=40$/);
  await expect(cards).toHaveCount(25);
  // The link is gone now: focus lands on the first new row instead of falling back to the page.
  await expect(cards.nth(20)).toBeFocused();
  await expect(page.locator('.show-more-count')).toHaveText('Mostrando 25 de 25');
  await expect(page.getByRole('link', { name: 'Ver más' })).toHaveCount(0);

  // Loading more never refolds; folding goes back to five.
  await page.getByRole('button', { name: 'Plegar · Movimientos', exact: true }).click();
  await expect(cards).toHaveCount(5);
});

test('Actividad pages through the log and says so when the cap is reached', async ({ page }) => {
  const home = await createGroupAs(page, 'Diario largo', ['Ana', 'Bea']);
  seedActivity(tokenOf(home), 520);
  await page.getByRole('link', { name: 'Actividad', exact: true }).click();
  await page.waitForURL(/\/actividad$/);

  // D-09: each day folds to five entries; the page-wide count is still the whole page.
  const rows = page.locator('.journal-row');
  for (const day of await page.locator('.journal-day').all()) {
    expect(await day.locator('.journal-row').count()).toBeLessThanOrEqual(5);
  }
  await expect(page.locator('.show-more-count')).toHaveText('Mostrando 50 de 521');
  // "Ver más" unfolds every day, so the first new entry is there to take focus.
  await page.getByRole('link', { name: 'Ver más' }).click();
  await page.waitForURL(/\?mostrar=100$/);
  await expect(rows).toHaveCount(100);
  await expect(rows.nth(50)).toBeFocused();

  // A hand-typed huge value is clamped to the cap, and the cap is announced, not silent.
  await gotoHydrated(page, `${home}/actividad?mostrar=100000`);
  await expect(rows).toHaveCount(500);
  await expect(page.getByText('Se muestran 500 de 521, empezando por lo más reciente.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver más' })).toHaveCount(0);
});

test('at the cap, Movimientos points to the CSV with everything', async ({ page }) => {
  const home = await createGroupAs(page, 'Tope pagos', ['Ana', 'Bea']);
  seedPayments(tokenOf(home), 505);
  await gotoHydrated(page, `${home}?mostrar=100000`);
  await expect(page.locator('.movement-card')).toHaveCount(500);
  await expect(page.getByText('Se muestran 500 de 505, empezando por lo más reciente.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Descargar todos en CSV' })).toHaveAttribute('href', /\/exportar$/);
});

test('Cerradas pages through every closed round of the bote, none out of reach', async ({ page }) => {
  const home = await createGroupAs(page, 'Bote de siempre', ['Ana', 'Bea']);
  seedClosedRounds(tokenOf(home), 25);
  await gotoHydrated(page, `${home}/bote/cerradas`);

  const cards = page.locator('.closed-round');
  await expect(cards).toHaveCount(5);
  await page.getByRole('button', { name: 'Ver 20 de 25 · Rondas cerradas', exact: true }).click();
  await expect(cards).toHaveCount(20);
  await expect(page.locator('.show-more-count')).toHaveText('Mostrando 20 de 25');
  await page.getByRole('link', { name: 'Ver más' }).click();
  await page.waitForURL(/\/bote\/cerradas\?mostrar=40$/);
  await expect(cards).toHaveCount(25);
  await expect(page.locator('#closed-rounds > [data-list-row]').nth(20)).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Ronda 1', exact: true })).toBeVisible();
});
