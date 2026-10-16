/**
 * P2.7 — focused tests for the kernel-only `projectScenario` facade.
 *
 * Replaces the removed pool-era suite. Proves the facade is a thin orchestration
 * over the real kernel: CA08 (960 inclusive closes + exact APY + partial dates),
 * CA13 (determinism), CA03 (ordered split / partial / no-op / stale / eligibility
 * via the injected `quoteFunding` + `commitFunding` seam), CA04 (gross-net tax
 * identity), no-career/zero-income behavior, and the absence of legacy result
 * aliases. Mutation happens only through the state owner.
 */

import { describe, expect, it } from 'vitest';

import type { AccountDefinition, AccountWithdrawalPolicy, Scenario } from '../types';
import { createDefaultScenario } from '../defaultScenario';
import type { FundingPlan } from './contracts';
import type { FundingRequest } from './contracts';
import { commitFunding, quoteFunding } from './funding';
import { roundHalfAwayFromZero } from './money';
import {
  CANONICAL_RUN_MEASUREMENT,
  DEFERRED_FEATURE_DOMAINS,
  projectScenario,
  ProjectionError,
  composeHandlerFactories,
  createDefaultHandlerFactory
} from './projection';
import type { ProjectionHandlerFactory } from './projection';
import type { PostingContext } from './journal';
import type { EventDefinition, EventExecutionContext, EventPhase } from './scheduler';

const CHECKING = 'checking-account-default';
const EMERGENCY = 'emergencyFund-account-default';
const INVESTMENTS = 'investments-account-default';
const RETIREMENT = 'retirement401k-account-default';

/** Fresh independent default scenario anchored to an explicit observation date. */
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
  phase: EventPhase = 'discretionary'
): EventDefinition => ({
  definitionId,
  phase,
  purpose,
  recurrence: { frequency: 'oneTime', startDate: date },
  handlerId: 'fund',
  resolveTarget: () => targetCents
});

interface FundingRecord {
  committed: boolean;
  stale: boolean;
  plan: FundingPlan | null;
  errorCodes: string[];
}

const requestFor = (executionDefinitionId: string, occurrenceId: string, date: string, targetCents: number, deps: Parameters<ProjectionHandlerFactory>[0]): FundingRequest => ({
  id: executionDefinitionId,
  occurrenceId,
  date,
  requestedCents: targetCents,
  primaryAccountId: deps.funding.global.primaryAccountId,
  fallbackAccountIds: [...deps.funding.global.fallbackAccountIds],
  purpose: 'test'
});

/** Explicit D15 posting stamp derived from the scheduled occurrence (no default). */
const postingFor = (execution: EventExecutionContext): PostingContext => ({
  occurrenceId: execution.event.occurrenceId,
  definitionId: execution.event.definitionId,
  purpose: execution.event.purpose,
  date: execution.date,
  phase: execution.event.phase
});

/** Handler seam: real quoteFunding + commitFunding; `income` purpose deposits. */
const kernelHandler = (records: FundingRecord[]): ProjectionHandlerFactory => () => [
  {
    handlerId: 'fund',
    execute({ execution, targetCents, deps }) {
      if (execution.event.purpose === 'income') {
        const commit = deps.state.commitChanges({
          revision: deps.state.getRevision(),
          accountChanges: [{ accountId: CHECKING, deltaCents: targetCents }],
          expectedNetWorthDeltaCents: targetCents,
          posting: postingFor(execution)
        });
        records.push({ committed: commit.committed, stale: false, plan: null, errorCodes: commit.errors.map((e) => e.code) });
        return { committed: commit.committed, plan: null, diagnostics: commit.errors.map((e) => e.message) };
      }
      const quoted = quoteFunding(
        deps.state,
        requestFor(execution.event.definitionId, execution.event.occurrenceId, execution.date, targetCents, deps),
        deps.accounts,
        deps.dateOfBirth,
        {
          globalDefaults: {
            primaryAccountId: deps.funding.global.primaryAccountId,
            fallbackAccountIds: [...deps.funding.global.fallbackAccountIds]
          }
        }
      );
      if (!quoted.ok) {
        records.push({ committed: false, stale: false, plan: null, errorCodes: [quoted.diagnostic.code] });
        return { committed: false, plan: null, quote: quoted, diagnostics: [quoted.diagnostic.message] };
      }
      const result = commitFunding(deps.state, quoted.plan, { posting: postingFor(execution) });
      records.push({
        committed: result.committed,
        stale: result.stale,
        plan: result.plan,
        errorCodes: result.errors.map((e) => e.code)
      });
      return {
        committed: result.committed,
        plan: result.plan,
        quote: quoted,
        diagnostics: result.errors.map((e) => e.message)
      };
    }
  }
];

