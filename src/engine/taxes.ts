/**
 * P2.3 — Eligibility and exact gross-net taxes (engine-internal, pure).
 *
 * Scope (phase2_plan.md P2.3, frozen_contracts.md P0.3.6 / P0.5.4, ADR-020 /
 * ADR-021, D5): the bounded minimal-gross solver plus account/purpose tax
 * eligibility. This module performs no mutation, reads no wall clock, and opens
 * no state: it is a pure quote over integer-cent amounts and exact rates.
 *
 * ### Unit and rate rule
 *
 * Persisted config is dollars/percentages; every amount here is an **integer
 * cent**. Accepted decimal rates are converted once to **exact BigInt rationals**
 * (see {@link ExactRate}) so no binary floating-point error can ever move a
 * cent at a rounding boundary. A stated `20% × 15%` is exactly `3/100`, not the
 * `0.030000000000000002` a raw float product would produce. Each withholding
 * component is rounded half away from zero from **gross**, exactly once.
 *
 * ### Component model (P0.3.6 / D5)
 *
 * `C` = number of independently rounded withholding components (0–2) by source:
 *
 * - `0` — checking/savings; Roth; explicitly qualified HSA medical spending.
 * - `1` — taxable brokerage: `tax = roundHAFZ(gross × assumedGain% × LTCG%)`
 *   (defaults 20% gain, editable 15% LTCG); never applies to HSA/401k/property.
 * - `2` — retirement (401k) and non-qualified HSA: an income-tax component plus a
 *   separate penalty component, both rounded from gross once. For a non-qualified
 *   HSA the penalty is the HSA-specific extra penalty (default 20%), **waived from
 *   the holder's 65th birthday regardless of retirement status** (D5 / ADR-021).
 *
 * `net(G) = G − tax(G) − penalty(G)`; `gross = net + tax + penalty` holds by
 * construction, and the reconciliation identity is preserved on every executed
 * allocation.
 *
 * ### D5 bounded solver
 *
 * For a requested net `N`, combined pre-rounding rate `r` (`0 ≤ r < 1`) and `C`
 * rounded components, a sufficient gross lies in
 * `L = max(0, floor((N − C/2)/(1 − r)))` … `U = ceil((N + C/2)/(1 − r))`
 * (each component's rounding error is at most half a cent). The solver
 * enumerates integer cents **ascending from L** and takes the first `G` with
 * `net(G) ≥ N` — the minimal sufficient gross. **No binary search and no
 * closed-form `N/(1−r)` shortcut is ever used**, because `net(G)` is not
 * monotone. Windows wider than 256 candidates, `r ≥ 1`, unsafe/non-finite
 * rates or intermediates, and an empty bracket all return an **explicit
 * unsupported-range diagnostic** instead of an approximation.
 *
 * ### Partial funding (D5)
 *
 * When the available balance is below the minimal sufficient gross, the solver
 * does **not** assume `net(balance)` is maximal — coincident component rounding
 * can make `net` dip at a threshold. It searches the rounding-error-bounded
 * neighborhood at or below the balance (at most 256 candidates, else an
 * unsupported-range diagnostic), takes the highest achievable net, and chooses
 * the **smallest gross among equal maxima**. An unfunded target is never marked
 * paid.
 *
 * Authority: `refactor/phase2_plan.md` D5/P2.3, `refactor/frozen_contracts.md`
 * P0.3.6/P0.5.4, ADR-020, ADR-021.
 */

import type { AccountTypePreset } from '../types';
import type { FundingRequest } from './contracts';
import { MAX_SAFE_CENTS } from './money';
import { addMonthsToDate, compareDateOnly, parseDateOnly } from './dates';

// --- Tunable defaults (frozen) ----------------------------------------------

/** Taxable brokerage assumed taxable-gain share of gross (%) — P0.3.6. */
export const TAXABLE_DEFAULT_ASSUMED_GAIN_PERCENT = 20;
/** Editable long-term capital-gains rate (%) applied to the assumed gain. */
export const TAXABLE_DEFAULT_CAPITAL_GAINS_TAX_RATE = 15;
/** Non-qualified HSA extra penalty (%) before the waiver age — ADR-021. */
export const HSA_DEFAULT_NON_QUALIFIED_PENALTY_RATE = 20;
/** Holder age at which the non-qualified HSA extra penalty is waived. */
export const HSA_DEFAULT_PENALTY_WAIVER_AGE = 65;
/** Hard cap on solver candidates (D5); larger windows are unsupported. */
export const MAX_SOLVER_CANDIDATES = 256;

