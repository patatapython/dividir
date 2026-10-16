import { expect } from '@playwright/test';
import { createGroupAs, test } from './support';

test('the expense form can be left, saves back to the ledger and keeps delete apart', async ({ page }) => {
  await createGroupAs(page, 'Formularios gasto', ['Ana', 'Bea']);
  const home = page.url();

  // Cancel leaves without creating anything.
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.waitForURL(/\/gastos\/nuevo$/);
  await expect(page.getByRole('group', { name: 'Entre quién se reparte' })).toContainText('Bea');
  await expect(page.getByRole('button', { name: 'Eliminar gasto' })).toHaveCount(0); // nothing to delete yet
  await page.getByLabel('Concepto').fill('Borrador');
  await page.getByRole('link', { name: 'Cancelar' }).click();
  await page.waitForURL(home);
  await expect(page.getByRole('link', { name: 'Borrador' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe (€)').fill('20,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(home);

  // Editing saves back to the ledger, where the change is visible.
  await page.getByRole('link', { name: 'Cena' }).click();
  await page.waitForURL(/\/gastos\/[^/]+$/);
  await page.getByLabel('Concepto').fill('Cena y copas');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(home);
  await expect(page.getByRole('link', { name: 'Cena y copas' })).toBeVisible();

  // Delete is not a neighbour of save: it lives outside the form, after the refunds.
  await page.getByRole('link', { name: 'Cena y copas' }).click();
  await page.waitForURL(/\/gastos\/[^/]+$/);
  await expect(page.locator('form').getByRole('button', { name: 'Eliminar gasto' })).toHaveCount(0);
  const deleteZone = page.getByRole('region', { name: 'Eliminar gasto' });
  await expect(deleteZone).toBeVisible();
  const refundsBottom = await page.getByText('Devoluciones', { exact: true }).boundingBox();
  const deleteTop = await deleteZone.boundingBox();
  expect(deleteTop!.y).toBeGreaterThan(refundsBottom!.y);

  await deleteZone.getByRole('button', { name: 'Eliminar gasto' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.waitForURL(home);
  await expect(page.getByRole('link', { name: 'Cena y copas' })).toHaveCount(0);
});

test('the unpaid-charge form has the same exits and titled participant group', async ({ page }) => {
  await createGroupAs(page, 'Formularios pendientes', ['Ana', 'Bea']);
  const home = page.url();

  await page.getByRole('link', { name: 'Gasto sin pagar' }).click();
  await page.waitForURL(/\/sin-pagar\/nuevo$/);
  await expect(page.getByRole('group', { name: 'Entre quién se reparte' })).toContainText('Bea');
  await page.getByRole('link', { name: 'Cancelar' }).click();
  await page.waitForURL(home);

  await page.getByRole('link', { name: 'Gasto sin pagar' }).click();
  await page.getByLabel('Concepto').fill('Casa rural');
  await page.getByLabel('Importe (€)').fill('300,00');
  await page.getByRole('button', { name: 'Guardar gasto sin pagar' }).click();
  await page.waitForURL(home);

  await page.getByRole('link', { name: 'Casa rural' }).click();
  await page.waitForURL(/\/sin-pagar\/[^/]+$/);
  await page.getByLabel('Concepto').fill('Casa rural y leña');
  await page.getByRole('button', { name: 'Guardar gasto sin pagar' }).click();
  await page.waitForURL(home);
  await expect(page.getByRole('link', { name: 'Casa rural y leña' })).toBeVisible();

  await page.getByRole('link', { name: 'Casa rural y leña' }).click();
  await expect(page.locator('form').getByRole('button', { name: 'Eliminar gasto sin pagar' })).toHaveCount(0);
  await page.getByRole('region', { name: 'Eliminar gasto sin pagar' }).getByRole('button', { name: 'Eliminar gasto sin pagar' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await page.waitForURL(home);
  await expect(page.getByRole('link', { name: 'Casa rural y leña' })).toHaveCount(0);
});

test('a split row says what is wrong beside it, and save says why it is closed', async ({ page }) => {
  await createGroupAs(page, 'Formularios reparto', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.waitForURL(/\/gastos\/nuevo$/);

  const save = page.getByRole('button', { name: 'Guardar gasto' });
  const blockers = page.locator('.save-blockers');
  await expect(save).toBeDisabled();
  await expect(blockers).toContainText('Falta el concepto.');
  await expect(blockers).toContainText('Falta el importe.');

  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe (€)').fill('20,00');
  await page.getByLabel('Por porcentaje').check();
  // Empty rows are pending, not wrong: listed as missing, never flagged on the row.
  await expect(blockers).toContainText('Falta la parte de Ana y Bea.');
  await expect(page.locator('.share-row .error')).toHaveCount(0);

  // An unreadable row is flagged beside it once left, with an example.
  const ana = page.getByLabel('Parte de Ana');
  await ana.fill('treinta');
  await ana.press('Tab');
  await expect(page.locator('.share-row').filter({ hasText: 'Ana' }).locator('.error')).toHaveText(
    /Porcentaje no válido \(ejemplo: 33,33\)/,
  );
  await expect(ana).toHaveAttribute('aria-invalid', 'true');
  await expect(blockers).toContainText('Completa o corrige la parte de Ana.');
  await expect(blockers).toContainText('Falta la parte de Bea.');

  // Readable rows that do not add up: save says by how much.
  await ana.fill('50');
  await page.getByLabel('Parte de Bea').fill('40');
  await expect(page.locator('.share-row .error')).toHaveCount(0);
  await expect(blockers).toHaveText(/Los porcentajes suman 90 %; deben sumar 100 %\./);
  await expect(save).toHaveAttribute('aria-describedby', /.+/);

  await page.getByLabel('Parte de Bea').fill('50');
  await expect(blockers).toHaveCount(0);
  await expect(save).toBeEnabled();
  await expect(save).not.toHaveAttribute('aria-describedby');
  await save.click();
  await page.waitForURL(/\/g\/.{24}$/);
});

// Session 12 (simulation backlog): at 320 px a long name pushed its value under it, to
// the left, so the values of one list did not line up. Every row is name | value.
test('share values line up in one column at 320 px, whatever the name length', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await createGroupAs(page, 'Filas', ['Ana', 'Teodoro (el de siempre)', 'Bea']);
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.waitForURL(/\/gastos\/nuevo$/);
  await page.getByLabel('Importes exactos').check();

  const shares = page.getByRole('group', { name: 'Entre quién se reparte' });
  const boxes = await Promise.all(['Ana', 'Teodoro (el de siempre)', 'Bea'].map(async (name) => ({
    value: await shares.getByLabel(`Parte de ${name}`, { exact: true }).boundingBox(),
    check: await shares.getByLabel(`Incluir a ${name}`, { exact: true }).boundingBox(),
  })));
  const [ana, teodoro, bea] = boxes;
  // One column of values, right where the short names have it.
  expect(teodoro.value!.x).toBe(ana.value!.x);
  expect(bea.value!.x).toBe(ana.value!.x);
  // And on the row of its own name (not a line below it), whose checkbox keeps its size.
  expect(teodoro.value!.y).toBeLessThan(teodoro.check!.y + teodoro.check!.height);
  expect(teodoro.check!.width).toBe(ana.check!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
