/**
 * P2.3 — focused tests for eligibility and the exact gross-net solver.
 *
 * Covers CA04 numerics (`$1000` gross→`$970`, `$1000` net→`$1030.93`,
 * `$0.17`→`$0.01` tax), the D5 bracket/iteration bound, unsupported-range
 * diagnostics, the HSA birthday/qualified rules, coincident-component rounding
 * dips in partial funding, and input immutability.
 */

import { describe, expect, it } from 'vitest';

import { MAX_SAFE_CENTS, roundHalfAwayFromZero } from './money';
import {
  HSA_DEFAULT_NON_QUALIFIED_PENALTY_RATE,
  buildWithholdingProfile,
  computeGrossNetBracket,
  evaluateAccountEligibility,
  exactRateFromPercent,
  exactRateMultiply,
  grossToNet,
  isHsaPenaltyWaived,
  isWithdrawalTaxExempt,
  quoteWithdrawal,
  solveGrossForNet,
  tryBuildWithholdingProfile
} from './taxes';
import type {
  AccountEligibility,
  WithdrawalAccountConfig,
  WithholdingContext,
  WithholdingProfile
} from './taxes';

const CONTEXT: WithholdingContext = { withdrawalDate: '2025-01-01', dateOfBirth: '1980-01-01' };

const account = (overrides: Partial<WithdrawalAccountConfig> = {}): WithdrawalAccountConfig => ({
  accountType: 'taxable',
  ...overrides
});

const profileFor = (overrides: Partial<WithdrawalAccountConfig> = {}, context: WithholdingContext = CONTEXT) =>
  buildWithholdingProfile(account(overrides), {}, context);

const TAXABLE = profileFor();
const RETIREMENT_22_10 = profileFor({
  accountType: 'retirement401k',
  withdrawalPolicy: { withdrawalTaxRate: 22, penaltyRate: 10 }
});

const netOf = (profile: WithholdingProfile, grossCents: number): number => grossToNet(grossCents, profile).netCents;

describe('taxes — exact rational rates', () => {
  it('reduces decimal percentages to exact fractions of gross', () => {
    expect(exactRateFromPercent(20)).toEqual({ numerator: 1n, denominator: 5n });
    expect(exactRateFromPercent(15)).toEqual({ numerator: 3n, denominator: 20n });
    expect(exactRateFromPercent(29)).toEqual({ numerator: 29n, denominator: 100n });
    // 20% gain share × 15% LTCG is exactly 3/100, never a float artefact.
    expect(exactRateMultiply(exactRateFromPercent(20), exactRateFromPercent(15))).toEqual({
      numerator: 3n,
      denominator: 100n
    });
  });

  it('rounds a component from exact arithmetic where a float product would drift', () => {
    // 50 × 29% is exactly 14.5 → rounds half away from zero to 15 cents.
    const retirement29 = profileFor({
      accountType: 'retirement401k',
      withdrawalPolicy: { withdrawalTaxRate: 29, penaltyRate: 0 }
    });
    expect(grossToNet(50, retirement29).taxCents).toBe(15);
    // Contrast: the naive float product 50 × 0.29 is below the half boundary.
    expect(50 * (29 / 100)).toBeLessThan(14.5);
    expect(roundHalfAwayFromZero(50 * (29 / 100))).toBe(14);
  });
});

