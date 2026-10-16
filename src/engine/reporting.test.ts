/**
 * P4.1 / P4.2 / P4.3 (R) — focused tests for `reporting.ts`.
 *
 * Proves the report is a read-only join over a frozen run: the committed audit
 * joins 1:1 to funding plans by occurrence, direct rows stay separate, an
 * uncommitted/zero-fund quote never fabricates a row, and each month reconciles
 * `opening + Σ committed deltas = closing` for accounts/liabilities/properties
 * (including the held acquisition deposit). Payroll facts are read from the
 * actual stamped posting, withdrawal tax comes only from committed
 * `FundingAllocation`, and annual groups sum actual months (never `last × 12`).
 *
 * P4.3 adds pure selectors: exact shortfall/exhaustion/fallback evidence (D16),
 * requested-vs-executed budgets by observed period kind, scheduled-vs-executed
 * counts, observed career boundaries, retirement-by-account, obligation
 * schedules with payoff states, and the CA12 named-context preview subset.
 */

import { describe, expect, it } from 'vitest';

import type { AccountDefinition, AccountWithdrawalPolicy, Scenario } from '../types';
import { createDefaultScenario } from '../defaultScenario';
import { commitFunding, quoteFunding } from './funding';
import type { PostingContext, PostingFlowFacts, PostingRecord } from './journal';
import type {
  FundingAllocation,
  FundingPlan,
  FundingStatus,
  SkippedFundingSource
} from './contracts';
import {
  projectScenario,
  type ProjectionEventHandler,
  type ProjectionFundingOutcome,
  type ProjectionHandlerFactory,
  type ProjectionRun
} from './projection';
import type { EventDefinition, EventExecutionContext } from './scheduler';
import { buildProjectionReport, REPORTING_SCHEMA_VERSION } from './reporting';

const CHECKING = 'checking-account-default';
const EMERGENCY = 'emergencyFund-account-default';
const INVESTMENTS = 'investments-account-default';
const RETIREMENT = 'retirement401k-account-default';

/** Fresh default scenario with zeroed accounts/careers, anchored to 2026-01-01. */
const scenario = (): Scenario => {
  const value = createDefaultScenario(new Date(2026, 0, 1));
  value.netWorth.asOfDate = '2026-01-01';
  value.netWorth.accounts = value.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  value.careerPlan = { enabled: false, entries: [] };
  return value;
};

const setAccount = (target: Scenario, accountId: string, patch: Partial<AccountDefinition>): void => {
  target.netWorth.accounts = target.netWorth.accounts.map((account) =>
    account.id === accountId ? { ...account, ...patch } : account
  );
};

const policy = (over: Partial<AccountWithdrawalPolicy> = {}): AccountWithdrawalPolicy => ({
  allowAutomaticFallback: true,
  withdrawalTaxRate: 0,
  penaltyRate: 0,
  restrictionNote: '',
  ...over
});

const event = (
  definitionId: string,
  date: string,
  targetCents: number,
  purpose = 'spend',
  phase: EventDefinition['phase'] = 'discretionary'
): EventDefinition => ({
  definitionId,
  phase,
  purpose,
  recurrence: { frequency: 'oneTime', startDate: date },
  handlerId: 'fund',
  resolveTarget: () => targetCents
});

const postingFor = (execution: EventExecutionContext, facts?: PostingFlowFacts): PostingContext => ({
  occurrenceId: execution.event.occurrenceId,
  definitionId: execution.event.definitionId,
  purpose: execution.event.purpose,
  date: execution.date,
  phase: execution.event.phase,
  ...(facts === undefined ? {} : { facts })
});

interface HandlerOptions {
  /** Destination for a direct `income` deposit. */
  readonly incomeAccountId?: string;
  /** Stamped payroll facts attached to every direct `income` posting. */
  readonly facts?: PostingFlowFacts;
}

/**
 * Handler seam mirroring the real streams: a direct `income` deposit (optionally
 * carrying stamped payroll facts) and a `quoteFunding`/`commitFunding` path for
 * every other purpose. Mutation only through `state.commitChanges`.
 */
const fundingHandler = (options: HandlerOptions = {}): ProjectionHandlerFactory => (): ProjectionEventHandler[] => [
  {
    handlerId: 'fund',
    execute({ execution, targetCents, deps }) {
      if (execution.event.purpose === 'income') {
        const accountId = options.incomeAccountId ?? CHECKING;
        const commit = deps.state.commitChanges({
          revision: deps.state.getRevision(),
          accountChanges: [{ accountId, deltaCents: targetCents }],
          expectedNetWorthDeltaCents: targetCents,
          posting: postingFor(execution, options.facts)
        });
        return { committed: commit.committed, plan: null, diagnostics: commit.errors.map((error) => error.message) };
      }
      const request = {
        id: execution.event.definitionId,
        occurrenceId: execution.event.occurrenceId,
        date: execution.date,
        requestedCents: targetCents,
        primaryAccountId: deps.funding.global.primaryAccountId,
        fallbackAccountIds: [...deps.funding.global.fallbackAccountIds],
        purpose: execution.event.purpose
      };
      const quoted = quoteFunding(deps.state, request, deps.accounts, deps.dateOfBirth, {
        globalDefaults: {
          primaryAccountId: deps.funding.global.primaryAccountId,
          fallbackAccountIds: [...deps.funding.global.fallbackAccountIds]
        }
      });
      if (!quoted.ok) {
        return { committed: false, plan: null, diagnostics: [quoted.diagnostic.message] };
      }
      const result = commitFunding(deps.state, quoted.plan, { posting: postingFor(execution) });
      return {
        committed: result.committed,
        plan: result.plan,
        quote: quoted,
        diagnostics: result.errors.map((error) => error.message)
      };
    }
  }
];

/**
 * Handler seam mirroring the App purchase/housing path: the request names **no**
 * source (its raw `primaryAccountId` stays `null`) and defers entirely to the
 * injected global funding policy. This is the exact provenance that made the
 * fallback selector label every drawn account as a fallback when reporting read
 * raw request provenance instead of the quote-time resolved order.
 */
const deferredFundingHandler = (): ProjectionHandlerFactory => (): ProjectionEventHandler[] => [
  {
    handlerId: 'fund',
    execute({ execution, targetCents, deps }) {
      const request = {
        id: execution.event.definitionId,
        occurrenceId: execution.event.occurrenceId,
        date: execution.date,
        requestedCents: targetCents,
        primaryAccountId: null,
        fallbackAccountIds: [] as string[],
        purpose: execution.event.purpose
      };
      const quoted = quoteFunding(deps.state, request, deps.accounts, deps.dateOfBirth, {
        globalDefaults: {
          primaryAccountId: deps.funding.global.primaryAccountId,
          fallbackAccountIds: [...deps.funding.global.fallbackAccountIds]
        }
      });
      if (!quoted.ok) {
        return { committed: false, plan: null, diagnostics: [quoted.diagnostic.message] };
      }
      const result = commitFunding(deps.state, quoted.plan, { posting: postingFor(execution) });
      return {
        committed: result.committed,
        plan: result.plan,
        quote: quoted,
        diagnostics: result.errors.map((error) => error.message)
      };
    }
  }
];

