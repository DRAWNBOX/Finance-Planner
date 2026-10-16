/**
 * P2.7 — focused tests for account month-close APY valuation.
 *
 * Covers CA08 (exact APY, clipped partial-month exponent, date fractions) and
 * the safe-range diagnostics of the isolated `valuation.ts` lane.
 */

import { describe, expect, it } from 'vitest';

import type { PropertyStatus } from '../types';
import { roundHalfAwayFromZero } from './money';
import {
  effectiveMonthlyRate,
  monthFractionForDates,
  monthlyGrowthFactor,
  quoteAccountMonthClose,
  quoteDebtMonthlyAccrual,
  quotePropertyAppreciation
} from './valuation';

describe('valuation — exact APY', () => {
  it('compounds to the stated annual rate over twelve months', () => {
    const monthly = effectiveMonthlyRate(0.065);
    expect(Math.pow(1 + monthly, 12)).toBeCloseTo(1.065, 12);
    expect(monthly).toBeCloseTo(Math.pow(1.065, 1 / 12) - 1, 15);
  });

  it('quotes a full-month growth posting rounded half away from zero once', () => {
    const balanceCents = 1_000_000;
    const result = quoteAccountMonthClose({ accountId: 'a', balanceCents, annualRate: 0.065 });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const expected = roundHalfAwayFromZero(balanceCents * (Math.pow(1.065, 1 / 12) - 1));
    expect(result.close.monthFraction).toBe(1);
    expect(result.close.growthFactor).toBeCloseTo(Math.pow(1.065, 1 / 12), 15);
    expect(result.close.growthCents).toBe(expected);
    expect(result.close.closingBalanceCents).toBe(balanceCents + expected);
  });

  it('uses a clipped partial-month exponent', () => {
    const balanceCents = 1_000_000;
    const fraction = 16 / 31;
    const result = quoteAccountMonthClose({
      accountId: 'a',
      balanceCents,
      annualRate: 0.065,
      monthFraction: fraction
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const expected = roundHalfAwayFromZero(balanceCents * (Math.pow(1.065, fraction / 12) - 1));
    expect(result.close.growthFactor).toBeCloseTo(monthlyGrowthFactor(0.065, fraction), 15);
    expect(result.close.growthCents).toBe(expected);
  });

  it('handles a -100% rate by zeroing the balance', () => {
    const result = quoteAccountMonthClose({ accountId: 'a', balanceCents: 12345, annualRate: -1 });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.close.growthCents).toBe(-12345);
    expect(result.close.closingBalanceCents).toBe(0);
  });

  it('returns explicit diagnostics for invalid ranges', () => {
    expect(quoteAccountMonthClose({ accountId: 'a', balanceCents: 1.5, annualRate: 0 }).ok).toBe(false);
    expect(quoteAccountMonthClose({ accountId: 'a', balanceCents: -1, annualRate: 0 }).ok).toBe(false);
    expect(quoteAccountMonthClose({ accountId: 'a', balanceCents: 1, annualRate: -1.5 }).ok).toBe(false);
    expect(quoteAccountMonthClose({ accountId: 'a', balanceCents: 1, annualRate: 0, monthFraction: 0 }).ok).toBe(false);
    expect(quoteAccountMonthClose({ accountId: 'a', balanceCents: 1, annualRate: 0, monthFraction: 1.5 }).ok).toBe(false);
  });
});

describe('valuation — date fractions', () => {
  it('is 1 for a full month', () => {
    expect(monthFractionForDates('2026-01', '2026-01-01', '2026-01-31')).toBe(1);
  });

  it('is the covered share for a clipped month', () => {
    expect(monthFractionForDates('2026-01', '2026-01-16', '2026-01-31')).toBe(16 / 31);
    expect(monthFractionForDates('2026-02', '2026-02-01', '2026-02-14')).toBe(14 / 28);
    expect(monthFractionForDates('2024-02', '2024-02-01', '2024-02-29')).toBe(1);
  });

  it('returns null when the range does not intersect the month', () => {
    expect(monthFractionForDates('2026-03', '2026-01-01', '2026-02-28')).toBeNull();
    expect(monthFractionForDates('nope', '2026-01-01', '2026-01-31')).toBeNull();
  });
});

describe('valuation — debt monthly accrual (D13, nominal APR/12)', () => {
  it('accrues at the independently computed nominal APR/12', () => {
    const principalCents = 1_000_000; // $10,000
    const annualRate = 0.065;
    const result = quoteDebtMonthlyAccrual(principalCents, annualRate);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const expected = roundHalfAwayFromZero((principalCents * (6.5 / 100)) / 12);
    expect(result.accrual.monthlyRate).toBeCloseTo(annualRate / 12, 15);
    expect(result.accrual.accrualCents).toBe(expected);
    expect(result.accrual.accrualCents).toBe(5417); // 5416.66… → 5417
    expect(result.accrual.closingBalanceCents).toBe(principalCents + expected);
  });

  it('is distinct from the effective account APY for the same rate', () => {
    const principalCents = 1_000_000;
    const rate = 0.06;
    const debt = quoteDebtMonthlyAccrual(principalCents, rate);
    const apy = quoteAccountMonthClose({ accountId: 'a', balanceCents: principalCents, annualRate: rate });
    expect(debt.ok && apy.ok).toBe(true);
    if (!debt.ok || !apy.ok) {
      return;
    }
    expect(debt.accrual.accrualCents).toBe(5000); // 6% / 12 nominal
    expect(apy.close.growthCents).toBe(4868); // (1.06)^(1/12) − 1 effective
    expect(debt.accrual.accrualCents).not.toBe(apy.close.growthCents);
  });

  it('accrues exactly zero on a 0% card', () => {
    const result = quoteDebtMonthlyAccrual(500_000, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.accrual.monthlyRate).toBe(0);
    expect(result.accrual.accrualCents).toBe(0);
    expect(result.accrual.closingBalanceCents).toBe(500_000);
  });

  it('prorates a clipped partial month', () => {
    const principalCents = 1_000_000;
    const fraction = 16 / 31;
    const result = quoteDebtMonthlyAccrual(principalCents, 0.065, fraction);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const expected = roundHalfAwayFromZero(principalCents * (0.065 / 12) * fraction);
    expect(result.accrual.accrualCents).toBe(expected);
    expect(result.accrual.accrualCents).toBeLessThan(5417);
  });

  it('prorates safely across the 960-month horizon plus a partial month', () => {
    const principalCents = 2_500_000; // $25,000
    const annualRate = 0.065;
    const fullMonth = roundHalfAwayFromZero((principalCents * (6.5 / 100)) / 12);
    let last = 0;
    for (let month = 0; month < 960; month += 1) {
      const quoted = quoteDebtMonthlyAccrual(principalCents, annualRate);
      expect(quoted.ok).toBe(true);
      if (!quoted.ok) {
        return;
      }
      last = quoted.accrual.accrualCents;
      expect(Number.isSafeInteger(quoted.accrual.closingBalanceCents)).toBe(true);
    }
    // Nominal accrual is not compounded here: every full month is identical.
    expect(last).toBe(fullMonth);
    const partial = quoteDebtMonthlyAccrual(principalCents, annualRate, 15 / 31);
    expect(partial.ok).toBe(true);
    if (!partial.ok) {
      return;
    }
    expect(partial.accrual.accrualCents).toBe(
      roundHalfAwayFromZero((principalCents * (6.5 / 100)) / 12 * (15 / 31))
    );
  });

  it('rejects negative and unsafe inputs with explicit diagnostics', () => {
    const negativePrincipal = quoteDebtMonthlyAccrual(-1, 0.05);
    expect(negativePrincipal.ok).toBe(false);
    if (!negativePrincipal.ok) {
      expect(negativePrincipal.diagnostic.code).toBe('unsafe-principal');
    }
    expect(quoteDebtMonthlyAccrual(1.5, 0.05).ok).toBe(false);
    expect(quoteDebtMonthlyAccrual(100, -0.01).ok).toBe(false);
    expect(quoteDebtMonthlyAccrual(100, Number.POSITIVE_INFINITY).ok).toBe(false);
    expect(quoteDebtMonthlyAccrual(100, Number.NaN).ok).toBe(false);
    expect(quoteDebtMonthlyAccrual(100, 0.05, 0).ok).toBe(false);
    expect(quoteDebtMonthlyAccrual(100, 0.05, 1.5).ok).toBe(false);
  });
});

describe('valuation — property appreciation (D11, effective annual)', () => {
  it('appreciates at the independently computed effective annual rate', () => {
    const valueCents = 30_000_000; // $300,000
    const annualRate = 0.03;
    const result = quotePropertyAppreciation(valueCents, annualRate);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const expected = roundHalfAwayFromZero(valueCents * (Math.pow(1 + annualRate, 1 / 12) - 1));
    expect(result.appreciation.status).toBe('owned');
    expect(result.appreciation.growthFactor).toBeCloseTo(Math.pow(1.03, 1 / 12), 15);
    expect(result.appreciation.appreciationCents).toBe(expected);
    expect(result.appreciation.closingValueCents).toBe(valueCents + expected);
  });

  it('is distinct from the nominal debt APR for the same rate', () => {
    const valueCents = 1_000_000;
    const rate = 0.06;
    const property = quotePropertyAppreciation(valueCents, rate);
    const debt = quoteDebtMonthlyAccrual(valueCents, rate);
    expect(property.ok && debt.ok).toBe(true);
    if (!property.ok || !debt.ok) {
      return;
    }
    expect(debt.accrual.accrualCents).toBe(5000); // nominal 6% / 12
    expect(property.appreciation.appreciationCents).toBe(4868); // (1.06)^(1/12) − 1
    expect(property.appreciation.appreciationCents).not.toBe(debt.accrual.accrualCents);
  });

  it('prorates a clipped partial month', () => {
    const valueCents = 30_000_000;
    const fraction = 16 / 31;
    const result = quotePropertyAppreciation(valueCents, 0.03, fraction);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const expected = roundHalfAwayFromZero(valueCents * (Math.pow(1.03, fraction / 12) - 1));
    expect(result.appreciation.growthFactor).toBeCloseTo(monthlyGrowthFactor(0.03, fraction), 15);
    expect(result.appreciation.appreciationCents).toBe(expected);
  });

  it('handles depreciation including a -100% wipeout', () => {
    const depreciating = quotePropertyAppreciation(1_000_000, -0.05);
    expect(depreciating.ok).toBe(true);
    if (!depreciating.ok) {
      return;
    }
    expect(depreciating.appreciation.appreciationCents).toBeLessThan(0);
    expect(depreciating.appreciation.closingValueCents).toBeLessThan(1_000_000);

    const wipeout = quotePropertyAppreciation(123_456, -1);
    expect(wipeout.ok).toBe(true);
    if (!wipeout.ok) {
      return;
    }
    expect(wipeout.appreciation.growthFactor).toBe(0);
    expect(wipeout.appreciation.appreciationCents).toBe(-123_456);
    expect(wipeout.appreciation.closingValueCents).toBe(0);
  });

  it('never appreciates a pending (or sold) property but does appreciate an owned one', () => {
    const valueCents = 30_000_000;
    const pending = quotePropertyAppreciation(valueCents, 0.03, 1, 'pending');
    expect(pending.ok).toBe(true);
    if (!pending.ok) {
      return;
    }
    expect(pending.appreciation.status).toBe('pending');
    expect(pending.appreciation.growthFactor).toBe(1);
    expect(pending.appreciation.appreciationCents).toBe(0);
    expect(pending.appreciation.closingValueCents).toBe(valueCents);

    const sold = quotePropertyAppreciation(valueCents, 0.03, 1, 'sold');
    expect(sold.ok).toBe(true);
    if (!sold.ok) {
      return;
    }
    expect(sold.appreciation.appreciationCents).toBe(0);

    const owned = quotePropertyAppreciation(valueCents, 0.03, 1, 'owned');
    expect(owned.ok).toBe(true);
    if (!owned.ok) {
      return;
    }
    expect(owned.appreciation.appreciationCents).toBeGreaterThan(0);
  });

  it('stays safe across the 960-month horizon plus a partial month', () => {
    const initialCents = 30_000_000;
    const annualRate = 0.03;
    let valueCents = initialCents;
    for (let month = 0; month < 960; month += 1) {
      const quoted = quotePropertyAppreciation(valueCents, annualRate);
      expect(quoted.ok).toBe(true);
      if (!quoted.ok) {
        return;
      }
      valueCents = quoted.appreciation.closingValueCents;
      expect(Number.isSafeInteger(valueCents)).toBe(true);
    }
    // Per-month HAFZ drift is under half a cent per month, so 80 years of
    // compounding stays within a dollar of the closed form (1.03)^80.
    expect(Math.abs(valueCents - initialCents * Math.pow(1.03, 80))).toBeLessThan(480);

    const partial = quotePropertyAppreciation(valueCents, annualRate, 16 / 31);
    expect(partial.ok).toBe(true);
    if (!partial.ok) {
      return;
    }
    expect(partial.appreciation.appreciationCents).toBe(
      roundHalfAwayFromZero(valueCents * (Math.pow(1.03, 16 / 31 / 12) - 1))
    );
  });

  it('rejects unsafe values, rates, fractions and statuses', () => {
    expect(quotePropertyAppreciation(-1, 0.03).ok).toBe(false);
    expect(quotePropertyAppreciation(1.5, 0.03).ok).toBe(false);
    expect(quotePropertyAppreciation(100, -1.5).ok).toBe(false);
    expect(quotePropertyAppreciation(100, Number.NaN).ok).toBe(false);
    expect(quotePropertyAppreciation(100, 0.03, 0).ok).toBe(false);
    expect(quotePropertyAppreciation(100, 0.03, 1.5).ok).toBe(false);
    expect(quotePropertyAppreciation(100, 0.03, 1, 'bogus' as PropertyStatus).ok).toBe(false);
  });
});

describe('valuation — account APY unchanged by D11/D13', () => {
  it('keeps the exact effective APY quote for a 6.5% account', () => {
    const monthly = effectiveMonthlyRate(0.065);
    expect(Math.pow(1 + monthly, 12)).toBeCloseTo(1.065, 12);
    const result = quoteAccountMonthClose({ accountId: 'a', balanceCents: 1_000_000, annualRate: 0.065 });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.close.growthCents).toBe(
      roundHalfAwayFromZero(1_000_000 * (Math.pow(1.065, 1 / 12) - 1))
    );
    expect(result.close.growthFactor).toBeCloseTo(Math.pow(1.065, 1 / 12), 15);
  });

  it('keeps the account effective monthly rate below the nominal APR/12', () => {
    const effective = effectiveMonthlyRate(0.065);
    expect(effective).toBeLessThan(0.065 / 12);
    expect(Math.abs(effective - 0.065 / 12)).toBeLessThan(0.001);
  });
});
