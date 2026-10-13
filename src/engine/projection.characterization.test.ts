import { describe, expect, it } from 'vitest';
import { createDefaultCreditCard, createDefaultHousingEntry, createDefaultLoan, defaultScenario } from '../defaultScenario';
import { compilePaycheck } from '../paycheck';
import type { Scenario } from '../types';
import { projectScenario } from './projection';

// Current regression expectations after the approved manual-contribution removal.
// Original full baselines remain in refactor/fixtures/projection.pre-refactor.snap.
// Local timestamp avoids the engine's date-only UTC parsing shifting the month
// in time zones west of UTC. Date-only anchoring is audited separately.
const startDate = '2026-01-01T00:00:00';
const accountId = 'investments-account-default';
const retirementId = 'retirement401k-account-default';

const baseScenario = (): Scenario => {
  const scenario: Scenario = structuredClone(defaultScenario);
  scenario.options.dateOfBirth = 'invalid-date'; // Exactly twelve months per period.
  scenario.profile = { currentAge: 45, retirementAge: 46, retirementYears: 1 };
  scenario.portfolio.currentAssets = 0;
  scenario.manualReturns.inflationEnabled = false;
  scenario.netWorth.bankAccounts = scenario.netWorth.bankAccounts!.map((account) => ({ ...account, balance: account.id === accountId ? 10000 : 0 }));
  scenario.netWorth.pools = scenario.netWorth.pools!.map((pool) => ({ ...pool, preRetirementReturnRate: 0, postRetirementReturnRate: 0 }));
  scenario.withdrawal.sourceLines = [];
  scenario.careerPlan.entries = [];
  scenario.expenses.ui.scrubberDate = '2026-01-01';
  scenario.expenses.ui.windowStartDate = '2026-01-01';
  scenario.expenses.ui.windowEndDate = '2026-12-31';
  return scenario;
};

const withCareer = (): Scenario => {
  const scenario = baseScenario();
  const career = structuredClone(defaultScenario.careerPlan.entries[0]);
  career.startAge = 45;
  career.endAge = 45;
  career.startYearMonth = '2026-01';
  career.endYearMonth = '2026-12';
  career.annualRaiseRate = 0;
  career.sourceLines = [];
  career.paycheck = {
    payFrequency: 'monthly',
    categories: [{ id: 'earnings', label: 'Earnings', kind: 'earning', lines: [{ id: 'pay', label: 'Pay', amount: 1000, mode: 'amount' }] }]
  };
  career.paycheckInfo = compilePaycheck(career.paycheck);
  scenario.careerPlan.entries = [career];
  return scenario;
};