const deltaByAccount = (changes: readonly { accountId: string; deltaCents: number }[]): Map<string, number> =>
  new Map(changes.map((change) => [change.accountId, change.deltaCents]));

// ---------------------------------------------------------------------------
// P4.2 — CA02 opening + committed deltas reconciliation
// ---------------------------------------------------------------------------

describe('reporting — P4.2 account reconciliation (CA02)', () => {
  it('replays the opening observation plus committed deltas to each month close', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 1000 });
    const run = projectScenario(s, {
      horizonMonths: 3,
      events: [event('income', '2026-01-10', 50_000, 'income', 'income')],
      handlerFactory: fundingHandler()
    });
    const report = buildProjectionReport(run);

    const jan = report.months[0];
    const janChecking = jan.accounts.find((entry) => entry.accountId === CHECKING);
    expect(janChecking).toEqual({
      accountId: CHECKING,
      openingCents: 100_000,
      deltaCents: 50_000,
      closingCents: 150_000,
      reconciled: true
    });
    expect(jan.closing.netWorthCents).toBe(150_000);
    expect(jan.closing.assetsCents).toBe(150_000);
    expect(jan.closing.assetsCents).toBe(
      jan.closing.accountCents + jan.closing.propertyValueCents + jan.closing.heldDepositCents
    );
    expect(jan.reconciled).toBe(true);

    // The "opening" of every month is the run opening observation, so the
    // cumulative delta (not the prior close) reconciles the current snapshot.
    const febChecking = report.months[1].accounts.find((entry) => entry.accountId === CHECKING)!;
    expect(febChecking.openingCents).toBe(100_000);
    expect(febChecking.deltaCents).toBe(50_000);
    expect(febChecking.closingCents).toBe(150_000);
    expect(febChecking.reconciled).toBe(true);

    expect(report.accountCloses(CHECKING)).toHaveLength(3);
    expect(report.totals.opening.netWorthCents).toBe(100_000);
    expect(report.totals.closing.netWorthCents).toBe(150_000);
    expect(report.totals.openingReconciled).toBe(true);
    expect(report.totals.closingReconciled).toBe(true);
    expect(report.totals.reconciled).toBe(true);
    expect(report.diagnostics).toEqual([]);
  });

  it('reports a mismatch diagnostic instead of silently clamping', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 1000 });
    const run = projectScenario(s, {
      horizonMonths: 2,
      events: [event('income', '2026-01-10', 50_000, 'income', 'income')],
      handlerFactory: fundingHandler()
    });
    // Corrupt one close snapshot's account balance to force a reconciliation gap.
    const corrupted = {
      ...run,
      monthlyCloses: run.monthlyCloses.map((close, index) =>
        index === 0
          ? {
              ...close,
              snapshot: {
                ...close.snapshot,
                accounts: close.snapshot.accounts.map((account) =>
                  account.accountId === CHECKING ? { ...account, balanceCents: account.balanceCents + 1 } : account
                )
              }
            }
          : close
      )
    } as typeof run;

    const report = buildProjectionReport(corrupted);
    expect(report.months[0].reconciled).toBe(false);
    expect(report.diagnostics.some((message) => message.includes(`Account "${CHECKING}" does not reconcile`))).toBe(
      true
    );
  });
});

// ---------------------------------------------------------------------------
// P4.2 — held deposit / property / debt counted exactly once
// ---------------------------------------------------------------------------

