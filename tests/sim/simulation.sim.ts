import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, it } from 'vitest';
import { Driver } from './driver';
import { Rng } from './rng';
import { loadRoster } from './roster';
import { seedBigGroup } from './scenario-big-group';
import { seedEmpty, seedLongNames, seedThree, seedTrip } from './scenario-small';
import { probeBoundaries } from './scenario-boundaries';
import { raceDevices } from './scenario-concurrency';
import { measureReads } from './scenario-performance';

/**
 * The scale simulation. One fixed seed, one
 * driver, run in order: every group is seeded through the server actions and then
 * checked. The groups stay in dividir_sim for the browser phase; their tokens and
 * the run's numbers are written to tests/sim/.out/.
 */
const SEED = 20_260_925;
const OUT = fileURLToPath(new URL('./.out/', import.meta.url));

describe.sequential('simulacro', () => {
  const rng = new Rng(SEED);
  const driver = new Driver();
  const groups: Record<string, string> = {};
  const roster = loadRoster();

  afterAll(() => {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}manifest.json`, `${JSON.stringify({ seed: SEED, groups }, null, 2)}\n`);
    writeFileSync(`${OUT}report.json`, `${JSON.stringify({
      seed: SEED,
      calls: driver.calls,
      rejections: driver.rejections,
      covered: [...driver.covered].sort(),
      timings: driver.timings,
    }, null, 2)}\n`);
  });

  it('el grupo grande: 27+ personas, seis meses de gastos y rondas del bote', async () => {
    groups.grande = await driver.time('seed big group', () => seedBigGroup(driver, rng, roster));
  });

  it('un viaje de 12 personas que se salda hasta el último céntimo', async () => {
    groups.viaje = await driver.time('seed viaje', () => seedTrip(driver, rng, roster.founders.slice(0, 12)));
  });

  it('tres amigos y los céntimos que no se dividen', async () => {
    groups.tres = await seedThree(driver, roster.founders.slice(0, 3));
  });

  it('un grupo recién creado, sin nada', async () => {
    groups.vacio = await seedEmpty(driver, roster.founders.slice(3, 5));
  });

  it('nombres y conceptos en el límite de longitud', async () => {
    groups.largos = await seedLongNames(driver, rng);
  });

  it('diez dispositivos a la vez sobre las mismas filas', async () => {
    groups.concurrencia = await driver.time('race devices', () => raceDevices(driver, rng, roster.founders.slice(12, 22)));
  });

  it('lo que cuesta leer cada pantalla con el volumen del grupo grande', async () => {
    await measureReads(driver, groups.grande);
  });

  it('valores límite, grupos ajenos y borrar un grupo', async () => {
    await probeBoundaries(driver, groups.grande);
  });
});
