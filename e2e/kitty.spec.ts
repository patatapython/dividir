import { expect, type Page } from '@playwright/test';
import { createGroup, createGroupAs, gotoHydrated, hasFocusWithin, test } from './support';

/** Fill the inline per-participant fields and submit them as one batch. */
async function contributeInline(page: Page, entries: Record<string, string>) {
  for (const [who, amount] of Object.entries(entries)) {
    await page.getByLabel(`Aporte de ${who}`, { exact: true }).fill(amount);
  }
  await page.getByRole('button', { name: 'Añadir aportes', exact: true }).click();
  // A successful batch clears every inline field — a reliable completion signal.
  for (const who of Object.keys(entries)) {
    await expect(page.getByLabel(`Aporte de ${who}`, { exact: true })).toHaveValue('');
  }
}

test('bote lifecycle: close with informative leftover, reopen with a leftover from before, distribute — never touches settlement', async ({ page }) => {
  await createGroup(page, 'Finde', ['Ana', 'Bea']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity

  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);

  // --- Round 1: everyone puts 20 via the quick-fill. Spend 30 → balance 10 → CERRAR ---
  await page.getByLabel('Nombre de la ronda').fill('Sábado');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await expect(page.getByText(/abierta/)).toBeVisible();

  await page.getByLabel('Todos aportan').fill('20,00');
  await page.getByRole('button', { name: 'Todos aportan lo mismo' }).click();
  await expect(page.getByLabel('Aporte de Bea')).toHaveValue('20,00'); // quick-fill reached everyone
  await page.getByRole('button', { name: 'Añadir aportes', exact: true }).click();
  await expect(page.locator('.leader-row').filter({ hasText: 'Bote' }).filter({ hasNotText: 'Sobrante' })).toContainText('40,00 €');

  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe del gasto').fill('30,00');
  await page.getByRole('button', { name: 'Añadir gasto', exact: true }).click();

  await page.getByRole('button', { name: 'Cerrar ronda' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar sin repartir' }).click();
  await page.waitForURL(/\/bote\/cerradas$/); // the round just closed, as its record

  // The leftover is informational on the closed round — nothing is parked anywhere.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/abierta/)).toHaveCount(0);
  await expect(page.locator('.leader-row').filter({ hasText: 'Sobran' })).toContainText('10,00 €');

  // The closed round keeps its full sheet: expanding it shows who put what and what was spent.
  await page.getByRole('button', { name: 'Ver detalle' }).click();
  await expect(page.locator('.leader-row').filter({ hasText: 'Cena' })).toContainText('30,00 €');
  await expect(page.locator('.leader-row').filter({ hasText: 'Bea' })).toContainText('20,00 €');
  await page.getByRole('button', { name: 'Ocultar' }).click();

  // --- Round 2: the user re-enters those 10 by hand as a preexisting bote. 20+20 more → 50 → REPARTIR 25 each ---
  // Closing landed on Cerradas; new rounds are opened from Ronda.
  await page.getByRole('link', { name: 'Ronda', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await page.getByLabel('Nombre de la ronda').fill('Domingo');
  await page.getByLabel('Sobrante de otra vez (opcional)').fill('10,00');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await expect(page.getByText(/abierta/)).toBeVisible();
  await expect(page.locator('.leader-row').filter({ hasText: 'Sobrante de otra vez' })).toContainText('10,00 €');

  await contributeInline(page, { Ana: '20,00', Bea: '20,00' });

  await page.getByRole('button', { name: 'Cerrar ronda' }).click();
  // The payout preview shows the proportional split before confirming.
  await expect(page.getByRole('dialog').getByText('25,00 €').first()).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Repartir', exact: true }).click();

  // Distributing empties the round; the closed row shows the payout, not a leftover.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(/abierta/)).toHaveCount(0);

  // --- The bote is a separate ledger: no person-to-person debt was ever created ---
  await page.getByRole('link', { name: 'Reparto', exact: true }).click(); // the bote has no Saldos view
  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);
  // No reparto movement exists, so no plan and no "Todo saldado" verdict (T-31).
  await expect(page.getByText('Todavía no hay gastos')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar pago' })).toHaveCount(0);
});

test('a closed round can be reopened, fixed and closed again', async ({ page }) => {
  await createGroup(page, 'Arreglos', ['Ana', 'Bea']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity

  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await page.getByLabel('Nombre de la ronda').fill('Viernes');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await expect(page.getByText(/abierta/)).toBeVisible();

  // A mistaken 20 goes in and the round is closed.
  await contributeInline(page, { Ana: '20,00' });
  await page.getByRole('button', { name: 'Cerrar ronda' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar sin repartir' }).click();
  await expect(page.locator('.leader-row').filter({ hasText: 'Sobran' })).toContainText('20,00 €');

  // Reopen from the detail, fix the amount, close again.
  await page.getByRole('button', { name: 'Ver detalle' }).click();
  await page.getByRole('button', { name: 'Reabrir ronda' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Reabrir', exact: true }).click();
  await expect(page.getByText(/abierta/)).toBeVisible();

  await page.getByRole('button', { name: 'Editar aporte de Ana', exact: true }).click();
  await page.getByLabel('Nuevo importe de Ana').fill('15,00');
  await page.getByRole('button', { name: 'Guardar aporte' }).click();
  await expect(page.locator('.leader-row').filter({ hasText: 'Bote' }).filter({ hasNotText: 'Sobrante' })).toContainText('15,00 €');

  await page.getByRole('button', { name: 'Cerrar ronda' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar sin repartir' }).click();
  await expect(page.locator('.leader-row').filter({ hasText: 'Sobran' })).toContainText('15,00 €');
});

test('open-round entries can be edited and deleted, keeping the balance ≥ 0', async ({ page }) => {
  await createGroup(page, 'Correcciones', ['Ana', 'Bea']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity

  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);

  await page.getByLabel('Nombre de la ronda').fill('Prueba');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await expect(page.getByText(/abierta/)).toBeVisible();

  await contributeInline(page, { Ana: '20,00', Bea: '5,00' });

  const saldo = page.locator('.leader-row').filter({ hasText: 'Bote' }).filter({ hasNotText: 'Sobrante' });
  await expect(saldo).toContainText('25,00 €');

  // Every row shows its own Editar and Eliminar; each is named after its row.
  const editBea = page.getByRole('button', { name: 'Editar aporte de Bea', exact: true });
  await expect(editBea).toBeVisible();
  await expect(page.getByRole('button', { name: 'Eliminar aporte de Bea', exact: true })).toBeVisible();

  // Editar swaps the row for its edit panel with focus in the amount; Cancelar
  // restores the row and hands focus back to its Editar.
  await editBea.click();
  await expect(page.getByLabel('Nuevo importe de Bea')).toBeFocused();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByLabel('Nuevo importe de Bea')).toHaveCount(0);
  await expect(editBea).toBeFocused();

  // Edit Bea's contribution 5 → 15 (amount-only inline edit).
  await editBea.click();
  await page.getByLabel('Nuevo importe de Bea').fill('15,00');
  await page.getByRole('button', { name: 'Guardar aporte' }).click();
  await expect(saldo).toContainText('35,00 €');
  await expect(editBea).toBeFocused();

  // Delete Bea's contribution → balance drops to Ana's 20.
  await page.getByRole('button', { name: 'Eliminar aporte de Bea', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(editBea).toHaveCount(0);
  await expect(saldo).toContainText('20,00 €');

  // Add a spend, then delete it — the freed balance returns.
  await page.getByLabel('Concepto').fill('Hielo');
  await page.getByLabel('Importe del gasto').fill('8,00');
  await page.getByRole('button', { name: 'Añadir gasto', exact: true }).click();
  await expect(saldo).toContainText('12,00 €');
  await page.getByRole('button', { name: 'Editar gasto Hielo', exact: true }).click();
  await expect(page.getByLabel('Nuevo concepto del gasto Hielo')).toBeFocused();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('button', { name: 'Eliminar gasto Hielo', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(saldo).toContainText('20,00 €');
});

// Session 12: with the bote at 0 there is nothing to distribute — the dialog says so
// and only closing is possible (the server refuses a REPARTIR of zeros).
test('a round with the bote at 0 can only be closed', async ({ page }) => {
  await createGroup(page, 'Bote a cero', ['Ana', 'Bea']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity
  await expect(page.getByText('Eres Ana')).toBeVisible();
  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await page.getByLabel('Nombre de la ronda').fill('Justa');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await contributeInline(page, { Ana: '10,00' });
  await page.getByLabel('Concepto').fill('Hielo');
  await page.getByLabel('Importe del gasto').fill('10,00');
  await page.getByRole('button', { name: 'Añadir gasto', exact: true }).click();
  await expect(page.locator('.leader-row').filter({ hasText: 'Bote' }).filter({ hasNotText: 'Sobrante' })).toContainText('0,00 €');

  await page.getByRole('button', { name: 'Cerrar ronda' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('El bote está a 0 €: no hay nada que repartir.');
  const repartir = dialog.getByRole('button', { name: 'Repartir', exact: true });
  await expect(repartir).toBeDisabled();
  await expect(repartir).toHaveAccessibleDescription('El bote está a 0 €: no hay nada que repartir.');
  await dialog.getByRole('button', { name: 'Cerrar sin repartir' }).click();
  await page.waitForURL(/\/bote\/cerradas$/);
});

// T-43 + T-34: the close dialog names its three outcomes and keeps its own
// error; every bote form shows its error next to itself.
test('bote errors appear next to the form or dialog that failed', async ({ page, context }) => {
  await createGroup(page, 'Errores bote', ['Ana', 'Bea']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity
  await expect(page.getByText('Eres Ana')).toBeVisible();
  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  const boteUrl = page.url();

  await page.getByLabel('Nombre de la ronda').fill('Sábado');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await page.getByLabel('Aporte de Ana', { exact: true }).fill('10,00');
  await page.getByRole('button', { name: 'Añadir aportes', exact: true }).click();
  await expect(page.getByLabel('Aporte de Ana', { exact: true })).toHaveValue('');

  const spendForm = page.locator('form').filter({ hasText: 'Añadir gasto del bote' });
  await spendForm.getByLabel('Concepto').fill('Cubata gigante');
  await spendForm.getByLabel('Importe del gasto').fill('25,00');
  await spendForm.getByRole('button', { name: 'Añadir gasto', exact: true }).click();
  await expect(spendForm.getByRole('alert')).toContainText('El gasto supera el saldo del bote');
  await expect(page.locator('form').filter({ hasText: 'Añadir aportes' }).getByRole('alert')).toHaveCount(0);

  // Another device closes the round first: this device's close fails inside its dialog.
  const other = await context.newPage();
  await gotoHydrated(other, boteUrl);
  await other.getByRole('button', { name: 'Cerrar ronda' }).click();
  await other.getByRole('dialog').getByRole('button', { name: 'Cerrar sin repartir' }).click();
  await other.waitForURL(/\/bote\/cerradas$/);

  await page.getByRole('button', { name: 'Cerrar ronda' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Repartir', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cerrar sin repartir' }).click();
  await expect(dialog.getByRole('alert')).toContainText('La ronda del bote ya está cerrada');
  await expect(dialog).toBeVisible();
});

test('the open round puts first, as the main action, what can be done next: contribute while it is empty, spend once it has money', async ({ page }) => {
  await createGroup(page, 'Orden', ['Ana', 'Bea']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity
  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await page.getByLabel('Nombre de la ronda').fill('Bares');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();

  const formOrder = () => page.getByRole('heading', { name: /^Añadir (aportes|gasto del bote)$/ }).allTextContents();
  const contribute = page.getByRole('button', { name: 'Añadir aportes', exact: true });
  const spend = page.getByRole('button', { name: 'Añadir gasto', exact: true });

  // Empty round: a spend would be refused, so contributing comes first.
  await expect.poll(formOrder).toEqual(['Añadir aportes', 'Añadir gasto del bote']);
  await expect(contribute).toHaveClass(/btn--primary/);
  await expect(spend).not.toHaveClass(/btn--primary/);

  // With money in it, the frequent act is spending. The reorder moves the
  // forms: what was already typed in the spend form survives it.
  await page.getByLabel('Concepto').fill('Cañas');
  await contributeInline(page, { Ana: '10,00', Bea: '10,00' });
  await expect.poll(formOrder).toEqual(['Añadir gasto del bote', 'Añadir aportes']);
  await expect(spend).toHaveClass(/btn--primary/);
  await expect(contribute).not.toHaveClass(/btn--primary/);
  await expect(page.getByLabel('Concepto')).toHaveValue('Cañas');

  // Spent down to zero: back to contributing.
  await page.getByLabel('Importe del gasto').fill('20,00');
  await spend.click();
  await expect(page.getByText('Cañas')).toBeVisible();
  await expect.poll(formOrder).toEqual(['Añadir aportes', 'Añadir gasto del bote']);
});

// Loopback (session 10): a submit button disables itself while it works and when
// its fields empty; the focus it held must stay in its form, not fall to <body>,
// even though that same success moves the form below the spend form.
test('contributing from the keyboard keeps focus in the contributions form', async ({ page }) => {
  await createGroup(page, 'Foco', ['Ana', 'Bea']);
  await page.getByRole('button', { name: /^Ana/ }).click(); // claim identity
  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await page.getByLabel('Nombre de la ronda').fill('Bares');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();

  await page.getByLabel('Aporte de Ana', { exact: true }).fill('10,00');
  await page.getByLabel('Aporte de Bea', { exact: true }).fill('10,00');
  await page.getByRole('button', { name: 'Añadir aportes', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Aporte de Ana', { exact: true })).toHaveValue('');
  await expect.poll(() => page.getByRole('heading', { name: /^Añadir (aportes|gasto del bote)$/ }).allTextContents())
    .toEqual(['Añadir gasto del bote', 'Añadir aportes']);

  const contributions = page.locator('form').filter({ has: page.getByRole('heading', { name: 'Añadir aportes' }) });
  await expect.poll(() => hasFocusWithin(contributions)).toBe(true);
});

// T-100: a typo in a round's name is fixed in place, open or closed — a closed
// round is renamed without reopening it, and the change is in Actividad.
test('a round is renamed in place, open or closed, and the rename is in Actividad', async ({ page }) => {
  await createGroupAs(page, 'Renombres', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await page.getByLabel('Nombre de la ronda').fill('Gastos inciales');
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await expect(page.getByRole('heading', { name: 'Gastos inciales · abierta' })).toBeVisible();

  // The field opens where the name was, focused and filled with it; Cancelar keeps it.
  await page.getByRole('button', { name: 'Renombrar Gastos inciales', exact: true }).click();
  const field = page.getByLabel('Nuevo nombre para Gastos inciales', { exact: true });
  await expect(field).toBeFocused();
  await expect(field).toHaveValue('Gastos inciales');
  await field.fill('Otra cosa');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gastos inciales · abierta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Renombrar Gastos inciales', exact: true })).toBeFocused();

  // An empty name is refused next to the field.
  await page.getByRole('button', { name: 'Renombrar Gastos inciales', exact: true }).click();
  await field.fill('  ');
  await page.getByRole('button', { name: 'Guardar nombre', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'no puede estar vacío' })).toBeVisible();

  await field.fill('Gastos iniciales');
  await field.press('Enter');
  await expect(page.getByRole('heading', { name: 'Gastos iniciales · abierta' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Renombrar Gastos iniciales', exact: true })).toBeFocused();

  // Closed: renamed on Cerradas, and it stays closed.
  await contributeInline(page, { Ana: '10,00' });
  await page.getByRole('button', { name: 'Cerrar ronda' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar sin repartir' }).click();
  await page.waitForURL(/\/bote\/cerradas$/);
  await page.getByRole('button', { name: 'Renombrar Gastos iniciales', exact: true }).click();
  await page.getByLabel('Nuevo nombre para Gastos iniciales', { exact: true }).fill('Primera ronda');
  await page.getByRole('button', { name: 'Guardar nombre', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Primera ronda', exact: true })).toBeVisible();
  await expect(page.locator('.closed-round')).toContainText('Cerrado');
  await expect(page.locator('.leader-row').filter({ hasText: 'Sobran' })).toContainText('10,00 €');

  await page.getByRole('link', { name: 'Actividad', exact: true }).click();
  await page.waitForURL(/\/actividad$/);
  const renames = page.locator('.journal-row').filter({ hasText: 'renombró una ronda del bote' });
  await expect(renames).toHaveCount(2);
  await expect(renames.filter({ hasText: 'antes Gastos iniciales' })).toContainText('Primera ronda');
  await expect(renames.filter({ hasText: 'antes Gastos inciales' })).toContainText('Gastos iniciales');
});

// README showcase finding: whether a row's Editar/Eliminar fit beside its amount
// depended on the length of the name, so one list mixed two row shapes. The shape
// must follow the width of the list alone: every row of a list looks the same.
test('every row of a bote list has the same shape, whatever the length of its name', async ({ page }) => {
  await createGroupAs(page, 'Formas', ['Al', 'Bea', 'Maximiliano Fernández']);
  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await contributeInline(page, { Al: '20,00', Bea: '20,00', 'Maximiliano Fernández': '20,00' });

  const rows = page.locator('.leader-row').filter({ has: page.getByRole('button', { name: /^Editar/ }) });
  await expect(rows).toHaveCount(3);
  const actionsBesideAmount = await rows.evaluateAll((els) => els.map((row) => {
    const amount = row.querySelector('.money')!.getBoundingClientRect();
    const actions = row.querySelector('.leader-actions')!.getBoundingClientRect();
    return actions.top < amount.bottom;
  }));
  expect(new Set(actionsBesideAmount).size, `row shapes: ${actionsBesideAmount}`).toBe(1);
});
