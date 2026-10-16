/**
 * P4.4 — Display-dollars view adapter (pure, UI-only).
 *
 * This module is the single, deterministic boundary between the **cents-only**
 * engine output and the **display-dollar** values a chart, table, tooltip,
 * activity panel or summary renders. It owns:
 *
 * 1. **Cents → dollars** ({@link toDollars} / {@link tryToDollars}) — an exact
 *    `cents / 100` division with **no rounding** (rounding only happens at the
 *    posting boundary, never before deflation).
 * 2. **The D18 current-dollar deflation factor** ({@link deflationFactor} /
 *    {@link resolveDeflation}) — one date-based factor per period,
 *    `factor(t) = (1 + annualInflationRate)^(t/12)`, where `t` is the
 *    **date-only calendar-month coverage** from the opening observation to the
 *    closing observation, including the clipped partial first/last month. The
 *    factor is `1` when inflation is disabled or the rate is `0`, and is exactly
 *    `1` when the closing observation equals the opening observation.
 * 3. **Observed-cents display helpers** ({@link displayObservedCents} /
 *    {@link displayObservedCentsSeries}) — signed, unclamped current-dollar
 *    values for accounts, debt, property, activity and summary rows. Every value
 *    sharing the same closing observation date uses exactly the same factor, so
 *    a monthly tooltip, a yearly row and an activity panel can never diverge.
 * 4. **Named-context display metadata** ({@link displayContextFromRunMetadata} /
 *    {@link displayContextFromResultContext}) — the
 *    `{ measurement, startDate, endDate, engineRevision, schemaVersion, contextId }`
 *    tuple that labels which projection a set of display values came from.
 * 5. **Measurement selection** ({@link measurementValueCents} /
 *    {@link displayMeasurementCents}) — asset-only vs. account-only vs. signed
 *    net worth from the same `StateTotals`, then deflated by the same factor.
 *
 * Invariants (D18):
 * - **Pure and deterministic**: no wall clock (`Date` is never constructed), no
 *   randomness, no I/O. The same arguments always yield the same result.
 * - **Nominal results are immutable**: this module never mutates or re-runs the
 *   projection; it derives a *parallel* deflated view from values it is handed.
 * - **One factor per observation date**: all series values sharing a closing
 *   observation date share exactly one factor.
 * - **Signed values are preserved**: nothing here clamps a negative net worth to
 *   zero; deflation is applied to the signed value.
 * - Invalid dates, a non-finite rate, a rate `<= -100`, and a non-finite factor
 *   return an explicit diagnostic instead of a silent `NaN`/`Infinity`.
 *
 * Public API: `toDollars`, `tryToDollars`, `elapsedMonthCoverage`,
 * `resolveDeflation`, `deflationFactor`, `deflateDollars`, `deflateCents`,
 * `displayObservedCents`, `displayObservedCentsSeries`, `measurementValueCents`,
 * `displayMeasurementCents`, `displayContextFromRunMetadata`,
 * `displayContextFromResultContext`.
 */

import {
  compareDateOnly,
  daysInMonth,
  isValidDateOnly,
  MONTHS_PER_YEAR,
  parseDateOnly,
  type DateOnly
} from '../engine/dates';
import { CENTS_PER_DOLLAR } from '../engine/money';
import type { ProjectionRunMetadata } from '../engine/projection';
import type { MeasurementBasis, ResultContextMetadata } from '../types';

// ---------------------------------------------------------------------------
// Diagnostic-aware results (mirrors `money.ts` `MoneyOutcome`)
// ---------------------------------------------------------------------------

export type ViewDiagnosticCode =
  | 'invalid-date'
  | 'observation-before-opening'
  | 'non-finite-cents'
  | 'invalid-inflation-rate'
  | 'non-finite-factor'
  | 'incomplete-context';

export interface ViewDiagnostic {
  readonly code: ViewDiagnosticCode;
  readonly message: string;
}

/** Typed result for display helpers that must never throw or yield `NaN`. */
export type ViewOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: ViewDiagnostic };

const ok = <T>(value: T): ViewOutcome<T> => ({ ok: true, value });

const fail = (code: ViewDiagnosticCode, message: string): ViewOutcome<never> => ({
  ok: false,
  diagnostic: { code, message }
});

// ---------------------------------------------------------------------------
// Cents → dollars (exact; no rounding)
// ---------------------------------------------------------------------------

/**
 * Converts integer cents to dollars for display. Exact `cents / 100`: a value is
 * **never** rounded before deflation. Throws on a non-finite input.
 */