describe('reporting — P4.2 property, held deposit and debt reconciliation', () => {
  const propertyHandler: ProjectionHandlerFactory = () => [
    {
      handlerId: 'fund',
      execute({ execution, targetCents, deps }) {
        if (execution.event.purpose === 'deposit') {
          const commit = deps.state.commitChanges({
            revision: deps.state.getRevision(),
            accountChanges: [{ accountId: CHECKING, deltaCents: -targetCents }],
            propertyChanges: [
              {
                propertyId: 'p1',
                create: true,
                status: 'pending',
                acquisitionDepositDeltaCents: targetCents
              }
            ],
            expectedNetWorthDeltaCents: 0,
            posting: postingFor(execution)
          });
          return { committed: commit.committed, plan: null, diagnostics: commit.errors.map((error) => error.message) };
        }
        if (execution.event.purpose === 'complete') {
          const commit = deps.state.commitChanges({
            revision: deps.state.getRevision(),
            propertyChanges: [
              {
                propertyId: 'p1',
                valueDeltaCents: 180_000,
                acquisitionDepositDeltaCents: -20_000,
                status: 'owned',
                mortgageId: 'm1'
              }
            ],
            liabilityChanges: [
              { liabilityId: 'm1', create: true, kind: 'mortgage', principalDeltaCents: 150_000 }
            ],
            expectedNetWorthDeltaCents: 180_000 - 20_000 - 150_000,
            posting: postingFor(execution)
          });
          return { committed: commit.committed, plan: null, diagnostics: commit.errors.map((error) => error.message) };
        }
        return { committed: false, plan: null };
      }
    }
  ];

  it('reconciles the held deposit, then property value and debt exactly once', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 500 });
    const run = projectScenario(s, {
      horizonMonths: 3,
      events: [
        event('deposit', '2026-01-05', 20_000, 'deposit', 'mandatory'),
        event('complete', '2026-02-05', 1, 'complete', 'mandatory')
      ],
      handlerFactory: propertyHandler
    });
    const report = buildProjectionReport(run);

    const jan = report.months[0];
    const janProperty = jan.properties.find((entry) => entry.propertyId === 'p1')!;
    expect(janProperty).toEqual({
      propertyId: 'p1',
      openingValueCents: 0,
      openingDepositCents: 0,
      valueDeltaCents: 0,
      depositDeltaCents: 20_000,
      closingValueCents: 0,
      closingDepositCents: 20_000,
      reconciled: true
    });
    // The held deposit is an asset counted exactly once (cash moved into it).
    expect(jan.closing.accountCents).toBe(30_000);
    expect(jan.closing.heldDepositCents).toBe(20_000);
    expect(jan.closing.assetsCents).toBe(50_000);
    expect(jan.closing.netWorthCents).toBe(50_000);

    const feb = report.months[1];
    const febProperty = feb.properties.find((entry) => entry.propertyId === 'p1')!;
    expect(febProperty.closingValueCents).toBe(180_000);
    expect(febProperty.closingDepositCents).toBe(0);
    expect(febProperty.reconciled).toBe(true);
    const febLiability = feb.liabilities.find((entry) => entry.liabilityId === 'm1')!;
    expect(febLiability.closingPrincipalCents).toBe(150_000);
    expect(febLiability.principalDeltaCents).toBe(150_000);
    expect(febLiability.reconciled).toBe(true);
    expect(feb.closing.assetsCents).toBe(210_000);
    expect(feb.closing.liabilityCents).toBe(150_000);
    expect(feb.closing.netWorthCents).toBe(60_000);
    expect(feb.reconciled).toBe(true);

    expect(report.propertyCloses('p1')).toHaveLength(3);
    expect(report.liabilityCloses('m1')).toHaveLength(2);
    expect(report.diagnostics).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// P4.2 — signed (underwater) net worth
// ---------------------------------------------------------------------------

describe('reporting — P4.2 signed net worth', () => {
  it('keeps net worth signed when liabilities exceed assets', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    const borrowHandler: ProjectionHandlerFactory = () => [
      {
        handlerId: 'fund',
        execute({ execution, deps }) {
          const commit = deps.state.commitChanges({
            revision: deps.state.getRevision(),
            accountChanges: [{ accountId: CHECKING, deltaCents: 50_000 }],
            liabilityChanges: [
              { liabilityId: 'd1', create: true, kind: 'loan', principalDeltaCents: 200_000 }
            ],
            expectedNetWorthDeltaCents: 50_000 - 200_000,
            posting: postingFor(execution)
          });
          return { committed: commit.committed, plan: null, diagnostics: commit.errors.map((error) => error.message) };
        }
      }
    ];
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event('borrow', '2026-01-05', 1, 'borrow', 'mandatory')],
      handlerFactory: borrowHandler
    });
    const report = buildProjectionReport(run);

    expect(report.months[0].closing.accountCents).toBe(60_000);
    expect(report.months[0].closing.liabilityCents).toBe(200_000);
    expect(report.months[0].closing.netWorthCents).toBe(-140_000);
    expect(report.totals.closing.netWorthCents).toBe(-140_000);
    expect(report.years[0].closing.netWorthCents).toBe(-140_000);
    expect(report.months[0].reconciled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P4.1 — payroll facts vs withdrawal tax; audit join and unfunded quotes
// ---------------------------------------------------------------------------

describe('reporting — P4.1 payroll facts and withdrawal withholding', () => {
  it('reads actual payroll gross/net facts and never folds payroll tax into withdrawal tax', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 0 });
    setAccount(s, RETIREMENT, {
      openingBalance: 100,
      withdrawalPolicy: policy({ withdrawalTaxRate: 20, penaltyRate: 10 })
    });
    s.fundingPolicy = { primaryAccountId: RETIREMENT, fallbackAccountIds: [] };

    // gross 10000 = net 7500 + tax 2000 + unresolved 500 (missing employee destination).
    const facts: PostingFlowFacts = {
      grossEarningsCents: 1_000_000,
      netPayCents: 750_000,
      payrollTaxCents: 200_000,
      otherDeductionsCents: 0,
      employeeRetirementCents: 0,
      employeeHsaCents: 0,
      employerRetirementCents: 0,
      employerHsaCents: 0,
      unresolvedEmployeeCents: 50_000,
      allocations: []
    };
    const run = projectScenario(s, {
      horizonMonths: 2,
      events: [
        event('income', '2026-01-10', 800_000, 'income', 'income'),
        event('retirement', '2026-02-10', 5_000, 'retirement', 'mandatory')
      ],
      handlerFactory: fundingHandler({ facts })
    });
    const report = buildProjectionReport(run);

    // Actual stamped payroll facts surface verbatim on the month flow.
    const jan = report.months[0].flow;
    expect(jan.grossEarningsCents).toBe(1_000_000);
    expect(jan.netPayCents).toBe(750_000);
    expect(jan.payrollTaxCents).toBe(200_000);
    expect(jan.unresolvedEmployeeCents).toBe(50_000);
    expect(jan.withdrawalTaxCents).toBe(0);

    // A commitment in February carries/keeps payroll facts absent.
    expect(report.months[1].flow.payrollTaxCents).toBe(0);

    // Withdrawal tax/penalty come only from the committed FundingAllocation.
    expect(report.fundingRows).toHaveLength(1);
    const plan = report.fundingRows[0].plan!;
    expect(plan.taxCents).toBeGreaterThan(0);
    expect(plan.penaltyCents).toBeGreaterThan(0);
    const feb = report.months[1].flow;
    expect(feb.withdrawalTaxCents).toBe(plan.taxCents);
    expect(feb.withdrawalPenaltyCents).toBe(plan.penaltyCents);
    expect(feb.withdrawalTaxCents).not.toBe(jan.payrollTaxCents);
    // Payroll tax is never added into the withdrawal tax leg.
    expect(report.directRows).toHaveLength(1);
    expect(report.directRows[0].withdrawalTaxCents).toBe(0);

    // The committed plan joins 1:1 to its posting; the direct payroll row stays separate.
    const joined = report.byOccurrence(plan.occurrenceId);
    expect(joined).toHaveLength(1);
    expect(joined[0].kind).toBe('funding');
    expect(joined[0].plan).toBe(plan);
    expect(report.byFundingSource(RETIREMENT)).toHaveLength(1);
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0].committed).toBe(true);
    expect(report.outcomes[0].row).toBe(report.fundingRows[0]);
    expect(report.diagnostics).toEqual([]);
  });

  it('records a partial zero-fund quote as requested spend with no fabricated row', () => {
    const s = scenario();
    s.fundingPolicy = { primaryAccountId: 'missing-account', fallbackAccountIds: [] };
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event('spend', '2026-01-15', 10_000)],
      handlerFactory: fundingHandler()
    });
    const report = buildProjectionReport(run);

    expect(report.audit).toHaveLength(0);
    expect(report.directRows).toHaveLength(0);
    expect(report.fundingRows).toHaveLength(0);
    expect(report.outcomes).toHaveLength(1);
    const [outcome] = report.outcomes;
    expect(outcome.committed).toBe(false);
    expect(outcome.requestedCents).toBe(10_000);
    expect(outcome.executedCents).toBe(0);
    expect(outcome.shortfallCents).toBe(10_000);
    expect(outcome.row).toBeNull();

    const flow = report.months[0].flow;
    expect(flow.requestedSpendingCents).toBe(10_000);
    expect(flow.executedSpendingCents).toBe(0);
    expect(flow.shortfallCents).toBe(10_000);
    expect(flow.postingCount).toBe(0);
  });

  it('does not double count a committed quote and its plan', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event('spend', '2026-01-15', 25_000)],
      handlerFactory: fundingHandler()
    });
    const report = buildProjectionReport(run);

    // Partial plan: requested 25000, executed 10000 (only $100 was available).
    expect(report.fundingRows).toHaveLength(1);
    expect(report.outcomes).toHaveLength(1);
    expect(report.outcomes[0].committed).toBe(true);
    const flow = report.months[0].flow;
    expect(flow.requestedSpendingCents).toBe(25_000);
    expect(flow.executedSpendingCents).toBe(10_000);
    expect(flow.shortfallCents).toBe(15_000);
  });
});

// ---------------------------------------------------------------------------
// P4.2 — annual grouping over actual months
// ---------------------------------------------------------------------------

