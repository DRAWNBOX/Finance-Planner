/**
 * P2.2 — focused tests for the private kernel state and its sole atomic commit.
 *
 * These tests exercise CA03 (atomicity/conservation), CA09 (held acquisition
 * deposit partial → completion), observed-zero opening, safe-range limits and
 * the "rejected commit is a no-op" contract.
 *
 * Dependency note: `state.ts` converts opening dollars via the P2.1
 * `dollarsToCents` export from `./money`. That lane has landed, so this suite
 * runs against the real rounding owner (no local shim).
 */

import { describe, expect, it } from 'vitest';

import type { LiabilityKind } from '../types';
import { createDefaultScenario } from '../defaultScenario';
import { resolveOpening } from './opening';
import type {
  OpeningAccountState,
  OpeningLiabilityState,
  OpeningPropertyState,
  ResolvedOpening
} from './opening';
import { buildState, StateValidationError } from './state';
import type { StateChangeSet } from './state';
import type { PostingContext, PostingFlowFacts, PostingRecord } from './journal';
import { POSTING_PHASES } from './journal';

const POLICY = {
  allowAutomaticFallback: true,
  withdrawalTaxRate: 0,
  penaltyRate: 0,
  restrictionNote: ''
};

/** Explicit posting fixture: no production default is ever fabricated (D15). */
const POSTING: PostingContext = {
  occurrenceId: 'occ:test',
  definitionId: 'def:test',
  purpose: 'test-posting',
  date: '2026-01-15',
  phase: 'mandatory'
};

const openingAccount = (accountId: string, dollars: number): OpeningAccountState => ({
  accountId,
  label: accountId,
  accountType: 'checking',
  openingBalance: dollars,
  annualReturnRate: 0,
  retirementAnnualReturnRate: null,
  withdrawalPolicy: { ...POLICY },
  displayOrder: 0,
  source: 'configured'
});

const openingLiability = (
  liabilityId: string,
  dollars: number,
  kind: LiabilityKind = 'loan'
): OpeningLiabilityState => ({
  liabilityId,
  kind,
  openingBalance: dollars,
  source: 'configured'
});

const openingProperty = (
  propertyId: string,
  dollars: number,
  over: Partial<OpeningPropertyState> = {}
): OpeningPropertyState => ({
  propertyId,
  value: dollars,
  status: 'pending',
  requiredDownPayment: 0,
  source: 'configured',
  fundingEventAccountIds: [],
  ...over
});

const makeOpening = (over: Partial<ResolvedOpening> = {}): ResolvedOpening => ({
  date: '2026-01-01',
  measurement: 'assetOnly',
  hasSnapshot: false,
  sourceSnapshotId: null,
  accounts: [],
  liabilities: [],
  properties: [],
  history: [],
  diagnostics: [],
  ...over
});

/**
 * A recurring commit convenience that always targets the live revision and
 * stamps the explicit posting fixture. Pass `posting: undefined` to omit it for
 * the missing-posting cases (use a raw `commitChanges` call there instead).
 */
const apply = (state: ReturnType<typeof buildState>, changeSet: Omit<StateChangeSet, 'revision'>) =>
  state.commitChanges({ posting: POSTING, ...changeSet, revision: state.getRevision() });

describe('buildState — opening conversion and ownership', () => {
  it('converts persisted dollars to integer cents once at the boundary', () => {
    const state = buildState(
      makeOpening({
        accounts: [openingAccount('checking', 1234.56)],
        liabilities: [openingLiability('loan', 987.65)],
        properties: [openingProperty('home', 300000.01)]
      })
    );

    expect(state.getAccountBalanceCents('checking')).toBe(123456);
    expect(state.getLiability('loan')?.principalCents).toBe(98765);
    expect(state.getProperty('home')?.valueCents).toBe(30000001);
    // Accrued interest/fees start at zero; held deposit is runtime-only.
    expect(state.getLiability('loan')?.accruedInterestCents).toBe(0);
    expect(state.getProperty('home')?.acquisitionDepositCents).toBe(0);
    expect(state.getRevision()).toBe(0);
  });

  it('keeps an observed zero opening liability at exactly zero', () => {
    const state = buildState(
      makeOpening({
        hasSnapshot: true,
        measurement: 'assetsMinusLiabilities',
        liabilities: [{ liabilityId: 'mort', kind: 'mortgage', openingBalance: 0, source: 'observed' }]
      })
    );

    expect(state.getLiability('mort')?.principalCents).toBe(0);
    expect(state.getTotals().liabilityCents).toBe(0);
  });

  it('clears a dangling mortgage link and records a diagnostic', () => {
    const state = buildState(
      makeOpening({
        properties: [openingProperty('home', 250000, { debtLink: 'missing-mortgage' })]
      })
    );

    expect(state.getProperty('home')?.mortgageId).toBeNull();
    expect(state.getDiagnostics().some((line) => line.includes('missing-mortgage'))).toBe(true);
  });

  it('rejects negative and non-finite opening amounts instead of inventing money', () => {
    expect(() => buildState(makeOpening({ accounts: [openingAccount('bad', -1)] }))).toThrow(
      StateValidationError
    );
    expect(() => buildState(makeOpening({ accounts: [openingAccount('bad', Number.NaN)] }))).toThrow(
      StateValidationError
    );
    expect(() =>
      buildState(makeOpening({ liabilities: [openingLiability('bad', Number.POSITIVE_INFINITY)] }))
    ).toThrow(StateValidationError);
  });

  it('rejects opening dollars that overflow the safe cent range', () => {
    expect(() =>
      buildState(makeOpening({ accounts: [openingAccount('huge', Number.MAX_SAFE_INTEGER)] }))
    ).toThrow(StateValidationError);
  });

  it('rejects an opening whose individually-safe amounts overflow in aggregate', () => {
    const huge = 45_000_000_000_000; // 4.5e15 cents each; three sum past MAX_SAFE_INTEGER
    expect(() =>
      buildState(
        makeOpening({
          accounts: [openingAccount('a', huge), openingAccount('b', huge), openingAccount('c', huge)]
        })
      )
    ).toThrow(StateValidationError);
  });

  it('folds snapshot property-linked debt once through opening resolution', () => {
    const scenario = createDefaultScenario(new Date('2026-01-15'));
    scenario.liabilities = [];
    scenario.properties = [];
    scenario.netWorth.openingSnapshot = {
      date: '2026-01-01',
      accounts: [],
      liabilities: [],
      properties: [{ propertyId: 'home', value: 300000, debtBalance: 240000 }],
      measurement: 'assetsMinusLiabilities'
    };

    const state = buildState(resolveOpening(scenario));

    expect(state.getLiabilities()).toHaveLength(1);
    expect(state.getLiability('property:home')?.principalCents).toBe(24000000);
    expect(state.getProperty('home')?.valueCents).toBe(30000000);
    expect(state.getTotals().liabilityCents).toBe(24000000);
  });
});