describe('taxes — gross to net (CA04)', () => {
  it('$1000 taxable gross → $970 net with $30 capital-gains tax', () => {
    const posting = grossToNet(100000, TAXABLE);
    expect(posting.grossCents).toBe(100000);
    expect(posting.taxCents).toBe(3000);
    expect(posting.penaltyCents).toBe(0);
    expect(posting.netCents).toBe(97000);
    // Reconciliation identity is exact.
    expect(posting.grossCents).toBe(posting.netCents + posting.taxCents + posting.penaltyCents);
  });

  it('$0.17 taxable gross → $0.01 tax computed from the unrounded gain', () => {
    const posting = grossToNet(17, TAXABLE);
    expect(posting.taxCents).toBe(1);
    expect(posting.netCents).toBe(16);
  });

  it('keeps tax and penalty separate rounded identities for a 401k', () => {
    const posting = grossToNet(100000, RETIREMENT_22_10);
    expect(posting.taxCents).toBe(22000);
    expect(posting.penaltyCents).toBe(10000);
    expect(posting.netCents).toBe(68000);
    expect(posting.grossCents).toBe(posting.netCents + posting.taxCents + posting.penaltyCents);
  });

  it('withholds nothing from checking/savings and Roth', () => {
    for (const type of ['checking', 'savings', 'roth'] as const) {
      const posting = grossToNet(100000, profileFor({ accountType: type }));
      expect(posting.taxCents).toBe(0);
      expect(posting.penaltyCents).toBe(0);
      expect(posting.netCents).toBe(100000);
    }
  });
});

describe('taxes — HSA qualification and age boundary', () => {
  const hsaPolicy = {
    withdrawalTaxRate: 22,
    penaltyRate: 0,
    hsa: { nonQualifiedPenaltyRate: HSA_DEFAULT_NON_QUALIFIED_PENALTY_RATE, nonQualifiedPenaltyWaiverAge: 65 }
  };
  const hsaAccount = account({ accountType: 'hsa', withdrawalPolicy: hsaPolicy });

  it('treats explicitly qualified medical spending as tax/penalty free', () => {
    const profile = buildWithholdingProfile(hsaAccount, { hsaQualifiedMedical: true }, CONTEXT);
    expect(profile.componentCount).toBe(0);
    expect(profile.taxExempt).toBe(true);
    const posting = grossToNet(100000, profile);
    expect(posting.taxCents).toBe(0);
    expect(posting.penaltyCents).toBe(0);
    expect(posting.netCents).toBe(100000);
  });

  it('never infers qualification from a purpose/category label', () => {
    // No explicit qualification flag → non-qualified, even for a "medical" name.
    const profile = buildWithholdingProfile(hsaAccount, {}, CONTEXT);
    expect(profile.qualifiedMedical).toBe(false);
    const posting = grossToNet(100000, profile);
    expect(posting.taxCents).toBe(22000);
    expect(posting.penaltyCents).toBe(20000);
    expect(posting.netCents).toBe(58000);
  });

  it('waives only the extra penalty from the 65th birthday, regardless of retirement', () => {
    const dob = '1960-06-15';
    expect(isHsaPenaltyWaived('2025-06-14', dob)).toBe(false);
    expect(isHsaPenaltyWaived('2025-06-15', dob)).toBe(true);
    expect(isHsaPenaltyWaived('2025-06-16', dob)).toBe(true);
    // A Feb-29 DOB clamps to Feb-28 in a non-leap waiver year.
    expect(isHsaPenaltyWaived('2025-02-27', '1960-02-29')).toBe(false);
    expect(isHsaPenaltyWaived('2025-02-28', '1960-02-29')).toBe(true);

    const before = buildWithholdingProfile(hsaAccount, {}, { withdrawalDate: '2025-06-14', dateOfBirth: dob });
    const on65 = buildWithholdingProfile(hsaAccount, {}, { withdrawalDate: '2025-06-15', dateOfBirth: dob });
    expect(before.hsaPenaltyWaived).toBe(false);
    expect(before.componentCount).toBe(2);
    expect(on65.hsaPenaltyWaived).toBe(true);
    expect(on65.componentCount).toBe(1);
    const postingAt65 = grossToNet(100000, on65);
    expect(postingAt65.taxCents).toBe(22000);
    expect(postingAt65.penaltyCents).toBe(0);
    expect(postingAt65.netCents).toBe(78000);
  });

  it('diagnoses an unsupported waiver age rather than overflowing the date range', () => {
    const result = tryBuildWithholdingProfile(
      account({ accountType: 'hsa', withdrawalPolicy: { ...hsaPolicy, hsa: { nonQualifiedPenaltyRate: 20, nonQualifiedPenaltyWaiverAge: 8020 } } }),
      {},
      { withdrawalDate: '2025-01-01', dateOfBirth: '1980-01-01' }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostic.code).toBe('invalid-waiver-age');
  });
});

