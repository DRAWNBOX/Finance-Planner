/**
 * P2.7 — Account month-close APY valuation (engine-internal, pure).
 *
 * Isolated lane for the **only** financial math the kernel-only `projectScenario`
 * facade performs on its own: growing an account balance by its exact effective
 * annual percentage yield at a month close.
 *
 * Contract (`refactor/phase2_plan.md` P2.7, `refactor/frozen_contracts.md`
 * P0.3.4 / P0.3.5, ADR-020, AGENTS.md "exact APY monthly compounding"):
 *
 * - **Exact APY.** The full-month factor is `(1 + annualRate)^(1/12)`, so
 *   `(1 + effectiveMonthlyRate(rate))^12 === 1 + rate` for a stated annual rate
 *   (a stated `6.5%` yields exactly `6.5%` per year).
 * - **Clipped partial-month exponent.** A month that is clipped by the valuation
 *   window uses the fractional exponent `monthFraction / 12`, i.e.
 *   `(1 + annualRate)^(monthFraction / 12)`, where `monthFraction` is the covered
 *   share of the calendar month. A full month is `monthFraction === 1`.
 * - **Cents once.** The growth posting is `roundHalfAwayFromZero(balance ×
 *   (factor − 1))`, the single rounding at the posting boundary (P0.3.4); the
 *   per-account factor and rate intermediates stay high precision.
 * - **Safe ranges.** Non-finite/`< −100%` rates, non-positive `> 1` fractions,
 *   unsafe balances and unsafe growth return an explicit diagnostic rather than
 *   an approximation (P0.3.5).
 *
 * P3 (D11/D13) — this module is the **single valuation owner** for the other two
 * non-payment postings as well:
 *
 * - **Debt-interest accrual (D13).** `quoteDebtMonthlyAccrual` accrues at the
 *   **nominal** monthly rate `annualRate / 12` (simple, uncompounded), prorated by the
 *   covered month fraction. A `0%` card accrues exactly zero. This is
 *   deliberately distinct from the account effective-APY rule above.
 * - **Property appreciation (D11).** `quotePropertyAppreciation` grows a held
 *   property at its **effective** annual appreciation rate
 *   (`(1 + rate)^(monthFraction / 12) − 1`), the same compounding family as the
 *   account APY but its own rate/API. Only an `owned` property appreciates; a
 *   `pending` acquisition holds a non-appreciating deposit and never gains value
 *   (P0.5.3).
 *
 * Both quote functions only **return a cent delta** for the caller to post
 * through `state.commitChanges`; they mutate nothing, read no wall clock and
 * hold no state. They are the APIs P3D.3 (loans) and P3H.1 (housing) consume.
 *
 * This module mutates nothing, reads no wall clock and holds no state.
 */

import {
  compareDateOnly,
  daysInMonth,
  endOfMonthDate,
  parseYearMonth,
  toDayOrdinal,
  type DateOnly,
  type YearMonth
} from './dates';
import { roundHalfAwayFromZero } from './money';
import type { PropertyStatus } from '../types';

/** Basis points-free exact rate helper: effective monthly rate for a fraction. */
export const effectiveMonthlyRate = (annualRate: number): number => Math.pow(1 + annualRate, 1 / 12) - 1;

/**
 * Growth factor for `monthFraction` of a month at `annualRate`
 * (`(1 + annualRate)^(monthFraction / 12)`). `monthFraction === 1` is a full month.
 */
export const monthlyGrowthFactor = (annualRate: number, monthFraction = 1): number =>
  Math.pow(1 + annualRate, monthFraction / 12);

export type ValuationDiagnosticCode =
  | 'invalid-annual-rate'
  | 'invalid-month-fraction'
  | 'invalid-year-month'
  | 'invalid-range'
  | 'invalid-property-status'
  | 'unsafe-balance'
  | 'unsafe-growth'
  | 'unsafe-principal'
  | 'unsafe-value'
  | 'unsafe-accrual'
  | 'unsafe-appreciation';

export interface ValuationDiagnostic {
  readonly code: ValuationDiagnosticCode;
  readonly message: string;
}