describe('read snapshots — private and immutable', () => {
  it('exposes frozen snapshots and no mutable map or setter', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('a', 10)] }));
    const account = state.getAccount('a')!;

    expect(Object.isFrozen(account)).toBe(true);
    expect(Object.isFrozen(state.getAccounts())).toBe(true);
    expect(Object.isFrozen(state.toSnapshot())).toBe(true);
    expect(() => {
      (account as { balanceCents: number }).balanceCents = 9999;
    }).toThrow();
  });

  it('reports deterministic id-ordered reads', () => {
    const state = buildState(
      makeOpening({ accounts: [openingAccount('zeta', 1), openingAccount('alpha', 2)] })
    );

    expect(state.getAccounts().map((entry) => entry.accountId)).toEqual(['alpha', 'zeta']);
  });

  it('reconciles assets − liabilities in getTotals', () => {
    const state = buildState(
      makeOpening({
        accounts: [openingAccount('checking', 100)],
        liabilities: [openingLiability('loan', 40)],
        properties: [openingProperty('home', 300)]
      })
    );

    const totals = state.getTotals();
    expect(totals.accountCents).toBe(10000);
    expect(totals.propertyValueCents).toBe(30000);
    expect(totals.liabilityCents).toBe(4000);
    expect(totals.assetsCents).toBe(40000);
    expect(totals.netWorthCents).toBe(36000);
  });
});

