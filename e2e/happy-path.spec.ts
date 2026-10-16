import { expect } from '@playwright/test';
import { enterNewGroup, gotoHydrated, newClient, test } from './support';
import { formatCalendarDate, todayKey } from '../src/app/_ui/dates';

test('full group lifecycle: create, join from second browser, four split modes, settle to zero', async ({ browser }) => {
  const context1 = await newClient(browser);
  const page = await context1.newPage();

  // Create group
  await gotoHydrated(page, '/');
  await page.getByLabel('Nombre del grupo').fill('Viaje E2E');
  await page.getByLabel('Participante 1').fill('Ana');
  await page.getByLabel('Participante 2').fill('Beto');
  await page.getByRole('button', { name: 'Crear grupo' }).click();
  await enterNewGroup(page);
  const groupUrl = page.url();

  // Claim identity on device 1
  await page.getByRole('button', { name: /^Ana/ }).click();
  await expect(page.getByText('Eres Ana')).toBeVisible();

  // Join from a second browser context and claim the other identity
  const context2 = await newClient(browser);
  const page2 = await context2.newPage();
  await gotoHydrated(page2, groupUrl);
  await page2.getByRole('button', { name: /^Beto/ }).click();
  await expect(page2.getByText('Eres Beto')).toBeVisible();

  // One expense per split mode
  const addExpense = async (
    title: string,
    amount: string,
    mode: 'A partes iguales' | 'Por partes' | 'Por porcentaje' | 'Importes exactos',
    values?: string[],
  ) => {
    await page.getByRole('link', { name: 'Añadir gasto' }).click();
    await page.getByLabel('Concepto').fill(title);
    await page.getByLabel('Importe (€)').fill(amount);
    await page.getByRole('radio', { name: mode }).check();
    if (values) {
      await page.getByLabel('Parte de Ana').fill(values[0]);
      await page.getByLabel('Parte de Beto').fill(values[1]);
    }
    await expect(page.getByText('Vista previa del reparto')).toBeVisible();
    await page.getByRole('button', { name: 'Guardar gasto' }).click();
    await page.waitForURL(/\/g\/.{24}$/);
    await expect(page.getByRole('link', { name: title })).toBeVisible();
  };

  await addExpense('Hotel', '90,00', 'A partes iguales');
  await addExpense('Cena', '30,00', 'Importes exactos', ['10,00', '20,00']);
  await addExpense('Museo', '20,00', 'Por porcentaje', ['50', '50']);
  await addExpense('Taxi', '9,00', 'Por partes', ['1', '2']);
  // T-22: movements read as a Spanish date, never as raw ISO.
  await expect(page.locator('.movement-meta').first()).toContainText(formatCalendarDate(todayKey()));
  await expect(page.locator('.movement-meta').first()).not.toContainText(todayKey());

  // Settle: register every payment the plan proposes. Each registration
  // refreshes the page, so wait for the button count to drop before looping.
  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await expect(page.getByText(/Plan para saldar/)).toBeVisible();
  const registerButtons = page.getByRole('button', { name: 'Registrar pago' });
  for (;;) {
    const count = await registerButtons.count();
    if (count === 0) break;
    await registerButtons.first().click();
    await expect(registerButtons).toHaveCount(count - 1, { timeout: 15_000 });
  }
  await expect(page.getByText(/todo saldado/i)).toBeVisible();

  // Activity shows the story
  await page.getByRole('link', { name: 'Actividad' }).click();
  await expect(page.getByText('añadió un gasto: Hotel')).toBeVisible();
  await expect(page.getByText(/registró un pago/).first()).toBeVisible();

  await context1.close();
  await context2.close();
});
