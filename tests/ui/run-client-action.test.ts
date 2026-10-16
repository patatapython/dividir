import { afterEach, describe, expect, it, vi } from 'vitest';
import { notFound } from 'next/navigation';
import { runClientAction, UNEXPECTED_ACTION_ERROR } from '@/app/_ui/run-client-action';

describe('runClientAction', () => {
  afterEach(() => vi.restoreAllMocks());

  it('passes a successful result through', async () => {
    expect(await runClientAction(async () => ({ ok: true, data: 7 }))).toEqual({ ok: true, data: 7 });
  });

  it('passes a mapped failure through untouched, code included', async () => {
    const failure = { ok: false as const, error: 'Pago duplicado', code: 'DUPLICATE_PAYMENT' as const };
    expect(await runClientAction(async () => failure)).toEqual(failure);
  });

  it('turns a rejected action (network down, unmapped server error) into a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await runClientAction(async () => { throw new TypeError('Failed to fetch'); });
    expect(result).toEqual({ ok: false, error: UNEXPECTED_ACTION_ERROR });
    expect(console.error).toHaveBeenCalled();
  });

  it('lets Next navigation errors (redirect, notFound) through', async () => {
    await expect(runClientAction(async () => notFound())).rejects.toThrow();
  });
});
