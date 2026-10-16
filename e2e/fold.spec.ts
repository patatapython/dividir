import { expect } from '@playwright/test';
import { createGroupAs, test } from './support';

// D-09: a long read list shows its first 5 rows; one toggle expands and folds it.
const PEOPLE = ['Ana', 'Bea', 'Carla', 'Dani', 'Eva', 'Fede', 'Gema'];

test('a long list shows five rows, expands to all of them and folds back', async ({ page }) => {
  await createGroupAs(page, 'Siete', PEOPLE);
  await page.getByRole('link', { name: 'Ajustes' }).click();
  await page.waitForURL(/\/ajustes$/);

  const rows = page.locator('.participant-row');
  const toggle = page.getByRole('button', { name: 'Ver todos (7) · Participantes', exact: true });
  await expect(rows).toHaveCount(5);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Expanding shows every row, says so, and hands focus to the first new one.
  await toggle.click();
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(5)).toBeFocused();
  await expect(page.getByRole('status').filter({ hasText: 'Mostrando 7 de 7' })).toHaveCount(1);
  const fold = page.getByRole('button', { name: 'Plegar · Participantes', exact: true });
  await expect(fold).toHaveAttribute('aria-expanded', 'true');

  // Folding goes back to five and keeps focus on the toggle.
  await fold.click();
  await expect(rows).toHaveCount(5);
  await expect(toggle).toBeFocused();
});

test('folding takes the screen back to the top of the folded box', async ({ page }) => {
  await createGroupAs(page, 'Siete arriba', PEOPLE);
  await page.getByRole('link', { name: 'Ajustes' }).click();
  await page.waitForURL(/\/ajustes$/);
  await page.setViewportSize({ width: 400, height: 420 });

  const heading = page.getByRole('heading', { name: 'Participantes', exact: true });
  await page.getByRole('button', { name: 'Ver todos (7) · Participantes', exact: true }).click();
  const fold = page.getByRole('button', { name: 'Plegar · Participantes', exact: true });
  await fold.scrollIntoViewIfNeeded();
  await expect(heading).not.toBeInViewport();

  await fold.click();
  await expect(heading).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Ver todos (7) · Participantes', exact: true })).toBeFocused();
});

test('the bote folds its contributions, and two lists on one screen never share a toggle name', async ({ page }) => {
  await createGroupAs(page, 'Bote de siete', PEOPLE);
  await page.getByRole('link', { name: 'Bote', exact: true }).click();
  await page.waitForURL(/\/bote$/);
  await page.getByRole('button', { name: 'Abrir ronda' }).click();
  await expect(page.getByText(/abierta/)).toBeVisible();

  await page.getByLabel('Todos aportan', { exact: true }).fill('10,00');
  await page.getByRole('button', { name: 'Todos aportan lo mismo' }).click();
  await page.getByRole('button', { name: 'Añadir aportes', exact: true }).click();
  await expect(page.getByLabel('Aporte de Ana', { exact: true })).toHaveValue('');

  const edits = page.getByRole('button', { name: /^Editar aporte de / });
  await expect(edits).toHaveCount(5);
  await page.getByRole('button', { name: 'Ver todos (7) · Aportes', exact: true }).click();
  await expect(edits).toHaveCount(7);

  // A row shown by expanding is a full row: it edits like any other.
  await page.getByRole('button', { name: 'Editar aporte de Gema', exact: true }).click();
  await page.getByLabel('Nuevo importe de Gema').fill('20,00');
  await page.getByRole('button', { name: 'Guardar aporte' }).click();
  await expect(page.locator('.leader-row').filter({ hasText: 'Total aportado' })).toContainText('80,00 €');
});
