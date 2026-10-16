/**
 * Plan §4 Rn1–Rn2 and K (HTTP side): the production build serving dividir_sim
 * (`scripts/e2e-server.sh` with DATABASE_URL=dividir_sim, PORT=3200), measured as a
 * phone would load it. Run after `npm run sim`:
 *
 *   node --experimental-strip-types tests/sim/http-probe.ts
 *
 * Per screen of the big group: median and worst time to first byte and to the
 * whole document, and its weight. Then a burst: several devices loading screens at
 * the same instant. Numbers go to tests/sim/.out/http.json.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.SIM_BASE_URL ?? 'http://localhost:3200';
const OUT = new URL('./.out/', import.meta.url);
const { groups } = JSON.parse(readFileSync(new URL('manifest.json', OUT), 'utf8')) as { groups: Record<string, string> };
const g = `/g/${groups.quintada}`;

interface Sample { ttfb: number; total: number; bytes: number; status: number }

async function load(path: string, client: string): Promise<Sample> {
  const start = performance.now();
  const response = await fetch(`${BASE}${path}`, { headers: { 'x-forwarded-for': client }, redirect: 'manual' });
  const ttfb = performance.now() - start;
  const body = await response.arrayBuffer();
  return { ttfb, total: performance.now() - start, bytes: body.byteLength, status: response.status };
}

const quantile = (values: number[], q: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]);
};

const screens: Record<string, string> = {
  'Gastos (20 movimientos)': g,
  'Gastos (500 movimientos)': `${g}?mostrar=500`,
  Saldos: `${g}/balances`,
  'Actividad (50)': `${g}/actividad`,
  'Actividad (500)': `${g}/actividad?mostrar=500`,
  'Bote › Ronda': `${g}/bote`,
  'Bote › Cerradas (20)': `${g}/bote/cerradas`,
  Ajustes: `${g}/ajustes`,
  Compartir: `${g}/compartir`,
  'Nuevo gasto': `${g}/gastos/nuevo`,
  'Exportar CSV': `${g}/exportar`,
};

async function main() {
  const perScreen: Record<string, { status: number; kb: number; ttfbMedian: number; ttfbWorst: number; totalMedian: number }> = {};
  for (const [label, path] of Object.entries(screens)) {
    await load(path, '10.0.0.1'); // warm the route once, like any visitor after the first
    const runs: Sample[] = [];
    for (let i = 0; i < 9; i++) runs.push(await load(path, '10.0.0.1'));
    perScreen[label] = {
      status: runs[0].status,
      kb: Math.round(runs[0].bytes / 102.4) / 10,
      ttfbMedian: quantile(runs.map((r) => r.ttfb), 0.5),
      ttfbWorst: quantile(runs.map((r) => r.ttfb), 1),
      totalMedian: quantile(runs.map((r) => r.total), 0.5),
    };
  }

  // A burst: 30 phones open a screen of the group at the same instant, 3 times over.
  const burst: number[] = [];
  let failures = 0;
  const paths = Object.values(screens);
  for (let wave = 0; wave < 3; wave++) {
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) => load(paths[i % paths.length], `10.0.1.${i}`)),
    );
    for (const r of results) {
      burst.push(r.total);
      if (r.status !== 200) failures++;
    }
  }
  const report = {
    base: BASE,
    perScreen,
    burst: { requests: burst.length, failures, p50: quantile(burst, 0.5), p95: quantile(burst, 0.95), worst: quantile(burst, 1) },
  };
  writeFileSync(new URL('http.json', OUT), `${JSON.stringify(report, null, 2)}\n`);
  console.table(perScreen);
  console.log('burst', report.burst);
}

await main();