describe('taxes — CA04 custom non-qualified HSA policy (ADR-021)', () => {
  // Genuinely non-default policy: 20% income tax, a 10% extra penalty (default
  // is 20%) and a waiver at age 60 (default is 65). Holder DOB 1966-03-10, so
  // the custom 60th birthday is 2026-03-10.
  const CUSTOM_PENALTY_PERCENT = 10;
  const CUSTOM_WAIVER_AGE = 60;
  const CUSTOM_CAREER_DOB = '1966-03-10';
  const DAY_BEFORE_CUSTOM_60 = '2026-03-09';
  const ON_CUSTOM_60 = '2026-03-10';
  const customHsaPolicy = {
    withdrawalTaxRate: 20,
    penaltyRate: 0,
    hsa: {
      nonQualifiedPenaltyRate: CUSTOM_PENALTY_PERCENT,
      nonQualifiedPenaltyWaiverAge: CUSTOM_WAIVER_AGE
    }
  };
  const customHsa = account({ accountType: 'hsa', withdrawalPolicy: customHsaPolicy });

  it('withholds the configured custom extra penalty (not the 20% default) before the custom waiver age', () => {
    // Guard that the fixture really exercises a non-default penalty rate.
    expect(CUSTOM_PENALTY_PERCENT).not.toBe(HSA_DEFAULT_NON_QUALIFIED_PENALTY_RATE);

    const profile = buildWithholdingProfile(customHsa, {}, {
      withdrawalDate: DAY_BEFORE_CUSTOM_60,
      dateOfBirth: CUSTOM_CAREER_DOB
    });
    expect(profile.hsaPenaltyWaived).toBe(false);
    expect(profile.componentCount).toBe(2);

    // Independently computed for $1000 gross: tax = 20% of 100000 = 20000,
    // penalty = 10% of 100000 = 10000, net = 100000 − 20000 − 10000 = 70000.
    const posting = grossToNet(100000, profile);
    expect(posting.grossCents).toBe(100000);
    expect(posting.taxCents).toBe(20000);
    expect(posting.penaltyCents).toBe(10000);
    expect(posting.netCents).toBe(70000);
    expect(posting.grossCents).toBe(posting.netCents + posting.taxCents + posting.penaltyCents);
  });

  it('waives only the penalty on the custom birthday and leaves the default boundary intact', () => {
    const dob = CUSTOM_CAREER_DOB;
    // Custom waiver age 60: the day before is penalized, the birthday is waived.
    expect(isHsaPenaltyWaived(DAY_BEFORE_CUSTOM_60, dob, CUSTOM_WAIVER_AGE)).toBe(false);
    expect(isHsaPenaltyWaived(ON_CUSTOM_60, dob, CUSTOM_WAIVER_AGE)).toBe(true);
    // The custom threshold does not move the default age-65 boundary.
    expect(isHsaPenaltyWaived(ON_CUSTOM_60, dob)).toBe(false);
    expect(isHsaPenaltyWaived('2031-03-10', dob)).toBe(true);

    const onCustomBirthday = buildWithholdingProfile(customHsa, {}, {
      withdrawalDate: ON_CUSTOM_60,
      dateOfBirth: dob
    });
    expect(onCustomBirthday.hsaPenaltyWaived).toBe(true);
    expect(onCustomBirthday.componentCount).toBe(1);
    // $1000 gross pays only the 20% income tax once waived: net = 80000.
    const posting = grossToNet(100000, onCustomBirthday);
    expect(posting.taxCents).toBe(20000);
    expect(posting.penaltyCents).toBe(0);
    expect(posting.netCents).toBe(80000);
    expect(posting.grossCents).toBe(posting.netCents + posting.taxCents + posting.penaltyCents);
  });

  it('grosses a requested net back up through the custom policy (before and on the birthday)', () => {
    // Before the birthday, 20% tax + 10% penalty. $700 net needs $1000 gross:
    // the minimal sufficient cent (99999 gives net 69999, one cent short).
    const before = quoteWithdrawal({
      account: customHsa,
      request: {},
      context: { withdrawalDate: DAY_BEFORE_CUSTOM_60, dateOfBirth: CUSTOM_CAREER_DOB },
      requestedNetCents: 70000
    });
    expect(before.status).toBe('funded');
    if (before.status !== 'funded') {
      return;
    }
    expect(before.grossCents).toBe(100000);
    expect(before.taxCents).toBe(20000);
    expect(before.penaltyCents).toBe(10000);
    expect(before.netCents).toBe(70000);
    expect(before.shortfallCents).toBe(0);
    expect(before.grossCents).toBe(before.netCents + before.taxCents + before.penaltyCents);

    // On the custom birthday the penalty is waived: only 20% tax remains, so
    // $800 net needs $1000 gross (99999 gives net 79999, one cent short).
    const after = quoteWithdrawal({
      account: customHsa,
      request: {},
      context: { withdrawalDate: ON_CUSTOM_60, dateOfBirth: CUSTOM_CAREER_DOB },
      requestedNetCents: 80000
    });
    expect(after.status).toBe('funded');
    if (after.status !== 'funded') {
      return;
    }
    expect(after.grossCents).toBe(100000);
    expect(after.taxCents).toBe(20000);
    expect(after.penaltyCents).toBe(0);
    expect(after.netCents).toBe(80000);
    expect(after.grossCents).toBe(after.netCents + after.taxCents + after.penaltyCents);
  });
});