export const toDollars = (cents: number): number => {
  if (!Number.isFinite(cents)) {
    throw new RangeError(`toDollars requires finite cents; received ${cents}.`);
  }
  return cents / CENTS_PER_DOLLAR;
};

/** Diagnostic-aware {@link toDollars}. */
export const tryToDollars = (cents: number): ViewOutcome<number> => {
  if (!Number.isFinite(cents)) {
    return fail('non-finite-cents', `toDollars requires finite cents; received ${cents}.`);
  }
  return ok(cents / CENTS_PER_DOLLAR);
};

// ---------------------------------------------------------------------------
// D18 — date-only calendar-month coverage and deflation factor
// ---------------------------------------------------------------------------

/** Month ordinal for already-parsed calendar parts (mirrors `toMonthOrdinal`). */
const monthOrdinalOf = (parts: { year: number; month: number }): number =>
  parts.year * MONTHS_PER_YEAR + (parts.month - 1);

/**
 * Date-only calendar-month coverage `t` from `openingDate` to `observationDate`
 * (inclusive). Each covered calendar month contributes its clipped fraction
 * (first and last months are partial when the endpoints fall mid-month), so a
 * mid-month opening yields a partial first-month exponent rather than a blind
 * `1`. `t` is exactly `0` when the two dates are the same.
 *
 * This is the O(1) closed form of the former per-month loop. Because both
 * endpoints always sit inside their own month, the inclusive range decomposes
 * into exactly three parts, each contributing the identical fraction the loop
 * produced:
 *
 * 1. the clipped **first** month: `(daysInMonth − openingDay + 1) / daysInMonth`;
 * 2. `diffMonths − 1` whole **interior** months at `1` apiece;
 * 3. the clipped **last** month: `observationDay / daysInMonth`.
 *
 * When both endpoints fall in the same month the two clips collapse into one
 * fraction, `(observationDay − openingDay + 1) / daysInMonth`. No month is ever
 * iterated, so a 960-month horizon costs the same as a one-month span.
 *
 * Returns a diagnostic when either date is malformed or the observation precedes
 * the opening observation.
 */
export const elapsedMonthCoverage = (openingDate: DateOnly, observationDate: DateOnly): ViewOutcome<number> => {
  const opening = parseDateOnly(openingDate);
  if (!opening) {
    return fail('invalid-date', `openingDate "${openingDate}" is not a valid YYYY-MM-DD date.`);
  }
  const observation = parseDateOnly(observationDate);
  if (!observation) {
    return fail('invalid-date', `observationDate "${observationDate}" is not a valid YYYY-MM-DD date.`);
  }
  const order = compareDateOnly(observationDate, openingDate);
  if (order < 0) {
    return fail(
      'observation-before-opening',
      `observationDate "${observationDate}" precedes openingDate "${openingDate}".`
    );
  }
  if (order === 0) {
    return ok(0);
  }

  const startOrdinal = monthOrdinalOf(opening);
  const endOrdinal = monthOrdinalOf(observation);

  // Same month: opening clips the start, observation clips the end.
  if (startOrdinal === endOrdinal) {
    const monthDays = daysInMonth(opening.year, opening.month);
    return ok((observation.day - opening.day + 1) / monthDays);
  }

  const firstMonthDays = daysInMonth(opening.year, opening.month);
  const firstFraction = (firstMonthDays - opening.day + 1) / firstMonthDays;
  const lastMonthDays = daysInMonth(observation.year, observation.month);
  const lastFraction = observation.day / lastMonthDays;
  const interiorMonths = endOrdinal - startOrdinal - 1;
  return ok(firstFraction + interiorMonths + lastFraction);
};

/** Resolved deflation context: the factor plus the coverage it was derived from. */
export interface DeflationContext {
  /** `(1 + r)^(t/12)`; exactly `1` when disabled or `r === 0`. */
  readonly factor: number;
  /** Date-only calendar-month coverage `t` (may be fractional). */
  readonly monthCoverage: number;
  /** Configured annual inflation rate in percent (as stored in `types.ts`). */
  readonly annualInflationRatePercent: number;
  /** Whether inflation deflation is enabled. */
  readonly enabled: boolean;
}

/**
 * Resolves the D18 deflation factor and the month coverage behind it.
 *
 * - `enabled === false` ⇒ identity (`factor: 1`, coverage `0`), no date/rate
 *   validation (a disabled toggle is a pure passthrough).
 * - The rate must be finite and greater than `-100` (a base of `1 + r` must stay
 *   positive); otherwise an `invalid-inflation-rate` diagnostic is returned.
 * - Invalid/reversed dates return their date diagnostic, even at a `0` rate.
 * - `annualInflationRatePercent === 0` ⇒ identity (`factor: 1`) after the dates
 *   are validated.
 */
