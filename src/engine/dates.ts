/**
 * P2.1 — Date-only calendar primitives (engine-internal, pure).
 *
 * Every value here is a **date-only** calendar value with no wall-clock or time
 * zone component:
 *
 * - `DateOnly` is the canonical `YYYY-MM-DD` string.
 * - `YearMonth` is the canonical `YYYY-MM` string.
 * - `MonthOrdinal` is `year * 12 + (month - 1)`, the stable integer used for
 *   month arithmetic and ordering.
 * - `DayOrdinal` is the proleptic-Gregorian day number (days from 1970-01-01),
 *   used for day arithmetic and comparison.
 *
 * The implementation never calls `Date`, so no local-time or DST component can
 * ever leak into month/day math (contract: "Timezone-safe; no `Date` time
 * components leaking into month math"). Leap years and day-31 targets clamp to
 * the last valid day of the target month. All ranges are **inclusive**.
 *
 * Horizon metadata (`MonthHorizon`) is explicit: a start month plus a full-month
 * count yields a matching inclusive `endYearMonth` and ordinal bounds, so the
 * required 960 full-month (80-year) horizon is a first-class value rather than
 * an implicit loop bound.
 *
 * Authority: `refactor/phase2_plan.md` P2.1, `refactor/frozen_contracts.md`
 * P0.3.2 (same-date ordering), P0.5.1 (date-only first-withdrawal dates),
 * P0.7.1 (960 full months).
 */

/** Canonical date-only value: `YYYY-MM-DD` (proleptic Gregorian, no time zone). */
export type DateOnly = string;

/** Canonical year-month value: `YYYY-MM`. */
export type YearMonth = string;

/** Stable month ordinal: `year * 12 + (month - 1)`; a month apart is `±1`. */
export type MonthOrdinal = number;

/** Proleptic-Gregorian day ordinal; consecutive days are `±1`. */
export type DayOrdinal = number;

export interface CalendarDate {
  /** Full year, `0`–`9999`. */
  year: number;
  /** Calendar month, `1`–`12`. */
  month: number;
  /** Day of month, `1`–`31` (validated against the month/year). */
  day: number;
}

export interface ParsedYearMonth {
  year: number;
  /** Calendar month, `1`–`12`. */
  month: number;
}

/** Inclusive date-only range, ordered `startDate <= endDate`. */
export interface DateRange {
  startDate: DateOnly;
  endDate: DateOnly;
}

/**
 * Inclusive month horizon metadata for a fixed-length projection window.
 * `monthCount` counts every month from `startYearMonth` through `endYearMonth`
 * (so a January-to-December horizon has `monthCount === 12`).
 */
export interface MonthHorizon {
  startYearMonth: YearMonth;
  endYearMonth: YearMonth;
  startOrdinal: MonthOrdinal;
  endOrdinal: MonthOrdinal;
  monthCount: number;
}

export const MONTHS_PER_YEAR = 12;

/** Required full horizon: 80 years of monthly batches (ADR-016 / P0.7.1). */
export const FULL_HORIZON_MONTHS = 960;

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const YEAR_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

/** Proleptic-Gregorian leap-year rule. */
export const isLeapYear = (year: number): boolean =>
  Number.isInteger(year) && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

/** Number of days in `month` (`1`–`12`) of `year`; throws for an invalid month. */
export const daysInMonth = (year: number, month: number): number => {
  if (!Number.isInteger(year)) {
    throw new RangeError(`daysInMonth requires an integer year; received ${year}.`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`daysInMonth requires a month between 1 and 12; received ${month}.`);
  }
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  // April, June, September and November have 30 days; all others have 31.
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
};

/** Parses a strict `YYYY-MM` value; returns `null` when malformed or out of range. */
export const parseYearMonth = (value: string): ParsedYearMonth | null => {
  const match = YEAR_MONTH_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    return null;
  }
  return { year, month };
};

export const isValidYearMonth = (value: string): boolean => parseYearMonth(value) !== null;

/** Formats a parsed year-month back to `YYYY-MM`; throws when out of range. */
export const formatYearMonth = ({ year, month }: ParsedYearMonth): YearMonth => {
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError(`formatYearMonth requires a year between 0000 and 9999; received ${year}.`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`formatYearMonth requires a month between 1 and 12; received ${month}.`);
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
};

/**
 * Parses a strict `YYYY-MM-DD` value. Returns `null` for malformed input,
 * out-of-range months, and impossible days (including `02-29` in a non-leap
 * year and day 31 in a 30-day month).
 */
export const parseDateOnly = (value: string): CalendarDate | null => {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) {
    return null;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
};

export const isValidDateOnly = (value: string): boolean => parseDateOnly(value) !== null;

