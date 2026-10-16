import { expect } from '@playwright/test';
import { enterNewGroup, gotoHydrated, test } from './support';

test('the sample ticket says it is an example', async ({ page }) => {
  await gotoHydrated(page, '/');
  const sample = page.locator('.ticket').filter({ has: page.getByRole('heading', { name: 'Cena de equipo' }) });
  await expect(sample.getByText('Ejemplo', { exact: true })).toBeVisible();
});

test('participant rows: a new one takes focus, extra ones can be removed, two always stay', async ({ page }) => {
  await gotoHydrated(page, '/');
  await page.getByLabel('Nombre del grupo').click(); // hydrated before typing
  const remove = page.getByRole('button', { name: /^Quitar participante/ });
  await expect(remove).toHaveCount(0);

  await page.getByLabel('Participante 1', { exact: true }).fill('Ana');
  await page.getByLabel('Participante 2', { exact: true }).fill('Beto');
  await page.getByRole('button', { name: 'Añadir participante' }).click();
  await expect(page.getByLabel('Participante 3', { exact: true })).toBeFocused();
  await page.keyboard.type('Carla');
  await expect(remove).toHaveCount(3);

  await page.getByRole('button', { name: 'Quitar participante 2' }).click();
  await expect(page.getByLabel('Participante 1', { exact: true })).toHaveValue('Ana');
  await expect(page.getByLabel('Participante 2', { exact: true })).toHaveValue('Carla');
  await expect(page.getByLabel('Participante 3', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Participante 2', { exact: true })).toBeFocused();
  await expect(remove).toHaveCount(0);

  await page.getByLabel('Nombre del grupo').fill('Filas');
  await page.getByRole('button', { name: 'Crear grupo' }).click();
  await enterNewGroup(page);
  const dialog = page.getByRole('dialog', { name: '¿Quién eres?' });
  await expect(dialog.getByRole('button', { name: /^Ana/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Carla/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Beto/ })).toHaveCount(0);
});

test('how it works is shown, not linked: no link points further down the same page', async ({ page }) => {
  await gotoHydrated(page, '/');
  const how = page.getByRole('region', { name: 'Cómo funciona' });
  await expect(how).toBeVisible();
  for (const step of ['Apunta', 'Divide', 'Salda']) {
    await expect(how.getByRole('heading', { name: step, level: 3 })).toBeVisible();
  }
  await expect(page.locator('a[href^="#"]')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Crear un grupo' }).getByRole('button', { name: 'Crear grupo' })).toBeVisible();
});