describe('taxes — net to gross solver (CA04 / D5)', () => {
  it('$1000 taxable net → $1030.93 gross with $30.93 tax', () => {
    const result = solveGrossForNet({ requestedNetCents: 100000, profile: TAXABLE });
    expect(result.status).toBe('funded');
    if (result.status !== 'funded') {
      return;
    }
    expect(result.grossCents).toBe(103093);
    expect(result.taxCents).toBe(3093);
    expect(result.penaltyCents).toBe(0);
    expect(result.netCents).toBe(100000);
    expect(result.shortfallCents).toBe(0);
    expect(result.grossCents).toBe(result.netCents + result.taxCents + result.penaltyCents);
  });

  it('does not reuse the closed-form estimate N/(1−r) as the answer', () => {
    // floor(100000 / 0.97) = 103092, which is one cent short of sufficient.
    expect(Math.floor(100000 / (1 - 0.03))).toBe(103092);
    expect(netOf(TAXABLE, 103092)).toBe(99999);
    const result = solveGrossForNet({ requestedNetCents: 100000, profile: TAXABLE });
    expect(result.status === 'funded' && result.grossCents).toBe(103093);
  });

  it('brackets the minimal gross within the proven L..U bounds', () => {
    const bracket = computeGrossNetBracket(100000, TAXABLE);
    expect(bracket.ok).toBe(true);
    if (!bracket.ok) {
      return;
    }
    expect(bracket.bracket).toEqual({ lowerCents: 103092, upperCents: 103094, candidateCount: 3 });
    expect(bracket.bracket.candidateCount).toBeLessThanOrEqual(256);
  });

  it('solves a two-component 401k net back to its gross', () => {
    const result = solveGrossForNet({ requestedNetCents: 68000, profile: RETIREMENT_22_10 });
    expect(result.status).toBe('funded');
    if (result.status !== 'funded') {
      return;
    }
    expect(result.grossCents).toBe(100000);
    expect(result.taxCents).toBe(22000);
    expect(result.penaltyCents).toBe(10000);
  });

  it('solves a zero request to a zero gross', () => {
    const result = solveGrossForNet({ requestedNetCents: 0, profile: TAXABLE });
    expect(result.status).toBe('funded');
    if (result.status !== 'funded') {
      return;
    }
    expect(result.grossCents).toBe(0);
    expect(result.netCents).toBe(0);
  });
});