// --- Exact rational rates ----------------------------------------------------

/**
 * Exact nonnegative rational rate as a fraction of gross. `denominator > 0`;
 * the pair is reduced to lowest terms. Constructed from a decimal number's
 * shortest round-tripping representation, so `0.03` is `3/100` exactly.
 */
export interface ExactRate {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

const ZERO: bigint = 0n;
const ONE: bigint = 1n;
const TWO: bigint = 2n;

const bigAbs = (value: bigint): bigint => (value < ZERO ? -value : value);

const gcd = (a: bigint, b: bigint): bigint => {
  let x = bigAbs(a);
  let y = bigAbs(b);
  while (y !== ZERO) {
    const remainder = x % y;
    x = y;
    y = remainder;
  }
  return x === ZERO ? ONE : x;
};

/** Creates a reduced exact rate; throws when the denominator is zero. */
export const createExactRate = (numerator: bigint, denominator: bigint): ExactRate => {
  if (denominator === ZERO) {
    throw new RangeError('ExactRate denominator must be nonzero.');
  }
  let n = numerator;
  let d = denominator;
  if (d < ZERO) {
    n = -n;
    d = -d;
  }
  const divisor = gcd(n, d);
  if (divisor > ONE) {
    n /= divisor;
    d /= divisor;
  }
  return { numerator: n, denominator: d };
};

const DECIMAL_PATTERN = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Converts a finite decimal number to an exact rational from its shortest
 * round-tripping decimal representation (exact integer/BigInt arithmetic). Use
 * this — never a float product — for any rate that must survive a cent boundary.
 */
export const exactRateFromNumber = (value: number): ExactRate => {
  if (!Number.isFinite(value)) {
    throw new RangeError(`exactRateFromNumber requires a finite value; received ${value}.`);
  }
  const text = String(value);
  const match = DECIMAL_PATTERN.exec(text);
  if (!match) {
    throw new RangeError(`Unsupported decimal representation "${text}".`);
  }
  const negative = match[1] === '-';
  const integerDigits = match[2] ?? '0';
  const fractionDigits = match[3] ?? '';
  const exponent = match[4] ? Number(match[4]) : 0;
  const mantissa = BigInt(`${integerDigits}${fractionDigits}` || '0');
  let numerator = mantissa;
  let denominator = ONE;
  const decimalExponent = fractionDigits.length - exponent;
  if (decimalExponent >= 0) {
    denominator = 10n ** BigInt(decimalExponent);
  } else {
    numerator = mantissa * 10n ** BigInt(-decimalExponent);
  }
  return createExactRate(negative ? -numerator : numerator, denominator);
};

/** Converts a percentage (`15` means `15%`) to an exact fraction of gross. */
export const exactRateFromPercent = (percent: number): ExactRate => {
  const value = exactRateFromNumber(percent);
  return createExactRate(value.numerator, value.denominator * 100n);
};

/** Exact product of two rates. */
export const exactRateMultiply = (a: ExactRate, b: ExactRate): ExactRate =>
  createExactRate(a.numerator * b.numerator, a.denominator * b.denominator);

/** Exact sum of two rates. */
export const exactRateAdd = (a: ExactRate, b: ExactRate): ExactRate =>
  createExactRate(a.numerator * b.denominator + b.numerator * a.denominator, a.denominator * b.denominator);

export const exactRateIsZero = (rate: ExactRate): boolean => rate.numerator === ZERO;

/** Rounds an exact rational to the nearest integer, halves away from zero. */
export const roundRationalHalfAwayFromZero = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= ZERO) {
    throw new RangeError('roundRationalHalfAwayFromZero requires a positive denominator.');
  }
  const negative = numerator < ZERO;
  const magnitude = negative ? -numerator : numerator;
  let quotient = magnitude / denominator;
  const remainder = magnitude % denominator;
  if (remainder * TWO >= denominator) {
    quotient += ONE;
  }
  return negative ? -quotient : quotient;
};

