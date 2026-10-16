/**
 * P4.4 — focused tests for the display-dollars view adapter (D18).
 *
 * Covers: cents→dollars without rounding; date-only calendar-month coverage
 * (full, partial, day-31/leap, same-date); the one-factor-per-observation
 * contract shared by annual/monthly/tooltip values; disabled/zero identity;
 * signed net worth and asset-only measurement; invalid rate/date diagnostics;
 * and the named-context metadata adapter.
 */

import { describe, expect, it, vi } from 'vitest';

/**
 * Non-timing instrumentation for the O(1) coverage guarantee. `elapsedMonthCoverage`
 * is the only view-adapter consumer of `daysInMonth`, so counting the direct
 * calls it makes proves the span is never iterated month by month: the closed
 * form touches `daysInMonth` at most twice regardless of horizon length, whereas
 * the former loop made one call per covered month. The wrapper delegates to the
 * real implementation, so behaviour is unchanged.
 */
const coverageWork = vi.hoisted(() => ({ daysInMonthCalls: 0 }));

vi.mock('../engine/dates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../engine/dates')>();
  return {
    ...actual,
    daysInMonth: (year: number, month: number): number => {
      coverageWork.daysInMonthCalls += 1;
      return actual.daysInMonth(year, month);
    }
  };
});

import type { ProjectionRunMetadata } from '../engine/projection';
import type { ResultContextMetadata } from '../types';
import {
  deflateCents,
  deflateDollars,
  deflationFactor,
  displayContextFromResultContext,
  displayContextFromRunMetadata,
  displayMeasurementCents,
  displayObservedCents,
  displayObservedCentsSeries,
  elapsedMonthCoverage,
  measurementValueCents,
  resolveDeflation,
  toDollars,
  tryToDollars
} from './viewAdapters';

const runMetadata = (overrides: Partial<ProjectionRunMetadata> = {}): ProjectionRunMetadata => ({
  engineRevision: 'p4.4-view-1',
  contextSchemaVersion: 1,
  contextId: 'ctx-1',
  timelineId: null,
  timelineLabel: 'Base',
  measurement: 'assetsMinusLiabilities',
  startDate: '2026-01-16',
  endDate: '2026-12-31',
  startYearMonth: '2026-01',
  endYearMonth: '2026-12',
  horizonMonths: 12,
  hasOpeningSnapshot: true,
  sourceSnapshotId: null,
  ...overrides
});

describe('viewAdapters — toDollars', () => {
  it('converts integer cents to dollars exactly, with no rounding', () => {
    expect(toDollars(12345)).toBe(123.45);
    expect(toDollars(1)).toBe(0.01);
    expect(toDollars(0)).toBe(0);
    expect(toDollars(-12345)).toBe(-123.45);
  });

  it('throws on non-finite cents and returns a diagnostic from tryToDollars', () => {
    expect(() => toDollars(Number.NaN)).toThrow(RangeError);
    const result = tryToDollars(Number.POSITIVE_INFINITY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.code).toBe('non-finite-cents');
    }
  });
});

describe('viewAdapters — elapsedMonthCoverage (date-only calendar months)', () => {
  it('is exactly 0 when the observations are the same date', () => {
    const result = elapsedMonthCoverage('2026-01-16', '2026-01-16');
    expect(result).toEqual({ ok: true, value: 0 });
  });

  it('is 1 for a whole calendar month', () => {
    const result = elapsedMonthCoverage('2026-01-01', '2026-01-31');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }
  });

  it('clips a partial first month rather than treating it as a full month', () => {
    const result = elapsedMonthCoverage('2026-01-16', '2026-01-31');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(16 / 31, 15);
    }
  });

  it('sums a clipped first month, full months and a clipped last month', () => {
    const result = elapsedMonthCoverage('2026-01-16', '2026-03-10');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(16 / 31 + 1 + 10 / 31, 15);
    }
  });

  it('handles day-31 months and leap/non-leap February', () => {
    const day31Leap = elapsedMonthCoverage('2024-01-31', '2024-02-01');
    const day31Common = elapsedMonthCoverage('2023-01-31', '2023-02-01');
    expect(day31Leap.ok && day31Leap.value).toBeCloseTo(1 / 31 + 1 / 29, 15);
    expect(day31Common.ok && day31Common.value).toBeCloseTo(1 / 31 + 1 / 28, 15);

    const leapFull = elapsedMonthCoverage('2024-02-01', '2024-02-29');
    const commonFull = elapsedMonthCoverage('2023-02-01', '2023-02-28');
    expect(leapFull.ok && leapFull.value).toBe(1);
    expect(commonFull.ok && commonFull.value).toBe(1);

    const leapPartial = elapsedMonthCoverage('2024-02-16', '2024-02-29');
    expect(leapPartial.ok && leapPartial.value).toBeCloseTo(14 / 29, 15);
  });

  it('diagnoses malformed dates and a reversed observation', () => {
    const bad = elapsedMonthCoverage('2026-13-01', '2026-02-01');
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.diagnostic.code).toBe('invalid-date');
    }
    const reversed = elapsedMonthCoverage('2026-02-01', '2026-01-31');
    expect(reversed.ok).toBe(false);
    if (!reversed.ok) {
      expect(reversed.diagnostic.code).toBe('observation-before-opening');
    }
  });
});

