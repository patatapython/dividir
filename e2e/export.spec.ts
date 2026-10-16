import { readFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { createGroupAs, test } from './support';

test('Ajustes downloads the reparto ledger as a CSV that ends in the saldo (T-53)', async ({ page }) => {
  await createGroupAs(page, 'Libro CSV', ['Ana', 'Bea']);
  await page.getByRole('link', { name: 'Añadir gasto' }).click();
  await page.getByLabel('Concepto').fill('Cena');
  await page.getByLabel('Importe (€)').fill('40,00');
  await page.getByRole('button', { name: 'Guardar gasto' }).click();
  await page.waitForURL(/\/g\/.{24}$/);

  await page.getByRole('link', { name: 'Ajustes', exact: true }).click();
  await page.waitForURL(/\/ajustes$/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Descargar CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^dividir-libro-csv-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await readFile(await download.path(), 'utf8');
  const lines = csv.replace(/^﻿/, '').trimEnd().split('\r\n');
  expect(lines[0]).toBe('Fecha;Tipo;Concepto;Importe;Detalle;Ana;Bea');
  expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2};Gasto;Cena;40,00;pagó Ana;20,00;-20,00$/);
  expect(lines[2]).toBe(';Saldo;;;;20,00;-20,00');
});

test('the export is never cached and an unknown group gets a bare 404', async ({ page, request }) => {
  const home = await createGroupAs(page, 'Cabeceras CSV', ['Ana', 'Bea']);
  const ok = await request.get(`${home}/exportar`);
  expect(ok.status()).toBe(200);
  expect(ok.headers()['content-type']).toBe('text/csv; charset=utf-8');
  expect(ok.headers()['cache-control']).toContain('no-store');
  expect(ok.headers()['x-robots-tag']).toBe('noindex, nofollow');

  const unknown = 'x'.repeat(24);
  const missing = await request.get(`/g/${unknown}/exportar`);
  expect(missing.status()).toBe(404);
  expect(await missing.text()).not.toContain(unknown);
});