/** Shared failure arm for every quote in this module. */
export type ValuationFailure = { readonly ok: false; readonly diagnostic: ValuationDiagnostic };

/** Result of quoting one account's month-close growth. */
export interface AccountMonthClose {
  readonly accountId: string;
  /** Annual rate as a fraction (`0.065` for `6.5%`). */
  readonly annualRate: number;
  /** Covered share of the calendar month, `0 < fraction <= 1`. */
  readonly monthFraction: number;
  /** `(1 + annualRate)^(monthFraction / 12)`. */
  readonly growthFactor: number;
  /** Cent growth posting, rounded half away from zero exactly once. */
  readonly growthCents: number;
  /** `balanceCents + growthCents` (>= 0). */
  readonly closingBalanceCents: number;
}

export type AccountMonthCloseResult =
  | { readonly ok: true; readonly close: AccountMonthClose }
  | ValuationFailure;

const fail = (code: ValuationDiagnosticCode, message: string): ValuationFailure => ({
  ok: false,
  diagnostic: { code, message }
});

export interface AccountMonthCloseInput {
  readonly accountId: string;
  /** Balance before growth, integer cents (>= 0). */
  readonly balanceCents: number;
  /** Annual rate as a fraction (e.g. `0.065`); finite and `>= -1`. */
  readonly annualRate: number;
  /** Covered share of the month, `0 < fraction <= 1`. Defaults to a full month. */
  readonly monthFraction?: number;
}

/**
 * Quotes one account's month-close APY growth. Pure; never mutates and never
 * rounds before the single cent posting.
 */
export const quoteAccountMonthClose = (input: AccountMonthCloseInput): AccountMonthCloseResult => {
  const { accountId, balanceCents, annualRate } = input;
  const monthFraction = input.monthFraction ?? 1;

  if (typeof balanceCents !== 'number' || !Number.isSafeInteger(balanceCents) || balanceCents < 0) {
    return fail(
      'unsafe-balance',
      `Account "${accountId}" balance must be a nonnegative safe integer cent amount; received ${String(balanceCents)}.`
    );
  }
  if (typeof annualRate !== 'number' || !Number.isFinite(annualRate) || annualRate < -1) {
    return fail(
      'invalid-annual-rate',
      `Account "${accountId}" annual rate must be finite and >= -100%; received ${String(annualRate)}.`
    );
  }
  if (
    typeof monthFraction !== 'number' ||
    !Number.isFinite(monthFraction) ||
    monthFraction <= 0 ||
    monthFraction > 1
  ) {
    return fail(
      'invalid-month-fraction',
      `Account "${accountId}" month fraction must be finite and in (0, 1]; received ${String(monthFraction)}.`
    );
  }

  const growthFactor = monthlyGrowthFactor(annualRate, monthFraction);
  if (!Number.isFinite(growthFactor)) {
    return fail('invalid-annual-rate', `Account "${accountId}" growth factor is not finite.`);
  }
  const growthCents = roundHalfAwayFromZero(balanceCents * (growthFactor - 1));
  if (!Number.isSafeInteger(growthCents)) {
    return fail('unsafe-growth', `Account "${accountId}" growth is outside the safe integer cent range.`);
  }
  const closingBalanceCents = balanceCents + growthCents;
  if (!Number.isSafeInteger(closingBalanceCents) || closingBalanceCents < 0) {
    return fail('unsafe-growth', `Account "${accountId}" closing balance would be invalid (${closingBalanceCents}).`);
  }

  return {
    ok: true,
    close: {
      accountId,
      annualRate,
      monthFraction,
      growthFactor,
      growthCents,
      closingBalanceCents
    }
  };
};

/**
 * Covered share of a calendar month given an inclusive valuation date range.
 * `1` when the whole month is covered; a partial month at a window edge yields
 * its covered-days over the month length. Returns `null` when the range does not
 * intersect the month or either endpoint is malformed.
 */