describe('reporting — P4.2 annual grouping', () => {
  it('sums actual months and never multiplies the last month by twelve', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 0 });
    const monthNames = ['2026-01-10', '2026-02-10', '2026-03-10', '2026-04-10', '2026-05-10'];
    const run = projectScenario(s, {
      horizonMonths: 5,
      events: monthNames.map((date, index) => event(`income-${index}`, date, 10_000, 'income', 'income')),
      handlerFactory: fundingHandler()
    });
    const report = buildProjectionReport(run);

    expect(report.years).toHaveLength(1);
    const year = report.years[0];
    expect(year.kind).toBe('calendarYear');
    expect(year.label).toBe('2026');
    expect(year.monthCount).toBe(5);
    expect(year.partial).toBe(true);
    expect(year.flow.netWorthDeltaCents).toBe(50_000);

    const summed = report.months.reduce((total, month) => total + month.flow.netWorthDeltaCents, 0);
    expect(year.flow.netWorthDeltaCents).toBe(summed);
    const lastMonthAnnualised = report.months[4].flow.netWorthDeltaCents * 12;
    expect(year.flow.netWorthDeltaCents).not.toBe(lastMonthAnnualised);
    expect(lastMonthAnnualised).toBe(120_000);

    // Stocks are the first opening and last closing — never a sum.
    expect(year.opening.netWorthCents).toBe(report.months[0].opening.netWorthCents);
    expect(year.closing.netWorthCents).toBe(report.months[4].closing.netWorthCents);
  });

  it('emits separately labeled age groups only with a reliable anchor', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 1000 });
    const run = projectScenario(s, { horizonMonths: 24 });
    const withoutAnchor = buildProjectionReport(run);
    expect(withoutAnchor.ageGroups).toBeUndefined();

    const withAnchor = buildProjectionReport(run, { dateOfBirth: '1986-06-15' });
    expect(withAnchor.ageGroups).toBeDefined();
    expect(withAnchor.ageGroups!.length).toBeGreaterThan(0);
    expect(withAnchor.ageGroups!.every((group) => group.kind === 'age')).toBe(true);
    expect(withAnchor.ageGroups!.every((group) => group.label.startsWith('Age '))).toBe(true);
    expect(withAnchor.ageGroups!.reduce((total, group) => total + group.monthCount, 0)).toBe(24);

    const invalid = buildProjectionReport(run, { dateOfBirth: 'not-a-date' });
    expect(invalid.ageGroups).toBeUndefined();
    expect(invalid.diagnostics.some((message) => message.includes('not a valid YYYY-MM-DD'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P4.1 — determinism, stable indexes and the 960-month fixture
// ---------------------------------------------------------------------------

describe('reporting — P4.1 indexes, immutability and the 960-month fixture', () => {
  it('builds a deterministic, frozen report with stable O(1) indexes for 960 months', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 10_000, annualReturnRate: 6.5 });
    const run = projectScenario(s, { horizonMonths: 960 });
    expect(run.monthlyCloses).toHaveLength(960);

    const report = buildProjectionReport(run);
    expect(report.schemaVersion).toBe(REPORTING_SCHEMA_VERSION);
    expect(report.months).toHaveLength(960);
    expect(report.years).toHaveLength(80);
    expect(report.postingCount).toBe(run.postings.length);
    expect(report.audit).toHaveLength(run.postings.length);
    // Every committed posting fell inside a month close, and every month-close
    // valuation posting is stamped with that close's month/date.
    expect(report.reconciledPostingCount).toBe(report.postingCount);
    const closeDates = new Set(report.months.map((month) => month.closingDate));
    const valuationRows = report.byPurpose('valuation');
    expect(valuationRows).toHaveLength(960);
    expect(valuationRows.every((row) => closeDates.has(row.date))).toBe(true);
    expect(valuationRows.every((row, index) => row.yearMonth === report.months[index].yearMonth)).toBe(true);

    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.audit)).toBe(true);
    expect(Object.isFrozen(report.months)).toBe(true);
    expect(Object.isFrozen(report.months[0])).toBe(true);
    expect(Object.isFrozen(report.months[0].accounts)).toBe(true);
    expect(Object.isFrozen(report.years)).toBe(true);
    expect(Object.isFrozen(report.metadata)).toBe(true);

    // Stable, pre-built indexes: a repeated query returns the same frozen array
    // (no per-query global clone) and results are frozen.
    const january = report.byMonth('2026-01');
    expect(january.length).toBe(1);
    expect(report.byMonth('2026-01')).toBe(january);
    expect(Object.isFrozen(january)).toBe(true);
    expect(report.byPurpose('valuation')).toHaveLength(960);
    expect(report.byAccount(CHECKING)).toHaveLength(960);
    expect(report.accountCloses(CHECKING)).toHaveLength(960);
    expect(report.byFundingSource(CHECKING)).toHaveLength(0);

    const window = report.byDateWindow('2026-01-01', '2026-01-31');
    expect(window).toHaveLength(1);
    expect(window[0].purpose).toBe('valuation');
    expect(report.byOccurrence('does-not-exist')).toBe(report.byMonth('1999-01'));

    expect(report.totals.monthCount).toBe(960);
    expect(report.totals.reconciled).toBe(true);
    expect(report.diagnostics).toEqual([]);

    // Deterministic: two builds over the same run are byte-identical (methods
    // are omitted by JSON, so only the data is compared).
    expect(JSON.stringify(buildProjectionReport(run))).toBe(JSON.stringify(buildProjectionReport(run)));
  });

  it('exposes the audit delta amounts verbatim from the journal', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 1000, annualReturnRate: 6.5 });
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event('income', '2026-01-10', 50_000, 'income', 'income')],
      handlerFactory: fundingHandler()
    });
    const report = buildProjectionReport(run);

    const direct = report.directRows.find((row) => row.purpose === 'income')!;
    expect(deltaByAccount(direct.accountChanges).get(CHECKING)).toBe(50_000);
    expect(direct.expectedNetWorthDeltaCents).toBe(50_000);
    const valuation = report.directRows.find((row) => row.purpose === 'valuation')!;
    expect(valuation.phase).toBe('close');
    expect(valuation.yearMonth).toBe('2026-01');
  });
});

// ---------------------------------------------------------------------------
// P4.3 helpers — synthetic funding outcomes for precise selector evidence
// ---------------------------------------------------------------------------

const recurringEvent = (
  definitionId: string,
  recurrence: EventDefinition["recurrence"],
  targetCents: number,
  purpose = "spend",
  phase: EventDefinition["phase"] = "discretionary"
): EventDefinition => ({
  definitionId,
  phase,
  purpose,
  recurrence,
  handlerId: "fund",
  resolveTarget: () => targetCents
});

interface SyntheticOutcomeOptions {
  readonly occurrenceId: string;
  readonly requestedCents: number;
  readonly definitionId?: string;
  readonly purpose?: string;
  readonly date?: string;
  readonly committed?: boolean;
  readonly executedCents?: number;
  readonly status?: FundingStatus;
  readonly primaryAccountId?: string | null;
  readonly allocations?: readonly FundingAllocation[];
  readonly eligibleAccountIds?: readonly string[];
  readonly resolvedSourceOrder?: readonly string[];
  readonly eligibleSources?: readonly { readonly accountId: string; readonly balanceCents: number }[];
  readonly quotaLimited?: boolean;
  readonly skippedSources?: readonly SkippedFundingSource[];
}