const floorDivide = (numerator: bigint, denominator: bigint): bigint => {
  let quotient = numerator / denominator;
  if (numerator % denominator !== ZERO && numerator < ZERO) {
    quotient -= ONE;
  }
  return quotient;
};

const ceilDivide = (numerator: bigint, denominator: bigint): bigint => {
  let quotient = numerator / denominator;
  if (numerator % denominator !== ZERO && numerator > ZERO) {
    quotient += ONE;
  }
  return quotient;
};

// --- Diagnostics -------------------------------------------------------------

export type TaxDiagnosticCode =
  | 'non-finite-rate'
  | 'negative-rate'
  | 'too-many-components'
  | 'unknown-account-type'
  | 'invalid-withdrawal-date'
  | 'invalid-date-of-birth'
  | 'invalid-waiver-age'
  | 'unsafe-amount'
  | 'negative-net'
  | 'combined-rate-not-less-than-one'
  | 'window-too-large'
  | 'no-candidate';

export interface TaxDiagnostic {
  readonly code: TaxDiagnosticCode;
  readonly message: string;
}

class TaxValidationError extends RangeError {
  readonly code: TaxDiagnosticCode;

  constructor(code: TaxDiagnosticCode, message: string) {
    super(message);
    this.name = 'TaxValidationError';
    this.code = code;
  }
}

const toDiagnostic = (error: TaxValidationError): TaxDiagnostic => ({ code: error.code, message: error.message });

// --- Withholding profile -----------------------------------------------------

export type WithholdingComponentKind = 'incomeTax' | 'capitalGainsTax' | 'penalty';

export interface WithholdingComponent {
  readonly kind: WithholdingComponentKind;
  readonly rate: ExactRate;
}

/**
 * Independently rounded withholding components for one account/request/date.
 * `componentCount` is `C` in the D5 bracket (0–2). `combinedRate` is `r`, the
 * exact pre-rounding sum of component rates.
 */
export interface WithholdingProfile {
  readonly components: readonly WithholdingComponent[];
  readonly componentCount: number;
  readonly combinedRate: ExactRate;
  readonly taxExempt: boolean;
  readonly qualifiedMedical: boolean;
  readonly hsaPenaltyWaived: boolean;
}

/** Structural account view consumed by the tax lane (never mutated). */
export interface WithdrawalAccountConfig {
  readonly accountType: AccountTypePreset;
  readonly withdrawalPolicy?: {
    readonly withdrawalTaxRate?: number;
    readonly penaltyRate?: number;
    readonly hsa?: {
      readonly nonQualifiedPenaltyRate?: number;
      readonly nonQualifiedPenaltyWaiverAge?: number;
    } | null;
  } | null;
  /** Taxable-proxy assumed gain share (%) — default 20. */
  readonly assumedGainPercent?: number;
  /** Editable long-term capital-gains rate (%) — default 15. */
  readonly capitalGainsTaxRate?: number;
}

export interface WithholdingContext {
  /** Date-only withdrawal date; drives the HSA age boundary. */
  readonly withdrawalDate: string;
  /** Date-only holder DOB; required to waive the non-qualified HSA penalty. */
  readonly dateOfBirth?: string | null;
}

export type WithholdingProfileResult =
  | { readonly ok: true; readonly profile: WithholdingProfile }
  | { readonly ok: false; readonly diagnostic: TaxDiagnostic };

const validatePercent = (value: number | undefined, fallback: number, context: string): number => {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) {
    throw new TaxValidationError('non-finite-rate', `${context} must be finite; received ${resolved}.`);
  }
  if (resolved < 0) {
    throw new TaxValidationError('negative-rate', `${context} must be nonnegative; received ${resolved}.`);
  }
  return resolved;
};

const validateWaiverAge = (value: number | undefined): number => {
  const resolved = value ?? HSA_DEFAULT_PENALTY_WAIVER_AGE;
  if (!Number.isFinite(resolved) || !Number.isInteger(resolved) || resolved < 0 || resolved > 120) {
    throw new TaxValidationError(
      'invalid-waiver-age',
      `nonQualifiedPenaltyWaiverAge must be an integer from 0 to 120; received ${resolved}.`
    );
  }
  return resolved;
};

