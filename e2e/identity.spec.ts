import { expect } from '@playwright/test';
import { createGroup, test } from './support';

test('the identity selector can be dismissed and reopened from the header', async ({ page }) => {
  await createGroup(page, 'Identidad aplazada', ['Ana', 'Bea']);
  const dialog = page.getByRole('dialog', { name: '¿Quién eres?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Ahora no' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('button', { name: '¿Quién eres?' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /^Ana/ }).click();
  await expect(page.getByRole('button', { name: /^Eres Ana/ })).toBeVisible();
  await expect(dialog).toBeHidden();
});

test('"Eres X" reopens the selector to switch identity, and the switch sticks', async ({ page }) => {
  await createGroup(page, 'Identidad cambiada', ['Ana', 'Bea']);
  const dialog = page.getByRole('dialog', { name: '¿Quién eres?' });
  await dialog.getByRole('button', { name: /^Ana/ }).click();
  const whoAmI = page.getByRole('button', { name: /^Eres Ana/ });
  await expect(whoAmI).toBeVisible();

  // Escape leaves the identity as it was
  await whoAmI.click();
  await expect(dialog.getByRole('button', { name: /^Ana/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.getByRole('button', { name: /^Ana/ })).toContainText('tú');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(whoAmI).toBeFocused();

  await whoAmI.click();
  await dialog.getByRole('button', { name: /^Bea/ }).click();
  await expect(page.getByRole('button', { name: /^Eres Bea/ })).toBeVisible();
  await expect(dialog).toBeHidden();

  await page.reload();
  await expect(page.getByRole('button', { name: /^Eres Bea/ })).toBeVisible();
  await expect(dialog).toBeHidden();
});
