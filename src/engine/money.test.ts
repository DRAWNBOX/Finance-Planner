import { describe, expect, it } from 'vitest';

import {
  CENTS_PER_DOLLAR,
  MAX_SAFE_CENTS,
  assertNonNegativeCents,
  assertSafeCents,
  centsToDollars,
  createCumulativeShareSchedule,
  cumulativeThrough,
  diagnoseCentsInput,
  diagnoseDollarInput,
  dollarsToCents,
  retargetCumulativeShareSchedule,
  roundHalfAwayFromZero,
  safeMultiplyCents,
  safeSumCents,
  shareAt,
  splitCumulative,
  tryCreateCumulativeShareSchedule,
  tryDollarsToCents,
  trySafeMultiplyCents,
  trySafeSumCents,
  trySplitCumulative
} from './money';

describe('money — half-away-from-zero rounding', () => {
  it('rounds exact halves away from zero in both directions', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(1.5)).toBe(2);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
    expect(roundHalfAwayFromZero(2.4)).toBe(2);
    expect(roundHalfAwayFromZero(-2.4)).toBe(-2);
    expect(roundHalfAwayFromZero(0)).toBe(0);
  });

  it('rejects non-finite values', () => {
    expect(() => roundHalfAwayFromZero(NaN)).toThrow(RangeError);
    expect(() => roundHalfAwayFromZero(Infinity)).toThrow(RangeError);
  });
});

describe('money — dollars to cents at the posting boundary', () => {
  it('converts whole and fractional dollars', () => {
    expect(CENTS_PER_DOLLAR).toBe(100);
    expect(dollarsToCents(0)).toBe(0);
    expect(dollarsToCents(100)).toBe(10000);
    expect(dollarsToCents(10.5)).toBe(1050);
    expect(dollarsToCents(-2.5)).toBe(-250);
  });

  it('rounds half cents away from zero, including negative and sub-cent values', () => {
    expect(dollarsToCents(0.005)).toBe(1);
    expect(dollarsToCents(-0.005)).toBe(-1);
    expect(dollarsToCents(0.004)).toBe(0);
    expect(dollarsToCents(-0.004)).toBe(0);
    expect(dollarsToCents(10.999)).toBe(1100);
    expect(dollarsToCents(10.994)).toBe(1099);
  });

  it('rounds from the exact decimal value (no binary-product drift, no tolerance)', () => {
    // 1.005 * 100 evaluates to 100.49999999999999 in IEEE-754; the exact decimal
    // value must still round a half cent away from zero to 101.
    expect(dollarsToCents(1.005)).toBe(101);
    expect(dollarsToCents(2.675)).toBe(268);
    expect(dollarsToCents(-2.675)).toBe(-268);
    // A single cent is never swallowed by a tolerance band.
    expect(dollarsToCents(0.01)).toBe(1);
    expect(dollarsToCents(-0.01)).toBe(-1);
    expect(dollarsToCents(1e-7)).toBe(0);
  });

  it('converts cents back to dollars for display', () => {
    expect(centsToDollars(1050)).toBe(10.5);
    expect(centsToDollars(-1)).toBe(-0.01);
    expect(centsToDollars(dollarsToCents(99.99))).toBeCloseTo(99.99, 10);
  });
});

describe('money — diagnostics for non-finite and unsafe amounts', () => {
  it('inspects dollar and cent inputs', () => {
    expect(diagnoseDollarInput(5)).toBeNull();
    expect(diagnoseDollarInput(NaN)?.code).toBe('non-finite');
    expect(diagnoseDollarInput(Infinity)?.code).toBe('non-finite');
    expect(diagnoseCentsInput(5)).toBeNull();
    expect(diagnoseCentsInput(5.5)?.code).toBe('unsafe-integer');
    expect(diagnoseCentsInput(NaN)?.code).toBe('non-finite');
  });

  it('throws and diagnoses overflow of the dollar→cent conversion', () => {
    expect(() => dollarsToCents(NaN)).toThrow(RangeError);
    expect(() => dollarsToCents(MAX_SAFE_CENTS)).toThrow(RangeError);
    expect(tryDollarsToCents(Number.NaN)).toMatchObject({ ok: false, diagnostic: { code: 'non-finite' } });
    expect(tryDollarsToCents(MAX_SAFE_CENTS)).toMatchObject({ ok: false, diagnostic: { code: 'overflow' } });
    expect(tryDollarsToCents(8.34)).toEqual({ ok: true, value: 834 });
  });
});

