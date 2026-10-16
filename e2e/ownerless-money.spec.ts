import { expect } from '@playwright/test';
import { createGroup, test } from './support';

// §6 Case B: Comida 200 paid by Ana 100 + the "Sobrante" 100. The ownerless
// money folds onto the people in settle → Ana +75, others −25.
test('Model B — the Sobrante payer folds into the person-to-person settlement', async ({ page }) => {
  await createGroup(page, 'Con sobrante', ['Ana', 'Beto', 'Carla', 'Dani']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity

  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Comida');
  await page.getByLabel('Importe (€)').fill('200,00');

  // Ana pays by default; add the "Sobrante" as a second payer.
  await page.getByRole('button', { name: 'Varios pagadores' }).click();
  await page.getByRole('button', { name: 'Sobrante', exact: true }).click();
  await page.getByLabel('Pago de Ana').fill('100,00');
  await page.getByLabel('Pago de Sobrante').fill('100,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  // Ana +75 (folded), Beto/Carla/Dani owe Ana 25 each.
  await expect(page.getByText('+75,00 €')).toBeVisible();
  await expect(page.locator('.leader-row').filter({ hasText: 'Beto → Ana' })).toContainText('25,00 €');
  await expect(page.locator('.leader-row').filter({ hasText: 'Dani → Ana' })).toContainText('25,00 €');
  // Ownerless money is real money in settle, never an external charge.
  await expect(page.getByText('Gastos sin pagar')).toHaveCount(0);
});

// §6 Case A: Casa rural 400 (no payer) is external debt only; a separate Comida
// 80 paid by Ana drives the internal settle. The two layers never mix.
test('Model A — gasto sin pagar is an external charge, never in the internal settle', async ({ page }) => {
  await createGroup(page, 'GastoSinPagar', ['Ana', 'Beto', 'Carla', 'Dani']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity

  // A normal expense: Comida 80 paid by Ana → Beto/Carla/Dani owe Ana 20.
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Comida');
  await page.getByLabel('Importe (€)').fill('80,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  // The unpaid group charge: Casa rural 400, equal split, no payer.
  await page.getByRole('link', { name: 'Gasto sin pagar' }).click();
  await page.getByLabel('Concepto').fill('Casa rural');
  await page.getByLabel('Importe (€)').fill('400,00');
  await page.getByRole('button', { name: 'Guardar gasto sin pagar' }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  // The home lists the charge for editing, signed like any expense, with each person's share.
  const charge = page.locator('.ticket--pending .movement-row').filter({ hasText: 'Casa rural' });
  await expect(charge.getByRole('link', { name: 'Casa rural' })).toBeVisible();
  await expect(charge.locator('.money--neg')).toHaveText('−400,00 €');
  await expect(charge.locator('.charge-shares')).toHaveText('Ana 100,00 € · Beto 100,00 € · Carla 100,00 € · Dani 100,00 €');

  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  // Internal settle reflects ONLY the comida: Beto/Carla/Dani → Ana 20.
  await expect(page.locator('.leader-row').filter({ hasText: 'Beto → Ana' })).toContainText('20,00 €');
  // A separate section lists each person's external 100, never blended in.
  await expect(page.getByRole('heading', { name: 'Gastos sin pagar' })).toBeVisible();
  // Each card reads both accounts side by side, never netted: Ana is owed 60
  // inside and still pays 100 outside; Beto owes 20 inside plus 100 outside.
  const card = (name: string) => page.locator('.balance-card').filter({ has: page.getByText(name, { exact: true }) });
  await expect(card('Ana').locator(':scope > .money')).toHaveText('+60,00 €');
  await expect(card('Ana').locator('.final-account')).toContainText('Sin pagar−100,00 €');
  await expect(card('Ana').locator('.final-account-total')).toHaveText('Total a poner100,00 €');
  await expect(card('Beto').locator('.final-account-total')).toHaveText('Total a poner120,00 €');
});

// The declared leftover is a helper (D-04): declared once in Ajustes, applied by hand from
// the "Sobrante" payer chip, and reminded on the home only while something is declared.
test('Sobrante — declared in Ajustes, reminded while declared, emptied with a confirmation', async ({ page }) => {
  await createGroup(page, 'Sobrante declarado', ['Ana', 'Beto']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity
  await expect(page.getByText('Eres Ana')).toBeVisible();
  await expect(page.locator('.leftover-line')).toHaveCount(0);

  // Nothing declared: choosing the chip says where to declare it.
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByRole('radio', { name: 'Sobrante' }).check();
  await expect(page.getByText('Para llevar la cuenta, decláralo en Ajustes')).toBeVisible();
  await page.getByRole('link', { name: 'Cancelar' }).click();

  await page.getByRole('link', { name: 'Ajustes' }).click();
  await page.waitForURL(/\/ajustes$/);
  await page.getByLabel('Sobrante declarado (€)').fill('80,00');
  await page.getByRole('button', { name: 'Guardar sobrante' }).click();
  await expect(page.getByText('quedan 80,00 €')).toBeVisible();

  // The home reminds, and the reminder leads back to Ajustes.
  await page.getByRole('navigation', { name: 'Modalidad' }).getByRole('link', { name: 'Reparto' }).click();
  const line = page.locator('.leftover-line');
  await expect(line).toHaveText(/Sobrante: quedan 80,00 €/);

  // Applying 30 from the chip lowers what is left everywhere.
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await expect(page.locator('.payer-cell').filter({ hasText: 'Sobrante' })).toContainText('quedan 80,00 €');
  await page.getByLabel('Concepto').fill('Pizzas');
  await page.getByLabel('Importe (€)').fill('30,00');
  await page.getByRole('radio', { name: 'Sobrante' }).check(); // the Sobrante pays it all
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);
  await expect(page.getByText('Pagó Sobrante')).toBeVisible();
  await expect(line).toHaveText(/Sobrante: quedan 50,00 €/);

  // Emptying it discards stored state, so it asks first (D-03); then the reminder goes.
  await line.click();
  await page.waitForURL(/\/ajustes$/);
  await page.getByRole('button', { name: 'Vaciar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Vaciar' }).click();
  await expect(page.getByRole('button', { name: 'Vaciar' })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Modalidad' }).getByRole('link', { name: 'Reparto' }).click();
  await expect(page.getByText('Pagó Sobrante')).toBeVisible();
  await expect(line).toHaveCount(0);
});

// Owner review (session 10): once somebody pays an unpaid charge in full it is
// an ordinary expense of theirs, with the same split, inside the reparto.
test('"Lo pagó X" turns an unpaid charge into an expense of whoever paid it', async ({ page }) => {
  await createGroup(page, 'Casa pagada', ['ana', 'juan', 'pollo']);
  await page.getByRole('button', { name: /^ana/ }).click(); // claim identity

  await page.getByRole('link', { name: 'Gasto sin pagar' }).click();
  await page.getByLabel('Concepto').fill('casa rural');
  await page.getByLabel('Importe (€)').fill('300,00');
  await page.getByRole('button', { name: 'Guardar gasto sin pagar' }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  await page.getByRole('link', { name: 'casa rural' }).click();
  await page.waitForURL(/\/gastos\/sin-pagar\/[^/]+$/);
  const zone = page.getByRole('region', { name: '¿Ya lo ha pagado alguien?' });
  await expect(zone.getByRole('button', { name: 'Lo pagó…' })).toBeDisabled();
  await expect(zone.getByRole('button', { name: 'Lo pagó…' })).toHaveAccessibleDescription('Elige quién lo pagó.');
  await zone.getByRole('radio', { name: 'pollo' }).check();
  await zone.getByRole('button', { name: 'Lo pagó pollo' }).click();
  // It deletes the unpaid charge, so it asks first (D-03); cancelling changes nothing.
  const dialog = page.getByRole('dialog', { name: '¿Lo pagó pollo?' });
  await expect(dialog).toContainText('«casa rural» deja de estar sin pagar');
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(dialog).toHaveCount(0);
  await zone.getByRole('button', { name: 'Lo pagó pollo' }).click();
  await dialog.getByRole('button', { name: 'Sí, lo pagó pollo' }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  // No unpaid charges left; the expense is in Movimientos, paid by pollo.
  await expect(page.getByRole('heading', { name: 'Gastos sin pagar' })).toHaveCount(0);
  const row = page.locator('.movement-card').filter({ hasText: 'casa rural' });
  await expect(row).toContainText('−300,00 €');
  await expect(row).toContainText(/Pagó pollo/i);
  // …and inside the reparto: ana and juan owe pollo 100 each.
  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);
  await expect(page.locator('.leader-row').filter({ hasText: 'ana → pollo' })).toContainText('100,00 €');
  await expect(page.locator('.leader-row').filter({ hasText: 'juan → pollo' })).toContainText('100,00 €');
});
