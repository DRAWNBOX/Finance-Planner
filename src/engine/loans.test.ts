/**
 * P3D.3 — focused tests for the headless loan/mortgage processor.
 *
 * Covers CA05 (fixed-date loan with full/partial/zero funding; monthly D13
 * interest accrual; funded principal reduces cash and debt equally; interest
 * remains due; excess payment capped) plus the D13 amortized-installment formula
 * (`max(PMT, configured minimum)` capped at outstanding, nominal APR/12, no
 * lower-rate clamp), observed-opening authority (including an observed zero),
 * interest-first allocation, no negative debt, no fabricated debt when the
 * liability is absent, no mortgage double-count, and explicit date
 * ordering/replenishment.
 *
 * Every expected value is computed independently from the implementation (a
 * closed-form PMT in the test, or an explicit `roundHalfAwayFromZero` product),
 * never read back from the module under test.
 */

import { describe, expect, it } from 'vitest';

import type { LiabilityDefinition, Loan, Scenario } from '../types';
import { createDefaultScenario } from '../defaultScenario';
import { compileScenarioContext, type CompiledScenarioContext } from './configuration';
import type { PostingContext } from './journal';
import { buildState, type EngineState } from './state';
import { roundHalfAwayFromZero } from './money';
import type { EventDefinition, EventExecutionContext } from './scheduler';
import {
  composeHandlerFactories,
  projectScenario,
  type ProjectionExecutionResult,
  type ProjectionHandlerDependencies,
  type ProjectionHandlerFactory
} from './projection';
import {
  buildLoanEventDefinitions,
  collectLoanLinks,
  createLoanHandlerFactory,
  createLoanHandlers,
  loanDefinitionId,
  LOAN_ACCRUAL_PURPOSE,
  LOAN_DOWN_PAYMENT_PURPOSE,
  quoteLoanInstallment,
  remainingTermMonths,
  type LoanProcessorBuild
} from './loans';

const CHECKING = 'checking-account-default';
const EMERGENCY = 'emergencyFund-account-default';

/** Explicit posting stamp for direct test-fixture commits (never a production default). */
const LOAN_TEST_POSTING: PostingContext = {
  purpose: 'test.loans',
  date: '2026-01-01',
  phase: 'income'
};

