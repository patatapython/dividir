import { describe, expect, it } from 'vitest';
import { dayKey, formatCalendarDate, formatDay, formatTime, previousDayKey, todayKey } from '@/app/_ui/dates';

const NOW = new Date('2026-09-23T10:00:00.000Z');

describe('formatCalendarDate (a user-picked YYYY-MM-DD, never timezone-shifted)', () => {
  it('reads as day and month in Spanish within the current year', () => {
    expect(formatCalendarDate('2026-07-12', NOW)).toBe('12 de julio');
    expect(formatCalendarDate('2026-01-01', NOW)).toBe('1 de enero');
  });

  it('adds the year only when it is not the current one', () => {
    expect(formatCalendarDate('2025-07-12', NOW)).toBe('12 de julio de 2025');
  });

  it('takes the current year in the app zone, not in UTC', () => {
    // 23:30 UTC on 31 Dec is already 1 Jan 2027 in Madrid.
    expect(formatCalendarDate('2026-12-31', new Date('2026-12-31T23:30:00.000Z'))).toBe('31 de diciembre de 2026');
  });
});

describe('instants (createdAt) read in the app time zone', () => {
  it('keys an instant by its Madrid calendar day, summer and winter', () => {
    expect(dayKey(new Date('2026-09-22T22:30:00.000Z'))).toBe('2026-09-23'); // CEST, +2
    expect(dayKey(new Date('2026-01-01T23:30:00.000Z'))).toBe('2026-01-02'); // CET, +1
    expect(dayKey(new Date('2026-09-22T21:59:00.000Z'))).toBe('2026-09-22');
  });

  it('formats the day and the wall-clock time in Madrid', () => {
    const lateNight = new Date('2026-09-22T22:30:00.000Z');
    expect(formatDay(lateNight, NOW)).toBe('23 de septiembre');
    expect(formatTime(lateNight)).toBe('00:30');
  });

  it('today is the Madrid day of now', () => {
    expect(todayKey(new Date('2026-09-22T22:30:00.000Z'))).toBe('2026-09-23');
  });
});

describe('previousDayKey (calendar arithmetic, safe across DST changes)', () => {
  it('steps back one calendar day across month and year ends', () => {
    expect(previousDayKey('2026-03-01')).toBe('2026-02-28');
    expect(previousDayKey('2026-01-01')).toBe('2025-12-31');
    expect(previousDayKey('2026-03-30')).toBe('2026-03-29'); // day after the spring-forward change
  });
});