describe('projectScenario — CA08 horizon, APY and partial dates', () => {
  it('produces 960 inclusive monthly closes and never shortens the horizon', () => {
    const run = projectScenario(scenario());
    expect(run.complete).toBe(false);
    expect(run.featureCoverage.kernel).toBe(true);
    expect(run.featureCoverage.processors).toBe(false);
    expect(run.metadata.horizonMonths).toBe(960);
    expect(run.metadata.startDate).toBe('2026-01-01');
    expect(run.monthlyCloses).toHaveLength(960);
    expect(run.monthlyCloses[0].yearMonth).toBe('2026-01');
    expect(run.monthlyCloses[0].partial).toBe(false);
    expect(run.monthlyCloses[959].yearMonth).toBe('2105-12');
    expect(run.totals.monthCount).toBe(960);
  });

  it('applies exact effective APY on a full month', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 10000, annualReturnRate: 6.5 });
    const run = projectScenario(s);
    const first = run.monthlyCloses[0];
    const close = first.accountCloses.find((entry) => entry.accountId === CHECKING)!;
    const expected = roundHalfAwayFromZero(1000000 * (Math.pow(1.065, 1 / 12) - 1));
    expect(first.monthFraction).toBe(1);
    expect(close.growthCents).toBe(expected);
    expect(close.closingBalanceCents).toBe(1000000 + expected);
    expect(run.totals.growthCents).toBeGreaterThan(0);
  });

  it('clips the first month exponent when the start date is mid-month', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 10000, annualReturnRate: 6.5 });
    const run = projectScenario(s, { startDate: '2026-01-16' });
    const first = run.monthlyCloses[0];
    const close = first.accountCloses.find((entry) => entry.accountId === CHECKING)!;
    const fraction = 16 / 31;
    const expected = roundHalfAwayFromZero(1000000 * (Math.pow(1.065, fraction / 12) - 1));
    expect(first.monthFraction).toBeCloseTo(fraction, 15);
    expect(first.partial).toBe(true);
    expect(close.growthCents).toBe(expected);
  });

  it('selects the retirement rate override for the retirement phase', () => {
    const build = () => {
      const s = scenario();
      setAccount(s, INVESTMENTS, { openingBalance: 10000, annualReturnRate: 0, retirementAnnualReturnRate: 5 });
      return s;
    };
    const accumulation = projectScenario(build());
    const retirement = projectScenario(build(), { ratePhase: 'retirement' });
    const accumulationGrowth = accumulation.monthlyCloses[0].accountCloses.find((c) => c.accountId === INVESTMENTS)!.growthCents;
    const retirementGrowth = retirement.monthlyCloses[0].accountCloses.find((c) => c.accountId === INVESTMENTS)!.growthCents;
    expect(accumulationGrowth).toBe(0);
    expect(retirementGrowth).toBeGreaterThan(0);
  });

  it('applies the exact effective-APY retirement override on a clipped partial month (2026-01-16)', () => {
    const s = scenario();
    // Base rate 0% + retirement override 5%: the override must be the rate actually
    // compounded, and only on the covered fraction of the month.
    setAccount(s, INVESTMENTS, { openingBalance: 10000, annualReturnRate: 0, retirementAnnualReturnRate: 5 });
    const run = projectScenario(s, { startDate: '2026-01-16', horizonMonths: 1, ratePhase: 'retirement' });
    const first = run.monthlyCloses[0];
    const close = first.accountCloses.find((entry) => entry.accountId === INVESTMENTS)!;

    // Jan 16–31 inclusive = 16 covered days of a 31-day month, so the exponent is
    // monthFraction / 12 = 16 / 372 at the selected 5% effective annual rate.
    // Independently computed from the fixed input (never read back from the run):
    const fraction = 16 / 31;
    const expected = roundHalfAwayFromZero(1000000 * (Math.pow(1.05, 16 / 372) - 1));
    expect(first.monthFraction).toBeCloseTo(fraction, 15);
    expect(first.partial).toBe(true);
    expect(close.annualRate).toBe(0.05);
    expect(close.monthFraction).toBeCloseTo(fraction, 15);
    expect(close.growthCents).toBe(expected);
    expect(close.closingBalanceCents).toBe(1000000 + expected);
    expect(run.totals.growthCents).toBe(expected);
    // The clipped exponent is not the full-month factor (nor the 16/12 shortcut).
    expect(close.growthCents).not.toBe(roundHalfAwayFromZero(1000000 * (Math.pow(1.05, 1 / 12) - 1)));
    // The retirement override is only selected for the overridden account.
    expect(
      first.accountCloses.filter((entry) => entry.accountId !== INVESTMENTS).every((entry) => entry.growthCents === 0)
    ).toBe(true);
    expect(run.opening.snapshot.accounts.find((a) => a.accountId === INVESTMENTS)!.balanceCents).toBe(1000000);
    // No month-close diagnostics and the close arrays are frozen (immutability).
    expect(run.diagnostics.some((message) => message.includes('month close skipped'))).toBe(false);
    expect(Object.isFrozen(first.accountCloses)).toBe(true);
    expect(Object.isFrozen(first.totals)).toBe(true);
  });

  it('closes a funded account at exactly 0 cents under a -100% rate without a negative balance or phantom liability', () => {
    const s = scenario();
    // `annualReturnRate` is persisted in percent (UI unit `%`, codec clamp
    // `Math.max(-100, …)`), so -100% is configured as -100 and the facade
    // converts it to the fraction -1 (`ratePercent / 100`).
    setAccount(s, CHECKING, { openingBalance: 10000, annualReturnRate: -100 });
    const run = projectScenario(s, { horizonMonths: 1 });
    const first = run.monthlyCloses[0];
    const close = first.accountCloses.find((entry) => entry.accountId === CHECKING)!;

    // -100% is a valid rate (>= -100%): the growth exactly offsets the balance.
    expect(close.annualRate).toBe(-1);
    expect(close.growthCents).toBe(-1000000);
    expect(close.closingBalanceCents).toBe(0);
    expect(first.snapshot.accounts.find((a) => a.accountId === CHECKING)!.balanceCents).toBe(0);
    expect(first.totals.accountCents).toBe(0);
    expect(first.totals.netWorthCents).toBe(0);
    expect(run.totals.growthCents).toBe(-1000000);
    expect(run.totals.closingCashCents).toBe(0);
    expect(run.totals.closingNetWorthCents).toBe(0);

    // No account is driven negative and no liability is fabricated to absorb it.
    expect(first.snapshot.accounts.every((account) => account.balanceCents >= 0)).toBe(true);
    expect(first.snapshot.liabilities).toHaveLength(0);
    expect(first.totals.liabilityCents).toBe(0);
    const valuation = run.postings.find((record) => record.posting.purpose === 'valuation')!;
    expect(valuation.accountChanges).toEqual([{ accountId: CHECKING, deltaCents: -1000000 }]);
    expect(valuation.liabilityChanges).toHaveLength(0);
    expect(valuation.expectedNetWorthDeltaCents).toBe(-1000000);
    expect(run.diagnostics.some((message) => message.includes('month close skipped'))).toBe(false);
    expect(run.diagnostics.some((message) => message.includes('validation commit rejected'))).toBe(false);
  });
});

