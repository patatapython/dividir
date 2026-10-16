import { expect, type Page } from '@playwright/test';
import { createGroupAs, gotoHydrated, hasFocusWithin, test } from './support';

// D-03: every action that deletes or discards stored state asks through the
// app's own dialog; an action undone in place (archive) never asks; deleting
// the group asks for its typed name (covered by group-settings).

async function confirm(page: Page, label: string) {
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('bote deletions and reopening a round ask first; cancelling keeps the data', async ({ page }) => {
  await createGroupAs(page, 'Confirmaciones bote', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await page.getByLabel('Nombre de la ronda').fill('Sábado');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await page.getByLabel('Aporte de Ana', { exact: true }).fill('20,00');
  await page.getByRole('button', { name: 'Añadir aportes', exact: true }).click();
  await expect(page.getByLabel('Aporte de Ana', { exact: true })).toHaveValue('');
  await page.getByLabel('Concepto').fill('Hielo');
  await page.getByLabel('Importe del gasto').fill('8,00');
  await page.getByRole('button', { name: 'Añadir gasto', exact: true }).click();
  const saldo = page.locator('.leader-row').filter({ hasText: 'Bote' }).filter({ hasNotText: 'Sobrante' });
  await expect(saldo).toContainText('12,00 €');

  // Contribution: cancel keeps it, confirm removes it.
  await page.getByRole('button', { name: 'Eliminar aporte de Ana' }).click();
  await expect(page.getByRole('dialog')).toContainText('20,00 €');
  await confirm(page, 'Cancelar');
  await expect(saldo).toContainText('12,00 €');

  // Spend: confirm removes it.
  await page.getByRole('button', { name: 'Eliminar gasto Hielo' }).click();
  await expect(page.getByRole('dialog')).toContainText('Hielo');
  await confirm(page, 'Eliminar');
  await expect(saldo).toContainText('20,00 €');

  // Reopening discards the stored close, so it asks too.
  await page.getByRole('button', { name: 'Cerrar ronda' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar sin repartir' }).click();
  await page.getByRole('button', { name: 'Ver detalle' }).click();
  await page.getByRole('button', { name: 'Reabrir ronda' }).click();
  await confirm(page, 'Cancelar');
  await expect(page.getByText(/abierta/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Reabrir ronda' }).click();
  await confirm(page, 'Reabrir');
  await expect(page.getByText(/abierta/)).toBeVisible();
});

test('deleting a participant asks; archiving is undone in place and never asks', async ({ page }) => {
  await createGroupAs(page, 'Confirmaciones personas', ['Ana', 'Bea', 'Carla']);
  await page.getByRole('link', { name: 'Ajustes' }).click();
  await page.waitForURL(/\/ajustes$/);
  const row = (name: string) => page.locator('.participant-row').filter({ hasText: name });

  await row('Carla').getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.getByRole('dialog')).toContainText('Carla');
  await confirm(page, 'Cancelar');
  await expect(row('Carla')).toHaveCount(1);
  await row('Carla').getByRole('button', { name: 'Eliminar' }).click();
  await confirm(page, 'Eliminar');
  await expect(row('Carla')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The row that opened the dialog is gone: focus stays with the people, not on the page (T-76).
  const people = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Participantes' }) });
  expect(await hasFocusWithin(people)).toBe(true);

  await row('Bea').getByRole('button', { name: 'Archivar' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(row('Bea').getByRole('button', { name: 'Recuperar' })).toBeVisible();
  // "Archivar" was replaced in place by "Recuperar": focus is not dropped either.
  expect(await hasFocusWithin(people)).toBe(true);
});

test('a duplicate payment is confirmed through the app dialog, not the browser', async ({ page, context }) => {
  await createGroupAs(page, 'Confirmaciones pagos', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe (€)').fill('20,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);
  const balances = `${page.url()}/balances`;

  // Two flatmates look at the same plan; one registers the payment first.
  await gotoHydrated(page, balances);
  const other = await context.newPage();
  await gotoHydrated(other, balances);
  await other.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(other.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0);

  let nativeDialog = false;
  page.on('dialog', (d) => { nativeDialog = true; void d.dismiss(); });
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByRole('dialog')).toContainText('pago idéntico');
  await confirm(page, 'Cancelar');
  expect(nativeDialog).toBe(false);
});

// A delete the server rejects keeps its dialog open with the reason inside,
// never behind the backdrop or nowhere (loopback of session 2).
test('a rejected delete keeps the dialog open and shows why', async ({ page, context }) => {
  await createGroupAs(page, 'Confirmaciones fallos', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe (€)').fill('20,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);
  const home = page.url();

  // Participant with an expense: the server refuses.
  await gotoHydrated(page, `${home}/ajustes`);
  await page.locator('.participant-row').filter({ hasText: 'Bea' }).getByRole('button', { name: 'Eliminar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('No se puede eliminar');

  // Refund and expense already deleted from another device: the second delete fails.
  await gotoHydrated(page, home);
  await page.getByRole('link', { name: 'Cena' }).click();
  await page.waitForURL(/\/gastos\/[^/]+$/);
  const expenseUrl = page.url();
  await page.getByRole('button', { name: 'Registrar devolución' }).click();
  await page.getByLabel('Importe devuelto (€)').fill('5,00');
  await page.getByRole('button', { name: 'Registrar devolución' }).click();
  await expect(page.getByRole('button', { name: 'Eliminar', exact: true })).toBeVisible();

  const other = await context.newPage();
  await gotoHydrated(other, expenseUrl);
  await other.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await other.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(other.getByRole('button', { name: 'Eliminar', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('La devolución ya no existe');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();

  await other.getByRole('button', { name: 'Eliminar gasto' }).click();
  await other.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await other.waitForURL(/\/g\/.{24}$/);

  await page.getByRole('button', { name: 'Eliminar gasto' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('El gasto ya no existe');

  // T-72: opening the vanished expense says so inside the group, which still exists.
  await gotoHydrated(page, expenseUrl);
  await expect(page.getByRole('heading', { name: 'Esto ya no existe' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver al grupo' }).click();
  await page.waitForURL(home);

  // An unknown token is the only "group not found".
  await gotoHydrated(page, home.replace(/.{24}$/, 'x'.repeat(24)));
  await expect(page.getByRole('heading', { name: 'Grupo no encontrado' })).toBeVisible();
});
