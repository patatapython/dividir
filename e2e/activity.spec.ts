import { expect, type Page } from '@playwright/test';
import { createGroupAs, test } from './support';

async function openActivity(page: Page) {
  await page.getByRole('link', { name: 'Actividad', exact: true }).click();
  await page.waitForURL(/\/actividad$/);
}

test('activity says how much and who, and leads to the entity while it exists (T-44)', async ({ page }) => {
  await createGroupAs(page, 'Diario enlaces', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe (€)').fill('40,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  await openActivity(page);
  const created = page.locator('.journal-row').filter({ hasText: 'añadió un gasto' });
  await expect(created).toContainText('Ana añadió un gasto: Cena');
  await expect(created).toContainText('pagó Ana');
  await expect(created).toContainText('40,00 €');

  // The entry leads to the expense itself (by keyboard); edit its amount there.
  await created.getByRole('link', { name: 'Cena' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForURL(/\/gastos\/[^/]+$/);
  await expect(page.getByLabel('Concepto')).toHaveValue('Cena');
  // The link left with its page: that is a navigation, whose focus belongs to the router,
  // not a removal on the same page (T-76 must not pull focus onto the group frame).
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await page.getByLabel('Importe (€)').fill('45,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  await openActivity(page);
  const edited = page.locator('.journal-row').filter({ hasText: 'editó un gasto' });
  await expect(edited).toContainText('45,00 €');
  await expect(edited).toContainText('antes 40,00 €');

  // Once deleted, no entry leads to it any more.
  await edited.getByRole('link', { name: 'Cena' }).click();
  await page.waitForURL(/\/gastos\/[^/]+$/);
  await page.getByRole('button', { name: 'Eliminar gasto' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  await openActivity(page);
  await expect(page.locator('.journal-row').filter({ hasText: 'eliminó un gasto' })).toContainText('45,00 €');
  await expect(page.locator('.journal-row').getByRole('link', { name: 'Cena' })).toHaveCount(0);
});

// Session 12: closing a round names it, and the entry leads to that round's own
// page with its whole sheet, whichever page of Cerradas it would fall on.
test('a closed round is named in Actividad and reached on its own page', async ({ page }) => {
  await createGroupAs(page, 'Diario rondas', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await page.getByLabel('Nombre de la ronda').fill('Agosto');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await page.getByLabel('Aporte de Bea', { exact: true }).fill('12,00');
  await page.getByRole('button', { name: 'Añadir aportes', exact: true }).click();
  await expect(page.getByLabel('Aporte de Bea', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Cerrar ronda' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar sin repartir' }).click();
  await page.waitForURL(/\/bote\/cerradas$/);

  await openActivity(page);
  const closed = page.locator('.journal-row').filter({ hasText: 'cerró una ronda del bote' });
  await expect(closed).toContainText('Ana cerró una ronda del bote: Agosto');
  await closed.getByRole('link', { name: 'Agosto' }).click();
  await page.waitForURL(/\/bote\/cerradas\/[^/]+$/);
  // The whole sheet is shown: no "Ver detalle" needed.
  await expect(page.getByRole('heading', { name: 'Agosto' })).toBeVisible();
  await expect(page.locator('.leader-row').filter({ hasText: 'Bea' })).toContainText('12,00 €');
  await expect(page.getByRole('button', { name: 'Ocultar' })).toBeVisible();
  await page.getByRole('link', { name: '← Todas las rondas cerradas' }).click();
  await page.waitForURL(/\/bote\/cerradas$/);
});

test('money and group-life entries share one column grid, told apart by a solid or hollow bar (T-77)', async ({ page }) => {
  await createGroupAs(page, 'Diario barras', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe (€)').fill('12,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);
  await openActivity(page);

  const money = page.locator('.journal-row').filter({ hasText: 'añadió un gasto' });
  const life = page.locator('.journal-row--life').filter({ hasText: 'creó el grupo' });
  const timeX = async (row: typeof money) => (await row.locator('.journal-time').boundingBox())?.x;
  expect(await timeX(life)).toBe(await timeX(money));

  // Lime means action, positive or selected (Bloques §3.1); a kind of entry is none of them.
  const bar = (row: typeof money) => row.evaluate((el) => {
    const style = getComputedStyle(el, '::before');
    return { background: style.backgroundColor, width: style.width };
  });
  const [moneyBar, lifeBar] = [await bar(money), await bar(life)];
  expect(lifeBar.width).toBe(moneyBar.width);
  expect(lifeBar.background).not.toBe(moneyBar.background);
  expect(lifeBar.background).not.toBe('rgb(214, 242, 74)');
});


// Session 10 backlog: every mutation writes to Actividad, and production prefetches
// the pages its links point to. A view fetched before a change must not be served
// after it: visit Actividad and Saldos first, change something, go back.
test('views visited before a change show it afterwards (reparto and bote)', async ({ page }) => {
  await createGroupAs(page, 'Diario fresco', ['Ana', 'Bea']);
  await openActivity(page);
  await page.getByRole('link', { name: 'Reparto', exact: true }).click();
  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);
  await expect(page.getByText('Todavía no hay gastos entre vosotros')).toBeVisible();

  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe (€)').fill('30,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  await openActivity(page);
  await expect(page.getByText('Cena')).toBeVisible();
  await page.getByRole('link', { name: 'Reparto', exact: true }).click();
  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);
  await expect(page.locator('.leader-row').filter({ hasText: 'Bea → Ana' })).toContainText('15,00 €');

  // The bote: an action there must reach Actividad too.
  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await page.getByLabel('Nombre de la ronda').fill('Bares');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await expect(page.getByText(/abierta/)).toBeVisible();
  await openActivity(page);
  await expect(page.getByText('abrió una ronda del bote')).toBeVisible();
});
