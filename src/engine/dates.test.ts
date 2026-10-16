import { describe, expect, it } from 'vitest';

import {
  FULL_HORIZON_MONTHS,
  MONTHS_PER_YEAR,
  addDays,
  addMonths,
  addMonthsToDate,
  clipDateRange,
  clipMonthHorizon,
  compareDateOnly,
  containsMonth,
  createMonthHorizon,
  daysInMonth,
  diffDays,
  diffMonths,
  endOfMonthDate,
  formatDateOnly,
  formatYearMonth,
  fromDayOrdinal,
  fromMonthOrdinal,
  isDateInRange,
  isLeapYear,
  isValidDateOnly,
  isValidYearMonth,
  lastDayOfMonth,
  listMonths,
  monthHorizonFromDate,
  parseDateOnly,
  parseYearMonth,
  toDayOrdinal,
  toMonthOrdinal
} from './dates';

describe('dates — leap years and month lengths', () => {
  it('applies the Gregorian leap-year rule', () => {
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(2023)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
  });

  it('reports day counts and clamps day-31 targets', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2023, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 6)).toBe(30);
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(() => daysInMonth(2026, 0)).toThrow(RangeError);
    expect(() => daysInMonth(2026, 13)).toThrow(RangeError);
  });
});

describe('dates — date-only parse/format', () => {
  it('round-trips a canonical date', () => {
    expect(parseDateOnly('2026-03-09')).toEqual({ year: 2026, month: 3, day: 9 });
    expect(formatDateOnly({ year: 2026, month: 3, day: 9 })).toBe('2026-03-09');
  });

  it('accepts a leap day only in a leap year', () => {
    expect(parseDateOnly('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
    expect(parseDateOnly('2023-02-29')).toBeNull();
    expect(isValidDateOnly('2024-02-29')).toBe(true);
    expect(isValidDateOnly('2023-02-29')).toBe(false);
  });

  it('rejects malformed dates and impossible days', () => {
    expect(parseDateOnly('2026-04-31')).toBeNull();
    expect(parseDateOnly('2026-13-01')).toBeNull();
    expect(parseDateOnly('2026-00-10')).toBeNull();
    expect(parseDateOnly('2026-01-00')).toBeNull();
    expect(parseDateOnly('2026-1-01')).toBeNull();
    expect(parseDateOnly('2026/01/01')).toBeNull();
    expect(parseDateOnly('')).toBeNull();
    expect(isValidDateOnly('not-a-date')).toBe(false);
  });

  it('refuses to format an invalid calendar date', () => {
    expect(() => formatDateOnly({ year: 2023, month: 2, day: 29 })).toThrow(RangeError);
    expect(() => formatDateOnly({ year: 2026, month: 1, day: 0 })).toThrow(RangeError);
  });
});

describe('dates — year-month parsing and month ordinals', () => {
  it('parses and formats year-months', () => {
    expect(parseYearMonth('2026-01')).toEqual({ year: 2026, month: 1 });
    expect(parseYearMonth('2026-1')).toBeNull();
    expect(parseYearMonth('2026-13')).toBeNull();
    expect(isValidYearMonth('2026-12')).toBe(true);
    expect(formatYearMonth({ year: 2026, month: 7 })).toBe('2026-07');
  });

  it('uses a stable year*12+month ordinal and round-trips it', () => {
    expect(toMonthOrdinal('2026-01')).toBe(2026 * MONTHS_PER_YEAR);
    expect(fromMonthOrdinal(toMonthOrdinal('2026-07'))).toBe('2026-07');
    expect(() => toMonthOrdinal('2026-13')).toThrow(RangeError);
  });

  it('adds/subtracts months across year boundaries', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-01', 0)).toBe('2026-01');
    expect(diffMonths('2025-12', '2027-01')).toBe(13);
    expect(diffMonths('2027-01', '2025-12')).toBe(-13);
  });
});

describe('dates — day arithmetic and day ordinals', () => {
  it('counts inclusive day spans and round-trips ordinals', () => {
    expect(diffDays('2026-01-01', '2026-01-31')).toBe(30);
    expect(toDayOrdinal('1970-01-01')).toBe(0);
    expect(fromDayOrdinal(toDayOrdinal('2026-03-09'))).toBe('2026-03-09');
  });

  it('adds days without time-zone or DST drift', () => {
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(addDays('2026-03-08', -1)).toBe('2026-03-07');
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  });

  it('crosses leap-day boundaries correctly', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01');
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
  });
});

