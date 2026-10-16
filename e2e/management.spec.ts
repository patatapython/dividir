import { expect, type Page } from '@playwright/test';
import { createGroupAs, gotoHydrated, test } from './support';

async function confirm(page: Page, label: string) {
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function addExpense(page: Page, title: string, amount: string) {
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill(title);
  await page.getByLabel('Importe (€)').fill(amount);
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);
}

/** Who a new expense can be split between, as the form lists them. */
async function splitCandidates(page: Page, home: string): Promise<string> {
  await gotoHydrated(page, home);
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  const group = page.getByRole('group', { name: 'Entre quién se reparte' });
  await expect(group).toBeVisible();
  return (await group.textContent()) ?? '';
}

test('participants are added, renamed, archived and recovered from Ajustes, and the forms follow', async ({ page }) => {
  const home = await createGroupAs(page, 'Gestión personas', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Ajustes' }).click();
  await page.waitForURL(/\/ajustes$/);
  const row = (name: string) => page.locator('.participant-row').filter({ hasText: name });

  await page.getByLabel('Nuevo participante').fill('Dani');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(row('Dani')).toHaveCount(1);

  await row('Dani').getByRole('button', { name: 'Renombrar' }).click();
  await page.getByLabel('Nuevo nombre para Dani').fill('Daniela');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(row('Daniela')).toHaveCount(1);
  expect(await splitCandidates(page, home)).toContain('Daniela');

  await gotoHydrated(page, `${home}/ajustes`);
  await row('Bea').getByRole('button', { name: 'Archivar' }).click();
  await expect(row('Bea').getByRole('button', { name: 'Recuperar' })).toBeVisible();
  expect(await splitCandidates(page, home)).not.toContain('Bea');

  await gotoHydrated(page, `${home}/ajustes`);
  await row('Bea').getByRole('button', { name: 'Recuperar' }).click();
  await expect(row('Bea').getByRole('button', { name: 'Archivar' })).toBeVisible();
  expect(await splitCandidates(page, home)).toContain('Bea');
});

test('a payment can be deleted from the ledger, which brings the debt back', async ({ page }) => {
  const home = await createGroupAs(page, 'Borrar pago', ['Ana', 'Bea']);
  await addExpense(page, 'Cena', '20,00');
  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0);

  await gotoHydrated(page, home);
  await page.getByRole('button', { name: 'Eliminar pago' }).click();
  await expect(page.getByRole('dialog')).toContainText('¿Eliminar este pago?');
  await confirm(page, 'Eliminar');
  await expect(page.getByRole('button', { name: 'Eliminar pago' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);
  await expect(page.getByRole('button', { name: 'Registrar pago' })).toBeVisible();
});

test('the group is deleted only with its exact name, and its link then leads nowhere', async ({ page }) => {
  const home = await createGroupAs(page, 'Grupo condenado', ['Ana', 'Bea']);
  await addExpense(page, 'Cena', '20,00');
  await page.getByRole('link', { name: 'Ajustes' }).click();
  await page.waitForURL(/\/ajustes$/);

  const erase = page.getByRole('button', { name: 'Eliminar grupo definitivamente' });
  await page.getByLabel('Nombre del grupo').fill('grupo condenado');
  await expect(erase).toBeDisabled();
  await page.getByLabel('Nombre del grupo').fill('Grupo condenado');
  await erase.click();
  await page.waitForURL((url) => url.pathname === '/');

  await gotoHydrated(page, home);
  await expect(page.getByRole('heading', { level: 1, name: 'Grupo no encontrado' })).toBeVisible();
});

test('an unknown group and a gone expense each get their own not-found page', async ({ page }) => {
  await gotoHydrated(page, `/g/${'x'.repeat(24)}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Grupo no encontrado' })).toBeVisible();

  const home = await createGroupAs(page, 'Gasto perdido', ['Ana', 'Bea']);
  await addExpense(page, 'Cena', '20,00');
  await page.getByRole('link', { name: 'Cena' }).click();
  await page.waitForURL(/\/gastos\/[^/]+$/);
  const expenseUrl = page.url();
  await page.getByRole('region', { name: 'Eliminar gasto' }).getByRole('button', { name: 'Eliminar gasto' }).click();
  await confirm(page, 'Eliminar');
  await page.waitForURL(home);

  await gotoHydrated(page, expenseUrl);
  await expect(page.getByRole('heading', { name: 'Esto ya no existe' })).toBeVisible();
  // The group is still there: its name heads the page and the way back works.
  await expect(page.getByRole('heading', { level: 1, name: 'Gasto perdido' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver al grupo' }).click();
  await page.waitForURL(home);
});

test('an unknown path says the page does not exist, inside the group when the group exists', async ({ page }) => {
  await gotoHydrated(page, '/no-existe');
  await expect(page.getByRole('heading', { level: 1, name: 'Esta página no existe' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Grupo no encontrado' })).toHaveCount(0);

  const home = await createGroupAs(page, 'Ruta perdida', ['Ana', 'Bea']);
  await gotoHydrated(page, `${home}/no-existe`);
  await expect(page.getByRole('heading', { level: 2, name: 'Esta página no existe' })).toBeVisible();
  // Still inside the group: its name heads the page and the way back works.
  await expect(page.getByRole('heading', { level: 1, name: 'Ruta perdida' })).toBeVisible();
  await page.getByRole('link', { name: 'Volver al grupo' }).click();
  await page.waitForURL(home);

  // Any page of a group that does not exist is "group not found".
  await gotoHydrated(page, `/g/${'y'.repeat(24)}/gastos/nuevo`);
  await expect(page.getByRole('heading', { level: 1, name: 'Grupo no encontrado' })).toBeVisible();
});

