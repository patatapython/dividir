import { expect } from '@playwright/test';
import { gotoHydrated, test } from './support';

// FocusKeeper gives focus back only when the page took it away. Clicking outside
// a control is leaving on purpose: a later change to the page must not pull focus
// back into it.
test('focus left on purpose is not pulled back by a later page change', async ({ page }) => {
  await gotoHydrated(page, '/');
  await page.getByLabel('Nombre del grupo').focus();
  await page.getByRole('heading', { level: 1 }).click(); // not focusable: focus goes to <body>
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');

  await page.evaluate(() => document.body.append(document.createElement('div')));
  await page.waitForTimeout(100); // the observer runs as a microtask; give it room to misbehave
  expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');
});
