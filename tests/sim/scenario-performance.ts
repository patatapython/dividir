import { getActivity, getClosedRounds, getGroupOverview, getKittyView, getLedgerExport, getSettingsView } from '../../src/server/queries';
import { ledgerCsv } from '../../src/app/g/[token]/exportar/ledger-csv';
import type { Driver } from './driver';

/**
 * Plan §4 Rn1 (server side): what each screen's read costs with the big group's
 * volume, median of several runs after a warm-up. The HTTP side (render, payload)
 * is measured against the production build in the browser phase.
 */
export async function measureReads(driver: Driver, token: string): Promise<Record<string, number>> {
  const reads: Record<string, () => Promise<unknown>> = {
    'Gastos/Saldos (getGroupOverview)': () => getGroupOverview(token),
    'Actividad 50 (getActivity)': () => getActivity(token, 50),
    'Actividad 500 (getActivity)': () => getActivity(token, 500),
    'Ronda (getKittyView)': () => getKittyView(token),
    'Cerradas 20 (getClosedRounds)': () => getClosedRounds(token, 20),
    'Ajustes (getSettingsView)': () => getSettingsView(token),
    'CSV (getLedgerExport + ledgerCsv)': async () => ledgerCsv((await getLedgerExport(token))!),
  };
  const medians: Record<string, number> = {};
  for (const [label, read] of Object.entries(reads)) {
    await read();
    const runs: number[] = [];
    for (let i = 0; i < 7; i++) {
      const start = performance.now();
      await read();
      runs.push(performance.now() - start);
    }
    runs.sort((a, b) => a - b);
    medians[label] = Math.round(runs[3] * 10) / 10;
    driver.timings.push({ label: `read ${label}`, ms: medians[label] });
  }
  driver.cover('Rn1');
  return medians;
}