describe('taxes — balance cap and partial funding', () => {
  it('funds in full when the balance covers the minimal gross', () => {
    const result = solveGrossForNet({
      requestedNetCents: 100000,
      profile: TAXABLE,
      availableBalanceCents: 103093
    });
    expect(result.status).toBe('funded');
    if (result.status !== 'funded') {
      return;
    }
    expect(result.grossCents).toBe(103093);
    expect(result.netCents).toBe(100000);
  });

  it('reports partial funding one cent below the minimal gross', () => {
    const result = solveGrossForNet({
      requestedNetCents: 100000,
      profile: TAXABLE,
      availableBalanceCents: 103092
    });
    expect(result.status).toBe('partial');
    if (result.status !== 'partial') {
      return;
    }
    expect(result.grossCents).toBe(103092);
    expect(result.netCents).toBe(99999);
    expect(result.shortfallCents).toBe(1);
  });

  it('finds the maximum net in a rounding dip instead of trusting net(balance)', () => {
    // 25% income tax + 25% penalty: net(G) dips at G=10 (net 4) below G=9 (net 5).
    const profile = profileFor({
      accountType: 'retirement401k',
      withdrawalPolicy: { withdrawalTaxRate: 25, penaltyRate: 25 }
    });
    expect(netOf(profile, 9)).toBe(5);
    expect(netOf(profile, 10)).toBe(4);

    const result = solveGrossForNet({ requestedNetCents: 20, profile, availableBalanceCents: 10 });
    expect(result.status).toBe('partial');
    if (result.status !== 'partial') {
      return;
    }
    expect(result.grossCents).toBe(9);
    expect(result.netCents).toBe(5);
    expect(result.shortfallCents).toBe(15);
  });

  it('chooses the smallest gross when several achieve the same maximum net', () => {
    // With balance 11 (window 7..11) net is maximal (5) at both G=9 and G=11.
    const profile = profileFor({
      accountType: 'retirement401k',
      withdrawalPolicy: { withdrawalTaxRate: 25, penaltyRate: 25 }
    });
    expect(netOf(profile, 11)).toBe(5);
    const result = solveGrossForNet({ requestedNetCents: 20, profile, availableBalanceCents: 11 });
    expect(result.status).toBe('partial');
    if (result.status !== 'partial') {
      return;
    }
    expect(result.grossCents).toBe(9);
    expect(result.netCents).toBe(5);
  });

  it('never marks an unfunded target as paid', () => {
    const result = solveGrossForNet({ requestedNetCents: 100000, profile: TAXABLE, availableBalanceCents: 0 });
    expect(result.status).toBe('unfunded');
    if (result.status !== 'unfunded') {
      return;
    }
    expect(result.grossCents).toBe(0);
    expect(result.netCents).toBe(0);
    expect(result.shortfallCents).toBe(100000);
  });
});