const syntheticOutcome = (options: SyntheticOutcomeOptions): ProjectionFundingOutcome => {
  const date = options.date ?? "2026-01-15";
  const allocations = [...(options.allocations ?? [])];
  const executedCents =
    options.executedCents ?? allocations.reduce((total, allocation) => total + allocation.netFundedCents, 0);
  const eligibleSources = (options.eligibleSources ?? []).map((source) =>
    Object.freeze({ accountId: source.accountId, balanceCents: source.balanceCents })
  );
  const plan: FundingPlan = {
    stateRevision: 0,
    request: {
      id: options.definitionId ?? options.occurrenceId,
      occurrenceId: options.occurrenceId,
      date,
      requestedCents: options.requestedCents,
      primaryAccountId: options.primaryAccountId ?? null,
      fallbackAccountIds: [],
      purpose: options.purpose ?? "test"
    },
    allocations,
    eligibleAccountIds: [...(options.eligibleAccountIds ?? eligibleSources.map((source) => source.accountId))],
    resolvedSourceOrder: [...(options.resolvedSourceOrder ?? [])],
    skippedSources: [...(options.skippedSources ?? [])],
    quotaLimited: options.quotaLimited ?? false,
    feasibleCents: executedCents,
    executedCents,
    shortfallCents: Math.max(0, options.requestedCents - executedCents),
    status:
      options.status ??
      (executedCents >= options.requestedCents ? "funded" : executedCents > 0 ? "partial" : "unfunded")
  };
  return Object.freeze({
    occurrenceId: options.occurrenceId,
    definitionId: options.definitionId ?? options.occurrenceId,
    handlerId: null,
    yearMonth: date.slice(0, 7),
    date,
    phase: "mandatory" as const,
    committed: options.committed ?? false,
    plan,
    eligibleSources: Object.freeze(eligibleSources),
    quotaLimited: plan.quotaLimited,
    skippedSources: Object.freeze([...plan.skippedSources])
  }) as ProjectionFundingOutcome;
};

const baseEmptyRun = (): ProjectionRun => projectScenario(scenario(), { horizonMonths: 1 });

const runWithOutcomes = (outcomes: readonly ProjectionFundingOutcome[]): ProjectionRun =>
  ({ ...baseEmptyRun(), fundingOutcomes: Object.freeze([...outcomes]) }) as ProjectionRun;

// ---------------------------------------------------------------------------
// P4.3 — shortfall, exhaustion and fallback (D16)
// ---------------------------------------------------------------------------