/** Formats a calendar date back to `YYYY-MM-DD`; throws when invalid. */
export const formatDateOnly = (date: CalendarDate): DateOnly => {
  if (!Number.isInteger(date.year) || date.year < 0 || date.year > 9999) {
    throw new RangeError(`formatDateOnly requires a year between 0000 and 9999; received ${date.year}.`);
  }
  if (!Number.isInteger(date.month) || date.month < 1 || date.month > 12) {
    throw new RangeError(`formatDateOnly requires a month between 1 and 12; received ${date.month}.`);
  }
  if (!Number.isInteger(date.day) || date.day < 1 || date.day > daysInMonth(date.year, date.month)) {
    throw new RangeError(
      `formatDateOnly requires a day between 1 and ${daysInMonth(date.year, date.month)} for ${date.year}-${String(
        date.month
      ).padStart(2, '0')}; received ${date.day}.`
    );
  }
  return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(
    2,
    '0'
  )}`;
};

// --- Civil-day conversion (Howard Hinnant's `days_from_civil` / `civil_from_days`) ---
// Pure integer arithmetic; no `Date`, no time zone, no floating point error.
const daysFromCivil = (year: number, month: number, day: number): number => {
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
};

const civilFromDays = (ordinal: DayOrdinal): CalendarDate => {
  const shifted = ordinal + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365
  );
  const year = yearOfEra + era * 400;
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  return { year: year + (month <= 2 ? 1 : 0), month, day };
};

/** Day ordinal of a `YYYY-MM-DD` value; throws when malformed. */
export const toDayOrdinal = (date: DateOnly): DayOrdinal => {
  const parsed = parseDateOnly(date);
  if (!parsed) {
    throw new RangeError(`toDayOrdinal requires a valid YYYY-MM-DD value; received "${date}".`);
  }
  return daysFromCivil(parsed.year, parsed.month, parsed.day);
};

/** Inverse of {@link toDayOrdinal}; throws for a non-integer ordinal. */
export const fromDayOrdinal = (ordinal: DayOrdinal): DateOnly => {
  if (!Number.isSafeInteger(ordinal)) {
    throw new RangeError(`fromDayOrdinal requires a safe-integer ordinal; received ${ordinal}.`);
  }
  const civil = civilFromDays(ordinal);
  return formatDateOnly(civil);
};

/** Adds (or subtracts) whole calendar days; time-zone and DST independent. */
export const addDays = (date: DateOnly, days: number): DateOnly => {
  if (!Number.isSafeInteger(days)) {
    throw new RangeError(`addDays requires a safe-integer day offset; received ${days}.`);
  }
  return fromDayOrdinal(toDayOrdinal(date) + days);
};

/** Signed day difference `b - a` (`> 0` when `b` is later). */
export const diffDays = (a: DateOnly, b: DateOnly): number => toDayOrdinal(b) - toDayOrdinal(a);

/** Stable ordering for date-only values: `-1`, `0` or `1`. */
export const compareDateOnly = (a: DateOnly, b: DateOnly): -1 | 0 | 1 => {
  const delta = toDayOrdinal(a) - toDayOrdinal(b);
  if (delta < 0) {
    return -1;
  }
  return delta > 0 ? 1 : 0;
};

/** Month ordinal for a `YYYY-MM` value; throws when malformed. */
export const toMonthOrdinal = (yearMonth: YearMonth): MonthOrdinal => {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) {
    throw new RangeError(`toMonthOrdinal requires a valid YYYY-MM value; received "${yearMonth}".`);
  }
  return parsed.year * MONTHS_PER_YEAR + (parsed.month - 1);
};

/** Inverse of {@link toMonthOrdinal}; throws for a non-integer ordinal. */
export const fromMonthOrdinal = (ordinal: MonthOrdinal): YearMonth => {
  if (!Number.isSafeInteger(ordinal)) {
    throw new RangeError(`fromMonthOrdinal requires a safe-integer ordinal; received ${ordinal}.`);
  }
  const year = Math.floor(ordinal / MONTHS_PER_YEAR);
  const month = ordinal - year * MONTHS_PER_YEAR + 1;
  return formatYearMonth({ year, month });
};

/** Adds (or subtracts) whole months to a `YYYY-MM` value. */
export const addMonths = (yearMonth: YearMonth, months: number): YearMonth => {
  if (!Number.isSafeInteger(months)) {
    throw new RangeError(`addMonths requires a safe-integer month offset; received ${months}.`);
  }
  return fromMonthOrdinal(toMonthOrdinal(yearMonth) + months);
};

/** Signed month difference `b - a` (`> 0` when `b` is later). */
export const diffMonths = (a: YearMonth, b: YearMonth): number => toMonthOrdinal(b) - toMonthOrdinal(a);

/**
 * Adds whole months while preserving the day of month, clamping to the target
 * month's last valid day (day-31 → day-28/29/30). `2024-01-31 + 1` = `2024-02-29`;
 * `2023-01-31 + 1` = `2023-02-28`.
 */
export const addMonthsToDate = (date: DateOnly, months: number): DateOnly => {
  const parsed = parseDateOnly(date);
  if (!parsed) {
    throw new RangeError(`addMonthsToDate requires a valid YYYY-MM-DD value; received "${date}".`);
  }
  if (!Number.isSafeInteger(months)) {
    throw new RangeError(`addMonthsToDate requires a safe-integer month offset; received ${months}.`);
  }
  const target = fromMonthOrdinal(toMonthOrdinal(formatYearMonth(parsed)) + months);
  const targetParts = parseYearMonth(target);
  if (!targetParts) {
    throw new RangeError(`addMonthsToDate produced an invalid target month "${target}".`);
  }
  const day = Math.min(parsed.day, daysInMonth(targetParts.year, targetParts.month));
  return formatDateOnly({ year: targetParts.year, month: targetParts.month, day });
};

/** Last valid day-of-month for a `YYYY-MM` value. */
export const lastDayOfMonth = (yearMonth: YearMonth): number => {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) {
    throw new RangeError(`lastDayOfMonth requires a valid YYYY-MM value; received "${yearMonth}".`);
  }
  return daysInMonth(parsed.year, parsed.month);
};

/** Last valid date of a `YYYY-MM` value (day-31 aware). */
export const endOfMonthDate = (yearMonth: YearMonth): DateOnly => {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) {
    throw new RangeError(`endOfMonthDate requires a valid YYYY-MM value; received "${yearMonth}".`);
  }
  return formatDateOnly({ year: parsed.year, month: parsed.month, day: daysInMonth(parsed.year, parsed.month) });
};

/** Inclusive containment check for a date-only range. */
export const isDateInRange = (date: DateOnly, range: DateRange): boolean =>
  compareDateOnly(date, range.startDate) >= 0 && compareDateOnly(date, range.endDate) <= 0;

/**
 * Inclusive clipping of a date range against optional bounds. Returns `null`
 * when the clipped range is empty (no dates fall inside the bounds).
 */
export const clipDateRange = (
  range: DateRange,
  clipStart?: DateOnly,
  clipEnd?: DateOnly
): DateRange | null => {
  // Validate both endpoints up front so malformed input never yields a silent result.
  const startOrdinal = toDayOrdinal(range.startDate);
  const endOrdinal = toDayOrdinal(range.endDate);
  const lower = clipStart === undefined ? startOrdinal : Math.max(startOrdinal, toDayOrdinal(clipStart));
  const upper = clipEnd === undefined ? endOrdinal : Math.min(endOrdinal, toDayOrdinal(clipEnd));
  if (lower > upper) {
    return null;
  }
  return { startDate: fromDayOrdinal(lower), endDate: fromDayOrdinal(upper) };
};

/**
 * Builds explicit inclusive horizon metadata. Defaults to the required 960
 * full months; `monthCount` is inclusive of both the start and end months.
 */
export const createMonthHorizon = (
  startYearMonth: YearMonth,
  monthCount: number = FULL_HORIZON_MONTHS
): MonthHorizon => {
  if (!Number.isSafeInteger(monthCount) || monthCount < 1) {
    throw new RangeError(`createMonthHorizon requires a positive integer month count; received ${monthCount}.`);
  }
  const startOrdinal = toMonthOrdinal(startYearMonth);
  const endOrdinal = startOrdinal + monthCount - 1;
  return {
    startYearMonth: fromMonthOrdinal(startOrdinal),
    endYearMonth: fromMonthOrdinal(endOrdinal),
    startOrdinal,
    endOrdinal,
    monthCount
  };
};

/** Horizon starting at the month containing `startDate`. */
export const monthHorizonFromDate = (
  startDate: DateOnly,
  monthCount: number = FULL_HORIZON_MONTHS
): MonthHorizon => {
  const parsed = parseDateOnly(startDate);
  if (!parsed) {
    throw new RangeError(`monthHorizonFromDate requires a valid YYYY-MM-DD value; received "${startDate}".`);
  }
  return createMonthHorizon(formatYearMonth(parsed), monthCount);
};

/** Inclusive containment check for a horizon. */
export const containsMonth = (horizon: MonthHorizon, yearMonth: YearMonth): boolean => {
  const ordinal = toMonthOrdinal(yearMonth);
  return ordinal >= horizon.startOrdinal && ordinal <= horizon.endOrdinal;
};

/**
 * Inclusive clipping of a horizon against optional month bounds. Returns `null`
 * when the clipped horizon is empty. The result carries fresh start/end metadata.
 */
export const clipMonthHorizon = (
  horizon: MonthHorizon,
  clipStartYearMonth?: YearMonth,
  clipEndYearMonth?: YearMonth
): MonthHorizon | null => {
  const lower =
    clipStartYearMonth === undefined ? horizon.startOrdinal : Math.max(horizon.startOrdinal, toMonthOrdinal(clipStartYearMonth));
  const upper =
    clipEndYearMonth === undefined ? horizon.endOrdinal : Math.min(horizon.endOrdinal, toMonthOrdinal(clipEndYearMonth));
  if (lower > upper) {
    return null;
  }
  return createMonthHorizon(fromMonthOrdinal(lower), upper - lower + 1);
};

/** Every month in a horizon, in ascending order. */
export const listMonths = (horizon: MonthHorizon): YearMonth[] => {
  const months: YearMonth[] = [];
  for (let ordinal = horizon.startOrdinal; ordinal <= horizon.endOrdinal; ordinal += 1) {
    months.push(fromMonthOrdinal(ordinal));
  }
  return months;
};