describe('commitChanges — atomic sparse mutation and rejection', () => {
  it('commits a sparse account debit and advances the revision', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 500)] }));
    const result = apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -12500 }],
      expectedNetWorthDeltaCents: -12500
    });

    expect(result.committed).toBe(true);
    expect(result.revision).toBe(1);
    expect(state.getRevision()).toBe(1);
    expect(state.getAccountBalanceCents('checking')).toBe(37500);
  });

  it('rejects a stale revision without mutating', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 500)] }));
    const result = state.commitChanges({
      revision: 99,
      accountChanges: [{ accountId: 'checking', deltaCents: -100 }]
    });

    expect(result.committed).toBe(false);
    expect(result.errors[0].code).toBe('stale-revision');
    expect(state.getRevision()).toBe(0);
    expect(state.getAccountBalanceCents('checking')).toBe(50000);
  });

  it('rejects an unknown entity without mutating', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 500)] }));
    const result = apply(state, {
      accountChanges: [{ accountId: 'ghost', deltaCents: -100 }],
      expectedNetWorthDeltaCents: -100
    });

    expect(result.committed).toBe(false);
    expect(result.errors[0]).toEqual(expect.objectContaining({ code: 'unknown-entity', entity: 'account' }));
    expect(state.getRevision()).toBe(0);
    expect(state.getAccountBalanceCents('checking')).toBe(50000);
  });

  it('rejects a nonempty commit with no conservation declaration (no-op)', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 500)] }));
    const result = apply(state, { accountChanges: [{ accountId: 'checking', deltaCents: -100 }] });

    expect(result.committed).toBe(false);
    expect(result.errors.some((error) => error.code === 'missing-conservation-declaration')).toBe(true);
    expect(state.getRevision()).toBe(0);
    expect(state.getAccountBalanceCents('checking')).toBe(50000);
  });

  it('rejects a non-safe conservation declaration without mutating', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 500)] }));
    const result = apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -100 }],
      expectedNetWorthDeltaCents: Number.NaN
    });

    expect(result.committed).toBe(false);
    expect(result.errors.some((error) => error.code === 'unsafe-amount')).toBe(true);
    expect(state.getRevision()).toBe(0);
    expect(state.getAccountBalanceCents('checking')).toBe(50000);
  });

  it('rejects a negative balance and applies none of the change set', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 100)] }));
    const result = apply(state, {
      accountChanges: [
        { accountId: 'checking', deltaCents: -5000 },
        { accountId: 'checking', deltaCents: -9000 }
      ],
      expectedNetWorthDeltaCents: -14000
    });

    // Duplicate target is also ambiguous; the point is nothing is applied.
    expect(result.committed).toBe(false);
    expect(state.getAccountBalanceCents('checking')).toBe(10000);
    expect(state.getRevision()).toBe(0);
  });

  it('rejects an all-or-none set when one signed leg would go negative', () => {
    const state = buildState(
      makeOpening({
        accounts: [openingAccount('checking', 100)],
        liabilities: [openingLiability('loan', 50)]
      })
    );
    const result = apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -20000 }],
      liabilityChanges: [{ liabilityId: 'loan', principalDeltaCents: -2000 }],
      expectedNetWorthDeltaCents: -18000
    });

    expect(result.committed).toBe(false);
    expect(state.getAccountBalanceCents('checking')).toBe(10000);
    expect(state.getLiability('loan')?.principalCents).toBe(5000);
    expect(state.getRevision()).toBe(0);
  });

  it('rejects duplicate targets in one change set', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 100)] }));
    const result = apply(state, {
      accountChanges: [
        { accountId: 'checking', deltaCents: -100 },
        { accountId: 'checking', deltaCents: -100 }
      ],
      expectedNetWorthDeltaCents: -200
    });

    expect(result.committed).toBe(false);
    expect(result.errors.some((error) => error.code === 'duplicate-change')).toBe(true);
    expect(state.getAccountBalanceCents('checking')).toBe(10000);
  });

  it('rejects unsafe cent deltas and unsafe aggregates', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 100)] }));
    const unsafe = apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: Number.MAX_SAFE_INTEGER }],
      expectedNetWorthDeltaCents: -Number.MAX_SAFE_INTEGER
    });
    expect(unsafe.committed).toBe(false);

    const a = openingAccount('a', 45_000_000_000_000);
    const b = openingAccount('b', 45_000_000_000_000);
    const wide = buildState(makeOpening({ accounts: [a, b] }));
    const overflow = apply(wide, {
      accountChanges: [{ accountId: 'a', deltaCents: 20_000_000_000_000 }],
      expectedNetWorthDeltaCents: 20_000_000_000_000
    });

    expect(overflow.committed).toBe(false);
    expect(overflow.errors.some((error) => error.code === 'unsafe-total')).toBe(true);
  });

  it('rejects a mortgage link to a liability the state does not own', () => {
    const state = buildState(makeOpening({ properties: [openingProperty('home', 0)] }));
    const result = apply(state, {
      propertyChanges: [{ propertyId: 'home', mortgageId: 'no-such-liability' }],
      expectedNetWorthDeltaCents: 0
    });

    expect(result.committed).toBe(false);
    expect(result.errors.some((error) => error.code === 'unknown-mortgage-link')).toBe(true);
    expect(state.getProperty('home')?.mortgageId).toBeNull();
  });

  it('creates a liability once and rejects a duplicate creation', () => {
    const state = buildState(
      makeOpening({ accounts: [openingAccount('checking', 1000)], properties: [openingProperty('home', 0)] })
    );
    const created = apply(state, {
      liabilityChanges: [{ liabilityId: 'mort', create: true, kind: 'mortgage', principalDeltaCents: 24000000 }],
      propertyChanges: [{ propertyId: 'home', mortgageId: 'mort' }],
      expectedNetWorthDeltaCents: -24000000
    });

    expect(created.committed).toBe(true);
    expect(state.getLiability('mort')?.principalCents).toBe(24000000);
    expect(state.getProperty('home')?.mortgageId).toBe('mort');

    const again = apply(state, {
      liabilityChanges: [{ liabilityId: 'mort', create: true, kind: 'mortgage' }],
      expectedNetWorthDeltaCents: 0
    });
    expect(again.committed).toBe(false);
    expect(again.errors.some((error) => error.code === 'entity-exists')).toBe(true);

    const noKind = apply(state, {
      liabilityChanges: [{ liabilityId: 'newDebt', create: true, principalDeltaCents: 100 }],
      expectedNetWorthDeltaCents: -100
    });
    expect(noKind.committed).toBe(false);
    expect(noKind.errors.some((error) => error.code === 'missing-creation-data')).toBe(true);
  });

  it('applies a principal payment atomically with its cash leg', () => {
    const state = buildState(
      makeOpening({
        accounts: [openingAccount('checking', 1000)],
        liabilities: [openingLiability('loan', 300)]
      })
    );
    const paid = apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -10000 }],
      liabilityChanges: [{ liabilityId: 'loan', principalDeltaCents: -10000 }],
      expectedNetWorthDeltaCents: 0
    });

    expect(paid.committed).toBe(true);
    expect(state.getAccountBalanceCents('checking')).toBe(90000);
    expect(state.getLiability('loan')?.principalCents).toBe(20000);
  });

  it('rejects a principal overpayment without debiting cash', () => {
    const state = buildState(
      makeOpening({
        accounts: [openingAccount('checking', 1000)],
        liabilities: [openingLiability('loan', 100)]
      })
    );
    const overpaid = apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -20000 }],
      liabilityChanges: [{ liabilityId: 'loan', principalDeltaCents: -20000 }],
      expectedNetWorthDeltaCents: 0
    });

    expect(overpaid.committed).toBe(false);
    expect(state.getAccountBalanceCents('checking')).toBe(100000);
    expect(state.getLiability('loan')?.principalCents).toBe(10000);
  });
});

