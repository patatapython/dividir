/**
 * Captures the README media from the showcase group (group.seed.ts) on the
 * production build: phone screenshots, a composed hero image and a GIF of adding an
 * expense. Run it end to end with `npm run showcase` (scripts/showcase.sh).
 *
 *   node --experimental-strip-types tests/showcase/capture.ts [outDir]
 *
 * Phone screens are viewport-sized (a full-page capture misplaces fixed elements such
 * as the action bar). The GIF adds an expense, so it runs last and the next capture
 * needs a fresh seed.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Node runs this file directly, so it imports no local module: the port is SHOWCASE_PORT of showcase-db.ts.
const BASE = process.env.SHOWCASE_BASE_URL ?? 'http://127.0.0.1:3300';
const OUT = resolve(process.argv[2] ?? 'docs/screenshots');
const manifest = JSON.parse(readFileSync(new URL('./.out/manifest.json', import.meta.url), 'utf8')) as {
  token: string;
  viewer: string;
  itemizedExpense: string;
  closedRound: string;
};
const group = `/g/${manifest.token}`;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

/** Waits until React has hydrated every control and the fonts are in, so the shot shows the live page. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button, a, input')).every((el) => Object.keys(el).some((k) => k.startsWith('__reactFiber$'))),
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
}

/** Scrolls so `heading` sits a little below the top of the screen. */
async function scrollTo(page: Page, heading: RegExp) {
  await page.getByRole('heading', { name: heading }).first().evaluate((el) => {
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 16);
  });
  await page.waitForTimeout(200);
}

async function shoot(context: BrowserContext, name: string, path: string, prepare?: (page: Page) => Promise<void>) {
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`);
  await settle(page);
  if (prepare) await prepare(page);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  await page.close();
  console.log(`${name}.png`);
}

async function phoneContext(browser: Browser, extra: Parameters<Browser['newContext']>[0] = {}) {
  const context = await browser.newContext({ ...PHONE, deviceScaleFactor: 2, ...extra });
  await context.addCookies([{ name: `participant_${manifest.token}`, value: manifest.viewer, url: BASE }]);
  return context;
}

/**
 * The README banner: the landing page's pixel pilgrim (taken from the live page, never
 * redrawn) on a lime tile, beside the name in the app's own type. Built inside the app
 * page so it uses the app's fonts; one image per GitHub theme, transparent around.
 */
async function banner(browser: Browser, theme: 'light' | 'dark') {
  const ink = theme === 'light' ? '#131313' : '#FFFDF2';
  const page = await browser.newPage({ viewport: { width: 900, height: 400 }, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/`);
  await settle(page);
  await page.evaluate((ink) => {
    const svg = document.querySelector('svg.landing-art')!.outerHTML;
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.innerHTML = `
      <div id="banner" style="display:inline-flex;align-items:center;gap:40px;padding:8px 24px 24px 8px">
        <div style="display:inline-flex;padding:20px 24px;background:#D6F24A;border:4px solid #131313;box-shadow:10px 10px 0 ${ink}">
          ${svg.replace('<svg', '<svg style="width:120px;height:auto"')}
        </div>
        <div style="color:${ink}">
          <div style="font:700 112px/0.85 var(--font-sans),sans-serif;letter-spacing:-0.055em">dividir</div>
          <div style="margin-top:18px;font:700 16px/1.4 var(--font-mono),monospace;letter-spacing:.2em;text-transform:uppercase">Apunta · divide · salda</div>
        </div>
      </div>`;
  }, ink);
  await page.evaluate(() => document.fonts.ready);
  await page.locator('#banner').screenshot({ path: join(OUT, `banner-${theme}.png`), omitBackground: true });
  await page.close();
  console.log(`banner-${theme}.png`);
}

/** Three phone screens side by side on the app's own crema, tinta frames and hard shadows. */
async function hero(browser: Browser, shots: string[]) {
  const frames = shots
    .map((name, i) => {
      const png = readFileSync(join(OUT, `${name}.png`)).toString('base64');
      return `<img src="data:image/png;base64,${png}" style="margin-top:${i === 1 ? 0 : 56}px">`;
    })
    .join('');
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><style>
    html,body{margin:0;height:100%;background:#FFFDF2}
    body{display:flex;justify-content:center;align-items:flex-start;gap:40px;padding-top:48px;box-sizing:border-box;overflow:hidden}
    img{width:340px;border:3px solid #131313;box-shadow:10px 10px 0 #131313}
    img:nth-child(2){box-shadow:10px 10px 0 #D6F24A, 10px 10px 0 3px #131313}
  </style>${frames}`);
  await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode())));
  await page.screenshot({ path: join(OUT, 'hero.png') });
  await page.close();
  console.log('hero.png');
}

/** Adding an expense and reading the new settlement plan, as a GIF. */
async function flowGif(browser: Browser) {
  const videos = mkdtempSync(join(tmpdir(), 'dividir-showcase-'));
  const context = await phoneContext(browser, { deviceScaleFactor: 1, recordVideo: { dir: videos, size: PHONE.viewport } });
  const page = await context.newPage();
  await page.goto(`${BASE}${group}`);
  await settle(page);
  await page.waitForTimeout(800);
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').waitFor();
  await settle(page);
  await page.getByLabel('Concepto').pressSequentially('Churros con chocolate', { delay: 60 });
  await page.getByLabel('Importe (€)').pressSequentially('18,50', { delay: 120 });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(new RegExp(`${group}$`));
  await settle(page);
  await page.waitForTimeout(1200);
  await page.getByRole('link', { name: 'Saldos', exact: true }).click();
  await page.waitForURL(/\/balances$/);
  await settle(page);
  await page.waitForTimeout(600);
  await page.getByRole('heading', { name: /Plan para saldar/ }).first().evaluate((el) => {
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 24, behavior: 'smooth' });
  });
  await page.waitForTimeout(2500);
  await context.close();

  const [video] = readdirSync(videos).filter((f) => f.endsWith('.webm'));
  const gif = join(OUT, 'flujo.gif');
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', join(videos, video),
    '-vf', 'fps=12,scale=360:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none',
    gif,
  ]);
  rmSync(videos, { recursive: true, force: true });
  console.log('flujo.gif');
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  const phone = await phoneContext(browser);
  await shoot(phone, 'landing', '/');
  await shoot(phone, 'gastos', group);
  await shoot(phone, 'saldos', `${group}/balances`, (page) => scrollTo(page, /Plan para saldar/));
  await shoot(phone, 'gasto-por-lineas', `${group}/gastos/${manifest.itemizedExpense}`, (page) => scrollTo(page, /^Líneas|^Entre quién/));
  await shoot(phone, 'bote', `${group}/bote`);
  await shoot(phone, 'bote-repartido', `${group}/bote/cerradas/${manifest.closedRound}`);
  await shoot(phone, 'actividad', `${group}/actividad`);
  await phone.close();

  await banner(browser, 'light');
  await banner(browser, 'dark');
  await hero(browser, ['gastos', 'saldos', 'bote-repartido']);
  await flowGif(browser);
  await browser.close();
}

await main();
