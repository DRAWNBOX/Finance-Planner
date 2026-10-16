/**
 * P2.1 — Money primitives (engine-internal, pure).
 *
 * Unit rule (RV28 / ADR-010 / ADR-020): persisted configuration is **dollars**;
 * every runtime posting, balance, request and allocation is an **integer cent**.
 * Dollars are converted once at the posting boundary, rounding half away from
 * zero. Rate math keeps high-precision intermediates and rounds only at the
 * final posting boundary. No tolerance band is ever applied, and no cent is
 * silently truncated.
 *
 * This module owns:
 *
 * 1. **Dollars ⇄ cents** conversion at the posting boundary (HAFZ). Dollars are
 *    rounded from their shortest round-tripping decimal representation, so a
 *    literal such as `2.675` becomes `268` cents rather than the `267` a raw
 *    binary `value * 100` would produce. A half cent always rounds away from zero.
 * 2. **Cumulative per-line scheduling.** For a target/line with `count`
 *    scheduled occurrences, occurrence `k` requests
 *    `roundHalfAwayFromZero(target * k / count) − roundHalfAwayFromZero(target *
 *    (k−1) / count)`. The twelve shares of an annual target sum to the target
 *    exactly (`$100` → eight `$8.33` + four `$8.34`). Creating a fresh schedule
 *    for a new target resets the accumulator; a partial period simply uses its
 *    actual occurrence count.
 * 3. **Safe-integer validation for inputs, multiplication, intermediates and
 *    aggregates** (P0.3.5): every value is checked after multiply/round/sum, not
 *    only on input. Non-finite, unsafe, or overflowing amounts produce an
 *    explicit diagnostic instead of a silently truncated number.
 *
 * Ergonomic typed surfaces for downstream streams:
 *
 * - taxes: {@link roundHalfAwayFromZero}, {@link assertSafeCents},
 *   {@link safeMultiplyCents} — the solver rounds each component from gross once.
 * - configuration/opening: {@link dollarsToCents}, {@link centsToDollars},
 *   {@link tryDollarsToCents}.
 * - scheduler: {@link createCumulativeShareSchedule}, {@link cumulativeThrough},
 *   {@link shareAt}, {@link splitCumulative}, {@link retargetCumulativeShareSchedule}.
 *
 * Authority: `refactor/phase2_plan.md` P2.1, `refactor/frozen_contracts.md`
 * P0.3.4 (cents rounding), P0.3.5 (safe limits / overflow), ADR-021 (annualized
 * allocation rounding).
 */

/** Integer cents (runtime money unit). */
export type Cents = number;

/** Persisted dollars (configuration unit). */
export type Dollars = number;

export const CENTS_PER_DOLLAR = 100;

/** Largest exactly-representable integer cent amount. */
export const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

export type MoneyDiagnosticCode =
  | 'non-finite'
  | 'unsafe-integer'
  | 'overflow'
  | 'negative-target'
  | 'invalid-count'
  | 'unsupported-range';

export interface MoneyDiagnostic {
  readonly code: MoneyDiagnosticCode;
  readonly message: string;
}

/** Typed result for diagnostic-aware callers; throw-free counterparts exist too. */
export type MoneyOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: MoneyDiagnostic };

export const createMoneyDiagnostic = (code: MoneyDiagnosticCode, message: string): MoneyDiagnostic => ({
  code,
  message
});

// --- Input / value diagnostics ----------------------------------------------

/** `null` when `dollars` is a usable finite dollar amount. */
export const diagnoseDollarInput = (dollars: Dollars, context = 'dollars'): MoneyDiagnostic | null => {
  if (!Number.isFinite(dollars)) {
    return createMoneyDiagnostic('non-finite', `${context} must be finite; received ${dollars}.`);
  }
  return null;
};

/** `null` when `cents` is a finite, safe integer cent amount. */
export const diagnoseCentsInput = (cents: Cents, context = 'cents'): MoneyDiagnostic | null => {
  if (!Number.isFinite(cents)) {
    return createMoneyDiagnostic('non-finite', `${context} must be finite; received ${cents}.`);
  }
  if (!Number.isSafeInteger(cents)) {
    return createMoneyDiagnostic(
      'unsafe-integer',
      `${context} must be a safe integer between ±${MAX_SAFE_CENTS}; received ${cents}.`
    );
  }
  return null;
};