describe('commitChanges — funding postings and CA09 acquisition', () => {
  it('debits exactly the gross amount once (gross = net + tax + penalty)', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('brokerage', 1000)] }));
    const net = 97000;
    const tax = 3000;
    const penalty = 0;
    const gross = net + tax + penalty;
    expect(gross).toBe(100000);

    const result = apply(state, {
      accountChanges: [{ accountId: 'brokerage', deltaCents: -gross }],
      expectedNetWorthDeltaCents: -gross
    });

    expect(result.committed).toBe(true);
    // Withholding reduces gross once; net/tax/penalty are never charged a second time.
    expect(state.getAccountBalanceCents('brokerage')).toBe(100000 - gross);
  });

  it('requires the post-commit revision for a second posting (no reused plan)', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('brokerage', 10000)] }));
    const first = state.commitChanges({
      revision: state.getRevision(),
      posting: POSTING,
      accountChanges: [{ accountId: 'brokerage', deltaCents: -100000 }],
      expectedNetWorthDeltaCents: -100000
    });
    expect(first.committed).toBe(true);

    const reused = state.commitChanges({
      revision: 0,
      posting: POSTING,
      accountChanges: [{ accountId: 'brokerage', deltaCents: -100000 }],
      expectedNetWorthDeltaCents: -100000
    });
    expect(reused.committed).toBe(false);
    expect(state.getAccountBalanceCents('brokerage')).toBe(900000);
  });

  it('funds a held acquisition deposit (partial) then completes the exchange atomically', () => {
    const state = buildState(
      makeOpening({
        accounts: [openingAccount('checking', 100000)],
        properties: [openingProperty('home', 0)]
      })
    );

    // Partial: $30k of a $60k down payment becomes a held deposit (asset-neutral).
    const partial = apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -3000000 }],
      propertyChanges: [{ propertyId: 'home', acquisitionDepositDeltaCents: 3000000 }],
      expectedNetWorthDeltaCents: 0
    });
    expect(partial.committed).toBe(true);
    expect(state.getProperty('home')?.acquisitionDepositCents).toBe(3000000);
    expect(state.getTotals().netWorthCents).toBe(10000000);

    // Completion: second $30k cash + held $30k deposit -> $300k property / $240k mortgage.
    const completion = apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -3000000 }],
      propertyChanges: [
        {
          propertyId: 'home',
          acquisitionDepositDeltaCents: -3000000,
          valueDeltaCents: 30000000,
          mortgageId: 'mort',
          status: 'owned'
        }
      ],
      liabilityChanges: [{ liabilityId: 'mort', create: true, kind: 'mortgage', principalDeltaCents: 24000000 }],
      expectedNetWorthDeltaCents: 0
    });
    expect(completion.committed).toBe(true);

    const totals = state.getTotals();
    expect(totals.heldDepositCents).toBe(0);
    expect(totals.propertyValueCents).toBe(30000000);
    expect(totals.accountCents).toBe(4000000);
    expect(totals.liabilityCents).toBe(24000000);
    // Deposit counted once; net worth unchanged across the whole lifecycle.
    expect(totals.netWorthCents).toBe(10000000);
  });

  it('rejects completion that leaves an owned property holding a deposit', () => {
    const state = buildState(
      makeOpening({
        accounts: [openingAccount('checking', 100000)],
        properties: [openingProperty('home', 0)]
      })
    );
    apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -3000000 }],
      propertyChanges: [{ propertyId: 'home', acquisitionDepositDeltaCents: 3000000 }],
      expectedNetWorthDeltaCents: 0
    });

    const invalid = apply(state, {
      propertyChanges: [{ propertyId: 'home', status: 'owned' }],
      expectedNetWorthDeltaCents: 0
    });

    expect(invalid.committed).toBe(false);
    expect(invalid.errors.some((error) => error.code === 'deposit-with-owned-property')).toBe(true);
    expect(state.getProperty('home')?.status).toBe('pending');
    expect(state.getProperty('home')?.acquisitionDepositCents).toBe(3000000);
  });

  it('rejects a declared conservation mismatch without mutating', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 1000)] }));
    const result = apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -10000 }],
      expectedNetWorthDeltaCents: 0
    });

    expect(result.committed).toBe(false);
    expect(result.errors.some((error) => error.code === 'conservation-mismatch')).toBe(true);
    expect(state.getAccountBalanceCents('checking')).toBe(100000);
    expect(state.getRevision()).toBe(0);
  });

  it('advances the revision and recomputes a safe net-worth total for a declared spend', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 1000)] }));
    const before = state.getTotals();
    expect(Number.isSafeInteger(before.netWorthCents)).toBe(true);

    const result = apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -25000 }],
      expectedNetWorthDeltaCents: -25000
    });

    expect(result.committed).toBe(true);
    expect(result.revision).toBe(1);
    const after = state.getTotals();
    expect(after.netWorthCents).toBe(before.netWorthCents - 25000);
    expect(Number.isSafeInteger(after.netWorthCents)).toBe(true);
    expect(after.assetsCents - after.liabilityCents).toBe(after.netWorthCents);
  });
});

