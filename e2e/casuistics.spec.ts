import { expect, type Page } from '@playwright/test';
import { createGroup, createGroupAs, gotoHydrated, hasFocusWithin, test } from './support';

test('itemized expense with an asymmetric per-item split', async ({ page }) => {
  await createGroup(page, 'Itemizado', ['Ana', 'Beto', 'Carla']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity

  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Cena');

  // Single-line mode: just the amount, split among everyone.
  await page.getByLabel('Importe (€)').fill('22,00');

  // Split into lines: the new line becomes the expanded one; exclude Carla from it.
  await page.getByRole('button', { name: /Trocear en líneas/ }).click();
  await page.getByLabel('Etiqueta del ítem').fill('Vino');
  await page.getByLabel('Importe (€)').fill('34,60');
  await page.getByLabel('Incluir a Carla').uncheck();

  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  // Feed shows the combined total.
  await expect(page.getByRole('link', { name: 'Cena' })).toBeVisible();
  await expect(page.getByText('56,60 €')).toBeVisible();

  // Carla only owes her share of item 1 (22,00 / 3 ≈ 7,33); Ana and Beto carry the wine.
  // Wait for Saldos itself: the Gastos grid also shows −7,33 €, so an early assertion
  // would pass on the page being left.
  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);
  await expect(page.locator('.balance-card').filter({ hasText: 'Carla' })).toContainText('−7,33 €');
  await expect(page.locator('.leader-row').filter({ hasText: 'Carla →' })).toContainText('7,33 €');
});