describe('projectScenario — CA13 determinism and immutability', () => {
  it('returns byte-identical runs for identical inputs', () => {
    const first = projectScenario(scenario());
    const second = projectScenario(scenario());
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('never mutates the caller scenario', () => {
    const s = scenario();
    const before = JSON.stringify(s);
    projectScenario(s, { startDate: '2026-03-10' });
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('projectScenario — explicit start / missing observation', () => {
  it('throws a ProjectionError when no opening observation date exists', () => {
    const s = scenario();
    s.netWorth.asOfDate = '';
    expect(() => projectScenario(s)).toThrow(ProjectionError);
  });

  it('throws a ProjectionError for an invalid explicit start date', () => {
    expect(() => projectScenario(scenario(), { startDate: '2026-13-40' })).toThrow(ProjectionError);
  });
});

describe('projectScenario — no-career / zero-income kernel run', () => {
  it('fabricates no income or spending and exposes no legacy result aliases', () => {
    const run = projectScenario(scenario());
    expect(run.plans).toHaveLength(0);
    expect(run.totals.executedNetCents).toBe(0);
    expect(run.totals.executedPlanCount).toBe(0);
    expect(run.monthlyCloses.every((month) => month.executedOccurrenceIds.length === 0)).toBe(true);
    expect('years' in run).toBe(false);
    expect('summary' in run).toBe(false);
    expect('incomeUsageByMonth' in run).toBe(false);
    expect('incomeValidation' in run).toBe(false);
    expect('accountBalancesById' in run).toBe(false);
  });
});

describe('projectScenario — D20 run vs opening measurement split', () => {
  it('labels a snapshot-less first launch as a signed run with an assetOnly opening', () => {
    const run = projectScenario(scenario());
    // The run's result values (annual points / totals) are canonical signed net
    // worth even though the observed opening had no snapshot and fell back to
    // the legacy `assetOnly` basis.
    expect(run.metadata.measurement).toBe(CANONICAL_RUN_MEASUREMENT);
    expect(run.metadata.measurement).toBe('assetsMinusLiabilities');
    expect(run.opening.hasSnapshot).toBe(false);
    expect(run.opening.measurement).toBe('assetOnly');
  });

  it('keeps the run signed when the observed opening is explicitly assetOnly', () => {
    const s = scenario();
    s.netWorth.openingSnapshot = {
      date: '2026-01-01',
      measurement: 'assetOnly',
      accounts: [{ accountId: CHECKING, balance: 0 }],
      liabilities: [],
      properties: []
    };
    const run = projectScenario(s);
    expect(run.metadata.measurement).toBe('assetsMinusLiabilities');
    expect(run.opening.hasSnapshot).toBe(true);
    expect(run.opening.measurement).toBe('assetOnly');
  });
});

describe('projectScenario — CA03 ordered split, partial, no-op, replenishment, stale', () => {
  it('splits primary-first then fallback and records the executed plan', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    setAccount(s, EMERGENCY, { openingBalance: 200 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [EMERGENCY] };
    const records: FundingRecord[] = [];
    const run = projectScenario(s, {
      events: [event('spend', '2026-01-15', 25000)],
      handlerFactory: kernelHandler(records)
    });
    expect(records).toHaveLength(1);
    expect(records[0].committed).toBe(true);
    expect(records[0].plan?.status).toBe('funded');
    expect(records[0].plan?.allocations.map((a) => a.accountId)).toEqual([CHECKING, EMERGENCY]);
    expect(records[0].plan?.allocations.map((a) => a.netFundedCents)).toEqual([10000, 15000]);
    expect(run.plans).toHaveLength(1);
    expect(run.totals.executedNetCents).toBe(25000);
  });

  it('reports actual partial funding without marking the remainder paid', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    setAccount(s, EMERGENCY, { openingBalance: 100 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [EMERGENCY] };
    const records: FundingRecord[] = [];
    const run = projectScenario(s, {
      events: [event('spend', '2026-01-15', 25000)],
      handlerFactory: kernelHandler(records)
    });
    expect(records[0].plan?.status).toBe('partial');
    expect(records[0].plan?.executedCents).toBe(20000);
    expect(records[0].plan?.shortfallCents).toBe(5000);
    expect(run.totals.executedNetCents).toBe(20000);
  });

  it('skips an ineligible automatic fallback (allowAutomaticFallback = false)', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    setAccount(s, EMERGENCY, {
      openingBalance: 100,
      withdrawalPolicy: policy({ allowAutomaticFallback: false })
    });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [EMERGENCY] };
    const records: FundingRecord[] = [];
    const run = projectScenario(s, {
      events: [event('spend', '2026-01-15', 15000)],
      handlerFactory: kernelHandler(records)
    });
    expect(records[0].plan?.allocations.map((a) => a.accountId)).toEqual([CHECKING]);
    expect(records[0].plan?.executedCents).toBe(10000);
    expect(records[0].plan?.status).toBe('partial');
    expect(run.totals.executedNetCents).toBe(10000);
  });

  it('debits nothing for an unknown/empty source (zero-fund no-op)', () => {
    const s = scenario();
    s.fundingPolicy = { primaryAccountId: 'missing-account', fallbackAccountIds: [] };
    const records: FundingRecord[] = [];
    const run = projectScenario(s, {
      events: [event('spend', '2026-01-15', 5000)],
      handlerFactory: kernelHandler(records)
    });
    expect(records[0].committed).toBe(false);
    expect(records[0].plan?.status).toBe('unfunded');
    expect(records[0].errorCodes).toContain('zero-fund');
    expect(run.plans).toHaveLength(0);
    expect(run.totals.executedNetCents).toBe(0);
  });

  it('skips a zero target without invoking any handler', () => {
    const records: FundingRecord[] = [];
    const run = projectScenario(scenario(), {
      events: [event('spend', '2026-01-15', 0)],
      handlerFactory: kernelHandler(records)
    });
    expect(records).toHaveLength(0);
    expect(run.plans).toHaveLength(0);
  });

  it('funds a later obligation from a same-month explicit income event (replenishment + ordering)', () => {
    const s = scenario();
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const records: FundingRecord[] = [];
    const run = projectScenario(s, {
      events: [event('income', '2026-01-05', 10000, 'income', 'income'), event('spend', '2026-01-15', 10000)],
      handlerFactory: kernelHandler(records)
    });
    expect(run.plans).toHaveLength(1);
    expect(run.plans[0].executedCents).toBe(10000);
    expect(run.totals.executedNetCents).toBe(10000);
    // The explicit income is a direct state commit, not a funding plan: it is
    // counted as an executed occurrence but never enters the funding audit, and
    // it no longer emits the generic "commit without a plan" warning (D10).
    expect(run.diagnostics.some((message) => message.includes('without a plan'))).toBe(false);
    expect(run.monthlyCloses[0].executedOccurrenceIds).toEqual(['income:2026-01-05', 'spend:2026-01-15']);
    expect(run.monthlyCloses[0].executedEventCount).toBe(2);
  });

  it('rejects a stale plan and leaves it uncommitted', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const records: FundingRecord[] = [];
    const staleFactory: ProjectionHandlerFactory = () => [
      {
        handlerId: 'fund',
        execute({ execution, targetCents, deps }) {
          const quoted = quoteFunding(
            deps.state,
            requestFor(execution.event.definitionId, execution.event.occurrenceId, execution.date, targetCents, deps),
            deps.accounts,
            deps.dateOfBirth
          );
          if (!quoted.ok) {
            records.push({ committed: false, stale: false, plan: null, errorCodes: [quoted.diagnostic.code] });
            return { committed: false, plan: null, quote: quoted, diagnostics: [quoted.diagnostic.message] };
          }
          // Force a revision bump between quote and commit.
          deps.state.commitChanges({
            revision: deps.state.getRevision(),
            accountChanges: [{ accountId: CHECKING, deltaCents: -1 }],
            expectedNetWorthDeltaCents: -1,
            posting: postingFor(execution)
          });
          const result = commitFunding(deps.state, quoted.plan, { posting: postingFor(execution) });
          records.push({
            committed: result.committed,
            stale: result.stale,
            plan: result.plan,
            errorCodes: result.errors.map((e) => e.code)
          });
          return {
            committed: result.committed,
            plan: result.plan,
            quote: quoted,
            diagnostics: result.errors.map((e) => e.message)
          };
        }
      }
    ];
    const run = projectScenario(s, {
      events: [event('spend', '2026-01-15', 5000)],
      handlerFactory: staleFactory
    });
    expect(records[0].stale).toBe(true);
    expect(records[0].committed).toBe(false);
    expect(records[0].errorCodes).toContain('stale-plan');
    expect(run.plans).toHaveLength(0);
    expect(run.diagnostics.some((message) => message.includes('Plan was quoted at revision'))).toBe(true);
  });
});

describe('projectScenario — D10 direct no-plan commits', () => {
  it('counts a committed direct state commit (plan: null) as an executed occurrence without a plan, audit row or warning', () => {
    const s = scenario();
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const records: FundingRecord[] = [];
    const run = projectScenario(s, {
      events: [event('income', '2026-01-05', 40000, 'income', 'income')],
      handlerFactory: kernelHandler(records)
    });

    // The handler really posted through the state owner, with no funding plan.
    expect(records).toHaveLength(1);
    expect(records[0].committed).toBe(true);
    expect(records[0].plan).toBeNull();

    // It is a real executed occurrence for the month...
    const january = run.monthlyCloses[0];
    expect(january.executedOccurrenceIds).toEqual(['income:2026-01-05']);
    expect(january.executedEventCount).toBe(1);

    // ...but no plan/audit row and no faked gross/net budget.
    expect(run.plans).toHaveLength(0);
    expect(run.totals.executedPlanCount).toBe(0);
    expect(run.totals.executedNetCents).toBe(0);
    expect(run.totals.executedGrossCents).toBe(0);
    expect(run.totals.executedTaxCents).toBe(0);
    expect(run.totals.executedPenaltyCents).toBe(0);

    // No generic "commit without a plan" diagnostic.
    expect(run.diagnostics.some((message) => message.includes('without a plan'))).toBe(false);

    // The direct deposit still landed in state (cash observed at month close).
    expect(january.closingCashCents).toBe(january.openingCashCents + 40000);
  });

  it('leaves the cash funding audit unchanged when a direct commit shares the month with a real plan', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const records: FundingRecord[] = [];
    const run = projectScenario(s, {
      events: [
        event('income', '2026-01-05', 40000, 'income', 'income'),
        event('spend', '2026-01-15', 10000)
      ],
      handlerFactory: kernelHandler(records)
    });

    // Exactly one funding plan/audit row, and the totals reflect only it.
    expect(run.plans).toHaveLength(1);
    expect(run.plans[0].occurrenceId).toBe('spend:2026-01-15');
    expect(run.plans[0].executedCents).toBe(10000);
    expect(run.plans[0].grossDebitCents).toBe(10000);
    expect(run.totals.executedPlanCount).toBe(1);
    expect(run.totals.executedNetCents).toBe(10000);
    expect(run.totals.executedGrossCents).toBe(10000);
    expect(run.totals.executedTaxCents).toBe(0);
    expect(run.totals.executedPenaltyCents).toBe(0);

    // Both occurrences count for the month; only the plan is an audit row.
    const january = run.monthlyCloses[0];
    expect(january.executedOccurrenceIds).toEqual(['income:2026-01-05', 'spend:2026-01-15']);
    expect(january.executedEventCount).toBe(2);
    // opening $100 + $400 direct deposit − $100 spend.
    expect(january.closingCashCents).toBe(10000 + 40000 - 10000);
  });

  it('does not audit or count a committed plan that executed nothing', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const zeroPlanFactory: ProjectionHandlerFactory = () => [
      {
        handlerId: 'fund',
        execute({ execution, targetCents, deps }) {
          const plan: FundingPlan = {
            stateRevision: deps.state.getRevision(),
            request: requestFor(
              execution.event.definitionId,
              execution.event.occurrenceId,
              execution.date,
              targetCents,
              deps
            ),
            allocations: [],
            eligibleAccountIds: [],
            resolvedSourceOrder: [],
            skippedSources: [],
            quotaLimited: false,
            feasibleCents: 0,
            executedCents: 0,
            shortfallCents: targetCents,
            status: 'unfunded'
          };
          return { committed: true, plan };
        }
      }
    ];
    const run = projectScenario(s, {
      events: [event('spend', '2026-01-15', 5000)],
      handlerFactory: zeroPlanFactory
    });

    expect(run.plans).toHaveLength(0);
    expect(run.totals.executedPlanCount).toBe(0);
    expect(run.totals.executedNetCents).toBe(0);
    expect(run.monthlyCloses[0].executedOccurrenceIds).toHaveLength(0);
    expect(run.monthlyCloses[0].executedEventCount).toBe(0);
    // Nothing executed, so no cash moved.
    expect(run.totals.closingCashCents).toBe(run.totals.openingCashCents);
  });

  it('remains deterministic across identical direct-commit runs', () => {
    const build = (): Scenario => {
      const s = scenario();
      s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
      return s;
    };
    const runOnce = () =>
      projectScenario(build(), {
        events: [
          event('income', '2026-01-05', 40000, 'income', 'income'),
          event('spend', '2026-01-15', 10000)
        ],
        handlerFactory: kernelHandler([])
      });
    expect(JSON.stringify(runOnce())).toBe(JSON.stringify(runOnce()));
  });
});

describe('projectScenario — CA04 gross = net + tax + penalty', () => {
  it('reconciles an executed taxed allocation exactly', () => {
    const s = scenario();
    setAccount(s, RETIREMENT, { openingBalance: 100, withdrawalPolicy: policy({ withdrawalTaxRate: 20, penaltyRate: 0 }) });
    s.fundingPolicy = { primaryAccountId: RETIREMENT, fallbackAccountIds: [] };
    const records: FundingRecord[] = [];
    const run = projectScenario(s, {
      events: [event('spend', '2026-01-15', 5000, 'retirement')],
      handlerFactory: kernelHandler(records)
    });
    expect(run.plans).toHaveLength(1);
    const plan = run.plans[0].plan;
    const [allocation] = plan.allocations;
    expect(allocation.accountId).toBe(RETIREMENT);
    expect(allocation.grossDebitCents).toBe(6250);
    expect(allocation.withheldTaxCents).toBe(1250);
    expect(allocation.penaltyCents).toBe(0);
    expect(allocation.netFundedCents).toBe(5000);
    expect(allocation.grossDebitCents).toBe(
      allocation.netFundedCents + allocation.withheldTaxCents + allocation.penaltyCents
    );
    expect(run.totals.executedGrossCents).toBe(6250);
    expect(run.totals.executedTaxCents).toBe(1250);
    expect(run.totals.executedPenaltyCents).toBe(0);
    expect(run.totals.executedGrossCents).toBe(
      run.totals.executedNetCents + run.totals.executedTaxCents + run.totals.executedPenaltyCents
    );
  });
});

/**
 * D10 — state-aware handler target resolver. This handler computes its target
 * from live state (`CHECKING` balance) at execution time. Income occurrences
 * deposit directly; spending occurrences fund exactly the observed balance, so
 * same-date ordering is observable: a spend dated before an income sees `$0`
 * (no future-income spending) while one dated after it sees the deposited balance.
 */
const stateAwareHandler = (observations: number[], records: FundingRecord[]): ProjectionHandlerFactory => () => [
  {
    handlerId: 'fund',
    resolveTarget(execution, deps) {
      if (execution.event.purpose === 'income') {
        return 25000;
      }
      const balance = deps.state.getAccountBalanceCents(CHECKING) ?? 0;
      observations.push(balance);
      return balance;
    },
    execute({ execution, targetCents, deps }) {
      if (execution.event.purpose === 'income') {
        const commit = deps.state.commitChanges({
          revision: deps.state.getRevision(),
          accountChanges: [{ accountId: CHECKING, deltaCents: targetCents }],
          expectedNetWorthDeltaCents: targetCents,
          posting: postingFor(execution)
        });
        records.push({ committed: commit.committed, stale: false, plan: null, errorCodes: [] });
        return { committed: commit.committed, plan: null };
      }
      const quoted = quoteFunding(
        deps.state,
        requestFor(execution.event.definitionId, execution.event.occurrenceId, execution.date, targetCents, deps),
        deps.accounts,
        deps.dateOfBirth
      );
      if (!quoted.ok) {
        records.push({ committed: false, stale: false, plan: null, errorCodes: [quoted.diagnostic.code] });
        return { committed: false, plan: null, quote: quoted, diagnostics: [quoted.diagnostic.message] };
      }
      const result = commitFunding(deps.state, quoted.plan, { posting: postingFor(execution) });
      records.push({
        committed: result.committed,
        stale: result.stale,
        plan: result.plan,
        errorCodes: result.errors.map((e) => e.code)
      });
      return {
        committed: result.committed,
        plan: result.plan,
        quote: quoted,
        diagnostics: result.errors.map((e) => e.message)
      };
    }
  }
];

describe('projectScenario — D10 state-aware handler targets', () => {
  it('recalculates a state-aware target after an earlier same-date income commit', () => {
    const s = scenario();
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const observations: number[] = [];
    const records: FundingRecord[] = [];
    const run = projectScenario(s, {
      events: [event('income', '2026-01-05', 999, 'income', 'income'), event('spend', '2026-01-15', 999)],
      handlerFactory: stateAwareHandler(observations, records)
    });
    // The deposit runs first; the spend resolver then sees the deposited balance.
    expect(observations).toEqual([25000]);
    expect(run.plans).toHaveLength(1);
    expect(run.plans[0].executedCents).toBe(25000);
    expect(run.totals.executedNetCents).toBe(25000);
  });

  it('never spends future income or fabricates a plan for a zero state-aware target', () => {
    const s = scenario();
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const observations: number[] = [];
    const records: FundingRecord[] = [];
    // The spend precedes the income, so the resolver must observe a zero balance.
    const run = projectScenario(s, {
      events: [event('spend', '2026-01-15', 999), event('income', '2026-01-20', 999, 'income', 'income')],
      handlerFactory: stateAwareHandler(observations, records)
    });
    expect(observations).toEqual([0]);
    expect(records).toHaveLength(1); // income only; the zero-target spend never executed
    expect(run.plans).toHaveLength(0);
    expect(run.totals.executedNetCents).toBe(0);
  });

  it('skips an invalid state-aware target without executing the handler', () => {
    const executed: string[] = [];
    const factory: ProjectionHandlerFactory = () => [
      {
        handlerId: 'fund',
        resolveTarget: () => Number.NaN,
        execute: ({ execution }) => {
          executed.push(execution.event.occurrenceId);
          return { committed: false, plan: null };
        }
      }
    ];
    const run = projectScenario(scenario(), {
      events: [event('spend', '2026-01-15', 5000)],
      handlerFactory: factory
    });
    expect(executed).toHaveLength(0);
    expect(run.plans).toHaveLength(0);
    expect(run.diagnostics.some((message) => message.includes('invalid target'))).toBe(true);
  });
});

describe('projectScenario — D10 default handler composition seam', () => {
  it('stays kernel-only and never flips processors when no factory is supplied', () => {
    const run = projectScenario(scenario(), { events: [event('spend', '2026-01-15', 5000)] });
    expect(run.featureCoverage.processors).toBe(false);
    expect(run.featureCoverage.kernel).toBe(true);
    expect(run.plans).toHaveLength(0);
    expect(run.diagnostics.some((message) => message.includes('No projection handlers were provided'))).toBe(true);
    expect(run.monthlyCloses).toHaveLength(960);
    expect(run.monthlyCloses[959].yearMonth).toBe('2105-12');
  });

  it('composes factories left to right and defaults to none', () => {
    const deps = undefined as unknown as Parameters<ProjectionHandlerFactory>[0];
    const factoryA: ProjectionHandlerFactory = () => [
      { handlerId: 'a', execute: () => ({ committed: false, plan: null }) }
    ];
    const factoryB: ProjectionHandlerFactory = () => [
      { handlerId: 'b', execute: () => ({ committed: false, plan: null }) }
    ];
    expect(composeHandlerFactories(factoryA, factoryB)(deps).map((handler) => handler.handlerId)).toEqual(['a', 'b']);
    expect(createDefaultHandlerFactory(deps)).toHaveLength(0);
  });
});

describe('projectScenario — P4.1 posting journal, funding outcomes and P4.2 closes', () => {
  it('journals the account APY month close as a valuation/close posting', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 10000, annualReturnRate: 6.5 });
    const run = projectScenario(s, { horizonMonths: 2 });

    const close = run.monthlyCloses[0].accountCloses.find((entry) => entry.accountId === CHECKING)!;
    expect(close.growthCents).toBeGreaterThan(0);

    const valuationRows = run.postings.filter((record) => record.posting.purpose === 'valuation');
    expect(valuationRows).toHaveLength(2);
    const [january] = valuationRows;
    expect(january.posting.definitionId).toBe('account-apy-valuation');
    expect(january.posting.phase).toBe('close');
    expect(january.posting.date).toBe('2026-01-31');
    expect(january.accountChanges).toEqual([{ accountId: CHECKING, deltaCents: close.growthCents }]);
    expect(january.expectedNetWorthDeltaCents).toBe(close.growthCents);
    expect(january.sequence).toBe(0);
    expect(january.revision).toBe(1);
    expect(valuationRows[1].posting.date).toBe('2026-02-28');
  });

  it('journals a direct income commit (plan: null) and counts it as an executed occurrence', () => {
    const s = scenario();
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event('income', '2026-01-05', 40000, 'income', 'income')],
      handlerFactory: kernelHandler([])
    });

    // No APY growth in this fixture → the only posting is the direct income commit.
    expect(run.postings).toHaveLength(1);
    const [incomeRow] = run.postings;
    expect(incomeRow.posting.occurrenceId).toBe('income:2026-01-05');
    expect(incomeRow.posting.purpose).toBe('income');
    expect(incomeRow.posting.phase).toBe('income');
    expect(incomeRow.posting.date).toBe('2026-01-05');
    expect(incomeRow.accountChanges).toEqual([{ accountId: CHECKING, deltaCents: 40000 }]);
    expect(run.monthlyCloses[0].executedOccurrenceIds).toEqual(['income:2026-01-05']);
  });

  it('captures an unfunded funding outcome with zero allocations and no posting', () => {
    const s = scenario();
    s.fundingPolicy = { primaryAccountId: 'missing-account', fallbackAccountIds: [] };
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event('spend', '2026-01-15', 5000)],
      handlerFactory: kernelHandler([])
    });

    expect(run.plans).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.occurrenceId).toBe('spend:2026-01-15');
    expect(outcome.committed).toBe(false);
    expect(outcome.plan.status).toBe('unfunded');
    expect(outcome.plan.executedCents).toBe(0);
    expect(outcome.plan.allocations).toHaveLength(0);
    expect(outcome.phase).toBe('discretionary');
    expect(outcome.date).toBe('2026-01-15');
    expect(outcome.eligibleSources).toEqual([{ accountId: 'missing-account', balanceCents: 0 }]);
    expect(outcome.skippedSources.map((entry) => entry.reason)).toContain('unknown-account');
    expect(outcome.quotaLimited).toBe(false);
  });

  it('captures a committed plan outcome with eligible balances sampled at outcome time', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event('spend', '2026-01-15', 25000)],
      handlerFactory: kernelHandler([])
    });

    // Committed partial plan: audited once in `plans`, observed once in outcomes.
    expect(run.plans).toHaveLength(1);
    expect(run.plans[0].status).toBe('partial');
    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.occurrenceId).toBe('spend:2026-01-15');
    expect(outcome.committed).toBe(true);
    expect(outcome.plan.status).toBe('partial');
    // Eligible source balance sampled after funding → exhaustion evidence (D16).
    expect(outcome.eligibleSources).toEqual([{ accountId: CHECKING, balanceCents: 0 }]);
  });

  it('records an unfunded outcome for a non-committed/stale quote without treating it as paid', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 100 });
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
    const records: FundingRecord[] = [];
    const staleFactory: ProjectionHandlerFactory = () => [
      {
        handlerId: 'fund',
        execute({ execution, targetCents, deps }) {
          const quoted = quoteFunding(
            deps.state,
            requestFor(execution.event.definitionId, execution.event.occurrenceId, execution.date, targetCents, deps),
            deps.accounts,
            deps.dateOfBirth
          );
          if (!quoted.ok) {
            return { committed: false, plan: null, quote: quoted, diagnostics: [quoted.diagnostic.message] };
          }
          // Force a revision bump between quote and commit → stale-plan rejection.
          deps.state.commitChanges({
            revision: deps.state.getRevision(),
            accountChanges: [{ accountId: CHECKING, deltaCents: -1 }],
            expectedNetWorthDeltaCents: -1,
            posting: postingFor(execution)
          });
          const result = commitFunding(deps.state, quoted.plan, { posting: postingFor(execution) });
          records.push({ committed: result.committed, stale: result.stale, plan: result.plan, errorCodes: result.errors.map((e) => e.code) });
          return { committed: result.committed, plan: result.plan, quote: quoted, diagnostics: result.errors.map((e) => e.message) };
        }
      }
    ];
    const run = projectScenario(s, {
      horizonMonths: 1,
      events: [event('spend', '2026-01-15', 5000)],
      handlerFactory: staleFactory
    });

    expect(records[0].stale).toBe(true);
    // Not paid: no funded plan/audit row, but the non-committed quote is observed.
    expect(run.plans).toHaveLength(0);
    expect(run.fundingOutcomes).toHaveLength(1);
    expect(run.fundingOutcomes[0].committed).toBe(false);
    expect(run.fundingOutcomes[0].plan.status).toBe('funded');
    // The forced revision-bump posting is the only committed posting.
    expect(run.postings).toHaveLength(1);
    expect(run.postings[0].posting.occurrenceId).toBe('spend:2026-01-15');
  });

  it('captures a reconciling entity snapshot once per month (annual = Σ months)', () => {
    const s = scenario();
    setAccount(s, CHECKING, { openingBalance: 10000, annualReturnRate: 6.5 });
    const run = projectScenario(s, { horizonMonths: 3 });

    let summedGrowth = 0;
    for (const month of run.monthlyCloses) {
      // assets − liabilities = signed net worth every month
      expect(month.totals.assetsCents - month.totals.liabilityCents).toBe(month.totals.netWorthCents);
      const snapshotSum = month.snapshot.accounts.reduce((total, account) => total + account.balanceCents, 0);
      expect(month.totals.accountCents).toBe(snapshotSum);
      expect(month.closingCashCents).toBe(snapshotSum);
      for (const close of month.accountCloses) {
        const snap = month.snapshot.accounts.find((account) => account.accountId === close.accountId)!;
        expect(snap.balanceCents).toBe(close.closingBalanceCents);
      }
      summedGrowth += month.growthCents;
    }

    // Annual aggregate = Σ months; the run close equals the last month close.
    expect(summedGrowth).toBe(run.totals.growthCents);
    const last = run.monthlyCloses[run.monthlyCloses.length - 1];
    expect(last.totals.netWorthCents).toBe(run.totals.closingNetWorthCents);
    expect(last.totals.accountCents).toBe(run.totals.closingCashCents);
    // Every revision is one committed posting; the final close sees them all.
    expect(last.snapshot.revision).toBe(run.postings.length);
  });

  it('freezes the journal, outcomes and monthly snapshots and stays byte-identical', () => {
    const build = (): Scenario => {
      const s = scenario();
      setAccount(s, CHECKING, { openingBalance: 10000, annualReturnRate: 6.5 });
      s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [] };
      return s;
    };
    const runOnce = () =>
      projectScenario(build(), {
        horizonMonths: 1,
        events: [
          event('income', '2026-01-05', 40000, 'income', 'income'),
          event('spend', '2026-01-15', 10000)
        ],
        handlerFactory: kernelHandler([])
      });

    const run = runOnce();
    expect(Object.isFrozen(run.postings)).toBe(true);
    for (const record of run.postings) {
      expect(Object.isFrozen(record)).toBe(true);
      expect(Object.isFrozen(record.posting)).toBe(true);
      expect(Object.isFrozen(record.accountChanges)).toBe(true);
    }
    expect(Object.isFrozen(run.fundingOutcomes)).toBe(true);
    for (const outcome of run.fundingOutcomes) {
      expect(Object.isFrozen(outcome)).toBe(true);
      expect(Object.isFrozen(outcome.eligibleSources)).toBe(true);
      expect(Object.isFrozen(outcome.skippedSources)).toBe(true);
    }
    expect(Object.isFrozen(run.monthlyCloses[0].snapshot)).toBe(true);
    expect(Object.isFrozen(run.monthlyCloses[0].snapshot.accounts)).toBe(true);
    expect(Object.isFrozen(run.monthlyCloses[0].totals)).toBe(true);

    expect(JSON.stringify(runOnce())).toBe(JSON.stringify(runOnce()));
  });
});