export const resolveDeflation = (
  openingDate: DateOnly,
  observationDate: DateOnly,
  annualInflationRatePercent: number,
  enabled = true
): ViewOutcome<DeflationContext> => {
  if (!enabled) {
    return ok({ factor: 1, monthCoverage: 0, annualInflationRatePercent, enabled: false });
  }
  if (!Number.isFinite(annualInflationRatePercent) || annualInflationRatePercent <= -100) {
    return fail(
      'invalid-inflation-rate',
      `annualInflationRatePercent must be finite and greater than -100; received ${annualInflationRatePercent}.`
    );
  }
  const coverage = elapsedMonthCoverage(openingDate, observationDate);
  if (!coverage.ok) {
    return coverage;
  }
  if (annualInflationRatePercent === 0) {
    return ok({ factor: 1, monthCoverage: coverage.value, annualInflationRatePercent, enabled: true });
  }
  const factor = Math.pow(1 + annualInflationRatePercent / 100, coverage.value / 12);
  if (!Number.isFinite(factor) || factor <= 0) {
    return fail(
      'non-finite-factor',
      `Deflation factor is not a usable positive number (${factor}) for rate ${annualInflationRatePercent}% over ${coverage.value} month(s).`
    );
  }
  return ok({ factor, monthCoverage: coverage.value, annualInflationRatePercent, enabled: true });
};

/**
 * D18 deflation factor: `(1 + annualInflationRate)^(t/12)` from the opening
 * observation date to the closing observation date. `enabled === false` or a
 * `0` rate yields `1`. Returns a diagnostic for an invalid rate/date.
 */
export const deflationFactor = (
  openingDate: DateOnly,
  observationDate: DateOnly,
  annualInflationRatePercent: number,
  enabled = true
): ViewOutcome<number> => {
  const resolved = resolveDeflation(openingDate, observationDate, annualInflationRatePercent, enabled);
  return resolved.ok ? ok(resolved.value.factor) : resolved;
};

/** Divides display dollars by a resolved factor. Signed; never clamped. */
export const deflateDollars = (dollars: number, factor: number): number => dollars / factor;

/** Converts cents to display dollars and deflates. Signed; never clamped. */
export const deflateCents = (cents: number, factor: number): number => toDollars(cents) / factor;

// ---------------------------------------------------------------------------
// Observed cents → display dollars (one factor per observation date)
// ---------------------------------------------------------------------------

/** One nominal cent value observed at a date-only closing point. */
export interface ObservedCents {
  readonly date: DateOnly;
  readonly cents: number;
}

/** Resolved display view of one nominal cent observation. */
export interface DeflatedCents {
  readonly observationDate: DateOnly;
  readonly nominalCents: number;
  readonly nominalDollars: number;
  /** The one D18 factor used for this observation date. */
  readonly factor: number;
  readonly monthCoverage: number;
  /** Signed current-dollar value (`nominalDollars / factor`); never clamped. */
  readonly displayDollars: number;
}

/**
 * Deflates one nominal cent observation to display dollars using the D18 factor
 * for its closing observation date. Account, debt, property, activity and
 * summary values that share an observation date all receive the same factor, and
 * the value is signed (a negative net worth stays negative).
 */
export const displayObservedCents = (
  observation: ObservedCents,
  openingDate: DateOnly,
  annualInflationRatePercent: number,
  enabled = true
): ViewOutcome<DeflatedCents> => {
  const deflation = resolveDeflation(openingDate, observation.date, annualInflationRatePercent, enabled);
  if (!deflation.ok) {
    return deflation;
  }
  const dollars = tryToDollars(observation.cents);
  if (!dollars.ok) {
    return dollars;
  }
  return ok({
    observationDate: observation.date,
    nominalCents: observation.cents,
    nominalDollars: dollars.value,
    factor: deflation.value.factor,
    monthCoverage: deflation.value.monthCoverage,
    displayDollars: deflateDollars(dollars.value, deflation.value.factor)
  });
};

/**
 * Deflates a whole observed series (monthly or yearly) with the D18 factor per
 * observation date. The first failing observation short-circuits with its
 * diagnostic. The input is never mutated.
 */