describe('viewAdapters — deflationFactor (D18)', () => {
  it('compounds to the stated annual rate across a full calendar year', () => {
    const result = deflationFactor('2026-01-01', '2026-12-31', 6);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(1.06, 12);
    }
  });

  it('uses the clipped partial-month exponent for a mid-month opening', () => {
    const result = deflationFactor('2026-01-16', '2026-01-31', 6);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(Math.pow(1.06, 16 / 31 / 12), 15);
    }
  });

  it('returns exactly 1 when the observation date equals the opening date', () => {
    const result = deflationFactor('2026-01-16', '2026-01-16', 6);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe(1);
    }
  });

  it('is the identity when inflation is disabled or the rate is 0', () => {
    const disabled = deflationFactor('2026-01-16', '2026-12-31', 6, false);
    const zero = deflationFactor('2026-01-16', '2026-12-31', 0, true);
    expect(disabled.ok && disabled.value).toBe(1);
    expect(zero.ok && zero.value).toBe(1);
  });

  it('returns a diagnostic for invalid rates', () => {
    for (const rate of [Number.NaN, Number.POSITIVE_INFINITY, -100, -101]) {
      const result = deflationFactor('2026-01-01', '2026-12-31', rate);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.diagnostic.code).toBe('invalid-inflation-rate');
      }
    }
  });

  it('accepts a deflationary rate greater than -100', () => {
    const result = deflationFactor('2026-01-01', '2026-12-31', -2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(0.98, 12);
    }
  });

  it('returns a diagnostic for an invalid date', () => {
    const result = deflationFactor('not-a-date', '2026-12-31', 6);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostic.code).toBe('invalid-date');
    }
  });

  it('exposes the month coverage behind the factor', () => {
    const resolved = resolveDeflation('2026-01-16', '2026-12-31', 6);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.value.monthCoverage).toBeCloseTo(11 + 16 / 31, 15);
      expect(resolved.value.factor).toBeCloseTo(Math.pow(1.06, (11 + 16 / 31) / 12), 15);
    }
  });
});

describe('viewAdapters — shared basis (annual closing month equals tooltip)', () => {
  it('uses the same factor for an annual row and a monthly tooltip at the same closing date', () => {
    const opening = '2026-01-16';
    const closing = '2026-12-31';
    const annual = deflationFactor(opening, closing, 2.9);
    const tooltip = deflationFactor(opening, closing, 2.9);
    expect(annual.ok && tooltip.ok).toBe(true);
    if (annual.ok && tooltip.ok) {
      expect(annual.value).toBe(tooltip.value);
    }
  });
});