// --- Half-away-from-zero rounding -------------------------------------------

/**
 * Rounds a finite value to the nearest integer, halves away from zero.
 * `-0.5 → -1`, `0.5 → 1`, `-2.5 → -3`. No tolerance is applied, so a `$0.01`
 * difference is always preserved.
 */
export const roundHalfAwayFromZero = (value: number): number => {
  if (!Number.isFinite(value)) {
    throw new RangeError(`roundHalfAwayFromZero requires a finite value; received ${value}.`);
  }
  return value < 0 ? -Math.round(-value) : Math.round(value);
};

// --- Dollars → cents (exact decimal HAFZ) -----------------------------------

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Converts a finite dollar amount to integer cents, half away from zero, using
 * the shortest round-tripping decimal representation of the input. Exact integer
 * arithmetic (BigInt) is used only for the intermediate; the final cent value is
 * validated as a safe integer.
 */
const decimalDollarsToCents = (dollars: Dollars): Cents => {
  const text = String(dollars);
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    // Number.prototype.toString always matches this pattern for finite numbers.
    throw new RangeError(`Unsupported dollar representation "${text}".`);
  }
  const negative = match[1] === '-';
  const integerDigits = match[2];
  const fractionDigits = match[3] ?? '';
  const exponent = match[4] ? Number(match[4]) : 0;
  const mantissa = BigInt(`${integerDigits}${fractionDigits}`);
  const decimalExponent = fractionDigits.length - exponent;
  const centExponent = 2 - decimalExponent; // cents = mantissa * 10^centExponent
  let cents: bigint;
  if (centExponent >= 0) {
    cents = mantissa * 10n ** BigInt(centExponent);
  } else {
    const divisor = 10n ** BigInt(-centExponent);
    const quotient = mantissa / divisor;
    const remainder = mantissa % divisor;
    // Half away from zero on the exact decimal value.
    cents = remainder * 2n >= divisor ? quotient + 1n : quotient;
  }
  const signed = negative ? -cents : cents;
  return Number(signed);
};

/**
 * Converts persisted dollars to integer cents at the posting boundary, half
 * away from zero. Throws {@link RangeError} on a non-finite input or an amount
 * whose cent value is not a safe integer. Use {@link tryDollarsToCents} for a
 * diagnostic result.
 */
export const dollarsToCents = (dollars: Dollars): Cents => {
  const diagnosis = diagnoseDollarInput(dollars, 'dollarsToCents');
  if (diagnosis) {
    throw new RangeError(diagnosis.message);
  }
  const cents = decimalDollarsToCents(dollars);
  const centsDiagnosis = diagnoseCentsInput(cents, 'dollarsToCents result');
  if (centsDiagnosis) {
    throw new RangeError(`dollarsToCents produced an unsupported amount: ${centsDiagnosis.message}`);
  }
  return cents;
};

/** Diagnostic-aware {@link dollarsToCents}. */
export const tryDollarsToCents = (dollars: Dollars): MoneyOutcome<Cents> => {
  const diagnosis = diagnoseDollarInput(dollars, 'dollarsToCents');
  if (diagnosis) {
    return { ok: false, diagnostic: diagnosis };
  }
  const cents = decimalDollarsToCents(dollars);
  const centsDiagnosis = diagnoseCentsInput(cents, 'dollarsToCents result');
  if (centsDiagnosis) {
    return {
      ok: false,
      diagnostic: createMoneyDiagnostic(
        'overflow',
        `dollarsToCents produced an unsupported amount: ${centsDiagnosis.message}`
      )
    };
  }
  return { ok: true, value: cents };
};

/** Converts integer cents to dollars for display. Throws on non-safe input. */
export const centsToDollars = (cents: Cents): Dollars => {
  const diagnosis = diagnoseCentsInput(cents, 'centsToDollars');
  if (diagnosis) {
    throw new RangeError(diagnosis.message);
  }
  return cents / CENTS_PER_DOLLAR;
};

