/**
 * Plan §4 N1/N4: every screen of the simulated groups at 320, 414 and 1280 px on
 * the production build (see http-probe.ts for how it is started). For each one it
 * records: horizontal page overflow, visible elements whose text spills out of
 * their box, console errors and uncaught page errors; and it saves a full-page
 * screenshot for the human pass. Results go to tests/sim/.out/visual/.
 *
 *   node --experimental-strip-types tests/sim/visual-sweep.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium, type Page } from '@playwright/test';

const BASE = process.env.SIM_BASE_URL ?? 'http://localhost:3200';
const OUT = new URL('./.out/visual/', import.meta.url);
const { groups } = JSON.parse(readFileSync(new URL('./.out/manifest.json', import.meta.url), 'utf8')) as {
  groups: Record<string, string>;
};
const ids = JSON.parse(process.env.SIM_IDS ?? '{}') as Record<string, string>;

const screens: [string, string][] = [
  ['landing', '/'],
  ...(['grande', 'largos', 'vacio', 'viaje'] as const).flatMap((name): [string, string][] => {
    const g = `/g/${groups[name]}`;
    return [
      [`${name}-gastos`, g],
      [`${name}-saldos`, `${g}/balances`],
      [`${name}-actividad`, `${g}/actividad`],
      [`${name}-bote`, `${g}/bote`],
      [`${name}-cerradas`, `${g}/bote/cerradas`],
      [`${name}-ajustes`, `${g}/ajustes`],
      [`${name}-nuevo-gasto`, `${g}/gastos/nuevo`],
      [`${name}-sin-pagar`, `${g}/gastos/sin-pagar/nuevo`],
    ];
  }),
  ['grande-compartir', `/g/${groups.grande}/compartir`],
  ...Object.entries(ids).map(([label, path]): [string, string] => [label, path]),
];

/** Visible elements whose content is wider than their own box and is not meant to scroll or clip. */
async function spills(page: Page) {
  return page.evaluate(() => {
    const found: string[] = [];
    const viewport = window.innerWidth;
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || el.closest('dialog:not([open])')) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const clips = ['hidden', 'auto', 'scroll', 'clip'].includes(style.overflowX);
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!clips && el.scrollWidth > el.clientWidth + 1 && el.children.length === 0) {
        found.push(`spills ${el.tagName.toLowerCase()}.${el.className} "${text}" (${el.scrollWidth} > ${el.clientWidth})`);
      }
      if (rect.right > viewport + 1 && style.position !== 'fixed') {
        found.push(`off-screen ${el.tagName.toLowerCase()}.${el.className} "${text}" (right ${Math.round(rect.right)} > ${viewport})`);
      }
    }
    return found.slice(0, 12);
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report: Record<string, unknown> = {};
  for (const width of [320, 414, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: width < 800 ? 780 : 900 }, deviceScaleFactor: 1 });
    for (const [label, path] of screens) {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
      page.on('pageerror', (e) => errors.push(`pageerror ${e.message.slice(0, 200)}`));
      const response = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
      // "¿Quién eres?" opens on first visit to a group; dismiss it to see the page.
      if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
      const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const problems = await spills(page);
      await page.screenshot({ path: new URL(`${label}-${width}.png`, OUT).pathname, fullPage: true });
      if (pageOverflow > 0 || problems.length > 0 || errors.length > 0 || response?.status() !== 200) {
        report[`${label}@${width}`] = { status: response?.status(), pageOverflow, problems, errors };
      }
      await page.close();
    }
    await context.close();
  }
  await browser.close();
  writeFileSync(new URL('report.json', OUT), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${screens.length * 3} captures; ${Object.keys(report).length} with findings`);
  console.log(JSON.stringify(report, null, 2).slice(0, 6000));
}

await main();