describe('viewAdapters — displayObservedCents (signed, unclamped)', () => {
  it('does not round dollars before deflation', () => {
    const result = displayObservedCents({ date: '2026-12-31', cents: 12345 }, '2026-01-01', 6);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 123.45 / 1.06 exactly, not a rounded 116.46.
      expect(result.value.nominalDollars).toBe(123.45);
      expect(result.value.displayDollars).toBeCloseTo(123.45 / 1.06, 12);
      expect(result.value.factor).toBeCloseTo(1.06, 12);
    }
  });

  it('gives every value at the same observation date the same factor', () => {
    const account = displayObservedCents({ date: '2026-06-30', cents: 100_000 }, '2026-01-16', 2.9);
    const debt = displayObservedCents({ date: '2026-06-30', cents: 3_500_000 }, '2026-01-16', 2.9);
    const property = displayObservedCents({ date: '2026-06-30', cents: 40_000_000 }, '2026-01-16', 2.9);
    expect(account.ok && debt.ok && property.ok).toBe(true);
    if (account.ok && debt.ok && property.ok) {
      expect(account.value.factor).toBe(debt.value.factor);
      expect(debt.value.factor).toBe(property.value.factor);
    }
  });

  it('preserves a negative signed value (never clamps)', () => {
    const result = displayObservedCents({ date: '2026-12-31', cents: -500_000 }, '2026-01-01', 6);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.displayDollars).toBeLessThan(0);
      expect(result.value.displayDollars).toBeCloseTo(-5000 / 1.06, 12);
    }
  });

  it('defines deflateDollars/deflateCents as plain division (signed)', () => {
    expect(deflateDollars(-5000, 1.25)).toBe(-4000);
    expect(deflateCents(-500_000, 1.25)).toBe(-4000);
  });

  it('deflates a whole series with one factor per observation date', () => {
    const series = displayObservedCentsSeries(
      [
        { date: '2026-01-31', cents: 1_000_000 },
        { date: '2026-06-30', cents: 1_200_000 },
        { date: '2026-12-31', cents: 1_500_000 }
      ],
      '2026-01-01',
      3
    );
    expect(series.ok).toBe(true);
    if (series.ok) {
      expect(series.value).toHaveLength(3);
      expect(series.value[0].factor).toBeCloseTo(Math.pow(1.03, 1 / 12), 15);
      expect(series.value[1].factor).toBeGreaterThan(series.value[0].factor);
      expect(series.value[2].factor).toBeCloseTo(1.03, 12);
    }
  });

  it('returns the first diagnostic of a failing series', () => {
    const series = displayObservedCentsSeries(
      [{ date: '2026-01-31', cents: 1_000_000 }, { date: 'bogus', cents: 2 }],
      '2026-01-01',
      3
    );
    expect(series.ok).toBe(false);
    if (!series.ok) {
      expect(series.diagnostic.code).toBe('invalid-date');
    }
  });
});

describe('viewAdapters — measurement selection', () => {
  it('computes signed net worth and never clamps a negative value', () => {
    const totals = { measurement: 'assetsMinusLiabilities' as const, assetsCents: 10_000_000, liabilitiesCents: 16_000_000 };
    expect(measurementValueCents(totals)).toBe(-6_000_000);
    const result = displayMeasurementCents(totals, '2026-12-31', '2026-01-01', 6);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.displayDollars).toBeCloseTo(-60_000 / 1.06, 12);
    }
  });

  it('keeps an asset-only measurement assets-only (liabilities not subtracted)', () => {
    const totals = { measurement: 'assetOnly' as const, assetsCents: 10_000_000, liabilitiesCents: 16_000_000 };
    expect(measurementValueCents(totals)).toBe(10_000_000);
    const result = displayMeasurementCents(totals, '2026-12-31', '2026-01-01', 6);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nominalDollars).toBe(100_000);
      expect(result.value.displayDollars).toBeCloseTo(100_000 / 1.06, 12);
    }
  });

  it('uses account-only assets for the accountAssets basis', () => {
    const totals = {
      measurement: 'accountAssets' as const,
      assetsCents: 40_000_000,
      liabilitiesCents: 5_000_000,
      accountAssetsCents: 12_000_000
    };
    expect(measurementValueCents(totals)).toBe(12_000_000);
  });
});

describe('viewAdapters — named-context display metadata', () => {
  it('copies every field from run metadata', () => {
    const context = displayContextFromRunMetadata(runMetadata());
    expect(context).toEqual({
      measurement: 'assetsMinusLiabilities',
      startDate: '2026-01-16',
      endDate: '2026-12-31',
      engineRevision: 'p4.4-view-1',
      schemaVersion: 1,
      contextId: 'ctx-1'
    });
  });

  it('validates a complete persisted result context', () => {
    const persisted: ResultContextMetadata = {
      measurement: 'assetsMinusLiabilities',
      startDate: '2026-01-16',
      endDate: '2026-12-31',
      schemaVersion: 1,
      engineRevision: 'p4.4-view-1',
      contextId: 'ctx-1'
    };
    const result = displayContextFromResultContext(persisted);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contextId).toBe('ctx-1');
    }
  });

  it('reports incomplete or invalid contexts instead of inventing metadata', () => {
    const missingRevision = displayContextFromResultContext({
      measurement: 'assetOnly',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      schemaVersion: 1
    });
    expect(missingRevision.ok).toBe(false);
    if (!missingRevision.ok) {
      expect(missingRevision.diagnostic.code).toBe('incomplete-context');
    }

    const badDate = displayContextFromResultContext({
      measurement: 'assetOnly',
      startDate: 'nope',
      endDate: '2026-12-31',
      schemaVersion: 1,
      engineRevision: 'rev'
    });
    expect(badDate.ok).toBe(false);
    if (!badDate.ok) {
      expect(badDate.diagnostic.code).toBe('invalid-date');
    }
  });
});

