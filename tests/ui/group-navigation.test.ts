import { describe, expect, it } from 'vitest';
import { asksIdentity, groupNavigation, MODES } from '@/app/g/[token]/group-navigation';

const base = '/g/abc';

describe('groupNavigation', () => {
  it.each([
    ['/g/abc', 'reparto', 'gastos', true],
    ['/g/abc/', 'reparto', 'gastos', true],
    ['/g/abc/gastos/nuevo', 'reparto', 'gastos', false],
    ['/g/abc/gastos/x1', 'reparto', 'gastos', false],
    ['/g/abc/gastos/sin-pagar/nuevo', 'reparto', 'gastos', false],
    ['/g/abc/balances', 'reparto', 'saldos', true],
    ['/g/abc/bote', 'bote', 'ronda', true],
    ['/g/abc/bote/cerradas', 'bote', 'cerradas', true],
    ['/g/abc/bote/cerradas/r1', 'bote', 'cerradas', false],
  ])('%s belongs to %s › %s (view root: %s)', (pathname, mode, view, isViewRoot) => {
    expect(groupNavigation(pathname, base)).toEqual({ mode, view, isViewRoot });
  });

  it.each(['/g/abc/actividad', '/g/abc/ajustes', '/g/abc/otra'])('%s belongs to no mode', (pathname) => {
    expect(groupNavigation(pathname, base)).toEqual({ mode: null, view: null, isViewRoot: false });
  });

  it('does not mistake a sibling prefix for a mode route', () => {
    expect(groupNavigation('/g/abc/botellas', base).mode).toBeNull();
    expect(groupNavigation('/g/abc/balancesx', base).mode).toBeNull();
  });

  it('every mode lists its views with the route each one owns', () => {
    expect(MODES.reparto.views.map((v) => [v.id, v.href])).toEqual([['gastos', ''], ['saldos', '/balances']]);
    expect(MODES.bote.views.map((v) => [v.id, v.href])).toEqual([['ronda', '/bote'], ['cerradas', '/bote/cerradas']]);
  });
});

describe('asksIdentity — where a device with no identity is asked who it is', () => {
  it.each(['/g/abc', '/g/abc/balances', '/g/abc/bote', '/g/abc/gastos/nuevo', '/g/abc/ajustes'])('%s asks', (pathname) => {
    expect(asksIdentity(pathname, base)).toBe(true);
  });

  it('the share page does not: it is for inviting, and the group asks once entered', () => {
    expect(asksIdentity('/g/abc/compartir', base)).toBe(false);
    expect(asksIdentity('/g/abc/compartir/', base)).toBe(false);
  });
});
