/**
 * P3S.2 — focused tests for the headless retirement-withdrawal stream.
 *
 * Proves: the configurable percentage basis (4% default, explicit 0) and the
 * `$100k → $4k/$6k` CA07 initial target; a later-start source's own-date balance;
 * amount/min/max/inflation and exact cumulative-cent monthly shares; the explicit
 * HSA qualification flag (never a category/label); the D8 fully-pinned fallback
 * list (`allowAutomaticFallback === false` still funds); partial vs depletion
 * diagnostics; and that a retirement withdrawal is net additional living
 * spending (gross account debits, never income).
 */

import { describe, expect, it } from 'vitest';

import { createDefaultScenario } from '../defaultScenario';
import type { AccountWithdrawalPolicy, RetirementWithdrawalSourceLine, Scenario } from '../types';
import type { CompiledScenarioContext } from './configuration';
import { compileScenarioContext } from './configuration';
import type { FundingRequest } from './contracts';
import { commitFunding, quoteFunding } from './funding';
import { projectScenario, composeHandlerFactories } from './projection';
import type { ProjectionEventHandler } from './projection';
import type { EventDefinition } from './scheduler';
import {
  buildRetirementEventDefinitions,
  createRetirementHandlers,
  RETIREMENT_HANDLER_ID,
  retirementDefinitionId
} from './retirement';

const REFERENCE = new Date(2026, 0, 1, 12, 0, 0);
const DOB = '1980-10-01';
const CHECKING = 'checking-account-default';
const SAVINGS = 'emergencyFund-account-default';
const HSA = 'hsa-account-default';
const RET401K = 'retirement401k-account-default';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Zeroed, career-free scenario anchored to a clean month start. */
const scenario = (): Scenario => {
  const value = createDefaultScenario(REFERENCE);
  value.netWorth.asOfDate = '2026-01-01';
  value.careerPlan = { enabled: false, entries: [] };
  value.cashflowItems = [];
  value.lifeEvents = [];
  value.netWorth.accounts = value.netWorth.accounts.map((account) => ({
    ...account,
    openingBalance: 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null
  }));
  value.withdrawal = {
    ...value.withdrawal,
    minimumYearlyWithdrawal: 0,
    maximumYearlyWithdrawal: 1000000,
    fallbackAccountIds: [],
    sourceLines: []
  };
  return value;
};

const setBalance = (target: Scenario, accountId: string, dollars: number): void => {
  target.netWorth.accounts = target.netWorth.accounts.map((account) =>
    account.id === accountId ? { ...account, openingBalance: dollars } : account
  );
};

const setFallback = (target: Scenario, accountId: string, allowed: boolean): void => {
  target.netWorth.accounts = target.netWorth.accounts.map((account) =>
    account.id === accountId
      ? { ...account, withdrawalPolicy: { ...account.withdrawalPolicy, allowAutomaticFallback: allowed } }
      : account
  );
};

/** Overrides one account's withdrawal policy (e.g. an explicit income-tax rate). */
const setWithdrawalPolicy = (
  target: Scenario,
  accountId: string,
  overrides: Partial<AccountWithdrawalPolicy>
): void => {
  target.netWorth.accounts = target.netWorth.accounts.map((account) =>
    account.id === accountId
      ? { ...account, withdrawalPolicy: { ...account.withdrawalPolicy, ...overrides } }
      : account
  );
};

const source = (overrides: Partial<RetirementWithdrawalSourceLine> = {}): RetirementWithdrawalSourceLine => ({
  id: 'src',
  enabled: true,
  accountId: RET401K,
  mode: 'percentOfInitialBalance',
  amount: 0,
  initialWithdrawalRatePercent: 4,
  firstWithdrawalDate: '2026-01-01',
  initialWithdrawalValuationDate: '2026-01-01',
  paymentDay: 1,
  startMarkerId: null,
  fallbackAccountIds: [],
  ...overrides
});

/** A percentage source with the rate field genuinely absent (not `undefined`). */
const sourceWithoutRate = (
  overrides: Partial<RetirementWithdrawalSourceLine> = {}
): RetirementWithdrawalSourceLine => {
  const line = source(overrides);
  delete line.initialWithdrawalRatePercent;
  return line;
};