describe('money — safe-integer validation (input / multiply / aggregate)', () => {
  it('guards cent values and nonnegative requirements', () => {
    expect(assertSafeCents(0)).toBe(0);
    expect(assertSafeCents(MAX_SAFE_CENTS)).toBe(MAX_SAFE_CENTS);
    expect(() => assertSafeCents(MAX_SAFE_CENTS + 1)).toThrow(RangeError);
    expect(() => assertSafeCents(1.5)).toThrow(RangeError);
    expect(assertNonNegativeCents(0)).toBe(0);
    expect(() => assertNonNegativeCents(-1)).toThrow(RangeError);
  });

  it('validates integer multiplication intermediates and results', () => {
    expect(safeMultiplyCents(5, 3)).toBe(15);
    expect(safeMultiplyCents(-5, 3)).toBe(-15);
    expect(() => safeMultiplyCents(MAX_SAFE_CENTS, 2)).toThrow(/overflow/i);
    expect(() => safeMultiplyCents(2, MAX_SAFE_CENTS)).toThrow(/overflow/i);
    expect(() => safeMultiplyCents(1.5, 2)).toThrow(RangeError);

    expect(trySafeMultiplyCents(MAX_SAFE_CENTS, 2)).toMatchObject({ ok: false, diagnostic: { code: 'overflow' } });
    expect(trySafeMultiplyCents(1.5, 2)).toMatchObject({ ok: false, diagnostic: { code: 'unsafe-integer' } });
    expect(trySafeMultiplyCents(4, 250)).toEqual({ ok: true, value: 1000 });
  });

  it('validates aggregates, including safe near-limit sums', () => {
    expect(safeSumCents([1, 2, 3])).toBe(6);
    expect(safeSumCents([MAX_SAFE_CENTS - 1, 1])).toBe(MAX_SAFE_CENTS);
    expect(() => safeSumCents([MAX_SAFE_CENTS, 1])).toThrow(/overflow/i);
    expect(() => safeSumCents([1, 1.5])).toThrow(RangeError);

    expect(trySafeSumCents([MAX_SAFE_CENTS, 1])).toMatchObject({ ok: false, diagnostic: { code: 'overflow' } });
    expect(trySafeSumCents([1, 2, 3])).toEqual({ ok: true, value: 6 });
  });
});

describe('money — cumulative per-line scheduled allocation', () => {
  it('splits $100 annually into eight $8.33 and four $8.34 (exact total)', () => {
    const schedule = createCumulativeShareSchedule(10000, 12);
    const shares = splitCumulative(schedule);
    expect(shares).toEqual([833, 834, 833, 833, 834, 833, 833, 834, 833, 833, 834, 833]);
    expect(safeSumCents(shares)).toBe(10000);
    expect(shares.filter((share) => share === 833)).toHaveLength(8);
    expect(shares.filter((share) => share === 834)).toHaveLength(4);
  });

  it('exposes rounded cumulative and per-occurrence shares', () => {
    const schedule = createCumulativeShareSchedule(10000, 12);
    expect(cumulativeThrough(schedule, 0)).toBe(0);
    expect(cumulativeThrough(schedule, 1)).toBe(833);
    expect(cumulativeThrough(schedule, 2)).toBe(1667);
    expect(cumulativeThrough(schedule, 12)).toBe(10000);
    expect(shareAt(schedule, 1)).toBe(833);
    expect(shareAt(schedule, 2)).toBe(834);
    expect(() => cumulativeThrough(schedule, 13)).toThrow(RangeError);
  });

  it('rounds fractional cumulative targets with no residual month', () => {
    expect(splitCumulative(createCumulativeShareSchedule(100, 3))).toEqual([33, 34, 33]);
    expect(splitCumulative(createCumulativeShareSchedule(0, 12))).toEqual(new Array(12).fill(0));
    expect(splitCumulative(createCumulativeShareSchedule(101, 1))).toEqual([101]);
  });

  it('handles an 80-year (960-occurrence) safe target exactly', () => {
    const schedule = createCumulativeShareSchedule(1_000_000, 960);
    const shares = splitCumulative(schedule);
    expect(shares).toHaveLength(960);
    expect(safeSumCents(shares)).toBe(1_000_000);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
    // Deterministic: identical input yields an identical split.
    expect(splitCumulative(schedule)).toEqual(shares);
  });

  it('rejects invalid schedules and reports diagnostics', () => {
    expect(() => createCumulativeShareSchedule(-1, 12)).toThrow(RangeError);
    expect(() => createCumulativeShareSchedule(100, 0)).toThrow(RangeError);
    expect(() => createCumulativeShareSchedule(1.5, 12)).toThrow(RangeError);
    expect(tryCreateCumulativeShareSchedule(-1, 12)).toMatchObject({
      ok: false,
      diagnostic: { code: 'negative-target' }
    });
    expect(tryCreateCumulativeShareSchedule(100, 0)).toMatchObject({
      ok: false,
      diagnostic: { code: 'invalid-count' }
    });
    expect(tryCreateCumulativeShareSchedule(100, MAX_SAFE_CENTS + 1)).toMatchObject({
      ok: false,
      diagnostic: { code: 'invalid-count' }
    });
    expect(trySplitCumulative(-100, 12)).toMatchObject({ ok: false, diagnostic: { code: 'negative-target' } });
  });

  it('resets only when the target or occurrence count changes', () => {
    const schedule = createCumulativeShareSchedule(1200, 12);
    expect(retargetCumulativeShareSchedule(schedule, 1200, 12)).toBe(schedule);
    const retargeted = retargetCumulativeShareSchedule(schedule, 2400, 12);
    expect(retargeted).not.toBe(schedule);
    expect(cumulativeThrough(retargeted, 12)).toBe(2400);
  });
});