// ---------------------------------------------------------------------------
// D23 — call-site-scoped truthful coverage claim
// ---------------------------------------------------------------------------

describe('projectScenario — D23 call-site coverage claim', () => {
  it('keeps the raw kernel-only run incomplete and fully deferred', () => {
    const run = projectScenario(scenario());
    expect(run.complete).toBe(false);
    expect(run.featureCoverage.processors).toBe(false);
    expect(run.featureCoverage.reporting).toBe(false);
    expect(run.featureCoverage.deferred).toEqual([...DEFERRED_FEATURE_DOMAINS]);
  });

  it('honours a full-horizon claim as complete with no deferred domains', () => {
    const run = projectScenario(scenario(), {
      horizonMonths: 1,
      events: [event('income', '2026-01-05', 10000, 'income', 'income')],
      handlerFactory: kernelHandler([]),
      coverage: { processors: true, reporting: true, deferred: [] }
    });
    expect(run.complete).toBe(true);
    expect(run.featureCoverage.processors).toBe(true);
    expect(run.featureCoverage.reporting).toBe(true);
    expect(run.featureCoverage.deferred).toEqual([]);
  });

  it('marks a claimed run incomplete when a schedule window truncates the horizon', () => {
    const run = projectScenario(scenario(), {
      horizonMonths: 6,
      events: [event('income', '2026-01-05', 10000, 'income', 'income')],
      scheduleWindow: { startDate: '2026-01-01', endDate: '2026-01-31' },
      handlerFactory: kernelHandler([]),
      coverage: { processors: true, reporting: true, deferred: [] }
    });
    expect(run.complete).toBe(false);
    expect(run.featureCoverage.deferred).toContain('partialScheduleWindow');
  });

  it('marks a claimed run incomplete and un-processed when a scheduled occurrence is blocked', () => {
    const run = projectScenario(scenario(), {
      horizonMonths: 1,
      events: [event('ghost', '2026-01-05', 10000, 'spend', 'discretionary')],
      // The default factory registers no handler, so the scheduled occurrence is dropped.
      handlerFactory: createDefaultHandlerFactory,
      coverage: { processors: true, reporting: true, deferred: [] }
    });
    expect(run.complete).toBe(false);
    expect(run.featureCoverage.processors).toBe(false);
    expect(run.featureCoverage.deferred).toContain('blockedExecution');
  });

  it('keeps reporting the still-deferred domains alongside a processors/reporting claim', () => {
    const run = projectScenario(scenario(), {
      horizonMonths: 1,
      events: [event('income', '2026-01-05', 10000, 'income', 'income')],
      handlerFactory: kernelHandler([]),
      coverage: { processors: true, reporting: true, deferred: ['longTermPurchases'] }
    });
    // The claim itself is honoured (processors/reporting true) and the caller's
    // remaining deferred domains are reported verbatim.
    expect(run.featureCoverage.processors).toBe(true);
    expect(run.featureCoverage.reporting).toBe(true);
    expect(run.featureCoverage.deferred).toEqual(['longTermPurchases']);
    expect(run.complete).toBe(false);
  });
});
