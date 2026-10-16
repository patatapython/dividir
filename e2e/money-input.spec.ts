import { expect } from '@playwright/test';
import { createGroup, test } from './support';

test('an amount is judged when the field is left, never mid-typing', async ({ page }) => {
  await createGroup(page, 'Tecleo', ['Ana', 'Bea']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity
  await expect(page.getByText('Eres Ana')).toBeVisible();
  // A client-side navigation: the form is hydrated before anything is typed.
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.waitForURL(/\/gastos\/nuevo$/);

  const amount = page.getByLabel('Importe (€)');
  const error = page.getByText('Importe no válido', { exact: false });

  // A pending decimal separator is a word being typed, not a mistake.
  await amount.fill('12,');
  await expect(error).toHaveCount(0);
  await expect(amount).not.toHaveAttribute('aria-invalid', 'true');

  // Leaving the field commits the value, and "12," is not an amount.
  await amount.press('Tab');
  await expect(error).toBeVisible();
  await expect(amount).toHaveAttribute('aria-invalid', 'true');

  // Editing withdraws the verdict; a valid value keeps it withdrawn after leaving.
  await amount.fill('12,5');
  await expect(error).toHaveCount(0);
  await amount.press('Tab');
  await expect(error).toHaveCount(0);
});

test('bote amounts carry no sample values and every contribution is validated', async ({ page }) => {
  await createGroup(page, 'Bote sin ejemplos', ['Ana', 'Bea']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity
  await expect(page.getByText('Eres Ana')).toBeVisible();
  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);

  // Empty state: the opening form shows no sample amount.
  await expect(page.getByLabel('Sobrante de otra vez (opcional)')).not.toHaveAttribute('placeholder');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();

  const decimalInputs = page.locator('input[inputmode="decimal"]');
  await expect(decimalInputs.first()).toBeVisible();
  for (const input of await decimalInputs.all()) {
    await expect(input).not.toHaveAttribute('placeholder');
  }

  // The quick-fill copies one amount to every row, so it only offers to once that amount is readable.
  const fillAll = page.getByRole('button', { name: 'Todos aportan lo mismo' });
  await page.getByLabel('Todos aportan').fill('diez');
  await expect(fillAll).toBeDisabled();
  await page.getByLabel('Todos aportan').fill('20,00');
  await expect(fillAll).toBeEnabled();
  await page.getByLabel('Todos aportan').fill('');

  // The per-person contribution is a real amount field: it is judged on leave.
  const anaContribution = page.getByLabel('Aporte de Ana', { exact: true });
  await anaContribution.fill('diez');
  await anaContribution.press('Tab');
  await expect(page.getByText('Importe no válido', { exact: false })).toBeVisible();
  await expect(anaContribution).toHaveAttribute('aria-invalid', 'true');
});