export const monthFractionForDates = (
  yearMonth: YearMonth,
  rangeStart: DateOnly,
  rangeEnd: DateOnly
): number | null => {
  const parsed = parseYearMonth(yearMonth);
  if (!parsed) {
    return null;
  }
  const monthStart: DateOnly = `${yearMonth}-01`;
  const monthEnd = endOfMonthDate(yearMonth);
  const coveredStart = compareDateOnly(monthStart, rangeStart) >= 0 ? monthStart : rangeStart;
  const coveredEnd = compareDateOnly(monthEnd, rangeEnd) <= 0 ? monthEnd : rangeEnd;
  if (compareDateOnly(coveredStart, coveredEnd) > 0) {
    return null;
  }
  const coveredDays = toDayOrdinal(coveredEnd) - toDayOrdinal(coveredStart) + 1;
  return coveredDays / daysInMonth(parsed.year, parsed.month);
};

// --- D13: contractual debt-interest accrual (nominal APR/12) ----------------

/** Result of quoting one liability's month-close contractual interest accrual. */
export interface DebtMonthlyAccrual {
  /** Outstanding principal before accrual, integer cents (`>= 0`). */
  readonly principalCents: number;
  /** Nominal annual percentage rate as a fraction (`0.065` for `6.5%`). */
  readonly annualRate: number;
  /** Covered share of the calendar month, `0 < fraction <= 1`. */
  readonly monthFraction: number;
  /** Nominal monthly rate `annualRate / 12` (not compounded). */
  readonly monthlyRate: number;
  /** Cent interest delta, rounded half away from zero exactly once (`>= 0`). */
  readonly accrualCents: number;
  /** `principalCents + accrualCents` — total owed (principal + this month's interest). */
  readonly closingBalanceCents: number;
}

export type DebtMonthlyAccrualResult =
  | { readonly ok: true; readonly accrual: DebtMonthlyAccrual }
  | ValuationFailure;

/**
 * Quotes one liability's month-close contractual interest accrual (D13) at the
 * **nominal** monthly rate `annualRate / 12`, prorated by `monthFraction`. This is
 * intentionally **not** the account effective-APY rule: a stated `6%` APR yields
 * exactly `principal × 0.06 / 12` for a full month, not `principal × ((1.06)^(1/12) − 1)`.
 *
 * A `0%` card accrues exactly zero. The returned `accrualCents` is the cent delta
 * the caller posts through `state.commitChanges` (allocated interest-first on
 * payment by the loans handler). Pure: no mutation, no wall clock, single HAFZ.
 */
export const quoteDebtMonthlyAccrual = (
  principalCents: number,
  annualRate: number,
  monthFraction = 1
): DebtMonthlyAccrualResult => {
  if (typeof principalCents !== 'number' || !Number.isSafeInteger(principalCents) || principalCents < 0) {
    return fail(
      'unsafe-principal',
      `Debt principal must be a nonnegative safe integer cent amount; received ${String(principalCents)}.`
    );
  }
  if (typeof annualRate !== 'number' || !Number.isFinite(annualRate) || annualRate < 0) {
    return fail(
      'invalid-annual-rate',
      `Debt APR must be finite and >= 0% (nominal); received ${String(annualRate)}.`
    );
  }
  if (
    typeof monthFraction !== 'number' ||
    !Number.isFinite(monthFraction) ||
    monthFraction <= 0 ||
    monthFraction > 1
  ) {
    return fail(
      'invalid-month-fraction',
      `Debt month fraction must be finite and in (0, 1]; received ${String(monthFraction)}.`
    );
  }

  const monthlyRate = annualRate / 12;
  // A full month (`monthFraction === 1`) reduces exactly to `principal × APR/12`.
  const accrualCents = roundHalfAwayFromZero(principalCents * monthlyRate * monthFraction);
  if (!Number.isSafeInteger(accrualCents) || accrualCents < 0) {
    return fail('unsafe-accrual', `Debt accrual is outside the safe integer cent range (${accrualCents}).`);
  }
  const closingBalanceCents = principalCents + accrualCents;
  if (!Number.isSafeInteger(closingBalanceCents) || closingBalanceCents < 0) {
    return fail('unsafe-accrual', `Debt closing balance would be invalid (${closingBalanceCents}).`);
  }

  return {
    ok: true,
    accrual: {
      principalCents,
      annualRate,
      monthFraction,
      monthlyRate,
      accrualCents,
      closingBalanceCents
    }
  };
};

