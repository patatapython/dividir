import { expect } from '@playwright/test';
import { createGroupAs, test } from './support';

// T-31: "Todo saldado" is a verdict on money that moved; a new group has none.
test('a group without movements is not stamped as settled', async ({ page }) => {
  await createGroupAs(page, 'Recien creado', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);
  await expect(page.getByText('Todavía no hay gastos')).toBeVisible();
  await expect(page.getByText('Todo saldado')).toHaveCount(0);
});

// Loopback of T-31: an unpaid charge is not a gasto between people, so a group
// that only has one says so without contradicting the charge listed below.
test('a group with only an unpaid charge is neither settled nor "without expenses"', async ({ page }) => {
  await createGroupAs(page, 'Solo pendiente', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Gasto sin pagar' }).click();
  await page.getByLabel('Concepto').fill('Casa rural');
  await page.getByLabel('Importe (€)').fill('400,00');
  await page.getByRole('button', { name: 'Guardar gasto sin pagar' }).click();
  await page.waitForURL(/\/g\/.{24}$/);
  await expect(page.getByText('Todavía no hay gastos entre vosotros')).toBeVisible();

  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);
  await expect(page.getByText('Todavía no hay gastos entre vosotros')).toBeVisible();
  await expect(page.getByText('Gastos sin pagar')).toBeVisible();
  await expect(page.getByText('Todo saldado')).toHaveCount(0);
});

// T-31: a failed payment is announced, not just painted.
test('a payment that fails is announced as an alert', async ({ page }) => {
  await createGroupAs(page, 'Pago fallido', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe (€)').fill('20,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);
  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);

  // The connection drops: the server action request never arrives.
  await page.route('**/*', (route) => (route.request().method() === 'POST' ? route.abort() : route.continue()));
  await page.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'No se ha podido completar la operación' })).toBeVisible();
});
