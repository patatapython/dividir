import { unstable_rethrow } from 'next/navigation';
import type { ActionResult } from '@/server/action-result';

export const UNEXPECTED_ACTION_ERROR =
  'No se ha podido completar la operación. Comprueba tu conexión e inténtalo de nuevo.';

/**
 * Calls a server action from a client component and always settles to an
 * ActionResult. Expected failures already arrive as results (runAction maps
 * them); anything that throws instead (network loss, an unmapped server error)
 * becomes a failure too, so the caller shows it inline and keeps its form.
 * Without this, React 19 raises the rejection to the nearest error.tsx, which
 * replaces the whole screen. Next's own navigation errors (redirect, notFound)
 * are rethrown so they keep working.
 */
type ActionFailure = Extract<ActionResult<never>, { ok: false }>;

export async function runClientAction<R extends ActionResult<unknown>>(
  action: () => Promise<R>,
): Promise<R | ActionFailure> {
  try {
    return await action();
  } catch (error) {
    unstable_rethrow(error);
    console.error(error);
    return { ok: false, error: UNEXPECTED_ACTION_ERROR };
  }
}
