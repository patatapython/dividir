import { expect, type Page } from '@playwright/test';
import { enterNewGroup, gotoHydrated, test } from './support';

/**
 * The heading outline of a page (T-29): exactly one h1, first, and no level
 * skipped on the way down. Section labels are real headings, so a screen
 * reader can jump between sections.
 */
async function expectSoundOutline(page: Page, where: string) {
  const levels = await page.locator('h1, h2, h3, h4, h5, h6').evaluateAll((els) =>
    els.map((el) => `${el.tagName[1]} ${el.textContent?.trim()}`),
  );
  const problems: string[] = [];
  if (levels.filter((l) => l.startsWith('1 ')).length !== 1) problems.push('not exactly one h1');
  if (!levels[0]?.startsWith('1 ')) problems.push('h1 is not first');
  for (let i = 1; i < levels.length; i++) {
    if (Number(levels[i][0]) > Number(levels[i - 1][0]) + 1) problems.push(`skips a level at "${levels[i]}"`);
  }
  expect(problems, `${where}:\n${levels.join('\n')}`).toEqual([]);
  expect(levels.length, `${where} has section headings`).toBeGreaterThan(1);
}

test('every screen has a sound heading outline', async ({ page }) => {
  await gotoHydrated(page, '/');
  await expectSoundOutline(page, 'landing');

  await page.getByLabel('Nombre del grupo').fill('Esquema');
  await page.getByLabel('Participante 1').fill('Ana');
  await page.getByLabel('Participante 2').fill('Bea');
  await page.getByRole('button', { name: 'Crear grupo' }).click();
  await page.waitForURL(/\/compartir$/);
  await expect(page.getByRole('heading', { name: 'Comparte el grupo' })).toBeVisible();
  await expectSoundOutline(page, 'share');
  await enterNewGroup(page);
  const home = page.url();
  await page.getByRole('dialog').getByRole('button', { name: /^Ana/ }).click();
  await expect(page.getByRole('button', { name: /^Eres Ana/ })).toBeVisible();

  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo gasto' })).toBeVisible();
  await expectSoundOutline(page, 'new expense');
  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe (€)').fill('10,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(home);

  await page.getByRole('link', { name: 'Gasto sin pagar' }).click();
  await expect(page.getByRole('heading', { name: 'Nuevo gasto sin pagar' })).toBeVisible();
  await expectSoundOutline(page, 'new unpaid expense');
  await page.getByLabel('Concepto').fill('Casa rural');
  await page.getByLabel('Importe (€)').fill('30,00');
  await page.getByRole('button', { name: 'Guardar gasto sin pagar' }).click();
  await page.waitForURL(home);
  await expect(page.getByRole('heading', { name: 'Movimientos' })).toBeVisible();
  await expectSoundOutline(page, 'gastos');

  await page.getByRole('link', { name: 'Cena' }).click();
  await expect(page.getByRole('heading', { name: 'Editar gasto' })).toBeVisible();
  await expectSoundOutline(page, 'edit expense');
  await page.getByRole('link', { name: 'Cancelar' }).click();
  await page.waitForURL(home);

  await page.getByRole('link', { name: 'Casa rural' }).click();
  await expect(page.getByRole('heading', { name: 'Editar gasto sin pagar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '¿Ya lo ha pagado alguien?' })).toBeVisible();
  await expectSoundOutline(page, 'edit unpaid expense');
  await page.getByRole('link', { name: 'Cancelar' }).click();
  await page.waitForURL(home);

  await page.getByRole('link', { name: 'Saldos' }).click();
  await expect(page.getByRole('heading', { name: 'Saldo neto' })).toBeVisible();
  await expectSoundOutline(page, 'saldos');

  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Abrir ronda' })).toBeVisible();
  await expectSoundOutline(page, 'bote without a round');
  await page.getByLabel('Nombre de la ronda').fill('Sábado');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await expect(page.getByText(/abierta/)).toBeVisible();
  await page.getByLabel('Aporte de Ana', { exact: true }).fill('20,00');
  await page.getByRole('button', { name: 'Añadir aportes', exact: true }).click();
  await expect(page.getByLabel('Aporte de Ana', { exact: true })).toHaveValue('');
  await expectSoundOutline(page, 'open round');
  await page.getByRole('button', { name: 'Cerrar ronda' }).click();
  await expectSoundOutline(page, 'close round dialog');
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar sin repartir' }).click();
  await page.waitForURL(/\/bote\/cerradas$/);
  await page.getByRole('button', { name: 'Ver detalle' }).click();
  await expect(page.getByRole('heading', { name: 'Aportes' })).toBeVisible();
  await expectSoundOutline(page, 'closed rounds');

  await page.getByRole('link', { name: 'Actividad' }).click();
  await expect(page.getByRole('heading', { name: /^Hoy/ })).toBeVisible();
  await expectSoundOutline(page, 'actividad');
  await page.locator('.journal-row').filter({ hasText: 'cerró una ronda' }).getByRole('link', { name: 'Sábado' }).click();
  await page.waitForURL(/\/bote\/cerradas\/[^/]+$/);
  await expect(page.getByRole('heading', { name: 'Aportes' })).toBeVisible();
  await expectSoundOutline(page, 'closed round page');

  await page.getByRole('link', { name: 'Ajustes' }).click();
  await expect(page.getByRole('heading', { name: 'Participantes' })).toBeVisible();
  await expectSoundOutline(page, 'ajustes');

  await gotoHydrated(page, `${home}/gastos/no-existe`);
  await expect(page.getByRole('heading', { name: 'Esto ya no existe' })).toBeVisible();
  await expectSoundOutline(page, 'gone inside the group');
});