describe("reporting — P4.3 shortfall, exhaustion and fallback (D16)", () => {
  it("emits the exact shortfall warning for a zero-fund and a partial plan", () => {
    const zero = scenario();
    zero.fundingPolicy = { primaryAccountId: "missing-account", fallbackAccountIds: [] };
    const zeroRun = projectScenario(zero, {
      horizonMonths: 1,
      events: [event("spend", "2026-01-15", 10_000)],
      handlerFactory: fundingHandler()
    });
    const zeroReport = buildProjectionReport(zeroRun);
    expect(zeroReport.shortfall.firstShortfallMonth).toBe("2026-01");
    expect(zeroReport.shortfall.warning).toBe(
      "Some scheduled payments could not be fully funded, beginning in 2026-01."
    );
    expect(zeroReport.shortfall.totalShortfallCents).toBe(10_000);

    const partial = scenario();
    setAccount(partial, CHECKING, { openingBalance: 100 });
    partial.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const partialRun = projectScenario(partial, {
      horizonMonths: 2,
      events: [event("spend", "2026-02-15", 25_000)],
      handlerFactory: fundingHandler()
    });
    const partialReport = buildProjectionReport(partialRun);
    expect(partialReport.shortfall.warning).toBe(
      "Some scheduled payments could not be fully funded, beginning in 2026-02."
    );
    expect(partialReport.shortfall.totalShortfallCents).toBe(15_000);
  });

  it("fires eligible exhaustion only for a pure zero-balance shortfall", () => {
    const pure = scenario();
    pure.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const pureRun = projectScenario(pure, {
      horizonMonths: 1,
      events: [event("spend", "2026-01-15", 10_000)],
      handlerFactory: fundingHandler()
    });
    const pureReport = buildProjectionReport(pureRun);
    expect(pureReport.exhaustion.exhausted).toBe(true);
    expect(pureReport.exhaustion.firstExhaustedMonth).toBe("2026-01");
    expect(pureReport.exhaustion.warning).toBe("eligible funding accounts exhausted");

    const unknown = scenario();
    unknown.fundingPolicy = { primaryAccountId: "missing-account", fallbackAccountIds: [] };
    const unknownRun = projectScenario(unknown, {
      horizonMonths: 1,
      events: [event("spend", "2026-01-15", 10_000)],
      handlerFactory: fundingHandler()
    });
    expect(buildProjectionReport(unknownRun).exhaustion.exhausted).toBe(false);
    expect(buildProjectionReport(unknownRun).exhaustion.warning).toBeNull();
  });

  it("never reports quota, ineligible or unsupported shortfalls as exhaustion", () => {
    const cases: readonly SyntheticOutcomeOptions[] = [
      {
        occurrenceId: "spend:quota:2026-01-15",
        requestedCents: 10_000,
        primaryAccountId: "r",
        quotaLimited: true,
        eligibleSources: [{ accountId: "r", balanceCents: 0 }],
        skippedSources: [{ accountId: "r", reason: "quota-limited", message: "zero quota" }]
      },
      {
        occurrenceId: "spend:ineligible:2026-01-15",
        requestedCents: 10_000,
        eligibleSources: [],
        skippedSources: [{ accountId: "r", reason: "ineligible-account", message: "restricted" }]
      },
      {
        occurrenceId: "spend:fallback-disabled:2026-01-15",
        requestedCents: 10_000,
        eligibleSources: [{ accountId: "c", balanceCents: 500 }],
        skippedSources: [{ accountId: "e", reason: "automatic-fallback-disabled", message: "fallback disabled" }]
      },
      {
        occurrenceId: "spend:unsupported:2026-01-15",
        requestedCents: 10_000,
        eligibleSources: [],
        skippedSources: [{ accountId: "r", reason: "unsupported-tax-range", message: "unsupported" }]
      }
    ];
    for (const options of cases) {
      const report = buildProjectionReport(runWithOutcomes([syntheticOutcome(options)]));
      expect(report.exhaustion.exhausted).toBe(false);
      expect(report.shortfall.warning).not.toBeNull();
    }
  });

  it("stays conservative: a month mixed with a policy shortfall is excluded from exhaustion", () => {
    const report = buildProjectionReport(
      runWithOutcomes([
        syntheticOutcome({
          occurrenceId: "spend:pure:2026-01-15",
          requestedCents: 10_000,
          eligibleSources: [{ accountId: "a", balanceCents: 0 }]
        }),
        syntheticOutcome({
          occurrenceId: "spend:policy:2026-01-20",
          requestedCents: 10_000,
          eligibleSources: [],
          skippedSources: [{ accountId: "b", reason: "ineligible-account", message: "restricted" }]
        }),
        syntheticOutcome({
          occurrenceId: "spend:pure2:2026-02-15",
          date: "2026-02-15",
          requestedCents: 10_000,
          eligibleSources: [{ accountId: "a", balanceCents: 0 }]
        })
      ])
    );
    // January mixes a pure and a policy shortfall → not exhaustion. February is
    // all-pure → exhaustion. The monthly predicate is all-short-pure (D16).
    expect(report.exhaustion.exhausted).toBe(true);
    expect(report.exhaustion.months).toEqual(["2026-02"]);
  });

  it("reports fallback use as a separate low-severity signal even when fully funded", () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    setAccount(s, EMERGENCY, { openingBalance: 200 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [EMERGENCY] };
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event("spend", "2026-01-15", 25_000)],
      handlerFactory: fundingHandler()
    });
    const report = buildProjectionReport(run);

    expect(report.shortfall.warning).toBeNull();
    expect(report.fallback.used).toBe(true);
    expect(report.fallback.severity).toBe("low");
    expect(report.fallback.occurrences).toHaveLength(1);
    expect(report.fallback.occurrences[0].primaryAccountId).toBe(CHECKING);
    expect(report.fallback.occurrences[0].fallbackAccountIds).toEqual([EMERGENCY]);
    expect(report.fallback.occurrences[0].executedCents).toBe(25_000);
  });

  it('reports no fallback when a global-default request draws only from the resolved primary', () => {
    // Regression for the provenance bug: the request's raw primary is `null`
    // (it defers to the global policy), so the old selector labelled every drawn
    // account as a fallback. The quote-time resolved order names the true
    // primary (CHECKING) and there is no secondary draw.
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 1000 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event("spend", "2026-01-15", 5_000)],
      handlerFactory: deferredFundingHandler()
    });
    const report = buildProjectionReport(run);

    expect(report.outcomes).toHaveLength(1);
    const plan = report.outcomes[0].plan;
    // Provenance is preserved verbatim, and the resolved order is propagated.
    expect(plan.request.primaryAccountId).toBeNull();
    expect(plan.resolvedSourceOrder).toEqual([CHECKING]);
    expect(plan.allocations.map((allocation) => allocation.accountId)).toEqual([CHECKING]);

    expect(report.fallback.used).toBe(false);
    expect(report.fallback.severity).toBe("none");
    expect(report.fallback.occurrences).toEqual([]);
  });

  it('names the resolved primary and only the two actually drawn secondaries for a global-default request', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    setAccount(s, EMERGENCY, { openingBalance: 60 });
    // A taxable account would withhold capital-gains tax from the draw; zero the
    // rate so the executed cents match the requested draw exactly.
    setAccount(s, INVESTMENTS, { openingBalance: 40, capitalGainsTaxRate: 0 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [EMERGENCY, INVESTMENTS] };
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event("spend", "2026-01-15", 20_000)],
      handlerFactory: deferredFundingHandler()
    });
    const report = buildProjectionReport(run);

    expect(report.fallback.used).toBe(true);
    expect(report.fallback.occurrences).toHaveLength(1);
    const occurrence = report.fallback.occurrences[0];
    // The quote-time resolved order supplies the primary even though the raw
    // request primary is null; only the two secondaries beyond it are listed.
    expect(occurrence.primaryAccountId).toBe(CHECKING);
    expect(occurrence.fallbackAccountIds).toEqual([EMERGENCY, INVESTMENTS]);
    expect(occurrence.requestedCents).toBe(20_000);
    expect(occurrence.executedCents).toBe(20_000);
  });

  it('still marks a drawn secondary as fallback when the configured primary is missing', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 500 });
    s.fundingPolicy = { primaryAccountId: "missing-account", fallbackAccountIds: [CHECKING] };
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event("spend", "2026-01-15", 10_000)],
      handlerFactory: deferredFundingHandler()
    });
    const report = buildProjectionReport(run);

    expect(report.fallback.occurrences).toHaveLength(1);
    const occurrence = report.fallback.occurrences[0];
    // `eligibleAccountIds` excludes the invalid primary; the primary identity
    // must still come from the resolved order, never `eligibleAccountIds[0]`.
    expect(occurrence.primaryAccountId).toBe("missing-account");
    expect(occurrence.fallbackAccountIds).toEqual([CHECKING]);
  });

  it('never reports an uncommitted quote as a fallback even when allocations were drawn', () => {
    const report = buildProjectionReport(
      runWithOutcomes([
        syntheticOutcome({
          occurrenceId: "spend:uncommitted:2026-01-15",
          requestedCents: 10_000,
          committed: false,
          primaryAccountId: "ghost",
          resolvedSourceOrder: ["ghost", "emergency"],
          allocations: [
            {
              accountId: "emergency",
              grossDebitCents: 10_000,
              netFundedCents: 10_000,
              withheldTaxCents: 0,
              penaltyCents: 0
            }
          ]
        })
      ])
    );

    expect(report.fallback.used).toBe(false);
    expect(report.fallback.occurrences).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// P4.3 — budgets, occurrences, careers, schedules and CA12 previews
// ---------------------------------------------------------------------------

describe("reporting — P4.3 budgets, occurrences, careers, schedules and previews", () => {
  it("groups requested-vs-executed budget by observed period kind without changing annual flows", () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 1_000_000 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const run = projectScenario(s, {
      horizonMonths: 36,
      events: [
        recurringEvent(
          "monthly-spend",
          { frequency: "monthly", startDate: "2026-01-10", endDate: "2026-03-10" },
          1_000
        ),
        recurringEvent(
          "annual-spend",
          { frequency: "annual", startDate: "2026-01-05", endDate: "2028-01-05" },
          5_000
        )
      ],
      handlerFactory: fundingHandler()
    });
    const report = buildProjectionReport(run);

    const monthly = report.budgets.byPeriodKind.find((group) => group.periodKind === "monthly")!;
    expect(monthly.requestedCents).toBe(3_000);
    expect(monthly.executedCents).toBe(3_000);
    const yearly = report.budgets.byPeriodKind.find((group) => group.periodKind === "yearly")!;
    expect(yearly.requestedCents).toBe(15_000);
    expect(yearly.executedCents).toBe(15_000);
    expect(report.budgets.lines.find((line) => line.definitionId === "monthly-spend")!.periodKind).toBe("monthly");
    expect(report.budgets.lines.find((line) => line.definitionId === "monthly-spend")!.periodKindReliable).toBe(true);
    expect(report.budgets.lines.find((line) => line.definitionId === "annual-spend")!.periodKind).toBe("yearly");
    expect(report.budgets.lines.find((line) => line.definitionId === "annual-spend")!.periodKindReliable).toBe(true);

    expect(report.occurrences.scheduledTotal).toBe(6);
    expect(report.occurrences.executedTotal).toBe(6);
    expect(report.occurrences.unexecutedTotal).toBe(0);

    // P4.2 annual flows are unchanged by the P4.3 selectors.
    const monthSum = report.months.reduce((total, month) => total + month.flow.netWorthDeltaCents, 0);
    const yearSum = report.years.reduce((total, year) => total + year.flow.netWorthDeltaCents, 0);
    expect(yearSum).toBe(monthSum);
    expect(report.years[0].flow.netWorthDeltaCents).toBe(-8_000);
  });

  it("derives career boundaries from actual payroll postings", () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 0 });
    const run = projectScenario(s, {
      horizonMonths: 3,
      events: [
        recurringEvent(
          "income:career-1",
          { frequency: "monthly", startDate: "2026-01-05", endDate: "2026-03-05" },
          5_000,
          "income",
          "income"
        )
      ],
      handlerFactory: fundingHandler()
    });
    const report = buildProjectionReport(run);
    expect(report.careers).toHaveLength(1);
    expect(report.careers[0]).toEqual({
      careerId: "career-1",
      definitionId: "income:career-1",
      firstYearMonth: "2026-01",
      lastYearMonth: "2026-03",
      postingCount: 3,
      source: "observed-income-posting"
    });
  });

  it("attributes retirement withdrawals per source account and selects schedules from actual postings", () => {
    const s = scenario();
    setAccount(s, RETIREMENT, {
      openingBalance: 1000,
      withdrawalPolicy: policy({ withdrawalTaxRate: 20, penaltyRate: 10 })
    });
    s.fundingPolicy = { primaryAccountId: RETIREMENT, fallbackAccountIds: [] };
    const run = projectScenario(s, {
      horizonMonths: 2,
      events: [event("retirement", "2026-02-10", 5_000, "retirement", "mandatory")],
      handlerFactory: fundingHandler()
    });
    const report = buildProjectionReport(run);

    expect(report.retirement.totalExecutedCents).toBe(5_000);
    expect(report.retirement.totalShortfallCents).toBe(0);
    const account = report.retirement.byAccount.find((entry) => entry.accountId === RETIREMENT)!;
    expect(account.executedCents).toBe(5_000);
    expect(account.taxCents).toBeGreaterThan(0);
    expect(account.penaltyCents).toBeGreaterThan(0);
    expect(account.months).toEqual(["2026-02"]);

    const schedule = report.schedules.find((entry) => entry.definitionId === "retirement")!;
    expect(schedule.kind).toBe("retirement");
    expect(schedule.requestedCents).toBe(5_000);
    expect(schedule.executedCents).toBe(5_000);
    expect(schedule.committedCount).toBe(1);
  });

  it("exposes revision/date-keyed actual-funded previews with a default signed net worth", () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    const borrowHandler: ProjectionHandlerFactory = () => [
      {
        handlerId: "fund",
        execute({ execution, deps }) {
          const commit = deps.state.commitChanges({
            revision: deps.state.getRevision(),
            accountChanges: [{ accountId: CHECKING, deltaCents: 50_000 }],
            liabilityChanges: [{ liabilityId: "d1", create: true, kind: "loan", principalDeltaCents: 200_000 }],
            expectedNetWorthDeltaCents: 50_000 - 200_000,
            posting: postingFor(execution)
          });
          return { committed: commit.committed, plan: null, diagnostics: commit.errors.map((error) => error.message) };
        }
      }
    ];
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event("borrow", "2026-01-05", 1, "borrow", "mandatory")],
      handlerFactory: borrowHandler
    });
    const report = buildProjectionReport(run);
    const netWorth = report.previews.measurements.find((measurement) => measurement.measurement === "netWorth")!;
    const accountAssets = report.previews.measurements.find(
      (measurement) => measurement.measurement === "accountAssets"
    )!;

    expect(netWorth.isDefault).toBe(true);
    expect(netWorth.signed).toBe(true);
    expect(netWorth.points[netWorth.points.length - 1].valueCents).toBe(-140_000);
    expect(accountAssets.isDefault).toBe(false);
    expect(accountAssets.points[0].valueCents).toBe(60_000);

    expect(netWorth.context.contextId).toBe(run.metadata.contextId);
    expect(netWorth.context.engineRevision).toBe(run.metadata.engineRevision);
    expect(netWorth.context.date).toBe(run.metadata.endDate);
    expect(netWorth.context.revision).toBe(run.monthlyCloses[0].snapshot.revision);
    expect(report.unverifiable.length).toBeGreaterThan(0);
  });
});