const finalizeProfile = (
  components: readonly WithholdingComponent[],
  flags: { taxExempt: boolean; qualifiedMedical: boolean; hsaPenaltyWaived: boolean }
): WithholdingProfile => {
  let combinedRate: ExactRate = { numerator: ZERO, denominator: ONE };
  for (const component of components) {
    combinedRate = exactRateAdd(combinedRate, component.rate);
  }
  return {
    components,
    componentCount: components.length,
    combinedRate,
    taxExempt: flags.taxExempt,
    qualifiedMedical: flags.qualifiedMedical,
    hsaPenaltyWaived: flags.hsaPenaltyWaived
  };
};

/**
 * True when the non-qualified HSA extra penalty is waived for a withdrawal on
 * `withdrawalDate` given the holder's `dateOfBirth` and `waiverAge`. The waiver
 * applies from (and including) the holder's birthday and is independent of any
 * retirement status. Feb-29 birthdays clamp to Feb-28 in non-leap years.
 */
export const isHsaPenaltyWaived = (
  withdrawalDate: string,
  dateOfBirth: string | null | undefined,
  waiverAge: number = HSA_DEFAULT_PENALTY_WAIVER_AGE
): boolean => {
  if (!parseDateOnly(withdrawalDate)) {
    throw new TaxValidationError('invalid-withdrawal-date', `Invalid withdrawal date "${withdrawalDate}".`);
  }
  if (dateOfBirth === null || dateOfBirth === undefined) {
    // No DOB means the age boundary cannot be proven; the penalty stays applied.
    return false;
  }
  if (!parseDateOnly(dateOfBirth)) {
    throw new TaxValidationError('invalid-date-of-birth', `Invalid date of birth "${dateOfBirth}".`);
  }
  const birthday = addMonthsToDate(dateOfBirth, validateWaiverAge(waiverAge) * 12);
  return compareDateOnly(withdrawalDate, birthday) >= 0;
};

const buildProfile = (
  account: WithdrawalAccountConfig,
  request: Pick<FundingRequest, 'hsaQualifiedMedical'>,
  context: WithholdingContext
): WithholdingProfile => {
  if (!parseDateOnly(context.withdrawalDate)) {
    throw new TaxValidationError('invalid-withdrawal-date', `Invalid withdrawal date "${context.withdrawalDate}".`);
  }
  const policy = account.withdrawalPolicy ?? null;
  const accountType = account.accountType;

  // Ordinary accounts: no withholding (checking/savings) or a Roth (zero).
  if (accountType === 'checking' || accountType === 'savings') {
    return finalizeProfile([], { taxExempt: true, qualifiedMedical: false, hsaPenaltyWaived: false });
  }
  if (accountType === 'roth') {
    return finalizeProfile([], { taxExempt: true, qualifiedMedical: false, hsaPenaltyWaived: false });
  }

  // Taxable brokerage proxy: gain share × editable LTCG, one rounded component.
  if (accountType === 'taxable') {
    const gainRate = exactRateFromPercent(
      validatePercent(account.assumedGainPercent, TAXABLE_DEFAULT_ASSUMED_GAIN_PERCENT, 'assumedGainPercent')
    );
    const ltcgRate = exactRateFromPercent(
      validatePercent(account.capitalGainsTaxRate, TAXABLE_DEFAULT_CAPITAL_GAINS_TAX_RATE, 'capitalGainsTaxRate')
    );
    return finalizeProfile([{ kind: 'capitalGainsTax', rate: exactRateMultiply(gainRate, ltcgRate) }], {
      taxExempt: false,
      qualifiedMedical: false,
      hsaPenaltyWaived: false
    });
  }

  // 401k: configured income tax plus configured penalty, each rounded from gross.
  if (accountType === 'retirement401k') {
    const taxRate = exactRateFromPercent(
      validatePercent(policy?.withdrawalTaxRate, 0, 'withdrawalPolicy.withdrawalTaxRate')
    );
    const penaltyRate = exactRateFromPercent(validatePercent(policy?.penaltyRate, 0, 'withdrawalPolicy.penaltyRate'));
    return finalizeProfile(
      [
        { kind: 'incomeTax', rate: taxRate },
        { kind: 'penalty', rate: penaltyRate }
      ],
      { taxExempt: false, qualifiedMedical: false, hsaPenaltyWaived: false }
    );
  }

  // HSA: qualified medical is tax/penalty-free; non-qualified pays income tax and
  // the HSA-specific extra penalty until the waiver age (never inferred).
  if (accountType === 'hsa') {
    if (request.hsaQualifiedMedical === true) {
      return finalizeProfile([], { taxExempt: true, qualifiedMedical: true, hsaPenaltyWaived: false });
    }
    const taxRate = exactRateFromPercent(
      validatePercent(policy?.withdrawalTaxRate, 0, 'withdrawalPolicy.withdrawalTaxRate')
    );
    const hsa = policy?.hsa ?? null;
    const extraPenaltyPercent = validatePercent(
      hsa?.nonQualifiedPenaltyRate,
      HSA_DEFAULT_NON_QUALIFIED_PENALTY_RATE,
      'withdrawalPolicy.hsa.nonQualifiedPenaltyRate'
    );
    const waiverAge = validateWaiverAge(hsa?.nonQualifiedPenaltyWaiverAge);
    const waived = isHsaPenaltyWaived(context.withdrawalDate, context.dateOfBirth, waiverAge);
    const components: WithholdingComponent[] = [{ kind: 'incomeTax', rate: taxRate }];
    if (!waived) {
      components.push({ kind: 'penalty', rate: exactRateFromPercent(extraPenaltyPercent) });
    }
    return finalizeProfile(components, { taxExempt: false, qualifiedMedical: false, hsaPenaltyWaived: waived });
  }

  throw new TaxValidationError(
    'unknown-account-type',
    `Unsupported account type "${String(accountType)}" for tax eligibility.`
  );
};