// ---------------------------------------------------------------------------
// D18 performance hardening — O(1) coverage, horizon regression, boundaries
// ---------------------------------------------------------------------------

/** Independent proleptic-Gregorian day count, written from scratch for reference. */
const referenceDayOrdinal = (date: string): number => {
  const [year, month, day] = date.split('-').map(Number);
  const adjustedYear = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
};

const referenceDaysInMonth = (year: number, month: number): number => {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
};

const makeDate = (year: number, month: number, day: number): string =>
  `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/**
 * Independent reference coverage: the original per-month clip, re-implemented
 * from scratch (string-ordering + an independent day ordinal). Used as the
 * ground truth the closed form must reproduce.
 */
const referenceCoverage = (openingDate: string, observationDate: string): number => {
  // The documented contract short-circuits equal dates to exactly 0.
  if (observationDate === openingDate) {
    return 0;
  }
  const [openingYear, openingMonth] = openingDate.split('-').map(Number);
  const [observationYear, observationMonth] = observationDate.split('-').map(Number);
  const startOrdinal = openingYear * 12 + (openingMonth - 1);
  const endOrdinal = observationYear * 12 + (observationMonth - 1);
  let total = 0;
  for (let ordinal = startOrdinal; ordinal <= endOrdinal; ordinal += 1) {
    const year = Math.floor(ordinal / 12);
    const month = ordinal - year * 12 + 1;
    const monthDays = referenceDaysInMonth(year, month);
    const monthStart = makeDate(year, month, 1);
    const monthEnd = makeDate(year, month, monthDays);
    const coveredStart = monthStart >= openingDate ? monthStart : openingDate;
    const coveredEnd = monthEnd <= observationDate ? monthEnd : observationDate;
    if (coveredStart > coveredEnd) {
      continue;
    }
    total += (referenceDayOrdinal(coveredEnd) - referenceDayOrdinal(coveredStart) + 1) / monthDays;
  }
  return total;
};

describe('viewAdapters — elapsedMonthCoverage is O(1) in horizon length', () => {
  it('touches daysInMonth a constant number of times for a 1-month and a 960-month span', () => {
    coverageWork.daysInMonthCalls = 0;
    const shortSpan = elapsedMonthCoverage('2000-01-15', '2000-02-14');
    const shortCalls = coverageWork.daysInMonthCalls;

    coverageWork.daysInMonthCalls = 0;
    const longSpan = elapsedMonthCoverage('2000-01-15', '2079-12-14');
    const longCalls = coverageWork.daysInMonthCalls;

    expect(shortSpan.ok).toBe(true);
    expect(longSpan.ok).toBe(true);
    // The former per-month loop would make one call per covered month (≤960);
    // the closed form makes a constant, span-independent number of calls.
    expect(longCalls).toBe(shortCalls);
    expect(longCalls).toBeLessThanOrEqual(2);
  });

  it('fold a 960-month span into one clipped first fraction, integer interior months, and one clipped last fraction', () => {
    const result = elapsedMonthCoverage('2000-01-15', '2079-12-14');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBeCloseTo(referenceCoverage('2000-01-15', '2079-12-14'), 12);
    }
  });
});

describe('viewAdapters — date boundaries across first/mid/last Jan-Feb (leap and common)', () => {
  it('clips the first, middle and last day of January and February in a leap year', () => {
    const firstToLastFeb = elapsedMonthCoverage('2024-02-01', '2024-02-29');
    expect(firstToLastFeb.ok && firstToLastFeb.value).toBe(1);

    const midFeb = elapsedMonthCoverage('2024-02-15', '2024-02-29');
    expect(midFeb.ok && midFeb.value).toBeCloseTo(15 / 29, 15);

    const lastJanToFirstFeb = elapsedMonthCoverage('2024-01-31', '2024-02-01');
    expect(lastJanToFirstFeb.ok && lastJanToFirstFeb.value).toBeCloseTo(1 / 31 + 1 / 29, 15);

    const firstJanToLastFeb = elapsedMonthCoverage('2024-01-01', '2024-02-29');
    expect(firstJanToLastFeb.ok && firstJanToLastFeb.value).toBe(2);

    const midJanToMidFeb = elapsedMonthCoverage('2024-01-15', '2024-02-15');
    expect(midJanToMidFeb.ok && midJanToMidFeb.value).toBeCloseTo(17 / 31 + 15 / 29, 15);
  });

  it('clips the last day of February in a common year and chains into March', () => {
    const lastFebToFirstMar = elapsedMonthCoverage('2023-02-28', '2023-03-01');
    expect(lastFebToFirstMar.ok && lastFebToFirstMar.value).toBeCloseTo(1 / 28 + 1 / 31, 15);

    const firstFebToLastFeb = elapsedMonthCoverage('2023-02-01', '2023-02-28');
    expect(firstFebToLastFeb.ok && firstFebToLastFeb.value).toBe(1);

    const midFebNonLeap = elapsedMonthCoverage('2023-02-15', '2023-02-28');
    expect(midFebNonLeap.ok && midFebNonLeap.value).toBeCloseTo(14 / 28, 15);
  });

  it('still diagnoses a reversed observation across a leap boundary', () => {
    const reversed = elapsedMonthCoverage('2024-02-29', '2024-02-01');
    expect(reversed.ok).toBe(false);
    if (!reversed.ok) {
      expect(reversed.diagnostic.code).toBe('observation-before-opening');
    }
  });
});

describe('viewAdapters — 960-point x 100-account deflation regression', () => {
  const opening = '2000-01-15';
  const rate = 2.5;
  const monthCount = 960;
  const accountCount = 100;

  const dates = Array.from({ length: monthCount }, (_, index) => {
    const year = 2000 + Math.floor(index / 12);
    const month = (index % 12) + 1;
    return makeDate(year, month, 15);
  });

  // Independent per-point references (naive month clip), computed once per date.
  const referenceFactors = dates.map((date) => Math.pow(1 + rate / 100, referenceCoverage(opening, date) / 12));
  const sampleIndices = [0, 1, 11, 137, 359, 480, 700, 958, 959];

  it('matches sampled factors to independently computed references for every account', () => {
    const firstAccountFactors: number[] = [];
    for (let account = 0; account < accountCount; account += 1) {
      const cents = 100_000 + account * 137;
      const observations = dates.map((date) => ({ date, cents }));
      const series = displayObservedCentsSeries(observations, opening, rate);
      expect(series.ok).toBe(true);
      if (!series.ok) {
        return;
      }
      expect(series.value).toHaveLength(monthCount);

      for (const index of sampleIndices) {
        const point = series.value[index];
        expect(point.observationDate).toBe(dates[index]);
        expect(point.nominalDollars).toBe(cents / 100);
        expect(point.factor).toBeCloseTo(referenceFactors[index], 9);
        expect(point.displayDollars).toBeCloseTo(cents / 100 / referenceFactors[index], 9);
        if (account === 0) {
          firstAccountFactors[index] = point.factor;
        } else {
          // Every account at the same closing date shares exactly one factor.
          expect(point.factor).toBe(firstAccountFactors[index]);
        }
      }
    }
  });

  it('keeps factors strictly increasing month over month across the full horizon', () => {
    const series = displayObservedCentsSeries(
      dates.map((date) => ({ date, cents: 1_000_000 })),
      opening,
      rate
    );
    expect(series.ok).toBe(true);
    if (!series.ok) {
      return;
    }
    for (let index = 1; index < series.value.length; index += 1) {
      expect(series.value[index].factor).toBeGreaterThan(series.value[index - 1].factor);
    }
  });

  it('exposes the same reference coverage as the month coverage behind each factor', () => {
    const series = displayObservedCentsSeries(
      dates.map((date) => ({ date, cents: 1_000_000 })),
      opening,
      rate
    );
    expect(series.ok).toBe(true);
    if (!series.ok) {
      return;
    }
    for (const index of sampleIndices) {
      expect(series.value[index].monthCoverage).toBeCloseTo(referenceCoverage(opening, dates[index]), 12);
    }
  });

  it('stays the identity over the full horizon when inflation is zero or disabled', () => {
    const observations = dates.map((date) => ({ date, cents: 1_000_000 }));

    const zero = displayObservedCentsSeries(observations, opening, 0, true);
    expect(zero.ok).toBe(true);
    if (zero.ok) {
      for (const point of zero.value) {
        expect(point.factor).toBe(1);
        expect(point.displayDollars).toBe(10000);
      }
    }

    const disabled = displayObservedCentsSeries(observations, opening, rate, false);
    expect(disabled.ok).toBe(true);
    if (disabled.ok) {
      for (const point of disabled.value) {
        expect(point.factor).toBe(1);
        expect(point.monthCoverage).toBe(0);
        expect(point.displayDollars).toBe(10000);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// GUI-A08 / CA12 / G34-G35 — fixed-date today's-dollar factor across month/year
// ---------------------------------------------------------------------------

describe('viewAdapters — fixed-date today’s-dollar factor across month/year (GUI-A08/CA12/G34-G35)', () => {
  const opening = '2026-01-15';
  const rate = 6;
  const june = '2026-06-01';
  const march = '2027-03-01';

  /** Factor recomputed from the shared coverage rule, independent of `deflationFactor`. */
  const expectedFactor = (observation: string): number => {
    const coverage = elapsedMonthCoverage(opening, observation);
    if (!coverage.ok) {
      throw new Error(`unexpected coverage diagnostic for ${observation}`);
    }
    return Math.pow(1 + rate / 100, coverage.value / 12);
  };

  it('derives a distinct, date-based factor for observations in different months and years', () => {
    const juneFactor = deflationFactor(opening, june, rate);
    const marchFactor = deflationFactor(opening, march, rate);
    expect(juneFactor.ok && marchFactor.ok).toBe(true);
    if (juneFactor.ok && marchFactor.ok) {
      expect(juneFactor.value).toBeCloseTo(expectedFactor(june), 12);
      expect(marchFactor.value).toBeCloseTo(expectedFactor(march), 12);
      // A later observation over a longer horizon deflates by a larger factor.
      expect(marchFactor.value).toBeGreaterThan(juneFactor.value);
    }
  });

  it('keeps nominal cents unchanged and applies the exact date-based factor to display dollars', () => {
    const nominalCents = 123_456;
    const result = displayObservedCents({ date: june, cents: nominalCents }, opening, rate);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.nominalCents).toBe(nominalCents);
      expect(result.value.nominalDollars).toBe(1234.56);
      expect(result.value.factor).toBeCloseTo(expectedFactor(june), 12);
      expect(result.value.displayDollars).toBeCloseTo(1234.56 / expectedFactor(june), 12);
    }
  });

  it('applies the same date-based factor to signed net worth and to account-only assets', () => {
    const totals = {
      measurement: 'assetsMinusLiabilities' as const,
      assetsCents: 4_000_000,
      liabilitiesCents: 5_200_000,
      accountAssetsCents: 4_000_000
    };
    const netWorth = displayMeasurementCents(totals, march, opening, rate);
    const accountAssets = displayMeasurementCents({ ...totals, measurement: 'accountAssets' as const }, march, opening, rate);
    expect(netWorth.ok && accountAssets.ok).toBe(true);
    if (netWorth.ok && accountAssets.ok) {
      expect(measurementValueCents(totals)).toBe(-1_200_000);
      expect(netWorth.value.displayDollars).toBeLessThan(0);
      expect(accountAssets.value.displayDollars).toBeGreaterThan(0);
      // Both measures share one date-based factor; only the signed cents differ.
      expect(netWorth.value.factor).toBe(accountAssets.value.factor);
      expect(netWorth.value.factor).toBeCloseTo(expectedFactor(march), 12);
      expect(netWorth.value.displayDollars).toBeCloseTo(-12_000 / expectedFactor(march), 12);
      expect(accountAssets.value.displayDollars).toBeCloseTo(40_000 / expectedFactor(march), 12);
    }
  });

  it('is the identity (nominal preserved) when today’s dollars are disabled', () => {
    const enabled = deflationFactor(opening, march, rate, true);
    const disabled = deflationFactor(opening, march, rate, false);
    expect(enabled.ok && disabled.ok).toBe(true);
    if (enabled.ok && disabled.ok) {
      expect(disabled.value).toBe(1);
      expect(enabled.value).toBeGreaterThan(1);
    }
    const nominal = displayObservedCents({ date: march, cents: -120_000 }, opening, rate, false);
    expect(nominal.ok).toBe(true);
    if (nominal.ok) {
      expect(nominal.value.factor).toBe(1);
      expect(nominal.value.displayDollars).toBe(-1200);
    }
  });
});