// --- D11: property appreciation (effective annual) --------------------------

/** Result of quoting one property's month-close appreciation. */
export interface PropertyAppreciation {
  readonly status: PropertyStatus;
  /** Held value before appreciation, integer cents (`>= 0`). */
  readonly valueCents: number;
  /** Effective annual appreciation rate as a fraction (`0.03` for `3%`). */
  readonly annualRate: number;
  /** Covered share of the calendar month, `0 < fraction <= 1`. */
  readonly monthFraction: number;
  /** `(1 + annualRate)^(monthFraction / 12)`; `1` when no appreciation applies. */
  readonly growthFactor: number;
  /** Cent value delta, HAFZ once (negative for depreciation). */
  readonly appreciationCents: number;
  /** `valueCents + appreciationCents` (`>= 0`). */
  readonly closingValueCents: number;
}

export type PropertyAppreciationResult =
  | { readonly ok: true; readonly appreciation: PropertyAppreciation }
  | ValuationFailure;

/**
 * Quotes one property's month-close appreciation (D11) at its **effective**
 * annual appreciation rate: `(1 + annualRate)^(monthFraction / 12) − 1`. This is
 * the same compounding family as the account APY but a distinct rate/API, and it
 * is deliberately unlike the nominal debt APR above.
 *
 * Only an `owned` property appreciates. A `pending` acquisition holds a
 * non-appreciating deposit and never gains value (P0.5.3); a `sold` property is
 * disposed. Both return `growthFactor === 1` and `appreciationCents === 0`, so a
 * caller can pass the observed identity unconditionally. The returned
 * `appreciationCents` is the cent delta the caller posts via `state.commitChanges`.
 * Pure: no mutation, no wall clock, single HAFZ.
 */
export const quotePropertyAppreciation = (
  valueCents: number,
  annualRate: number,
  monthFraction = 1,
  status: PropertyStatus = 'owned'
): PropertyAppreciationResult => {
  if (typeof valueCents !== 'number' || !Number.isSafeInteger(valueCents) || valueCents < 0) {
    return fail(
      'unsafe-value',
      `Property value must be a nonnegative safe integer cent amount; received ${String(valueCents)}.`
    );
  }
  if (typeof annualRate !== 'number' || !Number.isFinite(annualRate) || annualRate < -1) {
    return fail(
      'invalid-annual-rate',
      `Property appreciation rate must be finite and >= -100%; received ${String(annualRate)}.`
    );
  }
  if (
    typeof monthFraction !== 'number' ||
    !Number.isFinite(monthFraction) ||
    monthFraction <= 0 ||
    monthFraction > 1
  ) {
    return fail(
      'invalid-month-fraction',
      `Property month fraction must be finite and in (0, 1]; received ${String(monthFraction)}.`
    );
  }
  if (status !== 'pending' && status !== 'owned' && status !== 'sold') {
    return fail('invalid-property-status', `Unknown property status ${String(status)}.`);
  }

  // Pending (deposit only) and sold (disposed) properties do not appreciate.
  const growthFactor = status === 'owned' ? monthlyGrowthFactor(annualRate, monthFraction) : 1;
  if (!Number.isFinite(growthFactor)) {
    return fail('invalid-annual-rate', 'Property growth factor is not finite.');
  }
  const appreciationCents = roundHalfAwayFromZero(valueCents * (growthFactor - 1));
  if (!Number.isSafeInteger(appreciationCents)) {
    return fail('unsafe-appreciation', 'Property appreciation is outside the safe integer cent range.');
  }
  const closingValueCents = valueCents + appreciationCents;
  if (!Number.isSafeInteger(closingValueCents) || closingValueCents < 0) {
    return fail('unsafe-appreciation', `Property closing value would be invalid (${closingValueCents}).`);
  }

  return {
    ok: true,
    appreciation: {
      status,
      valueCents,
      annualRate,
      monthFraction,
      growthFactor,
      appreciationCents,
      closingValueCents
    }
  };
};
