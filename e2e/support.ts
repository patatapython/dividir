import { test as base, expect, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';

let clientsInThisWorker = 0;

/**
 * A client address no other test in the run uses. The E2E server trusts
 * X-Forwarded-For like production does behind its proxy (TRUST_PROXY=1), so
 * each test is its own client for the createGroup rate limiter, which stays
 * on: it has no off switch.
 */
function nextClientAddress(): string {
  const n = clientsInThisWorker++;
  return `10.${base.info().workerIndex % 256}.${(n >> 8) % 256}.${n % 256}`;
}

/** Specs import `test` from here, never from @playwright/test: every page of a test comes from its own client. */
export const test = base.extend({
  extraHTTPHeaders: async ({}, use) => {
    await use({ 'X-Forwarded-For': nextClientAddress() });
  },
});

/** A second browser for the same test, as another client (another device joining the group). */
export function newClient(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': nextClientAddress() } });
}

/**
 * Opens a URL and waits until React has hydrated every control on it. `goto`
 * returns at `load`, when the HTML is complete but its handlers may not be
 * attached yet (a page behind a loading boundary hydrates after the shell),
 * so a click at once can land on dead markup. Specs never call `page.goto`.
 * React marks each node it hydrates with a `__reactFiber$…` property.
 */
export async function gotoHydrated(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() =>
    [...document.querySelectorAll('a[href], button, input, select, textarea, summary')].every((el) =>
      Object.keys(el).some((key) => key.startsWith('__reactFiber$')),
    ),
  );
}

/**
 * Creates a group from the landing and returns its URL. Labels are matched
 * exactly: "Participante 3" is a substring of the "Quitar participante 3"
 * button that appears once a group has more rows than the minimum.
 */
export async function createGroup(page: Page, name: string, people: string[]): Promise<string> {
  await gotoHydrated(page, '/');
  await page.getByLabel('Nombre del grupo').fill(name);
  for (let i = 0; i < people.length; i++) {
    if (i >= 2) await page.getByRole('button', { name: 'Añadir participante' }).click();
    await page.getByLabel(`Participante ${i + 1}`, { exact: true }).fill(people[i]);
  }
  await page.getByRole('button', { name: 'Crear grupo' }).click();
  await enterNewGroup(page);
  return page.url();
}

/** A new group opens on its share page (T-40); "Ir al grupo" leads into the group itself. */
export async function enterNewGroup(page: Page) {
  await page.waitForURL(/\/g\/.{24}\/compartir$/);
  await page.getByRole('link', { name: 'Ir al grupo' }).click();
  await page.waitForURL(/\/g\/.{24}$/);
}

/** Chooses who this device is, and waits until the header says so (the cookie is set). */
export async function claimIdentity(page: Page, person: string) {
  await page.getByRole('dialog', { name: '¿Quién eres?' }).getByRole('button', { name: new RegExp(`^${person}`) }).click();
  await expect(page.getByRole('button', { name: new RegExp(`^Eres ${person}`) })).toBeVisible();
}

/** Creates a group and claims its first person, as most specs start. */
export async function createGroupAs(page: Page, name: string, people: string[]): Promise<string> {
  const url = await createGroup(page, name, people);
  await claimIdentity(page, people[0]);
  return url;
}

/** Whether keyboard focus is inside `container` (and not dropped to the document). */
export function hasFocusWithin(container: Locator): Promise<boolean> {
  return container.evaluate((el) => el.contains(document.activeElement));
}