describe('commitChanges — posting journal contract (P4.1a / D15)', () => {
  it('never journals the opening observation as a posting', () => {
    const state = buildState(
      makeOpening({
        accounts: [openingAccount('checking', 500)],
        liabilities: [openingLiability('loan', 100)],
        properties: [openingProperty('home', 300)]
      })
    );

    expect(state.getPostings()).toHaveLength(0);
    expect(state.getPostingsByMonth('2026-01')).toHaveLength(0);
  });

  it('rejects a meaningful commit missing its posting with no mutation and no journal row', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 500)] }));
    const result = state.commitChanges({
      revision: state.getRevision(),
      accountChanges: [{ accountId: 'checking', deltaCents: -100 }],
      expectedNetWorthDeltaCents: -100
    });

    expect(result.committed).toBe(false);
    expect(result.errors[0].code).toBe('missing-posting');
    expect(state.getRevision()).toBe(0);
    expect(state.getAccountBalanceCents('checking')).toBe(50000);
    expect(state.getPostings()).toHaveLength(0);
  });

  it('rejects an invalid posting context (blank purpose / bad date / unknown phase) without mutating', () => {
    const invalid: PostingContext[] = [
      { purpose: '   ', date: '2026-01-15', phase: 'mandatory' },
      { purpose: 'spend', date: '2026-13-01', phase: 'mandatory' },
      { purpose: 'spend', date: '2026-01-15', phase: 'not-a-phase' as PostingContext['phase'] }
    ];

    for (const posting of invalid) {
      const state = buildState(makeOpening({ accounts: [openingAccount('checking', 500)] }));
      const result = state.commitChanges({
        revision: 0,
        posting,
        accountChanges: [{ accountId: 'checking', deltaCents: -100 }],
        expectedNetWorthDeltaCents: -100
      });

      expect(result.committed).toBe(false);
      expect(result.errors.some((error) => error.code === 'missing-posting')).toBe(true);
      expect(state.getRevision()).toBe(0);
      expect(state.getAccountBalanceCents('checking')).toBe(50000);
      expect(state.getPostings()).toHaveLength(0);
    }
  });

  it('accepts every frozen posting phase', () => {
    for (const phase of POSTING_PHASES) {
      const state = buildState(makeOpening({ accounts: [openingAccount('checking', 500)] }));
      const result = apply(state, {
        posting: { purpose: 'phase-check', date: '2026-01-15', phase },
        accountChanges: [{ accountId: 'checking', deltaCents: -100 }],
        expectedNetWorthDeltaCents: -100
      });

      expect(result.committed).toBe(true);
      expect(state.getPostings()[0]?.posting.phase).toBe(phase);
    }
  });

  it('treats an empty or all-zero-delta change set as a no-op (no revision bump, no journal row)', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 500)] }));

    const empty = state.commitChanges({ revision: state.getRevision() });
    expect(empty.committed).toBe(true);
    expect(empty.noop).toBe(true);
    expect(empty.revision).toBe(0);
    expect(empty.errors).toHaveLength(0);

    const zeroDelta = state.commitChanges({
      revision: state.getRevision(),
      accountChanges: [{ accountId: 'checking', deltaCents: 0 }]
    });
    expect(zeroDelta.committed).toBe(true);
    expect(zeroDelta.noop).toBe(true);
    expect(zeroDelta.revision).toBe(0);

    expect(state.getRevision()).toBe(0);
    expect(state.getAccountBalanceCents('checking')).toBe(50000);
    expect(state.getPostings()).toHaveLength(0);
  });

  it('rejects a stale revision and appends no posting', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 500)] }));
    const result = state.commitChanges({
      revision: 99,
      posting: POSTING,
      accountChanges: [{ accountId: 'checking', deltaCents: -100 }],
      expectedNetWorthDeltaCents: -100
    });

    expect(result.committed).toBe(false);
    expect(result.errors[0].code).toBe('stale-revision');
    expect(state.getRevision()).toBe(0);
    expect(state.getPostings()).toHaveLength(0);
  });

  it('rejects a conservation mismatch and appends no posting', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 1000)] }));
    const result = apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -10000 }],
      expectedNetWorthDeltaCents: 0
    });

    expect(result.committed).toBe(false);
    expect(result.errors.some((error) => error.code === 'conservation-mismatch')).toBe(true);
    expect(state.getRevision()).toBe(0);
    expect(state.getPostings()).toHaveLength(0);
  });

  it('appends exactly one record per commit with a stable sequence and post-commit revision', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 1000)] }));

    apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -10000 }],
      expectedNetWorthDeltaCents: -10000
    });
    apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -20000 }],
      expectedNetWorthDeltaCents: -20000
    });

    const trace = state.getPostings();
    expect(trace).toHaveLength(2);
    expect(trace.map((record) => record.sequence)).toEqual([0, 1]);
    expect(trace.map((record) => record.revision)).toEqual([1, 2]);
    expect(trace[0].accountChanges).toHaveLength(1);
    expect(trace[0].expectedNetWorthDeltaCents).toBe(-10000);
    expect(trace[0].posting).toEqual(POSTING);
    expect(state.getRevision()).toBe(2);
  });

  it('deep-freezes records so caller mutations after commit cannot rewrite the audit', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 500)] }));
    const accountChange = { accountId: 'checking', deltaCents: -100 };
    const posting: PostingContext = { purpose: 'audit', date: '2026-01-15', phase: 'income' };

    const result = state.commitChanges({
      revision: 0,
      posting,
      accountChanges: [accountChange],
      expectedNetWorthDeltaCents: -100
    });
    expect(result.committed).toBe(true);

    // Mutating caller-owned objects after commit must not touch the record.
    accountChange.deltaCents = -999999;
    (posting as { purpose: string; date: string }).purpose = 'rewritten';
    (posting as { purpose: string; date: string }).date = '1999-01-01';

    const record = state.getPostings()[0];
    expect(record.accountChanges[0].deltaCents).toBe(-100);
    expect(record.posting.purpose).toBe('audit');
    expect(record.posting.date).toBe('2026-01-15');

    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.posting)).toBe(true);
    expect(Object.isFrozen(record.accountChanges)).toBe(true);
    expect(Object.isFrozen(record.accountChanges[0])).toBe(true);

    const trace = state.getPostings();
    expect(Object.isFrozen(trace)).toBe(true);
    expect(() => {
      (trace as PostingRecord[]).push(record);
    }).toThrow();
  });

  it('indexes append-only by occurrence, definition, account and month (O(touched))', () => {
    const state = buildState(
      makeOpening({ accounts: [openingAccount('checking', 10000), openingAccount('savings', 10000)] })
    );

    // One commit touching two accounts in 2026-01 with an occurrence/definition.
    apply(state, {
      posting: {
        occurrenceId: 'occ:a',
        definitionId: 'def:a',
        purpose: 'split',
        date: '2026-01-15',
        phase: 'mandatory'
      },
      accountChanges: [
        { accountId: 'checking', deltaCents: -1000 },
        { accountId: 'savings', deltaCents: 1000 }
      ],
      expectedNetWorthDeltaCents: 0
    });

    // A second commit on a different account in a different month.
    apply(state, {
      posting: {
        occurrenceId: 'occ:b',
        definitionId: 'def:b',
        purpose: 'spend',
        date: '2026-02-20',
        phase: 'discretionary'
      },
      accountChanges: [{ accountId: 'checking', deltaCents: -500 }],
      expectedNetWorthDeltaCents: -500
    });

    expect(state.getPostingsByOccurrence('occ:a')).toHaveLength(1);
    expect(state.getPostingsByOccurrence('occ:b')).toHaveLength(1);
    expect(state.getPostingsByOccurrence('occ:missing')).toHaveLength(0);

    expect(state.getPostingsByDefinition('def:a')).toHaveLength(1);
    expect(state.getPostingsByDefinition('def:missing')).toHaveLength(0);

    // The split commit is indexed under both touched accounts.
    expect(state.getPostingsByAccount('savings')).toHaveLength(1);
    expect(state.getPostingsByAccount('checking')).toHaveLength(2);
    expect(state.getPostingsByAccount('ghost')).toHaveLength(0);

    expect(state.getPostingsByMonth('2026-01')).toHaveLength(1);
    expect(state.getPostingsByMonth('2026-02')).toHaveLength(1);
    expect(state.getPostingsByMonth('2026-03')).toHaveLength(0);

    expect(Object.isFrozen(state.getPostingsByAccount('checking'))).toBe(true);
    expect(Object.isFrozen(state.getPostingsByOccurrence('occ:a'))).toBe(true);
  });
});