export const displayObservedCentsSeries = (
  observations: readonly ObservedCents[],
  openingDate: DateOnly,
  annualInflationRatePercent: number,
  enabled = true
): ViewOutcome<DeflatedCents[]> => {
  const result: DeflatedCents[] = [];
  for (const observation of observations) {
    const resolved = displayObservedCents(observation, openingDate, annualInflationRatePercent, enabled);
    if (!resolved.ok) {
      return resolved;
    }
    result.push(resolved.value);
  }
  return ok(result);
};

// ---------------------------------------------------------------------------
// Measurement selection (assets / account assets / signed net worth)
// ---------------------------------------------------------------------------

/** Cent totals and the measurement basis they should be read under. */
export interface MeasurementTotals {
  readonly measurement: MeasurementBasis;
  /** Accounts + property values + held acquisition deposits. */
  readonly assetsCents: number;
  /** Principal + accrued interest + fees (positive = debt). */
  readonly liabilitiesCents: number;
  /** Account-only assets when the basis needs them; defaults to `assetsCents`. */
  readonly accountAssetsCents?: number;
}

/**
 * Selects the cents a measurement basis displays: asset-only totals stay
 * assets-only (liabilities are not subtracted), account-assets uses the
 * account-only total, and `assetsMinusLiabilities` is the **signed** net worth.
 * No clamping is applied.
 */
export const measurementValueCents = (totals: MeasurementTotals): number => {
  switch (totals.measurement) {
    case 'assetsMinusLiabilities':
      return totals.assetsCents - totals.liabilitiesCents;
    case 'accountAssets':
      return totals.accountAssetsCents ?? totals.assetsCents;
    case 'assetOnly':
    default:
      return totals.assetsCents;
  }
};

/**
 * Deflates a measurement's cents under the D18 factor for the closing
 * observation date. The measurement basis decides the signed value; the factor
 * is the same one any other value at that date uses.
 */
export const displayMeasurementCents = (
  totals: MeasurementTotals,
  observationDate: DateOnly,
  openingDate: DateOnly,
  annualInflationRatePercent: number,
  enabled = true
): ViewOutcome<DeflatedCents> =>
  displayObservedCents(
    { date: observationDate, cents: measurementValueCents(totals) },
    openingDate,
    annualInflationRatePercent,
    enabled
  );

// ---------------------------------------------------------------------------
// Named-context display metadata
// ---------------------------------------------------------------------------

/** Which projection a set of display values came from (context/cache key). */
export interface DisplayContext {
  readonly measurement: MeasurementBasis;
  readonly startDate: DateOnly;
  readonly endDate: DateOnly;
  readonly engineRevision: string;
  readonly schemaVersion: number;
  readonly contextId: string;
}

/**
 * Labels a run's metadata for display. Every field is copied from
 * {@link ProjectionRunMetadata} — nothing is inferred or defaulted.
 */
export const displayContextFromRunMetadata = (metadata: ProjectionRunMetadata): DisplayContext => ({
  measurement: metadata.measurement,
  startDate: metadata.startDate,
  endDate: metadata.endDate,
  engineRevision: metadata.engineRevision,
  schemaVersion: metadata.contextSchemaVersion,
  contextId: metadata.contextId
});

/**
 * Validates a persisted {@link ResultContextMetadata} into complete display
 * metadata. A legacy/partial context (missing schema/engine revision, or an
 * invalid date) is reported as `incomplete-context`/`invalid-date` rather than
 * being silently labeled with invented values.
 */
export const displayContextFromResultContext = (context: ResultContextMetadata): ViewOutcome<DisplayContext> => {
  if (!isValidDateOnly(context.startDate)) {
    return fail('invalid-date', `startDate "${context.startDate}" is not a valid YYYY-MM-DD date.`);
  }
  if (!isValidDateOnly(context.endDate)) {
    return fail('invalid-date', `endDate "${context.endDate}" is not a valid YYYY-MM-DD date.`);
  }
  if (compareDateOnly(context.endDate, context.startDate) < 0) {
    return fail(
      'observation-before-opening',
      `endDate "${context.endDate}" precedes startDate "${context.startDate}".`
    );
  }
  if (typeof context.schemaVersion !== 'number' || !Number.isFinite(context.schemaVersion)) {
    return fail('incomplete-context', 'Result context is missing a finite schemaVersion.');
  }
  if (typeof context.engineRevision !== 'string' || context.engineRevision.length === 0) {
    return fail('incomplete-context', 'Result context is missing an engineRevision.');
  }
  return ok({
    measurement: context.measurement,
    startDate: context.startDate,
    endDate: context.endDate,
    engineRevision: context.engineRevision,
    schemaVersion: context.schemaVersion,
    contextId: context.contextId ?? ''
  });
};