const baseScenario = (): Scenario => {
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

const setAccountBalance = (target: Scenario, accountId: string, dollars: number): void => {
  target.netWorth.accounts = target.netWorth.accounts.map((account) =>
    account.id === accountId ? { ...account, openingBalance: dollars } : account
  );
};

const makeLoan = (over: Partial<Loan> = {}): Loan => ({
  id: 'loan-1',
  label: 'Loan',
  enabled: true,
  showOnGraph: true,
  startYearMonth: '2026-01',
  originalAmount: 25000,
  downPayment: 0,
  currentBalance: 25000,
  annualInterestRate: 6.5,
  minimumMonthlyPayment: 350,
  extraMonthlyPayment: 0,
  paymentSourceAccount: CHECKING,
  paymentSource: `account:${CHECKING}`,
  ...over
});

const makeLiability = (over: Partial<LiabilityDefinition> = {}): LiabilityDefinition => ({
  id: 'loan-1',
  kind: 'loan',
  openingBalance: 25000,
  annualInterestRate: 6.5,
  minimumMonthlyPayment: 350,
  endYearMonth: '2030-12',
  paymentDay: 1,
  ...over
});

/** Closed-form standard amortized payment, independent of the implementation. */
const closedFormPmt = (principalCents: number, annualRate: number, months: number): number => {
  const r = annualRate / 12;
  return r === 0 ? principalCents / months : (principalCents * r) / (1 - Math.pow(1 + r, -months));
};

interface Harness {
  context: CompiledScenarioContext;
  state: EngineState;
  deps: ProjectionHandlerDependencies;
  build: LoanProcessorBuild;
  invoke: (definitionId: string, date: string) => { target: number; result: ProjectionExecutionResult };
}

const harness = (
  scenario: Scenario,
  options: { horizonMonths?: number; startDate?: string } = {}
): Harness => {
  const context = compileScenarioContext(scenario, {
    horizonMonths: options.horizonMonths ?? 12,
    ...(options.startDate === undefined ? {} : { startDate: options.startDate })
  });
  const state = buildState(context.opening);
  const deps: ProjectionHandlerDependencies = {
    state,
    context,
    accounts: scenario.netWorth.accounts,
    dateOfBirth: null,
    funding: context.funding
  };
  const build = buildLoanEventDefinitions(context);
  const handlers = createLoanHandlers(deps);
  const handlerById = new Map(handlers.map((handler) => [handler.handlerId, handler]));
  const definitionById = new Map(build.definitions.map((definition) => [definition.definitionId, definition]));

  const invoke = (definitionId: string, date: string) => {
    const definition = definitionById.get(definitionId);
    if (!definition) {
      throw new Error(`No loan definition "${definitionId}".`);
    }
    const handler = handlerById.get(definition.handlerId ?? '');
    if (!handler) {
      throw new Error(`No loan handler for "${definitionId}".`);
    }
    const yearMonth = date.slice(0, 7);
    const execution: EventExecutionContext = {
      context,
      event: {
        occurrenceId: `${definitionId}:${date}`,
        definitionId,
        date,
        yearMonth,
        phase: definition.phase,
        priority: definition.priority ?? 0,
        purpose: definition.purpose,
        occurrenceIndex: 1,
        handlerId: definition.handlerId
      },
      yearMonth,
      date,
      occurrenceIndex: 1,
      activeCareer: null,
      activePayPlan: null
    };
    const target = handler.resolveTarget ? handler.resolveTarget(execution, deps) : definition.resolveTarget(execution);
    const result = handler.execute({ execution, targetCents: target, deps });
    return { target, result };
  };

  return { context, state, deps, build, invoke };
};

describe('loans — amortized installment quote (D13)', () => {
  it('computes the standard amortized payment independently of the minimum floor', () => {
    const principalCents = 2_500_000;
    const annualRate = 0.065;
    const months = 60;
    const expected = roundHalfAwayFromZero(closedFormPmt(principalCents, annualRate, months));
    const quoted = quoteLoanInstallment({
      principalCents,
      annualRate,
      remainingMonths: months,
      minimumPaymentCents: 35_000
    });
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) {
      return;
    }
    expect(quoted.quote.monthlyRate).toBeCloseTo(annualRate / 12, 15);
    expect(quoted.quote.standardPaymentCents).toBe(expected);
    expect(quoted.quote.requiredCents).toBe(expected);
  });

  it('applies the configured minimum when it exceeds the standard payment', () => {
    const quoted = quoteLoanInstallment({
      principalCents: 100_000,
      annualRate: 0.065,
      remainingMonths: 60,
      minimumPaymentCents: 50_000
    });
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) {
      return;
    }
    expect(quoted.quote.standardPaymentCents).toBeLessThan(50_000);
    expect(quoted.quote.requiredCents).toBe(50_000);
  });

  it('caps the required payment at the outstanding debt (principal + interest + fees)', () => {
    const quoted = quoteLoanInstallment({
      principalCents: 10_000,
      accruedInterestCents: 54,
      feesCents: 6,
      annualRate: 0.065,
      remainingMonths: 1,
      minimumPaymentCents: 50_000
    });
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) {
      return;
    }
    expect(quoted.quote.outstandingCents).toBe(10_060);
    expect(quoted.quote.requiredCents).toBe(10_060);
  });

  it('uses straight-line principal over the term at 0% APR', () => {
    const quoted = quoteLoanInstallment({ principalCents: 120_000, annualRate: 0, remainingMonths: 12 });
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) {
      return;
    }
    expect(quoted.quote.monthlyRate).toBe(0);
    expect(quoted.quote.standardPaymentCents).toBe(10_000);
  });

  it('uses the nominal APR/12 rather than the effective account APY', () => {
    const quoted = quoteLoanInstallment({ principalCents: 1_000_000, annualRate: 0.06, remainingMonths: 1 });
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) {
      return;
    }
    expect(quoted.quote.monthlyRate).toBe(0.06 / 12);
    expect(quoted.quote.monthlyRate).not.toBeCloseTo(Math.pow(1.06, 1 / 12) - 1, 8);
  });

  it('governs by the minimum and reports no standard payment when there is no term', () => {
    const quoted = quoteLoanInstallment({
      principalCents: 500_000,
      annualRate: 0.065,
      remainingMonths: null,
      minimumPaymentCents: 20_000
    });
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) {
      return;
    }
    expect(quoted.quote.standardPaymentCents).toBe(0);
    expect(quoted.quote.requiredCents).toBe(20_000);
  });

  it('counts the remaining term inclusively through the end month', () => {
    expect(remainingTermMonths('2030-12', '2026-01')).toBe(60);
    expect(remainingTermMonths('2026-01', '2026-01')).toBe(1);
    expect(remainingTermMonths(null, '2026-01')).toBeNull();
    expect(remainingTermMonths('2025-12', '2026-01')).toBeNull();
  });

  it('rejects invalid terms with an explicit diagnostic', () => {
    expect(quoteLoanInstallment({ principalCents: -1, annualRate: 0.05, remainingMonths: 12 }).ok).toBe(false);
    expect(quoteLoanInstallment({ principalCents: 1.5, annualRate: 0.05, remainingMonths: 12 }).ok).toBe(false);
    expect(quoteLoanInstallment({ principalCents: 100, annualRate: Number.NaN, remainingMonths: 12 }).ok).toBe(false);
    expect(quoteLoanInstallment({ principalCents: 100, annualRate: -0.01, remainingMonths: 12 }).ok).toBe(false);
    expect(quoteLoanInstallment({ principalCents: 100, annualRate: 0.05, remainingMonths: 0 }).ok).toBe(false);
    expect(
      quoteLoanInstallment({ principalCents: 100, annualRate: 0.05, remainingMonths: 12, minimumPaymentCents: -1 }).ok
    ).toBe(false);
  });
});