/** Builds the withholding profile; throws {@link TaxValidationError} on invalid input. */
export const buildWithholdingProfile = (
  account: WithdrawalAccountConfig,
  request: Pick<FundingRequest, 'hsaQualifiedMedical'>,
  context: WithholdingContext
): WithholdingProfile => buildProfile(account, request, context);

/** Diagnostic-aware {@link buildWithholdingProfile}. */
export const tryBuildWithholdingProfile = (
  account: WithdrawalAccountConfig,
  request: Pick<FundingRequest, 'hsaQualifiedMedical'>,
  context: WithholdingContext
): WithholdingProfileResult => {
  try {
    return { ok: true, profile: buildProfile(account, request, context) };
  } catch (error) {
    if (error instanceof TaxValidationError) {
      return { ok: false, diagnostic: toDiagnostic(error) };
    }
    throw error;
  }
};

// --- Eligibility (pure) ------------------------------------------------------

export type EligibilityReason =
  | 'ordinary'
  | 'taxable-gain'
  | 'retirement-income'
  | 'roth'
  | 'hsa-qualified'
  | 'hsa-nonqualified'
  | 'unknown';

export interface AccountEligibility {
  /** The account type can act as a funding source for a request. */
  readonly eligible: boolean;
  /** No tax or penalty is withheld (ordinary/Roth/qualified HSA). */
  readonly taxExempt: boolean;
  readonly reason: EligibilityReason;
}

/**
 * Pure account/purpose tax-eligibility. Qualification for HSA medical spending
 * comes **only** from the explicit `request.hsaQualifiedMedical` flag, never
 * from a category or purpose label.
 */
export const evaluateAccountEligibility = (
  account: Pick<WithdrawalAccountConfig, 'accountType'>,
  request: Pick<FundingRequest, 'hsaQualifiedMedical'>
): AccountEligibility => {
  switch (account.accountType) {
    case 'checking':
    case 'savings':
      return { eligible: true, taxExempt: true, reason: 'ordinary' };
    case 'taxable':
      return { eligible: true, taxExempt: false, reason: 'taxable-gain' };
    case 'retirement401k':
      return { eligible: true, taxExempt: false, reason: 'retirement-income' };
    case 'roth':
      return { eligible: true, taxExempt: true, reason: 'roth' };
    case 'hsa':
      return request.hsaQualifiedMedical === true
        ? { eligible: true, taxExempt: true, reason: 'hsa-qualified' }
        : { eligible: true, taxExempt: false, reason: 'hsa-nonqualified' };
    default:
      return { eligible: false, taxExempt: false, reason: 'unknown' };
  }
};