describe("reporting — P4.3 obligation schedule payoff from actual postings", () => {
  it("selects a loan schedule and its payoff month from reconciled liability closes", () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 0 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const loanHandler: ProjectionHandlerFactory = () => [
      {
        handlerId: "fund",
        execute({ execution, targetCents, deps }) {
          if (execution.event.purpose === "loanOpen") {
            const commit = deps.state.commitChanges({
              revision: deps.state.getRevision(),
              accountChanges: [{ accountId: CHECKING, deltaCents: 100_000 }],
              liabilityChanges: [{ liabilityId: "L", create: true, kind: "loan", principalDeltaCents: 100_000 }],
              expectedNetWorthDeltaCents: 0,
              posting: postingFor(execution)
            });
            return { committed: commit.committed, plan: null, diagnostics: commit.errors.map((error) => error.message) };
          }
          const request = {
            id: execution.event.definitionId,
            occurrenceId: execution.event.occurrenceId,
            date: execution.date,
            requestedCents: targetCents,
            primaryAccountId: CHECKING,
            fallbackAccountIds: [],
            purpose: execution.event.purpose
          };
          const quoted = quoteFunding(deps.state, request, deps.accounts, deps.dateOfBirth);
          if (!quoted.ok) {
            return { committed: false, plan: null, diagnostics: [quoted.diagnostic.message] };
          }
          const result = commitFunding(deps.state, quoted.plan, {
            posting: postingFor(execution),
            prepareRelatedChanges: ({ executedNetCents }) => ({
              liabilityChanges: [{ liabilityId: "L", principalDeltaCents: -Math.min(executedNetCents, 100_000) }],
              netWorthAdjustmentCents: Math.min(executedNetCents, 100_000)
            })
          });
          return {
            committed: result.committed,
            plan: result.plan,
            quote: quoted,
            diagnostics: result.errors.map((error) => error.message)
          };
        }
      }
    ];
    const run = projectScenario(s, {
      horizonMonths: 3,
      events: [
        event("loanOpen", "2026-01-05", 1, "loanOpen", "mandatory"),
        event("loanInstallment", "2026-02-05", 100_000, "loanInstallment", "mandatory")
      ],
      handlerFactory: loanHandler
    });
    const report = buildProjectionReport(run);

    const schedule = report.schedules.find((entry) => entry.definitionId === "loanInstallment")!;
    expect(schedule.kind).toBe("loan");
    expect(schedule.executedCents).toBe(100_000);
    expect(schedule.committedCount).toBe(1);
    expect(schedule.liabilityIds).toEqual(["L"]);
    expect(schedule.payoffYearMonth).toBe("2026-02");
    expect(report.liabilityCloses("L")[1].closingPrincipalCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P4.3 hardening — phase-independent debt classification, window validation,
// aggregate net-worth cross-check and cadence non-fabrication.
// ---------------------------------------------------------------------------

describe("reporting — P4.3 hardening", () => {
  it("classifies same-phase sale/completion liability deltas by purpose, never by phase", () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 0 });
    const handler: ProjectionHandlerFactory = () => [
      {
        handlerId: "fund",
        execute({ execution, deps }) {
          if (execution.event.purpose === "housingAcquisitionCompletion") {
            const commit = deps.state.commitChanges({
              revision: deps.state.getRevision(),
              accountChanges: [{ accountId: CHECKING, deltaCents: 100_000 }],
              liabilityChanges: [
                { liabilityId: "L", create: true, kind: "mortgage", principalDeltaCents: 100_000 }
              ],
              expectedNetWorthDeltaCents: 0,
              posting: postingFor(execution)
            });
            return { committed: commit.committed, plan: null, diagnostics: commit.errors.map((error) => error.message) };
          }
          if (execution.event.purpose === "housingMortgageAccrual") {
            const commit = deps.state.commitChanges({
              revision: deps.state.getRevision(),
              liabilityChanges: [{ liabilityId: "L", accruedInterestDeltaCents: 4_000 }],
              expectedNetWorthDeltaCents: -4_000,
              posting: postingFor(execution)
            });
            return { committed: commit.committed, plan: null, diagnostics: commit.errors.map((error) => error.message) };
          }
          if (execution.event.purpose === "housingDisposition") {
            const commit = deps.state.commitChanges({
              revision: deps.state.getRevision(),
              accountChanges: [{ accountId: CHECKING, deltaCents: -64_000 }],
              liabilityChanges: [
                { liabilityId: "L", principalDeltaCents: -60_000, accruedInterestDeltaCents: -4_000 }
              ],
              expectedNetWorthDeltaCents: 0,
              posting: postingFor(execution)
            });
            return { committed: commit.committed, plan: null, diagnostics: commit.errors.map((error) => error.message) };
          }
          return { committed: false, plan: null };
        }
      }
    ];
    const run = projectScenario(s, {
      horizonMonths: 2,
      events: [
        event("housingAcquisitionCompletion", "2026-01-05", 1, "housingAcquisitionCompletion", "accrual"),
        event("housingMortgageAccrual", "2026-01-20", 1, "housingMortgageAccrual", "accrual"),
        event("housingDisposition", "2026-02-05", 1, "housingDisposition", "accrual")
      ],
      handlerFactory: handler
    });
    const report = buildProjectionReport(run);

    // All three postings are stamped in the accrual phase. Only the recognized
    // accrual purpose raises accrued interest; the completion borrows principal
    // and the sale retires principal/pays interest — neither masquerades as an
    // accrual despite sharing the phase.
    const jan = report.months[0].flow;
    expect(jan.debtBorrowedCents).toBe(100_000);
    expect(jan.debtInterestAccruedCents).toBe(4_000);
    const feb = report.months[1].flow;
    expect(feb.debtPrincipalPaidCents).toBe(60_000);
    expect(feb.debtInterestPaidCents).toBe(4_000);
    expect(feb.debtInterestAccruedCents).toBe(0);
  });

  it("rejects invalid or reversed date windows instead of silently returning []", () => {
    const report = buildProjectionReport(projectScenario(scenario(), { horizonMonths: 1 }));
    expect(() => report.byDateWindow("2026-03-01", "2026-01-01")).toThrow(RangeError);
    expect(() => report.byDateWindow("not-a-date", "2026-01-01")).toThrow(RangeError);
    expect(() => report.byDateWindow("2026-01-01", "nope")).toThrow(RangeError);
  });

  it("diagnoses summed monthly net-worth deltas disagreeing with closing − opening", () => {
    const base = baseEmptyRun();
    // A tampered posting: declared conservation delta (−100) disagrees with its
    // actual account delta (+100). The state would reject this; the report must
    // surface the resulting aggregate disagreement rather than clamp it.
    const record: PostingRecord = Object.freeze({
      revision: 1,
      sequence: 0,
      posting: Object.freeze({
        definitionId: "tampered",
        purpose: "test",
        phase: "mandatory" as const,
        date: "2026-01-15"
      }),
      accountChanges: Object.freeze([{ accountId: CHECKING, deltaCents: 100 }]),
      liabilityChanges: Object.freeze([]),
      propertyChanges: Object.freeze([]),
      expectedNetWorthDeltaCents: -100
    });
    const corrupted = { ...base, postings: Object.freeze([record]) } as ProjectionRun;
    const report = buildProjectionReport(corrupted);
    expect(report.diagnostics.some((message) => message.includes("Summed monthly net-worth deltas"))).toBe(true);
  });

  it("marks an irregular partial-boundary cadence unknown/unreliable, never fabricated", () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 1_000_000 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };

    // A yearly recurrence clipped by the horizon: only one request is observed.
    const clipped = buildProjectionReport(
      projectScenario(s, {
        horizonMonths: 6,
        events: [
          recurringEvent("annual-clipped", { frequency: "annual", startDate: "2026-04-05", endDate: "2030-04-05" }, 5_000)
        ],
        handlerFactory: fundingHandler()
      })
    );
    const clippedLine = clipped.budgets.lines.find((line) => line.definitionId === "annual-clipped")!;
    expect(clippedLine.periodKind).toBe("oneTime");
    expect(clippedLine.periodKindReliable).toBe(false);

    // A partial/irregular observed cadence is `unknown`, not forced to monthly/yearly.
    const irregular = buildProjectionReport(
      projectScenario(s, {
        horizonMonths: 36,
        events: [
          event("irregular-spend", "2026-01-10", 5_000),
          event("irregular-spend", "2026-07-10", 5_000)
        ],
        handlerFactory: fundingHandler()
      })
    );
    const irregularLine = irregular.budgets.lines.find((line) => line.definitionId === "irregular-spend")!;
    expect(irregularLine.periodKind).toBe("unknown");
    expect(irregularLine.periodKindReliable).toBe(false);
    // The requested/executed budget is still recorded, never fabricated away.
    expect(irregularLine.requestedCents).toBe(10_000);
    expect(irregularLine.executedCents).toBe(10_000);
  });

  it("flags a non-accrual purpose that raises interest rather than accruing it by phase", () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 0 });
    const handler: ProjectionHandlerFactory = () => [
      {
        handlerId: "fund",
        execute({ execution, deps }) {
          // Accrual-phase posting with a non-accrual purpose raising interest.
          const commit = deps.state.commitChanges({
            revision: deps.state.getRevision(),
            liabilityChanges: [{ liabilityId: "L", create: true, kind: "loan", accruedInterestDeltaCents: 1_000 }],
            expectedNetWorthDeltaCents: -1_000,
            posting: postingFor(execution)
          });
          return { committed: commit.committed, plan: null, diagnostics: commit.errors.map((error) => error.message) };
        }
      }
    ];
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event("housingDisposition", "2026-01-05", 1, "housingDisposition", "accrual")],
      handlerFactory: handler
    });
    const report = buildProjectionReport(run);
    expect(report.months[0].flow.debtInterestAccruedCents).toBe(1_000);
    expect(report.diagnostics.some((message) => message.includes("not a recognized accrual purpose"))).toBe(true);
  });
});