test('a refund can be registered and deleted', async ({ page }) => {
  await createGroup(page, 'Reembolsos', ['Ana', 'Beto']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity

  // A simple expense to refund.
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe (€)').fill('20,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  // Open it for edit and register a refund.
  await page.getByRole('link', { name: 'Cena' }).click();
  await page.getByRole('button', { name: 'Registrar devolución' }).click();
  await page.getByLabel('Importe devuelto (€)').fill('10,00');
  await page.getByRole('button', { name: 'Registrar devolución' }).click();
  await expect(page.getByText(/recibió Ana/)).toBeVisible();

  // Delete it through the confirmation dialog.
  await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(page.getByText(/recibió Ana/)).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // The deleted row held the button that opened the dialog: focus stays with the refunds (T-76).
  const refunds = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Devoluciones' }) });
  expect(await hasFocusWithin(refunds)).toBe(true);
});

async function openBoteRound(page: Page, name: string) {
  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await page.getByLabel('Nombre de la ronda').fill(name);
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await expect(page.getByText(/abierta/)).toBeVisible();
}

/** Fill the inline per-participant fields and submit them as one batch. */
async function contributeInline(page: Page, entries: Record<string, string>) {
  for (const [who, amount] of Object.entries(entries)) {
    await page.getByLabel(`Aporte de ${who}`, { exact: true }).fill(amount);
  }
  await page.getByRole('button', { name: 'Añadir aportes', exact: true }).click();
  for (const who of Object.keys(entries)) {
    await expect(page.getByLabel(`Aporte de ${who}`, { exact: true })).toHaveValue('');
  }
}

test('a bote spend cannot exceed the round balance (balance ≥ 0 invariant)', async ({ page }) => {
  await createGroup(page, 'BoteGuard', ['Ana', 'Beto']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity

  await openBoteRound(page, 'Sábado');
  await contributeInline(page, { Ana: '10,00' });

  // A spend above the current balance is rejected server-side with a Spanish message.
  await page.getByLabel('Concepto').fill('Cubata gigante');
  await page.getByLabel('Importe del gasto').fill('25,00');
  await page.getByRole('button', { name: 'Añadir gasto', exact: true }).click();
  await expect(page.locator('p.error')).toContainText('El gasto supera el saldo del bote');

  // The balance is untouched and a spend within it still works.
  const saldo = page.locator('.leader-row').filter({ hasText: 'Bote' }).filter({ hasNotText: 'Sobrante' });
  await expect(saldo).toContainText('10,00 €');
  await page.getByLabel('Importe del gasto').fill('7,00');
  await page.getByRole('button', { name: 'Añadir gasto', exact: true }).click();
  await expect(saldo).toContainText('3,00 €');
});

test('REPARTIR splits the balance proportionally to each person contributions', async ({ page }) => {
  await createGroup(page, 'BoteReparto', ['Ana', 'Beto']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity

  // Unequal contributions: Ana 30, Beto 10; spend 20 → balance 20.
  await openBoteRound(page, 'Domingo');
  await contributeInline(page, { Ana: '30,00', Beto: '10,00' });
  await page.getByLabel('Concepto').fill('Hielo');
  await page.getByLabel('Importe del gasto').fill('20,00');
  await page.getByRole('button', { name: 'Añadir gasto', exact: true }).click();

  // The payout preview is proportional (3:1), not equal: Ana 15, Beto 5.
  await page.getByRole('button', { name: 'Cerrar ronda' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.leader-row').filter({ hasText: 'Ana' })).toContainText('15,00 €');
  await expect(dialog.locator('.leader-row').filter({ hasText: 'Beto' })).toContainText('5,00 €');
  await dialog.getByRole('button', { name: 'Repartir', exact: true }).click();

  // Distribution closes the round with the frozen payout and never creates person-to-person debt.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('Repartido')).toBeVisible();
  await page.getByRole('link', { name: 'Reparto', exact: true }).click(); // the bote has no Saldos view
  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);
  // No reparto movement exists, so no plan and no "Todo saldado" verdict (T-31).
  await expect(page.getByText('Todavía no hay gastos')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0);
});

test('changing the payer is one tap, and several payers is a mode you enter and leave', async ({ page }) => {
  await createGroup(page, 'Un toque', ['Ana', 'Beto']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity

  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Taxi');
  await page.getByLabel('Importe (€)').fill('12,00');
  const payers = page.getByRole('radiogroup', { name: 'Pagado por' });
  await expect(payers.getByRole('radio', { name: 'Ana' })).toBeChecked();

  await payers.getByRole('radio', { name: 'Beto' }).check();
  await expect(payers.getByRole('radio', { name: 'Ana' })).not.toBeChecked();
  await expect(page.getByLabel(/^Pago de/)).toHaveCount(0);

  // Into several payers and back: back to one keeps the first payer, alone.
  await page.getByRole('button', { name: 'Varios pagadores' }).click();
  await page.getByRole('group', { name: 'Pagado por' }).getByRole('button', { name: 'Ana', exact: true }).click();
  await expect(page.getByLabel('Pago de Ana')).toBeVisible();
  await page.getByRole('button', { name: 'Un solo pagador' }).click();
  await expect(payers.getByRole('radio', { name: 'Beto' })).toBeChecked();
  await expect(page.getByLabel(/^Pago de/)).toHaveCount(0);

  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);
  await expect(page.getByText('Pagó Beto')).toBeVisible();
});

test('multi-payer expense enforces the payer sum', async ({ page }) => {
  await createGroup(page, 'MultiPago', ['Ana', 'Beto']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity

  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Hotel');
  await page.getByLabel('Importe (€)').fill('84,60');

  // Ana pays by default; several payers is an explicit mode, then Beto is added.
  await page.getByRole('button', { name: 'Varios pagadores' }).click();
  await page.getByRole('button', { name: 'Beto', exact: true }).click();
  await page.getByLabel('Pago de Ana').fill('50,00');
  await page.getByLabel('Pago de Beto').fill('30,00');

  // Terse beside the payers; the figures live in the list that explains the disabled save.
  await expect(page.getByText('Los pagos no cuadran con el total.')).toBeVisible();
  await expect(page.locator('.save-blockers')).toContainText('Los pagos suman 80,00 € y el total es 84,60 €.');
  await expect(page.getByRole('button', { name: 'Guardar gasto' })).toBeDisabled();

  // Fix the second payer so the amounts square.
  await page.getByLabel('Pago de Beto').fill('34,60');
  await expect(page.getByText(/no cuadran/)).toHaveCount(0);
  await expect(page.locator('.save-blockers')).toHaveCount(0);
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);
  await expect(page.getByRole('link', { name: 'Hotel' })).toBeVisible();
});

test('editing an adjustment made before someone joined leaves the newcomer out of it', async ({ page }) => {
  const home = await createGroupAs(page, 'Ajuste antiguo', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe (€)').fill('30,00');
  await page.getByRole('radio', { name: 'Ajuste (+/-)' }).check();
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(home);

  await page.getByRole('link', { name: 'Ajustes' }).click();
  await page.getByLabel('Nuevo participante').fill('Carla');
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect(page.locator('.participant-row').filter({ hasText: 'Carla' })).toHaveCount(1);

  await gotoHydrated(page, home);
  await page.getByRole('link', { name: 'Cena' }).click();
  await page.waitForURL(/\/gastos\/[^/]+$/);
  await expect(page.getByLabel('Incluir a Ana')).toBeChecked();
  await expect(page.getByLabel('Incluir a Carla')).not.toBeChecked();
  await page.getByLabel('Concepto').fill('Cena del viernes');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(home);

  // The split is still Ana and Bea's: Bea owes 15, Carla nothing.
  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);
  const carla = page.locator('.balance-card').filter({ hasText: 'Carla' });
  await expect(carla).toContainText('0,00');
  await expect(carla).not.toContainText('Debe');
  await expect(page.getByText('Bea → Ana')).toBeVisible();
});
