import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// One Node major everywhere: the version a developer gets from `nvm use`, the one npm
// accepts (`engines`) and the one every image stage is built on. Tests run on the first,
// production runs on the last, so a drift between them ships untested code.
const nvmrc = existsSync('.nvmrc') ? readFileSync('.nvmrc', 'utf8').trim() : '';
const engines: string = JSON.parse(readFileSync('package.json', 'utf8')).engines?.node ?? '';
const imageMajors = [...readFileSync('Dockerfile', 'utf8').matchAll(/^FROM node:(\d+)/gm)].map((m) => m[1]);

describe('Node toolchain', () => {
  it('pins a Node major in .nvmrc', () => {
    expect(nvmrc).toMatch(/^\d+$/);
  });

  it('accepts only that major in package.json engines', () => {
    expect(engines).toMatch(new RegExp(`^\\^${nvmrc}\\.\\d+\\.\\d+$`));
  });

  it('builds every image stage on that major', () => {
    expect(imageMajors.length).toBeGreaterThan(0);
    expect(new Set(imageMajors)).toEqual(new Set([nvmrc]));
  });
});