describe('loans — definitions and liability linkage', () => {
  it('namespaces every loan occurrence as loan:<id>:<kind> in the frozen phases', () => {
    const s = baseScenario();
    s.loans = [makeLoan({ extraMonthlyPayment: 100, downPayment: 5000, downPaymentSource: `account:${CHECKING}` })];
    s.liabilities = [makeLiability()];
    const context = compileScenarioContext(s, { horizonMonths: 12 });
    const build = buildLoanEventDefinitions(context);
    const byPhase = new Map(build.definitions.map((definition) => [definition.definitionId, definition.phase]));

    expect([...byPhase.keys()].sort()).toEqual(
      [
        loanDefinitionId('loan-1', 'accrual'),
        loanDefinitionId('loan-1', 'downPayment'),
        loanDefinitionId('loan-1', 'extra'),
        loanDefinitionId('loan-1', 'installment')
      ].sort()
    );
    expect(byPhase.get(loanDefinitionId('loan-1', 'accrual'))).toBe('accrual');
    expect(byPhase.get(loanDefinitionId('loan-1', 'installment'))).toBe('mandatory');
    expect(byPhase.get(loanDefinitionId('loan-1', 'extra'))).toBe('discretionary');
    expect(byPhase.get(loanDefinitionId('loan-1', 'downPayment'))).toBe('mandatory');
    expect(
      build.definitions.find((definition) => definition.definitionId === loanDefinitionId('loan-1', 'accrual'))?.purpose
    ).toBe(LOAN_ACCRUAL_PURPOSE);
  });

  it('skips a loan with no matching liability', () => {
    const s = baseScenario();
    s.loans = [makeLoan()];
    s.liabilities = [];
    const plan = collectLoanLinks(compileScenarioContext(s, { horizonMonths: 12 }));
    expect(plan.links).toHaveLength(0);
    expect(plan.diagnostics[0]?.code).toBe('unknown-liability');
  });

  it('skips a property-linked liability so a mortgage is not double-counted', () => {
    const s = baseScenario();
    s.loans = [makeLoan()];
    s.liabilities = [
      { id: 'loan-1', kind: 'mortgage', openingBalance: 25000, annualInterestRate: 6.5, linkedPropertyId: 'home' }
    ];
    s.properties = [{ id: 'home', value: 300000, status: 'owned', requiredDownPayment: 0, debtLink: 'loan-1' }];
    const context = compileScenarioContext(s, { horizonMonths: 12 });
    const plan = collectLoanLinks(context);
    expect(plan.links).toHaveLength(0);
    expect(plan.diagnostics.some((diagnostic) => diagnostic.code === 'housing-owned')).toBe(true);
    expect(buildLoanEventDefinitions(context).definitions).toHaveLength(0);
  });

  it('does not invent debt from Loan.currentBalance when the liability is absent', () => {
    const s = baseScenario();
    s.loans = [makeLoan()];
    // A pending acquisition's configured financing has no opening debt yet, so
    // `resolveOpening` omits it and no liability reaches the compiled context.
    s.liabilities = [
      { id: 'loan-1', kind: 'mortgage', openingBalance: 25000, linkedPropertyId: 'home' }
    ];
    s.properties = [
      { id: 'home', value: 300000, status: 'pending', requiredDownPayment: 60000, debtLink: 'loan-1' }
    ];
    const context = compileScenarioContext(s, { horizonMonths: 12 });
    expect(context.getLiability('loan-1')).toBeUndefined();

    const h = harness(s);
    expect(h.state.getLiability('loan-1')).toBeUndefined();
    expect(h.build.definitions).toHaveLength(0);

    const run = projectScenario(s, {
      horizonMonths: 12,
      events: h.build.definitions,
      handlerFactory: createLoanHandlerFactory()
    });
    expect(run.totals.executedPlanCount).toBe(0);
    expect(run.totals.closingNetWorthCents).toBe(run.totals.openingNetWorthCents);
  });
});

