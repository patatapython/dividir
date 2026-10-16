import { expect, type Page } from '@playwright/test';
import { createGroupAs, gotoHydrated, test } from './support';

// D-01/D-02: REPARTO | BOTE switch always visible, each mode with its views
// and a fixed intro; Activity and Settings live in the header.

const modeSwitch = (page: Page) => page.getByRole('navigation', { name: 'Modalidad' });
const current = (page: Page, nav: string) => page.getByRole('navigation', { name: nav }).locator('[aria-current="page"]');

/** No horizontal page scroll, and the two mode tabs share one row. */
async function expectFitsNarrowScreen(page: Page) {
  const layout = await page.evaluate(() => {
    const tabs = [...document.querySelectorAll('nav[aria-label="Modalidad"] a')].map((a) => a.getBoundingClientRect().top);
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, tabs };
  });
  expect(layout.overflow).toBeLessThanOrEqual(0);
  expect(layout.tabs).toHaveLength(2);
  expect(layout.tabs[0]).toBe(layout.tabs[1]);
}

test('each route marks its mode and view; activity and settings belong to none', async ({ page }) => {
  const home = await createGroupAs(page, 'Navegación', ['Ana', 'Bea']);

  await expect(current(page, 'Modalidad')).toHaveText('Reparto');
  await expect(current(page, 'Vistas del reparto')).toHaveText('Gastos');
  await expect(page.getByText('Reparto entre personas')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Añadir gasto' })).toBeVisible();

  // A form nested under Gastos keeps Gastos active but drops the intro and the action bar.
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.waitForURL(/\/gastos\/nuevo$/);
  await expect(current(page, 'Vistas del reparto')).toHaveText('Gastos');
  await expect(page.getByText('Reparto entre personas')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Gasto sin pagar' })).toHaveCount(0);

  await page.getByRole('navigation', { name: 'Vistas del reparto' }).getByRole('link', { name: 'Saldos' }).click();
  await page.waitForURL(/\/balances$/);
  await expect(current(page, 'Vistas del reparto')).toHaveText('Saldos');

  await modeSwitch(page).getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await expect(current(page, 'Modalidad')).toHaveText('Bote');
  await expect(current(page, 'Vistas del bote')).toHaveText('Ronda');
  await expect(page.getByText('Bote común')).toBeVisible();
  await expect(page.getByText('Dinero de todos y de nadie')).toBeVisible();
  await expect(page.getByText('No hay ninguna ronda abierta')).toBeVisible(); // T-42 empty state
  await expect(page.getByRole('link', { name: 'Añadir gasto' })).toHaveCount(0); // no bottom bar in the bote

  await page.getByRole('navigation', { name: 'Vistas del bote' }).getByRole('link', { name: 'Cerradas' }).click();
  await page.waitForURL(/\/bote\/cerradas$/);
  await expect(current(page, 'Vistas del bote')).toHaveText('Cerradas');
  await expect(page.getByText('Todavía no hay rondas cerradas')).toBeVisible();

  for (const link of ['Actividad', 'Ajustes']) {
    await page.getByRole('link', { name: link, exact: true }).click();
    await page.waitForURL(new RegExp(`/${link.toLowerCase()}$`));
    await expect(current(page, 'Modalidad')).toHaveCount(0);
    await expect(page.getByRole('link', { name: link, exact: true })).toHaveAttribute('aria-current', 'page');
  }

  await modeSwitch(page).getByRole('link', { name: 'Reparto' }).click();
  await expect(page).toHaveURL(home);
});

test('the header leads out of the group to "Tus grupos", from any view', async ({ page }) => {
  const home = await createGroupAs(page, 'Salida', ['Ana', 'Bea']);
  for (const path of ['', '/bote', '/ajustes']) {
    await gotoHydrated(page, `${home}${path}`);
    await page.getByRole('banner').getByRole('link', { name: 'Tus grupos' }).click();
    await page.waitForURL((url) => url.pathname === '/');
    const recent = page.getByRole('region', { name: 'Tus grupos' });
    await expect(recent.getByRole('link', { name: /^Salida/ })).toBeVisible();
  }
});

test('no route scrolls sideways or splits the switch at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const home = await createGroupAs(page, 'Navegación', ['Ana', 'Bea']);
  // Real rows: a closed round in Cerradas and an open one with entries in Ronda.
  await gotoHydrated(page, `${home}/bote`);
  for (const round of ['Viernes', 'Sábado']) {
    await page.getByLabel('Nombre de la ronda').fill(round);
    await page.getByRole('button', { name: 'Abrir ronda' }).click();
    await page.getByLabel('Aporte de Ana', { exact: true }).fill('20,00');
    await page.getByLabel('Aporte de Bea', { exact: true }).fill('12,50');
    await page.getByRole('button', { name: 'Añadir aportes', exact: true }).click();
    await expect(page.getByLabel('Aporte de Ana', { exact: true })).toHaveValue('');
    await page.getByLabel('Concepto').fill('Hielo y refrescos');
    await page.getByLabel('Importe del gasto').fill('8,00');
    await page.getByRole('button', { name: 'Añadir gasto', exact: true }).click();
    await expect(page.getByText('Hielo y refrescos')).toBeVisible();
    if (round === 'Viernes') {
      await page.getByRole('button', { name: /^Cerrar ronda/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Cerrar sin repartir' }).click();
      await page.waitForURL(/\/bote\/cerradas$/);
      await gotoHydrated(page, `${home}/bote`);
    }
  }
  for (const path of ['', '/balances', '/bote', '/bote/cerradas', '/actividad', '/ajustes', '/gastos/nuevo']) {
    await gotoHydrated(page, `${home}${path}`);
    await expectFitsNarrowScreen(page);
  }
});

// Session 11 simulation (F-07, F-08): the real group's four-figure debts split as
// "−1076,46 / €" at 320 px, and a long name pushed the saldos grid off the screen.
test('long names and four-figure amounts fit a 320 px screen, and no amount splits', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  const long = 'José Antonio Martínez de la Fuente y Sánchez-Mora';
  const unbroken = 'Maximilianobartolomédelasantísimatrinidadgarcía';
  const home = await createGroupAs(page, 'Nombres largos', ['Ana', long, unbroken, 'Bea']);
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Cena de gala en el restaurante del parador con menú degustación y bodega');
  await page.getByLabel('Importe (€)').fill('4306,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  for (const path of ['', '/balances', '/actividad', '/gastos/nuevo', '/gastos/sin-pagar/nuevo', '/ajustes']) {
    await gotoHydrated(page, `${home}${path}`);
    await expectFitsNarrowScreen(page);
    // An amount is one unit: its figure and its € are never on two lines.
    const split = await page.locator('.money').evaluateAll((els) =>
      els.filter((el) => el.getClientRects().length > 1).map((el) => el.textContent));
    expect(split, path).toEqual([]);
  }
});
