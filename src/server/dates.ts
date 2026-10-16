/**
 * Expense/Payment dates are calendar dates (@db.Date), spec §4.6.
 * Both directions are pure string/UTC-midnight conversions — no timezone
 * math anywhere, so no midnight-shift bugs by construction.
 */
export function dateStringToDb(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function dbDateToString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