describe('loans — accrual (D13, nominal APR/12)', () => {
  it('accrues nominal APR/12 as accrued interest with a net-worth delta of −interest', () => {
    const s = baseScenario();
    s.loans = [makeLoan()];
    s.liabilities = [makeLiability()];
    const h = harness(s);
    const openingNetWorth = h.state.getTotals().netWorthCents;
    const expected = roundHalfAwayFromZero((2_500_000 * (6.5 / 100)) / 12);

    const { target, result } = h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-01');
    expect(expected).toBe(13_542);
    expect(target).toBe(expected);
    expect(result.committed).toBe(true);
    expect(h.state.getLiability('loan-1')?.principalCents).toBe(2_500_000);
    expect(h.state.getLiability('loan-1')?.accruedInterestCents).toBe(expected);
    expect(h.state.getTotals().netWorthCents).toBe(openingNetWorth - expected);
  });

  it('accrues nothing on a 0% loan', () => {
    const s = baseScenario();
    s.loans = [makeLoan({ annualInterestRate: 0 })];
    s.liabilities = [makeLiability({ annualInterestRate: 0 })];
    const h = harness(s);
    const { target, result } = h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-01');
    expect(target).toBe(0);
    expect(result.committed).toBe(false);
    expect(h.state.getLiability('loan-1')?.accruedInterestCents).toBe(0);
  });

  it('prorates a clipped first month', () => {
    const s = baseScenario();
    s.loans = [makeLoan()];
    s.liabilities = [makeLiability({ paymentDay: 20 })];
    const h = harness(s, { startDate: '2026-01-16' });
    const fraction = 16 / 31;
    const expected = roundHalfAwayFromZero(2_500_000 * (0.065 / 12) * fraction);
    const { target } = h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-20');
    expect(target).toBe(expected);
    expect(target).toBeLessThan(13_542);
  });

  it('lets an observed zero opening debt win over the configured balance', () => {
    const s = baseScenario();
    s.loans = [makeLoan()];
    s.liabilities = [makeLiability()];
    s.netWorth.openingSnapshot = {
      date: '2026-01-01',
      measurement: 'assetsMinusLiabilities',
      accounts: [],
      liabilities: [{ liabilityId: 'loan-1', balance: 0 }],
      properties: []
    };
    const h = harness(s);
    expect(h.context.getLiability('loan-1')?.openingBalance).toBe(0);
    expect(h.state.getLiability('loan-1')?.principalCents).toBe(0);
    const accrual = h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-01');
    const installment = h.invoke(loanDefinitionId('loan-1', 'installment'), '2026-01-01');
    expect(accrual.target).toBe(0);
    expect(accrual.result.committed).toBe(false);
    expect(installment.target).toBe(0);
    expect(installment.result.committed).toBe(false);
  });
});

