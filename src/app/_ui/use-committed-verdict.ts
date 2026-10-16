'use client';
import { useState } from 'react';

/**
 * The validation policy of every typed value in the app: judged when the user LEAVES the field, never
 * mid-typing (a pending "12," is a value being written, not a mistake). The verdict belongs to the value
 * committed on blur, so the first edit withdraws it and the next blur judges again.
 */
export function useCommittedVerdict(value: string, isInvalid: (value: string) => boolean) {
  const [rejected, setRejected] = useState<string | null>(null);
  return {
    showError: rejected !== null && rejected === value,
    commit: () => setRejected(isInvalid(value) ? value : null),
  };
}