describe('taxes — unsupported-range diagnostics', () => {
  it('diagnoses a combined rate that is not below one', () => {
    const profile = profileFor({
      accountType: 'retirement401k',
      withdrawalPolicy: { withdrawalTaxRate: 100, penaltyRate: 0 }
    });
    const result = solveGrossForNet({ requestedNetCents: 100000, profile });
    expect(result.status).toBe('unsupported');
    if (result.status !== 'unsupported') {
      return;
    }
    expect(result.diagnostic.code).toBe('combined-rate-not-less-than-one');
  });

  it('diagnoses a bracket wider than the 256-candidate bound', () => {
    const profile = profileFor({
      accountType: 'retirement401k',
      withdrawalPolicy: { withdrawalTaxRate: 99.9, penaltyRate: 0 }
    });
    const result = solveGrossForNet({ requestedNetCents: 100000, profile });
    expect(result.status).toBe('unsupported');
    if (result.status !== 'unsupported') {
      return;
    }
    expect(result.diagnostic.code).toBe('window-too-large');
  });

  it('diagnoses a non-finite persisted rate through the end-to-end quote', () => {
    const result = quoteWithdrawal({
      account: account({
        accountType: 'retirement401k',
        withdrawalPolicy: { withdrawalTaxRate: Number.NaN, penaltyRate: 0 }
      }),
      request: {},
      context: CONTEXT,
      requestedNetCents: 100000
    });
    expect(result.status).toBe('unsupported');
    if (result.status !== 'unsupported') {
      return;
    }
    expect(result.diagnostic.code).toBe('non-finite-rate');
  });

  it('diagnoses unsafe and negative requested amounts', () => {
    expect(solveGrossForNet({ requestedNetCents: MAX_SAFE_CENTS + 2, profile: TAXABLE }).status).toBe('unsupported');
    const negative = solveGrossForNet({ requestedNetCents: -1, profile: TAXABLE });
    expect(negative.status).toBe('unsupported');
    if (negative.status === 'unsupported') {
      expect(negative.diagnostic.code).toBe('negative-net');
    }
  });

  it('surfaces invalid HSA dates as diagnostics from the profile build', () => {
    const failed = tryBuildWithholdingProfile(
      account({ accountType: 'hsa', withdrawalPolicy: { withdrawalTaxRate: 22, penaltyRate: 0 } }),
      {},
      { withdrawalDate: '2025-01-01', dateOfBirth: 'not-a-date' }
    );
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.diagnostic.code).toBe('invalid-date-of-birth');
    }
  });
});

describe('taxes — eligibility', () => {
  it('classifies tax exemption by account type and explicit qualification', () => {
    const expected: Array<[WithdrawalAccountConfig['accountType'], boolean, AccountEligibility['reason']]> = [
      ['checking', true, 'ordinary'],
      ['savings', true, 'ordinary'],
      ['taxable', false, 'taxable-gain'],
      ['retirement401k', false, 'retirement-income'],
      ['roth', true, 'roth'],
      ['hsa', true, 'hsa-qualified']
    ];
    for (const [accountType, taxExempt, reason] of expected) {
      const request = accountType === 'hsa' ? { hsaQualifiedMedical: true } : {};
      const eligibility = evaluateAccountEligibility({ accountType }, request);
      expect(eligibility.eligible).toBe(true);
      expect(eligibility.taxExempt).toBe(taxExempt);
      expect(eligibility.reason).toBe(reason);
      expect(isWithdrawalTaxExempt({ accountType }, request)).toBe(taxExempt);
    }
    expect(evaluateAccountEligibility({ accountType: 'hsa' }, {}).reason).toBe('hsa-nonqualified');
    expect(isWithdrawalTaxExempt({ accountType: 'hsa' }, {})).toBe(false);
  });
});

describe('taxes — purity', () => {
  it('does not mutate or alias its inputs', () => {
    const frozenAccount = Object.freeze(
      account({ accountType: 'retirement401k', withdrawalPolicy: { withdrawalTaxRate: 22, penaltyRate: 10 } })
    );
    const frozenRequest = Object.freeze({ hsaQualifiedMedical: false });
    const frozenContext = Object.freeze({ withdrawalDate: '2025-01-01', dateOfBirth: '1980-01-01' });

    const profile = buildWithholdingProfile(frozenAccount, frozenRequest, frozenContext);
    const frozenComponents = Object.freeze(profile.components.slice());
    const frozenProfile = Object.freeze({ ...profile, components: frozenComponents });

    const posting = grossToNet(100000, frozenProfile);
    const result = solveGrossForNet({ requestedNetCents: 68000, profile: frozenProfile });

    expect(posting.components).not.toBe(frozenComponents);
    expect(result.status).toBe('funded');
    expect(frozenAccount.withdrawalPolicy?.withdrawalTaxRate).toBe(22);
    expect(frozenContext.withdrawalDate).toBe('2025-01-01');
  });
});