describe('CA02 — sparse posting conservation (closing = opening + Σ posting deltas)', () => {
  it('reconciles every account close to its opening plus exactly-once posting deltas', () => {
    const state = buildState(
      makeOpening({ accounts: [openingAccount('checking', 1000), openingAccount('savings', 500)] })
    );
    const opening = {
      checking: state.getAccountBalanceCents('checking')!,
      savings: state.getAccountBalanceCents('savings')!
    };

    // Spend, then an internal transfer (net-zero conservation), then a deposit.
    apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -25000 }],
      expectedNetWorthDeltaCents: -25000
    });
    apply(state, {
      accountChanges: [
        { accountId: 'checking', deltaCents: -10000 },
        { accountId: 'savings', deltaCents: 10000 }
      ],
      expectedNetWorthDeltaCents: 0
    });
    apply(state, {
      accountChanges: [{ accountId: 'savings', deltaCents: 5000 }],
      expectedNetWorthDeltaCents: 5000
    });

    const trace = state.getPostings();
    expect(trace).toHaveLength(3);

    const deltaSum = (accountId: string): number =>
      trace.reduce(
        (sum, record) =>
          sum +
          record.accountChanges
            .filter((change) => change.accountId === accountId)
            .reduce((legSum, change) => legSum + change.deltaCents, 0),
        0
      );

    expect(opening.checking + deltaSum('checking')).toBe(state.getAccountBalanceCents('checking'));
    expect(opening.savings + deltaSum('savings')).toBe(state.getAccountBalanceCents('savings'));

    // Each committed record appears exactly once in the trace.
    expect(new Set(trace.map((record) => record.sequence)).size).toBe(trace.length);
    expect(trace.map((record) => record.sequence)).toEqual([0, 1, 2]);

    // Net-worth conservation: Σ declared deltas equals the total asset change.
    const declaredSum = trace.reduce((sum, record) => sum + record.expectedNetWorthDeltaCents, 0);
    const netWorthAfter = state.getTotals().netWorthCents;
    const netWorthOpening = (opening.checking + opening.savings);
    expect(netWorthOpening + declaredSum).toBe(netWorthAfter);
  });
});