/** Convenience: `true` when a withdrawal from `account` carries no withholding. */
export const isWithdrawalTaxExempt = (
  account: Pick<WithdrawalAccountConfig, 'accountType'>,
  request: Pick<FundingRequest, 'hsaQualifiedMedical'>
): boolean => evaluateAccountEligibility(account, request).taxExempt;

// --- Gross ⇄ net quoting -----------------------------------------------------

export interface ResolvedComponent {
  readonly kind: WithholdingComponentKind;
  /** Exact rate applied to gross. */
  readonly rate: ExactRate;
  /** Rounded withholding for this component, integer cents. */
  readonly cents: number;
}

export interface TaxedPosting {
  readonly grossCents: number;
  readonly netCents: number;
  readonly taxCents: number;
  readonly penaltyCents: number;
  readonly components: readonly ResolvedComponent[];
}

const toSafeCents = (value: bigint, context: string): number => {
  if (value < ZERO || value > BigInt(MAX_SAFE_CENTS)) {
    throw new RangeError(`${context} is outside the safe cent range; received ${value}.`);
  }
  const cents = Number(value);
  if (!Number.isSafeInteger(cents)) {
    throw new RangeError(`${context} is not a safe integer; received ${value}.`);
  }
  return cents;
};

const resolvePosting = (grossCents: number, profile: WithholdingProfile): TaxedPosting => {
  let taxCents = 0;
  let penaltyCents = 0;
  const components: ResolvedComponent[] = profile.components.map((component) => {
    const cents = toSafeCents(
      roundRationalHalfAwayFromZero(
        BigInt(grossCents) * component.rate.numerator,
        component.rate.denominator
      ),
      'withholding component'
    );
    if (component.kind === 'penalty') {
      penaltyCents += cents;
    } else {
      taxCents += cents;
    }
    return { kind: component.kind, rate: component.rate, cents };
  });
  const netCents = grossCents - taxCents - penaltyCents;
  return { grossCents, netCents, taxCents, penaltyCents, components };
};

/**
 * Taxes an **executed gross** from a profile: each component is rounded half
 * away from zero from gross exactly once, tax and penalty stay separate, and
 * `net = gross − tax − penalty` holds by construction.
 */
export const grossToNet = (grossCents: number, profile: WithholdingProfile): TaxedPosting => {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0) {
    throw new RangeError(`grossToNet requires a nonnegative safe-integer cent amount; received ${grossCents}.`);
  }
  return resolvePosting(grossCents, profile);
};

/** Inclusive integer-cent bracket guaranteed to contain the minimal gross. */
export interface GrossNetBracket {
  readonly lowerCents: number;
  readonly upperCents: number;
  readonly candidateCount: number;
}

export type BracketResult =
  | { readonly ok: true; readonly bracket: GrossNetBracket }
  | { readonly ok: false; readonly diagnostic: TaxDiagnostic };

/**
 * D5 bracket `[L, U]` for a requested net: every `G < L` has `net(G) < N` and
 * `U` is guaranteed sufficient, so any sufficient gross lies inside. Returns an
 * unsupported-range diagnostic for invalid components/rates or an unsafe
 * intermediate. The candidate count may exceed {@link MAX_SOLVER_CANDIDATES};
 * callers decide whether that is unsupported.
 */
