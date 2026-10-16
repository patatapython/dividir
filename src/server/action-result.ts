export type ActionErrorCode = 'DUPLICATE_PAYMENT';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: ActionErrorCode };

export const ok = <T>(data: T): ActionResult<T> => ({ ok: true, data });
export const fail = (error: string, code?: ActionErrorCode): ActionResult<never> =>
  code === undefined ? { ok: false, error } : { ok: false, error, code };