describe('commitChanges — payroll posting facts (P4.2 / D15)', () => {
  const flowFacts = (over: Partial<PostingFlowFacts> = {}): PostingFlowFacts => ({
    grossEarningsCents: 10000,
    netPayCents: 7500,
    payrollTaxCents: 2000,
    otherDeductionsCents: 0,
    employeeRetirementCents: 0,
    employeeHsaCents: 0,
    employerRetirementCents: 0,
    employerHsaCents: 0,
    unresolvedEmployeeCents: 500,
    allocations: [],
    ...over
  });

  const payrollPosting = (facts: PostingFlowFacts): PostingContext => ({
    occurrenceId: 'income:career:test',
    definitionId: 'income:career:test',
    purpose: 'payroll',
    date: '2026-01-15',
    phase: 'income',
    facts
  });

  it('records the missing-destination example without mislabeling unresolved as net pay', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 0)] }));
    const facts = flowFacts(); // gross 10k, tax 2k, employee request 500 unresolved -> net 7500
    const result = apply(state, {
      posting: payrollPosting(facts),
      // Assets = netPay (7500) + unresolved (500) = 8000 — never netPay alone.
      accountChanges: [{ accountId: 'checking', deltaCents: 8000 }],
      expectedNetWorthDeltaCents: 8000
    });

    expect(result.committed).toBe(true);
    const record = state.getPostings()[0];
    expect(record.posting.facts).toEqual(facts);
    expect(record.posting.facts?.netPayCents).toBe(7500);
    expect(record.posting.facts?.unresolvedEmployeeCents).toBe(500);
    expect(state.getAccountBalanceCents('checking')).toBe(8000);
    expect(state.getTotals().netWorthCents).toBe(8000);
  });

  it('rejects facts that violate gross conservation as invalid-posting without mutation', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 0)] }));
    const result = apply(state, {
      posting: payrollPosting(flowFacts({ netPayCents: 8000 })),
      accountChanges: [{ accountId: 'checking', deltaCents: 8000 }],
      expectedNetWorthDeltaCents: 8000
    });

    expect(result.committed).toBe(false);
    expect(result.errors.some((error) => error.code === 'invalid-posting')).toBe(true);
    expect(state.getRevision()).toBe(0);
    expect(state.getAccountBalanceCents('checking')).toBe(0);
    expect(state.getPostings()).toHaveLength(0);
  });

  it('rejects negative, non-integer and unsafe fact amounts as invalid-posting', () => {
    const invalid: Partial<PostingFlowFacts>[] = [
      { grossEarningsCents: -1 },
      { payrollTaxCents: 1.5 },
      { netPayCents: Number.NaN },
      { unresolvedEmployeeCents: Number.MAX_SAFE_INTEGER + 1 }
    ];

    for (const over of invalid) {
      const state = buildState(makeOpening({ accounts: [openingAccount('checking', 0)] }));
      const result = apply(state, {
        posting: payrollPosting(flowFacts(over)),
        accountChanges: [{ accountId: 'checking', deltaCents: 8000 }],
        expectedNetWorthDeltaCents: 8000
      });

      expect(result.committed).toBe(false);
      expect(result.errors.some((error) => error.code === 'invalid-posting')).toBe(true);
      expect(state.getRevision()).toBe(0);
      expect(state.getPostings()).toHaveLength(0);
    }
  });

  it('rejects an executed allocation total above net pay', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 0)] }));
    const result = apply(state, {
      posting: payrollPosting(
        flowFacts({
          allocations: [{ lineId: 'line-1', accountId: 'checking', requestedCents: 8000, executedCents: 7600 }]
        })
      ),
      accountChanges: [{ accountId: 'checking', deltaCents: 8000 }],
      expectedNetWorthDeltaCents: 8000
    });

    expect(result.committed).toBe(false);
    expect(result.errors.some((error) => error.code === 'invalid-posting')).toBe(true);
    expect(state.getPostings()).toHaveLength(0);
  });

  it('rejects an allocation that executes more than it requests', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 0)] }));
    const result = apply(state, {
      posting: payrollPosting(
        flowFacts({
          allocations: [{ lineId: 'line-1', accountId: 'checking', requestedCents: 100, executedCents: 200 }]
        })
      ),
      accountChanges: [{ accountId: 'checking', deltaCents: 8000 }],
      expectedNetWorthDeltaCents: 8000
    });

    expect(result.committed).toBe(false);
    expect(result.errors.some((error) => error.code === 'invalid-posting')).toBe(true);
  });

  it('rejects a non-array allocations field', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 0)] }));
    const result = apply(state, {
      posting: payrollPosting(
        flowFacts({ allocations: null as unknown as PostingFlowFacts['allocations'] })
      ),
      accountChanges: [{ accountId: 'checking', deltaCents: 8000 }],
      expectedNetWorthDeltaCents: 8000
    });

    expect(result.committed).toBe(false);
    expect(result.errors.some((error) => error.code === 'invalid-posting')).toBe(true);
  });

  it('accepts oversubscribed requests whose executed total stays within net pay', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 0)] }));
    const facts = flowFacts({
      allocations: [
        { lineId: 'line-1', accountId: 'checking', requestedCents: 9000, executedCents: 7500 },
        { lineId: 'line-2', accountId: '', requestedCents: 100, executedCents: 0 }
      ]
    });
    const result = apply(state, {
      posting: payrollPosting(facts),
      accountChanges: [{ accountId: 'checking', deltaCents: 8000 }],
      expectedNetWorthDeltaCents: 8000
    });

    expect(result.committed).toBe(true);
    expect(state.getPostings()[0].posting.facts?.allocations).toHaveLength(2);
  });

  it('leaves facts absent on funding/accrual postings and requires nothing extra', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 500)] }));
    const result = apply(state, {
      posting: { purpose: 'debt-accrual', date: '2026-01-31', phase: 'accrual' },
      accountChanges: [{ accountId: 'checking', deltaCents: -100 }],
      expectedNetWorthDeltaCents: -100
    });

    expect(result.committed).toBe(true);
    expect(state.getPostings()[0].posting.facts).toBeUndefined();
  });

  it('deep-freezes facts and allocations so caller mutation cannot rewrite the audit', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 0)] }));
    const allocations = [
      { lineId: 'line-1', accountId: 'checking', requestedCents: 8000, executedCents: 7500 }
    ];
    const facts = flowFacts({ allocations });
    const result = apply(state, {
      posting: payrollPosting(facts),
      accountChanges: [{ accountId: 'checking', deltaCents: 8000 }],
      expectedNetWorthDeltaCents: 8000
    });
    expect(result.committed).toBe(true);

    // Mutate caller-owned structures after commit.
    (facts as { grossEarningsCents: number }).grossEarningsCents = 999;
    (facts as { unresolvedEmployeeCents: number }).unresolvedEmployeeCents = 0;
    allocations[0].executedCents = 1;
    allocations.push({ lineId: 'injected', accountId: 'x', requestedCents: 0, executedCents: 0 });

    const record = state.getPostings()[0];
    expect(record.posting.facts?.grossEarningsCents).toBe(10000);
    expect(record.posting.facts?.unresolvedEmployeeCents).toBe(500);
    expect(record.posting.facts?.allocations[0].executedCents).toBe(7500);
    expect(record.posting.facts?.allocations).toHaveLength(1);

    expect(Object.isFrozen(record.posting.facts)).toBe(true);
    expect(Object.isFrozen(record.posting.facts?.allocations)).toBe(true);
    expect(Object.isFrozen(record.posting.facts?.allocations[0])).toBe(true);
  });

  it('keeps a deposited employee contribution distinct from an unresolved one', () => {
    // Deposited: 500 leaves the remainder into the retirement account.
    const deposited = flowFacts({ employeeRetirementCents: 500, unresolvedEmployeeCents: 0 });
    // Unresolved: the same 500 is retained in the remainder (missing destination).
    const unresolved = flowFacts({ employeeRetirementCents: 0, unresolvedEmployeeCents: 500 });

    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 0)] }));
    apply(state, {
      posting: payrollPosting(deposited),
      accountChanges: [{ accountId: 'checking', deltaCents: 8000 }],
      expectedNetWorthDeltaCents: 8000
    });
    apply(state, {
      posting: payrollPosting(unresolved),
      accountChanges: [{ accountId: 'checking', deltaCents: 8000 }],
      expectedNetWorthDeltaCents: 8000
    });

    const [depositedRecord, unresolvedRecord] = state.getPostings();
    // Both conserve gross = 10000 with netPay 7500; the destination differs.
    expect(depositedRecord.posting.facts?.netPayCents).toBe(7500);
    expect(depositedRecord.posting.facts?.employeeRetirementCents).toBe(500);
    expect(depositedRecord.posting.facts?.unresolvedEmployeeCents).toBe(0);

    expect(unresolvedRecord.posting.facts?.netPayCents).toBe(7500);
    expect(unresolvedRecord.posting.facts?.employeeRetirementCents).toBe(0);
    expect(unresolvedRecord.posting.facts?.unresolvedEmployeeCents).toBe(500);
  });

  it('keeps employer deposits external to gross conservation', () => {
    const state = buildState(makeOpening({ accounts: [openingAccount('checking', 0)] }));
    const facts = flowFacts({ employerRetirementCents: 500 });
    const result = apply(state, {
      posting: payrollPosting(facts),
      accountChanges: [{ accountId: 'checking', deltaCents: 8500 }],
      expectedNetWorthDeltaCents: 8500
    });

    expect(result.committed).toBe(true);
    expect(state.getPostings()[0].posting.facts?.employerRetirementCents).toBe(500);
  });
});
