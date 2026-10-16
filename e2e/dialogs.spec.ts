import { expect, type Page } from '@playwright/test';
import { createGroupAs, gotoHydrated, test } from './support';

/** Focus is inside the open dialog, or nowhere in the page (browser chrome). */
const focusStaysInDialog = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    const dialog = document.querySelector('[role="dialog"], dialog[open]');
    return !!dialog && (active === document.body || active === null || dialog.contains(active));
  });

// T-30: the dialog takes focus on open, keeps Tab away from the page behind it,
// and hands focus back to the button that opened it.
test('a dialog focuses its safe choice, keeps Tab inside and returns focus on close', async ({ page }) => {
  await createGroupAs(page, 'Foco', ['Ana', 'Bea']);
  await gotoHydrated(page, `${page.url()}/ajustes`);

  const trigger = page.locator('.participant-row').filter({ hasText: 'Bea' }).getByRole('button', { name: 'Eliminar' });
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Cancelar' })).toBeFocused();

  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await focusStaysInDialog(page)).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // Cancelling by button returns focus the same way.
  await trigger.click();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();
  await expect(trigger).toBeFocused();
});
