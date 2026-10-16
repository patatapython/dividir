import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

// Every group route waits with the shape of what it is about to show (T-36).
// Next wraps a page in the NEAREST loading.tsx up its folder tree, so the
// skeleton a route gets is decided by where the files sit; this pins it. The
// group folder's own loading.tsx is also what a navigation shows before its
// prefetch arrives, so it is a neutral frame. The same holds one level down: a
// loading.tsx is also the fallback for every route below it, so it may only
// cover routes of its own shape; a page with differently shaped children takes
// its skeleton into a route group ((ledger), bote/(round)).
const GROUP = 'src/app/g/[token]';
const EXPECTED: Record<string, string> = {
  '(ledger)': 'ledger',
  balances: 'balances',
  'bote/(round)': 'round',
  'bote/cerradas': 'closed-rounds',
  'bote/cerradas/[roundId]': 'closed-rounds',
  'gastos/nuevo': 'form',
  'gastos/[id]': 'form',
  'gastos/sin-pagar/nuevo': 'form',
  'gastos/sin-pagar/[id]': 'form',
  actividad: 'activity',
  ajustes: 'settings',
  compartir: 'share',
  // No such page: nothing is coming, so the neutral group frame.
  '[...missing]': 'group',
};

function routes(dir: string): string[] {
  const here = existsSync(join(dir, 'page.tsx')) ? [relative(GROUP, dir) || '.'] : [];
  const below = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => routes(join(dir, entry.name)));
  return [...here, ...below];
}

function nearestLoading(route: string): string {
  for (let dir = join(GROUP, route); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'loading.tsx'))) return join(dir, 'loading.tsx');
    if (dir === GROUP) throw new Error(`${route} has no loading.tsx`);
  }
}

describe('route loading skeletons', () => {
  it('every group route declares the skeleton it waits with', () => {
    expect(routes(GROUP).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('the group boundary is neutral, not any one page', async () => {
    const { default: Loading } = (await import(resolve(GROUP, 'loading.tsx'))) as { default: ComponentType };
    expect(renderToStaticMarkup(createElement(Loading))).toContain('data-skeleton="group"');
  });

  it('a page-shaped skeleton never covers a route of another shape', () => {
    const covered = new Map<string, Set<string>>();
    for (const [route, name] of Object.entries(EXPECTED)) {
      for (let dir = join(GROUP, route); dir !== GROUP; dir = dirname(dir)) {
        if (!existsSync(join(dir, 'loading.tsx'))) continue;
        covered.set(dir, (covered.get(dir) ?? new Set()).add(name));
      }
    }
    const mixed = [...covered].filter(([, names]) => names.size > 1).map(([dir, names]) => `${dir}: ${[...names]}`);
    expect(mixed).toEqual([]);
  });

  it.each(Object.entries(EXPECTED))('%s waits with the %s skeleton', async (route, name) => {
    const { default: Loading } = (await import(resolve(nearestLoading(route)))) as { default: ComponentType };
    const markup = renderToStaticMarkup(createElement(Loading));
    expect(markup).toContain(`data-skeleton="${name}"`);
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain('role="status"');
  });
});