describe('dates — addMonthsToDate day clamping', () => {
  it('clamps to the last valid day of the target month', () => {
    expect(addMonthsToDate('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsToDate('2023-01-31', 1)).toBe('2023-02-28');
    expect(addMonthsToDate('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('preserves the day when it exists and supports subtraction', () => {
    expect(addMonthsToDate('2026-01-15', 12)).toBe('2027-01-15');
    expect(addMonthsToDate('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('exposes last-day helpers', () => {
    expect(lastDayOfMonth('2024-02')).toBe(29);
    expect(lastDayOfMonth('2026-04')).toBe(30);
    expect(endOfMonthDate('2024-02')).toBe('2024-02-29');
    expect(endOfMonthDate('2026-04')).toBe('2026-04-30');
  });
});

describe('dates — inclusive date ranges', () => {
  it('orders dates stably and tests inclusive containment', () => {
    expect(compareDateOnly('2026-01-31', '2026-02-01')).toBe(-1);
    expect(compareDateOnly('2026-02-01', '2026-02-01')).toBe(0);
    expect(compareDateOnly('2026-02-02', '2026-02-01')).toBe(1);
    const range = { startDate: '2026-01-15', endDate: '2026-02-15' };
    expect(isDateInRange('2026-01-15', range)).toBe(true);
    expect(isDateInRange('2026-02-15', range)).toBe(true);
    expect(isDateInRange('2026-01-14', range)).toBe(false);
    expect(isDateInRange('2026-02-16', range)).toBe(false);
  });

  it('clips a date range inclusively and returns null when empty', () => {
    expect(
      clipDateRange({ startDate: '2026-01-15', endDate: '2026-02-15' }, '2026-02-01', '2026-03-01')
    ).toEqual({ startDate: '2026-02-01', endDate: '2026-02-15' });
    expect(
      clipDateRange({ startDate: '2026-01-15', endDate: '2026-02-15' }, '2026-01-15', '2026-02-15')
    ).toEqual({ startDate: '2026-01-15', endDate: '2026-02-15' });
    expect(clipDateRange({ startDate: '2026-01-15', endDate: '2026-02-15' }, '2027-01-01')).toBeNull();
    expect(clipDateRange({ startDate: '2026-01-15', endDate: '2026-02-15' }, undefined, '2026-01-01')).toBeNull();
  });
});

describe('dates — explicit month horizons', () => {
  it('builds the required 960 full-month (80-year) horizon metadata', () => {
    const horizon = createMonthHorizon('2026-01');
    expect(horizon.monthCount).toBe(FULL_HORIZON_MONTHS);
    expect(horizon.startYearMonth).toBe('2026-01');
    expect(horizon.endYearMonth).toBe('2105-12');
    expect(horizon.startOrdinal).toBe(toMonthOrdinal('2026-01'));
    expect(horizon.endOrdinal).toBe(toMonthOrdinal('2105-12'));
    expect(diffMonths(horizon.startYearMonth, horizon.endYearMonth)).toBe(959);
  });

  it('counts both endpoints as inclusive', () => {
    expect(createMonthHorizon('2026-01', 12)).toMatchObject({ endYearMonth: '2026-12', monthCount: 12 });
    expect(createMonthHorizon('2026-01', 1)).toMatchObject({ endYearMonth: '2026-01', monthCount: 1 });
    expect(() => createMonthHorizon('2026-01', 0)).toThrow(RangeError);
    expect(() => createMonthHorizon('2026-01', 1.5)).toThrow(RangeError);
  });

  it('builds a horizon from a date and lists exactly 960 months', () => {
    const horizon = monthHorizonFromDate('2026-01-15', 24);
    expect(horizon.startYearMonth).toBe('2026-01');
    expect(horizon.endYearMonth).toBe('2027-12');

    const months = listMonths(createMonthHorizon('2026-01'));
    expect(months).toHaveLength(FULL_HORIZON_MONTHS);
    expect(months[0]).toBe('2026-01');
    expect(months[months.length - 1]).toBe('2105-12');
  });

  it('clips horizons inclusively and returns null when empty', () => {
    const horizon = createMonthHorizon('2026-01', 12);
    expect(containsMonth(horizon, '2026-01')).toBe(true);
    expect(containsMonth(horizon, '2026-12')).toBe(true);
    expect(containsMonth(horizon, '2027-01')).toBe(false);

    expect(clipMonthHorizon(horizon, '2026-03', '2027-01')).toMatchObject({
      startYearMonth: '2026-03',
      endYearMonth: '2026-12',
      monthCount: 10
    });
    expect(clipMonthHorizon(horizon, '2026-01', '2026-12')).toMatchObject({ monthCount: 12 });
    expect(clipMonthHorizon(horizon, '2027-01')).toBeNull();
    expect(clipMonthHorizon(horizon, undefined, '2025-12')).toBeNull();
  });
});
