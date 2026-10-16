/**
 * The one place the app turns dates into Spanish text (T-22).
 *
 * Two kinds of date exist. A calendar date (expense, payment and charge
 * `date`, `YYYY-MM-DD`) is what the user picked and is never shifted by a
 * time zone. An instant (`createdAt`) is read in APP_TIME_ZONE, fixed rather
 * than taken from the process: the server runs in UTC and the browser in the
 * viewer's zone, and both must print the same day and time.
 */
export const APP_TIME_ZONE = 'Europe/Madrid';

const keyParts = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const dayMonth = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long' });
const dayMonthYear = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
const clock = new Intl.DateTimeFormat('es-ES', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** The APP_TIME_ZONE calendar day of an instant, as `YYYY-MM-DD`. */
export function dayKey(instant: Date): string {
  const parts = Object.fromEntries(keyParts.formatToParts(instant).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Today in APP_TIME_ZONE: the default for date inputs. */
export const todayKey = (now = new Date()): string => dayKey(now);

/** The calendar day before `key`, by calendar arithmetic (a DST day is not 24 h). */
export function previousDayKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

/** "12 de julio"; the year is added only when it is not the current one. */
export function formatCalendarDate(key: string, now = new Date()): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  return key.slice(0, 4) === todayKey(now).slice(0, 4) ? dayMonth.format(date) : dayMonthYear.format(date);
}

/** The APP_TIME_ZONE day of an instant, as formatCalendarDate prints it. */
export const formatDay = (instant: Date, now = new Date()): string => formatCalendarDate(dayKey(instant), now);

/** "14:05" in APP_TIME_ZONE. */
export const formatTime = (instant: Date): string => clock.format(instant);