// --- Safe-integer guards (input / multiply / intermediate / aggregate) ------

/** Returns `value` when it is a safe integer cent amount, else throws. */
export const assertSafeCents = (value: Cents, context = 'cents'): Cents => {
  const diagnosis = diagnoseCentsInput(value, context);
  if (diagnosis) {
    throw new RangeError(diagnosis.message);
  }
  return value;
};

/** Returns `value` when it is a safe integer cent amount `>= 0`, else throws. */
export const assertNonNegativeCents = (value: Cents, context = 'cents'): Cents => {
  assertSafeCents(value, context);
  if (value < 0) {
    throw new RangeError(`${context} must be nonnegative; received ${value}.`);
  }
  return value;
};

/**
 * Integer cent multiply with a safe-integer **intermediate and result** check.
 * The factor is a count/occurrences-style integer, not a rate.
 */
export const safeMultiplyCents = (cents: Cents, factor: number, context = 'safeMultiplyCents'): Cents => {
  assertSafeCents(cents, `${context} operand`);
  assertSafeCents(factor, `${context} factor`);
  const product = cents * factor;
  const diagnosis = diagnoseCentsInput(product, `${context} product`);
  if (diagnosis) {
    throw new RangeError(`Cents overflow: ${diagnosis.message}`);
  }
  return product;
};

/** Diagnostic-aware {@link safeMultiplyCents}. */
export const trySafeMultiplyCents = (cents: Cents, factor: number): MoneyOutcome<Cents> => {
  const centsDiagnosis = diagnoseCentsInput(cents, 'safeMultiplyCents operand');
  if (centsDiagnosis) {
    return { ok: false, diagnostic: centsDiagnosis };
  }
  const factorDiagnosis = diagnoseCentsInput(factor, 'safeMultiplyCents factor');
  if (factorDiagnosis) {
    return { ok: false, diagnostic: factorDiagnosis };
  }
  const diagnosis = diagnoseCentsInput(cents * factor, 'safeMultiplyCents product');
  if (diagnosis) {
    return { ok: false, diagnostic: createMoneyDiagnostic('overflow', `Cents overflow: ${diagnosis.message}`) };
  }
  return { ok: true, value: cents * factor };
};

/**
 * Sums integer cents, validating every operand and each running aggregate so an
 * unsafe intermediate is reported rather than silently losing precision.
 */
export const safeSumCents = (values: readonly Cents[], context = 'safeSumCents'): Cents => {
  let total = 0;
  for (const value of values) {
    assertSafeCents(value, `${context} operand`);
    const next = total + value;
    const diagnosis = diagnoseCentsInput(next, `${context} aggregate`);
    if (diagnosis) {
      throw new RangeError(`Cents overflow: ${diagnosis.message}`);
    }
    total = next;
  }
  return total;
};

/** Diagnostic-aware {@link safeSumCents}. */
export const trySafeSumCents = (values: readonly Cents[]): MoneyOutcome<Cents> => {
  let total = 0;
  for (const value of values) {
    const operandDiagnosis = diagnoseCentsInput(value, 'safeSumCents operand');
    if (operandDiagnosis) {
      return { ok: false, diagnostic: operandDiagnosis };
    }
    const next = total + value;
    const aggregateDiagnosis = diagnoseCentsInput(next, 'safeSumCents aggregate');
    if (aggregateDiagnosis) {
      return { ok: false, diagnostic: createMoneyDiagnostic('overflow', `Cents overflow: ${aggregateDiagnosis.message}`) };
    }
    total = next;
  }
  return { ok: true, value: total };
};

// --- Cumulative per-line scheduling -----------------------------------------

/**
 * The rounded cumulative scheduled amount through occurrence `index` (1-based,
 * inclusive) for a target split over `count` occurrences. `index === 0` is `0`
 * and `index === count` is exactly `targetCents`. Division uses exact BigInt
 * intermediates, so no floating-point drift or overflow can occur.
 */
export interface CumulativeShareSchedule {
  readonly targetCents: Cents;
  readonly count: number;
}

