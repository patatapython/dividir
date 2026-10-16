import { expect, type Page } from '@playwright/test';
import { claimIdentity, createGroupAs, gotoHydrated, test } from './support';

/** Creates a group from the landing and stays on the page it opens on. */
async function createGroupToShare(page: Page, name: string) {
  await gotoHydrated(page, '/');
  await page.getByLabel('Nombre del grupo').fill(name);
  await page.getByLabel('Participante 1', { exact: true }).fill('Ana');
  await page.getByLabel('Participante 2', { exact: true }).fill('Beto');
  await page.getByRole('button', { name: 'Crear grupo' }).click();
  await page.waitForURL(/\/g\/.{24}\/compartir$/);
  return page.url().replace(/\/compartir$/, '');
}

test('a new group opens on its share page, which copies the link and asks nobody who they are', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const home = await createGroupToShare(page, 'Para compartir');

  await expect(page.getByRole('heading', { name: 'Comparte el grupo' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '¿Quién eres?' })).toHaveCount(0);
  await expect(page.getByLabel('Enlace del grupo', { exact: true })).toHaveValue(home);
  await expect(page.getByRole('img', { name: 'Código QR con el enlace del grupo' })).toBeVisible();

  await page.getByRole('button', { name: 'Copiar enlace' }).click();
  await expect(page.getByRole('status')).toHaveText('Enlace copiado.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(home);

  // Entering the group is where it asks.
  await page.getByRole('link', { name: 'Ir al grupo' }).click();
  await page.waitForURL(home);
  await claimIdentity(page, 'Ana');

  // The header leads back to the same page.
  await page.getByRole('link', { name: 'Compartir', exact: true }).click();
  await page.waitForURL(`${home}/compartir`);
  await expect(page.getByLabel('Enlace del grupo', { exact: true })).toHaveValue(home);
});

test('opening "¿Quién eres?" by hand on the share page does not spend the question the group asks', async ({ page }) => {
  const home = await createGroupToShare(page, 'Pregunta intacta');
  await page.getByRole('button', { name: '¿Quién eres?' }).click();
  await page.getByRole('dialog', { name: '¿Quién eres?' }).getByRole('button', { name: 'Ahora no' }).click();
  await expect(page.getByRole('dialog', { name: '¿Quién eres?' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Ir al grupo' }).click();
  await page.waitForURL(home);
  await claimIdentity(page, 'Ana');
});

test('when copying is refused, the link is left selected to copy by hand', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')) },
    });
  });
  await createGroupToShare(page, 'Copia rechazada');

  await page.getByRole('button', { name: 'Copiar enlace' }).click();
  await expect(page.getByRole('status')).toContainText('No se ha podido copiar');
  const link = page.getByLabel('Enlace del grupo', { exact: true });
  await expect(link).toBeFocused();
  const selected = await link.evaluate((el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0));
  expect(selected).toBe(await link.inputValue());
});

test('where the device has a share sheet, it is the main action and hands it the link', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: ShareData[] = [];
    (window as unknown as { shareCalls: ShareData[] }).shareCalls = calls;
    Object.defineProperty(navigator, 'share', {
      value: (data: ShareData) => {
        calls.push(data);
        // The second call is the user closing the sheet: not an error.
        return calls.length > 1 ? Promise.reject(new DOMException('Cancelled', 'AbortError')) : Promise.resolve();
      },
    });
  });
  const home = await createGroupToShare(page, 'Hoja nativa');

  const share = page.getByRole('button', { name: 'Compartir enlace' });
  await expect(share).toHaveClass(/btn--primary/);
  await share.click();
  await share.click();
  const calls = await page.evaluate(() => (window as unknown as { shareCalls: ShareData[] }).shareCalls);
  expect(calls).toHaveLength(2);
  expect(calls[0]).toMatchObject({ title: 'Hoja nativa', url: home });
  await expect(page.getByRole('status')).toHaveText('');
});

test('"Tus grupos" lists the groups this device visited, and forgets the ones that are gone', async ({ page }) => {
  const home = await createGroupAs(page, 'Recordado', ['Ana', 'Beto']);
  await gotoHydrated(page, '/');
  const yours = page.locator('.recent-groups');
  await expect(yours.getByRole('heading', { name: 'Tus grupos' })).toBeVisible();
  await yours.getByRole('link', { name: /Recordado/ }).click();
  await page.waitForURL(home);

  // A remembered link whose group no longer exists is dropped once visited.
  const gone = `/g/${'z'.repeat(24)}`;
  await page.evaluate((token) => {
    const list = JSON.parse(localStorage.getItem('dividir:groups') ?? '[]');
    localStorage.setItem('dividir:groups', JSON.stringify([{ token, name: 'Borrado', visitedAt: 1 }, ...list]));
  }, gone.slice(3));
  // Even through a bookmark to one of its pages, not only its home.
  await gotoHydrated(page, `${gone}/gastos/nuevo`);
  await expect(page.getByRole('heading', { name: 'Grupo no encontrado' })).toBeVisible();
  await page.getByRole('link', { name: 'Crear un grupo' }).click();
  await expect(yours.getByRole('link', { name: /Recordado/ })).toBeVisible();
  await expect(yours.getByRole('link', { name: /Borrado/ })).toHaveCount(0);

  // Deleting the group from this device forgets it too.
  await yours.getByRole('link', { name: /Recordado/ }).click();
  await page.waitForURL(home);
  await page.getByRole('link', { name: 'Ajustes' }).click();
  await page.getByLabel('Nombre del grupo').fill('Recordado');
  await page.getByRole('button', { name: 'Eliminar grupo definitivamente' }).click();
  await page.waitForURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Apunta, divide, salda.' })).toBeVisible();
  await expect(yours).toHaveCount(0);
});