describe('loans — installment funding (interest-first)', () => {
  it('fully funds the installment, applying interest first and reducing principal by the actual paid amount', () => {
    const s = baseScenario();
    setAccountBalance(s, CHECKING, 100000);
    s.loans = [makeLoan()];
    s.liabilities = [makeLiability()];
    const h = harness(s);
    const openingNetWorth = h.state.getTotals().netWorthCents;

    const interest = h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-01').target;
    expect(interest).toBe(13_542);

    const monthlyRate = 0.065 / 12;
    const outstanding = 2_500_000 + interest;
    const expectedPayment = Math.min(
      Math.max(
        roundHalfAwayFromZero(closedFormPmt(2_500_000, 0.065, 60)),
        35_000
      ),
      outstanding
    );

    const installment = h.invoke(loanDefinitionId('loan-1', 'installment'), '2026-01-01');
    expect(installment.target).toBe(expectedPayment);
    expect(installment.result.committed).toBe(true);
    expect(installment.result.plan?.status).toBe('funded');

    const interestPaid = Math.min(expectedPayment, interest);
    const principalPaid = expectedPayment - interestPaid;
    expect(monthlyRate).toBeCloseTo(0.005416666666666667, 15);
    expect(h.state.getLiability('loan-1')?.accruedInterestCents).toBe(interest - interestPaid);
    expect(h.state.getLiability('loan-1')?.principalCents).toBe(2_500_000 - principalPaid);
    expect(h.state.getAccountBalanceCents(CHECKING)).toBe(10_000_000 - expectedPayment);
    // A payment is a cash↔debt exchange: net worth only fell by this month's interest.
    expect(h.state.getTotals().netWorthCents).toBe(openingNetWorth - interest);
  });

  it('retains unpaid interest/principal and reports a missed payment when funding is partial', () => {
    const s = baseScenario();
    setAccountBalance(s, CHECKING, 100);
    s.loans = [makeLoan()];
    s.liabilities = [makeLiability()];
    const h = harness(s);
    const interest = h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-01').target;

    const installment = h.invoke(loanDefinitionId('loan-1', 'installment'), '2026-01-01');
    expect(installment.result.committed).toBe(true);
    expect(installment.result.plan?.executedCents).toBe(10_000);
    // 10,000 cents is below the accrued interest, so all of it is interest-first
    // and principal is untouched.
    expect(h.state.getLiability('loan-1')?.accruedInterestCents).toBe(interest - 10_000);
    expect(h.state.getLiability('loan-1')?.principalCents).toBe(2_500_000);
    expect(h.state.getAccountBalanceCents(CHECKING)).toBe(0);
    const note = (installment.result.diagnostics ?? []).join(' | ');
    expect(note).toContain('shortfall');
    expect(note).toContain('loan-1');
  });

  it('retains the debt and reports a missed payment when funding is zero', () => {
    const s = baseScenario();
    s.loans = [makeLoan()];
    s.liabilities = [makeLiability()];
    const h = harness(s);
    h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-01');

    const installment = h.invoke(loanDefinitionId('loan-1', 'installment'), '2026-01-01');
    expect(installment.result.committed).toBe(false);
    expect(h.state.getLiability('loan-1')?.principalCents).toBe(2_500_000);
    expect(h.state.getLiability('loan-1')?.accruedInterestCents).toBe(13_542);
    expect((installment.result.diagnostics ?? []).join(' ')).toContain('missed');
  });

  it('never drives the liability negative and caps an excess payment at the outstanding debt', () => {
    const s = baseScenario();
    setAccountBalance(s, CHECKING, 100000);
    s.loans = [makeLoan()];
    s.liabilities = [makeLiability({ endYearMonth: '2026-01' })];
    const h = harness(s);
    const interest = h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-01').target;
    const installment = h.invoke(loanDefinitionId('loan-1', 'installment'), '2026-01-01');
    expect(installment.target).toBe(2_500_000 + interest);
    expect(installment.result.committed).toBe(true);
    expect(h.state.getLiability('loan-1')?.principalCents).toBe(0);
    expect(h.state.getLiability('loan-1')?.accruedInterestCents).toBe(0);
  });

  it('applies the discretionary extra after the mandatory installment', () => {
    const s = baseScenario();
    setAccountBalance(s, CHECKING, 100000);
    s.loans = [makeLoan({ extraMonthlyPayment: 1000 })];
    s.liabilities = [makeLiability()];
    const h = harness(s);
    h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-01');
    h.invoke(loanDefinitionId('loan-1', 'installment'), '2026-01-01');
    const principalAfterMandatory = h.state.getLiability('loan-1')?.principalCents ?? 0;

    const extra = h.invoke(loanDefinitionId('loan-1', 'extra'), '2026-01-01');
    expect(extra.target).toBe(100_000);
    expect(extra.result.committed).toBe(true);
    expect(h.state.getLiability('loan-1')?.principalCents).toBe(principalAfterMandatory - 100_000);
  });
});

describe('loans — down payment', () => {
  it('issues one account-funded down-payment request and none when terms require none', () => {
    const withDown = baseScenario();
    setAccountBalance(withDown, CHECKING, 100000);
    withDown.loans = [makeLoan({ downPayment: 2000, downPaymentSource: `account:${CHECKING}` })];
    withDown.liabilities = [makeLiability()];
    const h = harness(withDown);

    const { target, result } = h.invoke(loanDefinitionId('loan-1', 'downPayment'), '2026-01-01');
    expect(target).toBe(200_000);
    expect(result.committed).toBe(true);
    expect(h.state.getAccountBalanceCents(CHECKING)).toBe(9_800_000);
    expect(h.state.getLiability('loan-1')?.principalCents).toBe(2_500_000);

    const noDown = baseScenario();
    noDown.loans = [makeLoan()];
    noDown.liabilities = [makeLiability()];
    const definitions = buildLoanEventDefinitions(compileScenarioContext(noDown, { horizonMonths: 12 })).definitions;
    expect(definitions.some((definition) => definition.purpose === LOAN_DOWN_PAYMENT_PURPOSE)).toBe(false);
  });
});