const compile = (target: Scenario, horizonMonths = 12): CompiledScenarioContext =>
  compileScenarioContext(target, { horizonMonths });

const runRetirement = (target: Scenario, horizonMonths = 12, options?: Parameters<typeof createRetirementHandlers>[1]) => {
  const context = compile(target, horizonMonths);
  return projectScenario(target, {
    horizonMonths,
    events: buildRetirementEventDefinitions(context, options),
    handlerFactory: (deps) => createRetirementHandlers(deps, options)
  });
};

const sumRequested = (run: ReturnType<typeof runRetirement>): number =>
  run.plans.reduce((total, plan) => total + plan.requestedCents, 0);

const definitionsFor = (target: Scenario, horizonMonths = 12): string[] =>
  buildRetirementEventDefinitions(compile(target, horizonMonths)).map((definition) => definition.definitionId);

// ---------------------------------------------------------------------------
// CA07 — configurable percentage basis
// ---------------------------------------------------------------------------

describe('retirement stream — configurable percentage basis (CA07)', () => {
  it('derives a frozen $4k annual target from a $100k observed balance at 4%', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.withdrawal.sourceLines = [source({ initialWithdrawalRatePercent: 4 })];

    const run = runRetirement(target, 12);
    expect(run.plans).toHaveLength(12);
    expect(sumRequested(run)).toBe(400000); // $4,000
    expect(run.plans.every((plan) => plan.executedCents > 0)).toBe(true);
  });

  it('uses the editable 6% rate for the same $100k basis (→ $6k)', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.withdrawal.sourceLines = [source({ initialWithdrawalRatePercent: 6 })];

    const run = runRetirement(target, 12);
    expect(sumRequested(run)).toBe(600000); // $6,000
  });

  it('honors an explicit 0% rate as a zero withdrawal (not a 4% default)', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.withdrawal.sourceLines = [source({ initialWithdrawalRatePercent: 0 })];

    const run = runRetirement(target, 12);
    expect(run.plans).toHaveLength(0);
    expect(run.totals.closingCashCents).toBe(10000000);
  });

  it('defaults an absent rate to the contractual 4% (not 0)', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.withdrawal.sourceLines = [sourceWithoutRate()];

    const run = runRetirement(target, 12);
    expect(run.plans).toHaveLength(12);
    expect(sumRequested(run)).toBe(400000); // $4,000 default
    expect(run.plans.every((plan) => plan.executedCents > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Later-start source uses its own selected-date balance
// ---------------------------------------------------------------------------

describe('retirement stream — valuation basis', () => {
  it('uses a later-start source\'s own selected-date balance, not the opening balance', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    // A prior same-run debit reduces the account before the source starts.
    target.withdrawal.sourceLines = [
      source({ firstWithdrawalDate: '2026-07-01', initialWithdrawalValuationDate: '2026-07-01' })
    ];

    const advanceDefinition: EventDefinition = {
      definitionId: 'test:advance',
      phase: 'income',
      purpose: 'test.advance',
      recurrence: { frequency: 'oneTime', startDate: '2026-06-01' },
      handlerId: 'test.advance',
      resolveTarget: () => 2000000 // $20,000
    };
    const advanceHandler: ProjectionEventHandler = {
      handlerId: 'test.advance',
      execute({ execution, targetCents, deps }) {
        const request: FundingRequest = {
          id: 'test:advance',
          occurrenceId: execution.event.occurrenceId,
          date: execution.date,
          requestedCents: targetCents,
          primaryAccountId: RET401K,
          fallbackAccountIds: [],
          purpose: 'test.advance'
        };
        const quote = quoteFunding(deps.state, request, deps.accounts, deps.dateOfBirth);
        if (!quote.ok) {
          return { committed: false, plan: null, diagnostics: [quote.diagnostic.message] };
        }
        const commit = commitFunding(deps.state, quote.plan, {
          posting: {
            occurrenceId: execution.event.occurrenceId,
            definitionId: execution.event.definitionId,
            purpose: execution.event.purpose,
            date: execution.date,
            phase: execution.event.phase
          }
        });
        return { committed: commit.committed, plan: commit.plan };
      }
    };

    const context = compile(target, 12);
    const run = projectScenario(target, {
      horizonMonths: 12,
      events: [advanceDefinition, ...buildRetirementEventDefinitions(context)],
      handlerFactory: composeHandlerFactories(
        () => [advanceHandler],
        (deps) => createRetirementHandlers(deps)
      )
    });

    // Basis is $80,000 (not the $100,000 opening) → 4% = $3,200.
    const retirementRequested = run.plans
      .filter((plan) => plan.definitionId.startsWith('retirement:'))
      .reduce((sum, plan) => sum + plan.requestedCents, 0);
    expect(retirementRequested).toBe(320000);
  });

  it('reports an impossible basis observation as a diagnostic instead of approximating', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    // Valuation month is neither the first withdrawal month nor the opening month.
    target.withdrawal.sourceLines = [
      source({ firstWithdrawalDate: '2026-07-01', initialWithdrawalValuationDate: '2026-03-01' })
    ];

    const run = runRetirement(target, 12);
    expect(run.plans).toHaveLength(0);
    expect(run.diagnostics.some((message) => message.includes('no authoritative balance observation'))).toBe(true);
    expect(run.totals.closingCashCents).toBe(10000000);
  });

  it('completes a full run with one clear diagnostic and no debit for an unsupported valuation date', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    // Neither the source's first execution month (2026-07) nor the opening month (2026-01).
    target.withdrawal.sourceLines = [
      source({ firstWithdrawalDate: '2026-07-01', initialWithdrawalValuationDate: '2026-03-01' })
    ];

    const run = runRetirement(target, 24);
    expect(run.plans).toHaveLength(0);
    // No invented balance and no debit: the account is exactly as it opened.
    expect(run.totals.closingCashCents).toBe(10000000);

    const basisDiagnostics = run.diagnostics.filter((message) =>
      message.includes('no authoritative balance observation')
    );
    expect(basisDiagnostics).toHaveLength(1); // once-only, never a per-month throw
    const unresolvedDiagnostics = run.diagnostics.filter((message) =>
      message.includes('target could not be resolved')
    );
    expect(unresolvedDiagnostics).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Amount / min / max / inflation + cumulative cents
// ---------------------------------------------------------------------------

describe('retirement stream — amount, min, max, inflation', () => {
  it('supports a fixed annual amount mode', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.withdrawal.sourceLines = [source({ mode: 'amount', amount: 1200 })];

    const run = runRetirement(target, 12);
    expect(run.plans).toHaveLength(12);
    expect(run.plans.every((plan) => plan.requestedCents === 10000)).toBe(true);
    expect(sumRequested(run)).toBe(120000);
  });

  it('clamps an amount-mode target up to the yearly minimum', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.withdrawal.minimumYearlyWithdrawal = 2000;
    target.withdrawal.sourceLines = [source({ mode: 'amount', amount: 500 })];

    const run = runRetirement(target, 12);
    expect(sumRequested(run)).toBe(200000); // $2,000 floor
  });

  it('clamps a percentage-mode target down to the yearly maximum', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.withdrawal.maximumYearlyWithdrawal = 1000;
    target.withdrawal.sourceLines = [source({ initialWithdrawalRatePercent: 6 })];

    const run = runRetirement(target, 12);
    expect(sumRequested(run)).toBe(100000); // $1,000 cap, not $6,000
  });

  it('escalates the frozen target by inflation each annual period', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.withdrawal.sourceLines = [source({ mode: 'amount', amount: 1000 })];

    const run = runRetirement(target, 24, { inflationRatePercent: 10 });
    const year1 = run.plans.filter((plan) => plan.yearMonth.startsWith('2026'));
    const year2 = run.plans.filter((plan) => plan.yearMonth.startsWith('2027'));
    expect(year1.reduce((sum, plan) => sum + plan.requestedCents, 0)).toBe(100000);
    expect(year2.reduce((sum, plan) => sum + plan.requestedCents, 0)).toBe(110000);
  });

  it('splits an annual target into exact cumulative-cent shares', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.withdrawal.sourceLines = [source({ mode: 'amount', amount: 100 })];

    const run = runRetirement(target, 12);
    const shares = run.plans.map((plan) => plan.requestedCents);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(10000);
    expect(shares.filter((value) => value === 833)).toHaveLength(8);
    expect(shares.filter((value) => value === 834)).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------
// HSA qualification is explicit only
// ---------------------------------------------------------------------------

describe('retirement stream — HSA qualification', () => {
  const hsaScenario = (line: RetirementWithdrawalSourceLine): Scenario => {
    const target = scenario();
    setBalance(target, HSA, 100000);
    target.withdrawal.sourceLines = [line];
    return target;
  };

  it('applies the non-qualified HSA penalty without the explicit flag', () => {
    const target = hsaScenario(source({ accountId: HSA, initialWithdrawalRatePercent: 4 }));
    const run = runRetirement(target, 12);
    expect(run.plans).toHaveLength(12);
    expect(run.plans.every((plan) => plan.penaltyCents > 0)).toBe(true);
  });

  it('waives tax/penalty only when the explicit qualification flag is set', () => {
    const target = hsaScenario(source({ accountId: HSA, initialWithdrawalRatePercent: 4 }));
    const run = runRetirement(target, 12, { hsaQualifiedMedicalBySourceId: { src: true } });
    expect(run.plans).toHaveLength(12);
    expect(run.plans.every((plan) => plan.penaltyCents === 0 && plan.taxCents === 0)).toBe(true);
  });

  it('does not confer qualification from a label/category', () => {
    const target = hsaScenario(source({ accountId: HSA, label: 'Qualified Medical', initialWithdrawalRatePercent: 4 }));
    const run = runRetirement(target, 12);
    expect(run.plans.every((plan) => plan.penaltyCents > 0)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D8 — fully-pinned fallback list
// ---------------------------------------------------------------------------

describe('retirement stream — explicit pinned fallback (D8)', () => {
  it('funds a pinned 2nd-position fallback whose allowAutomaticFallback is false', () => {
    const target = scenario();
    setBalance(target, RET401K, 0);
    setBalance(target, SAVINGS, 5000);
    setFallback(target, SAVINGS, false);
    // An unrelated ordinary global policy must never be consulted for retirement.
    target.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    target.withdrawal.sourceLines = [
      source({ mode: 'amount', amount: 1200, fallbackAccountIds: [SAVINGS] })
    ];

    const run = runRetirement(target, 12);
    expect(run.plans.length).toBeGreaterThan(0);
    const allocationAccounts = run.plans[0].plan.allocations.map((allocation) => allocation.accountId);
    expect(allocationAccounts).toEqual([SAVINGS]);
    expect(run.plans[0].executedCents).toBe(run.plans[0].requestedCents);
  });
});

// ---------------------------------------------------------------------------
// Partial vs depletion
// ---------------------------------------------------------------------------

describe('retirement stream — partial vs depletion', () => {
  it('surfaces a partial funding diagnostic distinct from depletion', () => {
    const target = scenario();
    setBalance(target, CHECKING, 50); // less than one monthly share
    target.withdrawal.sourceLines = [
      source({ accountId: CHECKING, mode: 'amount', amount: 1200 })
    ];

    const run = runRetirement(target, 1);
    expect(run.plans).toHaveLength(1);
    expect(run.plans[0].status).toBe('partial');
    expect(run.diagnostics.some((message) => message.includes('partially funded'))).toBe(true);
    expect(run.diagnostics.some((message) => message.includes('depleted'))).toBe(false);
  });

  it('surfaces a depletion diagnostic when every listed account is empty', () => {
    const target = scenario();
    target.withdrawal.sourceLines = [source({ accountId: CHECKING, mode: 'amount', amount: 1200 })];

    const run = runRetirement(target, 1);
    expect(run.plans).toHaveLength(0);
    expect(run.diagnostics.some((message) => message.includes('depleted'))).toBe(true);
    expect(run.diagnostics.some((message) => message.includes('no automatic retry'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spending, not income
// ---------------------------------------------------------------------------

describe('retirement stream — spending interpretation', () => {
  it('debits accounts as net additional living spending and never posts income', () => {
    const target = scenario();
    setBalance(target, CHECKING, 100000);
    target.withdrawal.sourceLines = [source({ accountId: CHECKING, mode: 'amount', amount: 1200 })];

    const run = runRetirement(target, 12);
    expect(run.plans).toHaveLength(12);
    expect(run.plans.every((plan) => plan.plan.request.purpose === 'retirement')).toBe(true);

    const totalGross = run.plans.reduce((sum, plan) => sum + plan.grossDebitCents, 0);
    expect(totalGross).toBe(120000);
    // Spending reduces net worth by the full gross debit; nothing was credited.
    expect(run.totals.openingNetWorthCents - run.totals.closingNetWorthCents).toBe(totalGross);
    const closingChecking = run.monthlyCloses[run.monthlyCloses.length - 1].closingCashCents;
    expect(closingChecking).toBe(10000000 - 120000);
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe('retirement stream — wiring', () => {
  it('uses the retirement:<sourceId> namespace and purpose', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.withdrawal.sourceLines = [source({ id: 'row-a' })];

    const definitions = buildRetirementEventDefinitions(compile(target));
    expect(definitions).toHaveLength(1);
    expect(definitions[0].definitionId).toBe('retirement:row-a');
    expect(definitions[0].definitionId).toBe(retirementDefinitionId('row-a'));
    expect(definitions[0].purpose).toBe('retirement');
    expect(definitions[0].handlerId).toBe(RETIREMENT_HANDLER_ID);
    expect(definitionsFor(target)).toEqual(['retirement:row-a']);
  });

  it('honors a start date marker link', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.dateMarkers = [{ id: 'm-start', label: 'Start', date: '2026-07-01' }];
    target.withdrawal.sourceLines = [
      source({ id: 'marked', firstWithdrawalDate: '2026-02-01', startMarkerId: 'm-start' })
    ];

    const run = runRetirement(target, 12);
    expect(run.plans[0].yearMonth).toBe('2026-07');
    expect(run.diagnostics.some((message) => message.includes('2026-02'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P4.1 / D15 — posting journal attribution
// ---------------------------------------------------------------------------

describe('P4.1/D15 — retirement posting journal attribution', () => {
  it('journals exactly one indexed posting per committed withdrawal plan', () => {
    const target = scenario();
    setBalance(target, CHECKING, 100000);
    target.withdrawal.sourceLines = [source({ accountId: CHECKING, mode: 'amount', amount: 1200 })];

    const run = runRetirement(target, 12);
    expect(run.plans).toHaveLength(12);

    for (const plan of run.plans) {
      const byOccurrence = run.postings.filter((record) => record.posting.occurrenceId === plan.occurrenceId);
      expect(byOccurrence).toHaveLength(1);
      expect(byOccurrence[0]?.posting.definitionId).toBe(plan.definitionId);
      expect(byOccurrence[0]?.posting.purpose).toBe('retirement');
      expect(byOccurrence[0]?.posting.phase).toBe('mandatory');
      expect(byOccurrence[0]?.posting.date).toBe(`${plan.yearMonth}-01`);
      // Exactly one account debit per committed plan — never doubled.
      expect(byOccurrence[0]?.accountChanges).toEqual([
        { accountId: CHECKING, deltaCents: -plan.grossDebitCents }
      ]);
    }

    // Stream postings reconcile 1:1 with committed plans (nothing fabricated).
    expect(run.postings.filter((record) => record.posting.purpose === 'retirement')).toHaveLength(
      run.plans.length
    );
  });

  it('journals nothing for an unfunded occurrence (depleted account, no commit)', () => {
    const target = scenario();
    target.withdrawal.sourceLines = [source({ accountId: CHECKING, mode: 'amount', amount: 1200 })];

    const run = runRetirement(target, 1);
    expect(run.plans).toHaveLength(0);
    expect(run.postings.filter((record) => record.posting.purpose === 'retirement')).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
  });

  it('journals nothing when the percentage basis is unobservable (no invented target)', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.withdrawal.sourceLines = [
      source({ firstWithdrawalDate: '2026-07-01', initialWithdrawalValuationDate: '2026-03-01' })
    ];

    const run = runRetirement(target, 12);
    expect(run.plans).toHaveLength(0);
    expect(run.postings.filter((record) => record.posting.purpose === 'retirement')).toHaveLength(0);
  });

  it('preserves requested/tax/penalty/shortfall math alongside the posting', () => {
    const target = scenario();
    setBalance(target, HSA, 100000);
    // Explicit nonzero income-tax rate: the default HSA policy leaves
    // `withdrawalTaxRate` at 0, so configuring it makes the tax leg observable.
    setWithdrawalPolicy(target, HSA, { withdrawalTaxRate: 20 });
    target.withdrawal.sourceLines = [source({ accountId: HSA, initialWithdrawalRatePercent: 4 })];

    const run = runRetirement(target, 12);
    expect(run.plans.reduce((sum, plan) => sum + plan.requestedCents, 0)).toBe(400000);
    // A non-qualified HSA withholds income tax AND its 20% penalty.
    expect(run.plans.every((plan) => plan.taxCents > 0 && plan.penaltyCents > 0)).toBe(true);

    for (const plan of run.plans) {
      const rows = run.postings.filter((record) => record.posting.occurrenceId === plan.occurrenceId);
      expect(rows).toHaveLength(1);
      // The gross debit is withheld tax + penalty + net, exactly once.
      const debit = (rows[0]?.accountChanges ?? []).reduce((sum, change) => sum + change.deltaCents, 0);
      expect(debit).toBe(-plan.grossDebitCents);
      expect(plan.grossDebitCents).toBe(plan.executedCents + plan.taxCents + plan.penaltyCents);
    }
  });
});

// ---------------------------------------------------------------------------
// P4.1 / D16 — funding outcomes for unfunded quotes
// ---------------------------------------------------------------------------

describe('P4.1/D16 — retirement funding outcomes', () => {
  it('records an unfunded outcome for a depleted account (no plan, no posting)', () => {
    const target = scenario();
    target.withdrawal.sourceLines = [source({ accountId: CHECKING, mode: 'amount', amount: 1200 })];

    const run = runRetirement(target, 1);
    expect(run.plans).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.occurrenceId).toBe('retirement:src:2026-01-01');
    expect(outcome.definitionId).toBe('retirement:src');
    expect(outcome.phase).toBe('mandatory');
    expect(outcome.committed).toBe(false);
    // A single-month horizon prorates the annual $1,200 target into one share.
    expect(outcome.plan.request.requestedCents).toBe(120000);
    expect(outcome.plan.executedCents).toBe(0);
    expect(outcome.plan.status).toBe('unfunded');
  });

  it('records a committed partial outcome while the plan audit keeps the shortfall', () => {
    const target = scenario();
    setBalance(target, CHECKING, 50); // less than one monthly share
    target.withdrawal.sourceLines = [source({ accountId: CHECKING, mode: 'amount', amount: 1200 })];

    const run = runRetirement(target, 1);
    expect(run.plans).toHaveLength(1);
    expect(run.fundingOutcomes).toHaveLength(1);
    expect(run.fundingOutcomes[0]?.committed).toBe(true);
    expect(run.fundingOutcomes[0]?.plan.status).toBe('partial');
    expect(run.plans[0]?.shortfallCents).toBeGreaterThan(0);
    expect(run.postings).toHaveLength(1);
  });

  it('records no outcome when the percentage basis cannot be observed (resolver throws)', () => {
    const target = scenario();
    setBalance(target, RET401K, 100000);
    target.withdrawal.sourceLines = [
      source({ firstWithdrawalDate: '2026-07-01', initialWithdrawalValuationDate: '2026-03-01' })
    ];

    const run = runRetirement(target, 12);
    expect(run.plans).toHaveLength(0);
    expect(run.fundingOutcomes).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
  });
});