/** Creates a validated cumulative schedule. A new target/count **resets** the split. */
export const createCumulativeShareSchedule = (
  targetCents: Cents,
  count: number,
  context = 'cumulative schedule'
): CumulativeShareSchedule => {
  const diagnosis = diagnoseCentsInput(targetCents, `${context} target`);
  if (diagnosis) {
    throw new RangeError(diagnosis.message);
  }
  if (targetCents < 0) {
    throw new RangeError(`${context} target must be nonnegative; received ${targetCents}.`);
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError(`${context} count must be a positive integer; received ${count}.`);
  }
  return { targetCents, count };
};

/** Diagnostic-aware {@link createCumulativeShareSchedule}. */
export const tryCreateCumulativeShareSchedule = (
  targetCents: Cents,
  count: number
): MoneyOutcome<CumulativeShareSchedule> => {
  const diagnosis = diagnoseCentsInput(targetCents, 'cumulative schedule target');
  if (diagnosis) {
    return { ok: false, diagnostic: diagnosis };
  }
  if (targetCents < 0) {
    return {
      ok: false,
      diagnostic: createMoneyDiagnostic('negative-target', `cumulative schedule target must be nonnegative; received ${targetCents}.`)
    };
  }
  if (!Number.isSafeInteger(count) || count < 1) {
    return {
      ok: false,
      diagnostic: createMoneyDiagnostic('invalid-count', `cumulative schedule count must be a positive integer; received ${count}.`)
    };
  }
  return { ok: true, value: { targetCents, count } };
};

/** Rounded cumulative scheduled amount through occurrence `index` (0…count). */
export const cumulativeThrough = (schedule: CumulativeShareSchedule, index: number): Cents => {
  if (!Number.isSafeInteger(index) || index < 0 || index > schedule.count) {
    throw new RangeError(
      `cumulativeThrough requires an integer index between 0 and ${schedule.count}; received ${index}.`
    );
  }
  if (index === 0) {
    return 0;
  }
  const numerator = BigInt(schedule.targetCents) * BigInt(index);
  const denominator = BigInt(schedule.count);
  let quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder * 2n >= denominator) {
    quotient += 1n;
  }
  const value = Number(quotient);
  const diagnosis = diagnoseCentsInput(value, 'cumulativeThrough result');
  if (diagnosis) {
    throw new RangeError(`Cumulative overflow: ${diagnosis.message}`);
  }
  return value;
};

/**
 * Share requested at occurrence `index` (1-based): the rounded cumulative
 * through `index` minus the rounded cumulative through `index − 1`.
 */
export const shareAt = (schedule: CumulativeShareSchedule, index: number): Cents =>
  cumulativeThrough(schedule, index) - cumulativeThrough(schedule, index - 1);

/**
 * All per-occurrence shares. Their sum is exactly `schedule.targetCents`
 * (twelve shares of an annual target reconcile with no residual month).
 */
export const splitCumulative = (schedule: CumulativeShareSchedule): Cents[] => {
  const shares: Cents[] = [];
  let previous = 0;
  for (let index = 1; index <= schedule.count; index += 1) {
    const cumulative = cumulativeThrough(schedule, index);
    shares.push(cumulative - previous);
    previous = cumulative;
  }
  return shares;
};

/** Diagnostic-aware {@link splitCumulative}. */
export const trySplitCumulative = (targetCents: Cents, count: number): MoneyOutcome<Cents[]> => {
  const schedule = tryCreateCumulativeShareSchedule(targetCents, count);
  if (!schedule.ok) {
    return schedule;
  }
  return { ok: true, value: splitCumulative(schedule.value) };
};

/**
 * Returns `schedule` unchanged when target and count match, else a fresh
 * schedule (which resets the cumulative accumulator). Call this whenever a plan
 * or annual target changes.
 */
export const retargetCumulativeShareSchedule = (
  schedule: CumulativeShareSchedule,
  targetCents: Cents,
  count: number
): CumulativeShareSchedule =>
  schedule.targetCents === targetCents && schedule.count === count
    ? schedule
    : createCumulativeShareSchedule(targetCents, count);