export const computeGrossNetBracket = (
  requestedNetCents: number,
  profile: WithholdingProfile
): BracketResult => {
  if (!Number.isSafeInteger(requestedNetCents)) {
    return { ok: false, diagnostic: { code: 'unsafe-amount', message: `Requested net must be a safe integer; received ${requestedNetCents}.` } };
  }
  if (requestedNetCents < 0) {
    return { ok: false, diagnostic: { code: 'negative-net', message: `Requested net must be nonnegative; received ${requestedNetCents}.` } };
  }
  if (profile.componentCount > 2 || profile.components.length !== profile.componentCount) {
    return {
      ok: false,
      diagnostic: {
        code: 'too-many-components',
        message: `At most 2 independently rounded components are supported; received ${profile.components.length}.`
      }
    };
  }
  const rate = profile.combinedRate;
  if (rate.numerator < ZERO) {
    return { ok: false, diagnostic: { code: 'negative-rate', message: `Combined rate must be nonnegative; received ${rate.numerator}/${rate.denominator}.` } };
  }
  if (rate.numerator >= rate.denominator) {
    return {
      ok: false,
      diagnostic: {
        code: 'combined-rate-not-less-than-one',
        message: `Combined withholding rate must be < 1; received ${Number(rate.numerator) / Number(rate.denominator)}.`
      }
    };
  }
  const components = BigInt(profile.componentCount);
  const oneMinusRate = rate.denominator - rate.numerator;
  const twoNet = TWO * BigInt(requestedNetCents);
  const denominator = TWO * oneMinusRate;
  let lower = floorDivide((twoNet - components) * rate.denominator, denominator);
  if (lower < ZERO) {
    lower = ZERO;
  }
  const upper = ceilDivide((twoNet + components) * rate.denominator, denominator);
  let lowerCents: number;
  let upperCents: number;
  try {
    lowerCents = toSafeCents(lower, 'bracket lower bound');
    upperCents = toSafeCents(upper, 'bracket upper bound');
  } catch (error) {
    return {
      ok: false,
      diagnostic: { code: 'unsafe-amount', message: error instanceof Error ? error.message : 'Unsafe bracket bound.' }
    };
  }
  return { ok: true, bracket: { lowerCents, upperCents, candidateCount: upperCents - lowerCents + 1 } };
};

// --- Solver results ----------------------------------------------------------

export interface GrossNetQuote {
  readonly status: 'funded' | 'partial' | 'unfunded';
  readonly requestedNetCents: number;
  readonly grossCents: number;
  readonly netCents: number;
  readonly taxCents: number;
  readonly penaltyCents: number;
  readonly shortfallCents: number;
  readonly components: readonly ResolvedComponent[];
}

export interface UnsupportedGrossNet {
  readonly status: 'unsupported';
  readonly requestedNetCents: number;
  readonly diagnostic: TaxDiagnostic;
}

export type GrossNetResult = GrossNetQuote | UnsupportedGrossNet;

export interface SolveGrossForNetParams {
  /** Requested net spending target, integer cents. */
  readonly requestedNetCents: number;
  readonly profile: WithholdingProfile;
  /** Available account balance cap, integer cents. Omit for an uncapped quote. */
  readonly availableBalanceCents?: number;
}

const unsupported = (requestedNetCents: number, code: TaxDiagnosticCode, message: string): UnsupportedGrossNet => ({
  status: 'unsupported',
  requestedNetCents,
  diagnostic: { code, message }
});

const quoteFromPosting = (
  status: 'funded' | 'partial',
  requestedNetCents: number,
  posting: TaxedPosting
): GrossNetQuote => ({
  status,
  requestedNetCents,
  grossCents: posting.grossCents,
  netCents: posting.netCents,
  taxCents: posting.taxCents,
  penaltyCents: posting.penaltyCents,
  shortfallCents: Math.max(0, requestedNetCents - posting.netCents),
  components: posting.components
});

const unfundedQuote = (requestedNetCents: number): GrossNetQuote => ({
  status: 'unfunded',
  requestedNetCents,
  grossCents: 0,
  netCents: 0,
  taxCents: 0,
  penaltyCents: 0,
  shortfallCents: requestedNetCents,
  components: []
});

/**
 * Bounded partial search: the highest net achievable at or below `balanceCents`.
 * The rounding-error-bounded window `[max(0, B − W), B]` (`W = ceil(2/(1−r))`)
 * is guaranteed to contain the true maximum; ties keep the smallest gross.
 * Never uses `net(balance)` as a shortcut.
 */
const solvePartial = (
  requestedNetCents: number,
  profile: WithholdingProfile,
  balanceCents: number
): GrossNetResult => {
  if (balanceCents <= 0) {
    return unfundedQuote(requestedNetCents);
  }
  const rate = profile.combinedRate;
  const oneMinusRate = rate.denominator - rate.numerator;
  const width = ceilDivide(TWO * rate.denominator, oneMinusRate);
  let start = BigInt(balanceCents) - width;
  if (start < ZERO) {
    start = ZERO;
  }
  const candidateCount = BigInt(balanceCents) - start + ONE;
  if (candidateCount > BigInt(MAX_SOLVER_CANDIDATES)) {
    return unsupported(
      requestedNetCents,
      'window-too-large',
      `Partial-funding neighborhood of ${candidateCount} candidates exceeds the ${MAX_SOLVER_CANDIDATES}-candidate bound.`
    );
  }
  let startCents: number;
  try {
    startCents = toSafeCents(start, 'partial search lower bound');
  } catch (error) {
    return unsupported(requestedNetCents, 'unsafe-amount', error instanceof Error ? error.message : 'Unsafe bound.');
  }
  let best: TaxedPosting | null = null;
  for (let gross = startCents; gross <= balanceCents; gross += 1) {
    const posting = resolvePosting(gross, profile);
    // Strict `>` keeps the smallest gross among equal maxima (ascending scan).
    if (best === null || posting.netCents > best.netCents) {
      best = posting;
    }
  }
  if (best === null || best.netCents <= 0) {
    return unfundedQuote(requestedNetCents);
  }
  return quoteFromPosting('partial', requestedNetCents, best);
};