const scenarios: Record<string, () => Scenario> = {
  'opening balances and exact APY': () => {
    const scenario = baseScenario();
    scenario.netWorth.pools = scenario.netWorth.pools!.map((pool) => ({ ...pool, preRetirementReturnRate: 6.5, postRetirementReturnRate: 6.5 }));
    return scenario;
  },
  'payroll deposits, matching, capped savings and monthly expenses': () => {
    const scenario = withCareer();
    const career = scenario.careerPlan.entries[0];
    career.paycheck!.categories.push(
      { id: 'tax', label: 'Tax', kind: 'tax', lines: [{ id: 'tax-line', label: 'Tax', amount: 100, mode: 'amount' }] },
      { id: 'retirement', label: '401K', kind: 'pretax', lines: [{ id: '401k-line', label: '401K', amount: 50, mode: 'amount', bucket: 'retirement', accountId: retirementId }] },
      { id: 'match', label: 'Match', kind: 'employer', lines: [{ id: 'match-line', label: 'Match', amount: 25, mode: 'amount', bucket: 'retirement', accountId: retirementId }] }
    );
    career.paycheckInfo = compilePaycheck(career.paycheck!);
    career.sourceLines = [{ id: 'savings', enabled: true, sourceType: 'account', sourceId: accountId, contributionRate: 10, savingsMonthly: true, monthlyWithdrawal: 20, maxBalance: 10050, overflowFallbackAccountId: 'emergencyFund-account-default' }];
    return scenario;
  },
  'monthly and annual spending use independent income budgets': () => {
    const scenario = withCareer();
    scenario.creditCards = [{ ...createDefaultCreditCard(), id: 'ordinary', paymentMode: 'autopay', fixedPaymentAmount: 1000, autopayEndYearMonth: '2026-12' }];
    scenario.loans = [{ ...createDefaultLoan(45, 'invalid-date'), id: 'loan', startYearMonth: '2026-01', currentBalance: 12000, originalAmount: 12000, annualInterestRate: 0, minimumMonthlyPayment: 1000, paymentSource: 'income' }];
    return scenario;
  },
  'split fallback and tax-aware retirement exhaustion': () => {
    const scenario = baseScenario();
    scenario.profile = { currentAge: 65, retirementAge: 65, retirementYears: 1 };
    scenario.netWorth.bankAccounts = scenario.netWorth.bankAccounts!.map((account) => ({ ...account, balance: account.id === retirementId ? 1000 : account.id === accountId ? 500 : 0 }));
    scenario.netWorth.pools = scenario.netWorth.pools!.map((pool) => ({ ...pool, taxRate: pool.id === 'retirement401k' ? 20 : 0 }));
    scenario.withdrawal.sourceLines = [{ id: 'retire', enabled: true, sourceType: 'pool', sourceId: 'retirement401k', mode: 'amount', amount: 2400 }];
    return scenario;
  },
  'all credit card modes with interest, intro period and shortfalls': () => {
    const scenario = baseScenario();
    scenario.netWorth.bankAccounts!.find((account) => account.id === accountId)!.balance = 500;
    scenario.creditCards = ['fixed', 'minimum', 'payInFull', 'fixedPlusLump', 'autopay'].map((mode) => ({
      ...createDefaultCreditCard(), id: `card-${mode}`, paymentMode: mode as Scenario['creditCards'][number]['paymentMode'],
      currentBalance: 300, monthlyCharges: 10, introEnabled: true, introEndYearMonth: '2026-04',
      paymentSource: `account:${accountId}`, lumpSumPaymentSource: `account:${accountId}`, autopayEndYearMonth: '2026-03'
    }));
    return scenario;
  },
  'mortgage funding failure, rental income and home sale': () => {
    const scenario = baseScenario();
    scenario.netWorth.bankAccounts!.find((account) => account.id === accountId)!.balance = 100;
    scenario.housing = [{ ...createDefaultHousingEntry(45, 'invalid-date'), id: 'home', startYearMonth: '2026-01', sellYearMonth: '2026-04', purchasePrice: 12000, downPayment: 0, annualInterestRate: 0, loanTermYears: 1, extraMonthlyPayment: 0, propertyTaxYearly: 0, homeInsuranceYearly: 0, maintenanceMonthly: 0, pmiMonthly: 0, rentalIncomeMonthly: 50, rentalIncomeAccountId: accountId, saleProceedsAccountId: accountId, appreciationRate: 0, sellingCostsRate: 0, paymentSource: `account:${accountId}` }];
    return scenario;
  },
  'scheduled purchases, cashflow and life events': () => {
    const scenario = baseScenario();
    scenario.largePurchases = [{ id: 'purchase', label: 'Purchase', enabled: true, showOnGraph: true, yearMonth: '2026-02', age: 45, amount: 400, fundingSource: `account:${accountId}`, sourceLines: [{ id: 'purchase-source', enabled: true, sourceType: 'account', sourceId: accountId, mode: 'amount', amount: 400 }] }];
    scenario.longTermPurchases = [{ id: 'recurring', label: 'Recurring', enabled: true, showOnGraph: true, startYearMonth: '2026-03', endMode: 'duration', durationMonths: 3, endYearMonth: '2026-05', monthlyAmount: 200, fundingSource: `account:${accountId}`, sourceLines: [{ id: 'recurring-source', enabled: true, sourceType: 'account', sourceId: accountId, mode: 'amount', amount: 200 }] }];
    scenario.cashflowItems = [{ id: 'pension', category: 'pension_1', label: 'Pension', enabled: true, cadence: 'recurring', direction: 'inflow', amount: 1200, startAge: 45, endAge: 45, startYearMonth: '2026-01', endYearMonth: '2026-12', accountId }];
    scenario.lifeEvents = [{ id: 'event', type: 'custom_expense', label: 'Event', enabled: true, cadence: 'one_time', direction: 'outflow', amount: 75, startAge: 45, endAge: 45, startYearMonth: '2026-04', newSalary: 0, annualSalaryGrowthOverride: 0, accountId }];
    return scenario;
  },
  'partial first period and effective pay plan': () => {
    const scenario = withCareer();
    scenario.options.dateOfBirth = '1980-07-01';
    const paycheck = structuredClone(scenario.careerPlan.entries[0].paycheck!);
    paycheck.categories[0].lines[0].amount = 2000;
    scenario.careerPlan.entries[0].payPlans = [{ id: 'raise', label: 'Raise', effectiveYearMonth: '2026-04', paycheck, sourceLines: [] }];
    return scenario;
  },
  'ignores obsolete manual contribution fields without injecting income': () => {
    const scenario = baseScenario();
    Object.assign(scenario, { contribution: { yearlyContribution: 1200, yearlyIncreaseRate: 2.9 } });
    return scenario;
  }
};

describe('projection characterization', () => {
  for (const [name, createScenario] of Object.entries(scenarios)) {
    it(name, () => {
      const scenario = createScenario();
      const inputBefore = structuredClone(scenario);
      const result = projectScenario(scenario, { startDate });
      expect(scenario).toEqual(inputBefore);
      expect(projectScenario(scenario, { startDate })).toEqual(result);
      // Preserve full inputs and outputs, including every month's activity and warnings.
      expect({ startDate, scenario, result }).toMatchSnapshot();
    });
  }
});
