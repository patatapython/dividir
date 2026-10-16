import { expect } from 'vitest';
import type { ActionResult } from '../../src/server/action-result';
import { cookieJar } from '../server/next-mocks';

/**
 * Runs actions as a person would, from a device: every call is checked, every
 * successful mutation is counted per group (Actividad must list exactly those), and
 * every casuistic of the test plan that the run exercises is ticked, so the report
 * can prove what was covered instead of claiming it.
 */
export class Driver {
  readonly covered = new Set<string>();
  private readonly activity = new Map<string, number>();
  readonly timings: { label: string; ms: number }[] = [];
  calls = 0;
  rejections = 0;

  /** Acts from the device of `participantId` (null: a device nobody has claimed). */
  as(groupId: string, participantId: string | null): this {
    const key = `participant_${groupId}`;
    if (participantId === null) cookieJar.delete(key);
    else cookieJar.set(key, participantId);
    return this;
  }

  cover(...ids: string[]): void {
    for (const id of ids) this.covered.add(id);
  }

  /** A mutation that must succeed; `logs` is how many activity entries it writes. */
  async ok<T>(groupId: string, label: string, call: Promise<ActionResult<T>>, logs = 1): Promise<T> {
    this.calls++;
    const result = await call;
    if (!result.ok) throw new Error(`${label} failed: ${result.error}`);
    this.activity.set(groupId, (this.activity.get(groupId) ?? 0) + logs);
    return result.data;
  }

  /**
   * A mutation that must be refused with a Spanish message matching `message`.
   * Soft: a run reports every broken rule at once, and an action that throws
   * instead of refusing (an unhandled error the person would see) is one of them.
   */
  async refused(caseId: string, call: Promise<ActionResult<unknown>>, message: RegExp): Promise<string> {
    this.calls++;
    let result: ActionResult<unknown>;
    try {
      result = await call;
    } catch (error) {
      expect.soft(String(error).slice(0, 300), `${caseId}: unhandled error instead of a refusal`).toBe('a refusal');
      return '';
    }
    expect.soft(result.ok, `${caseId} should be refused`).toBe(false);
    if (result.ok) return '';
    expect.soft(result.error, caseId).toMatch(message);
    this.rejections++;
    this.cover(caseId);
    return result.error;
  }

  expectedActivity(groupId: string): number {
    return this.activity.get(groupId) ?? 0;
  }

  /** A mutation made outside the driver (e.g. concurrency) that logged `logs` entries. */
  countActivity(groupId: string, logs: number): void {
    this.activity.set(groupId, (this.activity.get(groupId) ?? 0) + logs);
  }

  async time<T>(label: string, run: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const value = await run();
    this.timings.push({ label, ms: Math.round(performance.now() - start) });
    return value;
  }
}

/** Cents → the decimal-comma string a person types ("1234" → "12,34"). */
export function typed(cents: number): string {
  return `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`;
}