/**
 * D5 solver: the minimal sufficient gross for a requested net, or an explicit
 * unsupported-range diagnostic. Enumerates integer cents ascending inside the
 * proven bracket (no binary search, no `N/(1−r)` shortcut). With a balance cap
 * it returns actual partial funding via the bounded neighborhood search.
 */
export const solveGrossForNet = (params: SolveGrossForNetParams): GrossNetResult => {
  const { requestedNetCents, profile, availableBalanceCents } = params;
  if (!Number.isSafeInteger(requestedNetCents)) {
    return unsupported(requestedNetCents, 'unsafe-amount', `Requested net must be a safe integer; received ${requestedNetCents}.`);
  }
  if (requestedNetCents < 0) {
    return unsupported(requestedNetCents, 'negative-net', `Requested net must be nonnegative; received ${requestedNetCents}.`);
  }
  if (
    availableBalanceCents !== undefined &&
    (!Number.isSafeInteger(availableBalanceCents) || availableBalanceCents < 0)
  ) {
    return unsupported(
      requestedNetCents,
      'unsafe-amount',
      `Available balance must be a nonnegative safe integer; received ${availableBalanceCents}.`
    );
  }

  const bracketResult = computeGrossNetBracket(requestedNetCents, profile);
  if (!bracketResult.ok) {
    return { status: 'unsupported', requestedNetCents, diagnostic: bracketResult.diagnostic };
  }
  const { lowerCents, upperCents, candidateCount } = bracketResult.bracket;
  if (candidateCount > MAX_SOLVER_CANDIDATES) {
    return unsupported(
      requestedNetCents,
      'window-too-large',
      `Gross bracket of ${candidateCount} candidates exceeds the ${MAX_SOLVER_CANDIDATES}-candidate bound.`
    );
  }

  let minimal: TaxedPosting | null = null;
  for (let gross = lowerCents; gross <= upperCents; gross += 1) {
    const posting = resolvePosting(gross, profile);
    if (posting.netCents >= requestedNetCents) {
      minimal = posting;
      break;
    }
  }
  if (minimal === null) {
    return unsupported(requestedNetCents, 'no-candidate', 'No gross inside the proven bracket satisfies the requested net.');
  }
  if (availableBalanceCents === undefined || minimal.grossCents <= availableBalanceCents) {
    return quoteFromPosting('funded', requestedNetCents, minimal);
  }
  return solvePartial(requestedNetCents, profile, availableBalanceCents);
};

export interface WithdrawalQuoteParams {
  readonly account: WithdrawalAccountConfig;
  readonly request: Pick<FundingRequest, 'hsaQualifiedMedical'>;
  readonly context: WithholdingContext;
  readonly requestedNetCents: number;
  readonly availableBalanceCents?: number;
}

/**
 * End-to-end pure quote: build the withholding profile from account/request/date
 * (diagnostic-aware) and run the bounded solver. Persisted invalid rates surface
 * as `unsupported` diagnostics rather than throws.
 */
export const quoteWithdrawal = (params: WithdrawalQuoteParams): GrossNetResult => {
  const profileResult = tryBuildWithholdingProfile(params.account, params.request, params.context);
  if (!profileResult.ok) {
    return { status: 'unsupported', requestedNetCents: params.requestedNetCents, diagnostic: profileResult.diagnostic };
  }
  return solveGrossForNet({
    requestedNetCents: params.requestedNetCents,
    profile: profileResult.profile,
    availableBalanceCents: params.availableBalanceCents
  });
};