describe('loans — sourceConfigId linkage', () => {
  it('links a loan id that differs from the liability id and accrues/repays the actual debt', () => {
    const s = baseScenario();
    setAccountBalance(s, CHECKING, 100000);
    s.loans = [makeLoan({ id: 'loan-A' })];
    s.liabilities = [
      {
        id: 'liability-X',
        kind: 'loan',
        openingBalance: 25000,
        annualInterestRate: 6.5,
        minimumMonthlyPayment: 350,
        endYearMonth: '2030-12',
        paymentDay: 1,
        sourceConfigId: 'loan-A'
      }
    ];
    const h = harness(s);
    const plan = collectLoanLinks(h.context);
    expect(plan.links).toHaveLength(1);
    // The resolved liability's own id is returned, not the raw loan id.
    expect(plan.links[0]?.liabilityId).toBe('liability-X');
    expect(h.state.getLiability('loan-A')).toBeUndefined();

    const interest = h.invoke(loanDefinitionId('loan-A', 'accrual'), '2026-01-01').target;
    expect(interest).toBe(13_542);
    expect(h.state.getLiability('liability-X')?.accruedInterestCents).toBe(13_542);

    const installment = h.invoke(loanDefinitionId('loan-A', 'installment'), '2026-01-01');
    expect(installment.result.committed).toBe(true);
    expect(h.state.getLiability('liability-X')?.accruedInterestCents).toBe(0);
    expect(h.state.getLiability('liability-X')?.principalCents).toBeLessThan(2_500_000);
  });

  it('leaves an ambiguous duplicate sourceConfigId link unresolved with no money moved', () => {
    const s = baseScenario();
    setAccountBalance(s, CHECKING, 100000);
    s.loans = [makeLoan({ id: 'loan-A' })];
    s.liabilities = [
      { id: 'liab-b', kind: 'loan', openingBalance: 100, sourceConfigId: 'loan-A' },
      { id: 'liab-a', kind: 'loan', openingBalance: 200, sourceConfigId: 'loan-A' }
    ];
    const context = compileScenarioContext(s, { horizonMonths: 12 });
    const plan = collectLoanLinks(context);
    expect(plan.links).toHaveLength(0);
    expect(plan.diagnostics.some((diagnostic) => diagnostic.code === 'unknown-liability')).toBe(true);
    expect(buildLoanEventDefinitions(context).definitions).toHaveLength(0);

    const h = harness(s);
    expect(h.build.definitions).toHaveLength(0);
    const run = projectScenario(s, {
      horizonMonths: 12,
      events: h.build.definitions,
      handlerFactory: createLoanHandlerFactory()
    });
    expect(run.totals.executedPlanCount).toBe(0);
    expect(run.totals.closingNetWorthCents).toBe(run.totals.openingNetWorthCents);
  });
});

describe('loans — facade ordering and replenishment', () => {
  it('does not let a later-dated deposit fund an earlier same-month payment, but replenishes later months', () => {
    const s = baseScenario();
    s.loans = [makeLoan()];
    s.liabilities = [makeLiability({ paymentDay: 20 })];
    const context = compileScenarioContext(s, { horizonMonths: 2 });
    const build = buildLoanEventDefinitions(context);

    const incomeEvent: EventDefinition = {
      definitionId: 'income-1',
      phase: 'income',
      purpose: 'income',
      recurrence: { frequency: 'oneTime', startDate: '2026-01-25' },
      handlerId: 'income',
      resolveTarget: () => 50_000
    };
    const incomeFactory: ProjectionHandlerFactory = () => [
      {
        handlerId: 'income',
        execute({ targetCents, deps }) {
          const commit = deps.state.commitChanges({
            revision: deps.state.getRevision(),
            accountChanges: [{ accountId: CHECKING, deltaCents: targetCents }],
            expectedNetWorthDeltaCents: targetCents,
            posting: LOAN_TEST_POSTING
          });
          return { committed: commit.committed, plan: null, diagnostics: commit.errors.map((error) => error.message) };
        }
      }
    ];

    const run = projectScenario(s, {
      horizonMonths: 2,
      events: [...build.definitions, incomeEvent],
      handlerFactory: composeHandlerFactories(incomeFactory, createLoanHandlerFactory())
    });

    const installmentId = loanDefinitionId('loan-1', 'installment');
    const funded = run.plans.filter(
      (audit) => audit.definitionId === installmentId && audit.status === 'funded'
    );
    expect(funded).toHaveLength(1);
    expect(funded[0]?.date).toBe('2026-02-20');
    expect(run.diagnostics.some((note) => note.includes('loan-1') && note.includes('missed'))).toBe(true);
    expect(run.diagnostics.some((note) => note.includes('2026-01-20'))).toBe(true);
  });
});

describe('loans — audit attribution (P4.1 / D15)', () => {
  it('journals the direct interest accrual as an interest-only liability delta (phase accrual)', () => {
    const s = baseScenario();
    s.loans = [makeLoan()];
    s.liabilities = [makeLiability()];
    const h = harness(s);
    const openingPrincipal = h.state.getLiability('loan-1')?.principalCents;
    const openingNetWorth = h.state.getTotals().netWorthCents;

    const { target } = h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-01');
    expect(target).toBe(13_542);

    const postings = h.state.getPostings();
    expect(postings).toHaveLength(1);
    const record = postings[0];
    expect(record?.posting).toMatchObject({
      occurrenceId: `${loanDefinitionId('loan-1', 'accrual')}:2026-01-01`,
      definitionId: loanDefinitionId('loan-1', 'accrual'),
      purpose: LOAN_ACCRUAL_PURPOSE,
      date: '2026-01-01',
      phase: 'accrual'
    });
    expect(record?.accountChanges).toEqual([]);
    expect(record?.liabilityChanges).toEqual([
      { liabilityId: 'loan-1', accruedInterestDeltaCents: 13_542 }
    ]);
    expect(record?.expectedNetWorthDeltaCents).toBe(-13_542);
    // Principal untouched; the delta is interest only.
    expect(h.state.getLiability('loan-1')?.principalCents).toBe(openingPrincipal);
    expect(h.state.getTotals().netWorthCents).toBe(openingNetWorth - 13_542);
  });

  it('writes no accrual posting when the target is zero', () => {
    const s = baseScenario();
    s.loans = [makeLoan({ annualInterestRate: 0 })];
    s.liabilities = [makeLiability({ annualInterestRate: 0 })];
    const h = harness(s);
    const { target, result } = h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-01');
    expect(target).toBe(0);
    expect(result.committed).toBe(false);
    expect(h.state.getPostings()).toHaveLength(0);
    expect(h.state.getRevision()).toBe(0);
  });

  it('writes one posting per committed installment, touching account and liability with the gross identity intact', () => {
    const s = baseScenario();
    setAccountBalance(s, CHECKING, 100000);
    s.loans = [makeLoan()];
    s.liabilities = [makeLiability()];
    const h = harness(s);
    const interest = h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-01').target;
    const installment = h.invoke(loanDefinitionId('loan-1', 'installment'), '2026-01-01');
    const payment = installment.target;
    const plan = installment.result.plan;
    expect(plan).toBeTruthy();

    const postings = h.state.getPostingsByDefinition(loanDefinitionId('loan-1', 'installment'));
    expect(postings).toHaveLength(1);
    const record = postings[0];
    expect(record?.posting.purpose).toBe('loanInstallment');
    expect(record?.posting.phase).toBe('mandatory');
    expect(record?.posting.occurrenceId).toBe(`${loanDefinitionId('loan-1', 'installment')}:2026-01-01`);

    const interestPaid = Math.min(payment, interest);
    const principalPaid = payment - interestPaid;
    expect(record?.liabilityChanges).toEqual([
      { liabilityId: 'loan-1', accruedInterestDeltaCents: -interestPaid, principalDeltaCents: -principalPaid }
    ]);

    const allocations = plan?.allocations ?? [];
    const gross = allocations.reduce((total, allocation) => total + allocation.grossDebitCents, 0);
    expect(record?.accountChanges).toEqual([{ accountId: CHECKING, deltaCents: -gross }]);
    expect(h.state.getPostingsByAccount(CHECKING)).toHaveLength(1);

    // gross = net + tax + penalty is unchanged by audit attribution.
    const net = allocations.reduce((total, allocation) => total + allocation.netFundedCents, 0);
    const tax = allocations.reduce((total, allocation) => total + allocation.withheldTaxCents, 0);
    const penalty = allocations.reduce((total, allocation) => total + allocation.penaltyCents, 0);
    expect(gross).toBe(net + tax + penalty);
  });

  it('writes no posting for an unfunded installment and does not advance the revision', () => {
    const s = baseScenario();
    s.loans = [makeLoan()];
    s.liabilities = [makeLiability()];
    const h = harness(s);
    h.invoke(loanDefinitionId('loan-1', 'accrual'), '2026-01-01');
    const revisionBefore = h.state.getRevision();
    const postingsBefore = h.state.getPostings().length;

    const installment = h.invoke(loanDefinitionId('loan-1', 'installment'), '2026-01-01');
    expect(installment.result.committed).toBe(false);
    expect(h.state.getPostings()).toHaveLength(postingsBefore);
    expect(h.state.getRevision()).toBe(revisionBefore);
  });

  it('tags a committed down-payment posting with its own purpose and account debit', () => {
    const s = baseScenario();
    setAccountBalance(s, CHECKING, 100000);
    s.loans = [makeLoan({ downPayment: 2000, downPaymentSource: `account:${CHECKING}` })];
    s.liabilities = [makeLiability()];
    const h = harness(s);

    const { result } = h.invoke(loanDefinitionId('loan-1', 'downPayment'), '2026-01-01');
    expect(result.committed).toBe(true);
    const postings = h.state.getPostingsByDefinition(loanDefinitionId('loan-1', 'downPayment'));
    expect(postings).toHaveLength(1);
    expect(postings[0]?.posting.purpose).toBe(LOAN_DOWN_PAYMENT_PURPOSE);
    expect(postings[0]?.posting.phase).toBe('mandatory');
    expect(postings[0]?.accountChanges).toEqual([{ accountId: CHECKING, deltaCents: -200_000 }]);
    expect(postings[0]?.liabilityChanges).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// P4.1 / D16 — funding outcomes for unfunded loan quotes
// ---------------------------------------------------------------------------

describe('loans — D16 funding outcomes (P4.1)', () => {
  /** A 0% loan isolates the installment quote (no interest accrual posting). */
  const zeroInterestLoan = (over: Partial<Loan> = {}): Loan =>
    makeLoan({ annualInterestRate: 0, extraMonthlyPayment: 0, downPayment: 0, ...over });

  const oneMonthLoanRun = (scenario: Scenario) => {
    const context = compileScenarioContext(scenario, { horizonMonths: 1 });
    const build = buildLoanEventDefinitions(context);
    return projectScenario(scenario, {
      horizonMonths: 1,
      events: build.definitions,
      handlerFactory: createLoanHandlerFactory()
    });
  };

  const INSTALLMENT_ID = loanDefinitionId('loan-1', 'installment');
  // 2,500,000¢ over 60 inclusive months at 0% ⇒ ceil-rounded standard install.
  const EXPECTED_REQUESTED = 41_667;

  it('records an unfunded/empty-evidence outcome for an accountless positive installment (no plan, no posting)', () => {
    const s = baseScenario();
    s.fundingPolicy = { primaryAccountId: null, fallbackAccountIds: [] };
    s.loans = [zeroInterestLoan({ paymentSource: undefined, paymentSourceAccount: 'income' })];
    s.liabilities = [makeLiability({ annualInterestRate: 0 })];

    const run = oneMonthLoanRun(s);

    expect(run.plans).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
    expect(run.totals.executedPlanCount).toBe(0);
    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.committed).toBe(false);
    expect(outcome.definitionId).toBe(INSTALLMENT_ID);
    expect(outcome.plan.request.requestedCents).toBe(EXPECTED_REQUESTED);
    expect(outcome.plan.executedCents).toBe(0);
    expect(outcome.plan.shortfallCents).toBe(EXPECTED_REQUESTED);
    expect(outcome.plan.status).toBe('unfunded');
    expect(outcome.eligibleSources).toEqual([]);
    expect(outcome.skippedSources).toEqual([]);
  });

  it('records eligible-source evidence and a zero-balance skip for a zero-fund installment', () => {
    const s = baseScenario();
    s.loans = [zeroInterestLoan()];
    s.liabilities = [makeLiability({ annualInterestRate: 0 })];

    const run = oneMonthLoanRun(s);

    expect(run.plans).toHaveLength(0);
    expect(run.postings).toHaveLength(0);
    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.committed).toBe(false);
    expect(outcome.plan.shortfallCents).toBe(EXPECTED_REQUESTED);
    expect(outcome.plan.status).toBe('unfunded');
    expect(outcome.eligibleSources).toEqual([{ accountId: CHECKING, balanceCents: 0 }]);
    expect(outcome.skippedSources.map((skip) => skip.reason)).toContain('zero-balance');
  });

  it('records exactly one partial outcome when a fallback source funds part of an installment', () => {
    const s = baseScenario();
    setAccountBalance(s, EMERGENCY, 20);
    s.fundingPolicy = { primaryAccountId: CHECKING, fallbackAccountIds: [EMERGENCY] };
    s.loans = [zeroInterestLoan({ paymentSource: undefined, paymentSourceAccount: 'income' })];
    s.liabilities = [makeLiability({ annualInterestRate: 0 })];

    const run = oneMonthLoanRun(s);

    expect(run.fundingOutcomes).toHaveLength(1);
    const [outcome] = run.fundingOutcomes;
    expect(outcome.committed).toBe(true);
    expect(outcome.plan.status).toBe('partial');
    expect(outcome.plan.request.requestedCents).toBe(EXPECTED_REQUESTED);
    expect(outcome.plan.executedCents).toBe(2000);
    expect(outcome.plan.shortfallCents).toBe(EXPECTED_REQUESTED - 2000);
    expect(outcome.eligibleSources.map((source) => source.accountId)).toEqual([CHECKING, EMERGENCY]);
    expect(run.plans).toHaveLength(1);
  });
});

