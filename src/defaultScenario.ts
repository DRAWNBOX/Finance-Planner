import type {
  CareerEntry,
  CashflowCategory,
  CashflowItem,
  LargePurchase,
  Loan,
  LongTermPurchase,
  Scenario
} from './types';
import { formatYearMonthFromAge } from './utils/ageDate';
import {
  ensureSourceLinesForPurchase,
  ensureSourceLinesForWithdrawal,
  getDefaultBankAccountIdForPool,
  normalizeLoanPaymentSource,
  seedDefaultBankAccounts,
  seedDefaultPools
} from './financeModel';

const makeItemId = (category: CashflowCategory) => `${category}-default`;

export const createDefaultCashflowItem = (
  category: CashflowCategory,
  currentAge: number,
  retirementAge: number,
  retirementYears: number
): CashflowItem => {
  const retirementEndAge = retirementAge + retirementYears;

  switch (category) {
    case 'social_security':
      return {
        id: makeItemId(category),
        category,
        label: 'Social Security',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        amount: 24000,
        startAge: retirementAge,
        endAge: retirementEndAge,
        inflationAdjusted: true
      };
    case 'social_security_spouse':
      return {
        id: makeItemId(category),
        category,
        label: 'SS (Spouse)',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        amount: 18000,
        startAge: retirementAge,
        endAge: retirementEndAge,
        inflationAdjusted: true
      };
    case 'inheritance':
      return {
        id: makeItemId(category),
        category,
        label: 'Inheritance',
        enabled: true,
        cadence: 'one_time',
        direction: 'inflow',
        amount: 50000,
        startAge: retirementAge + 5,
        endAge: retirementAge + 5,
        inflationAdjusted: false
      };
    case 'college_child_1':
    case 'college_child_2':
    case 'college_child_3':
      return {
        id: makeItemId(category),
        category,
        label:
          category === 'college_child_1'
            ? 'College Child 1'
            : category === 'college_child_2'
              ? 'College Child 2'
              : 'College Child 3',
        enabled: true,
        cadence: 'recurring',
        direction: 'outflow',
        amount: 12000,
        startAge: currentAge + 5,
        endAge: currentAge + 8,
        inflationAdjusted: true
      };
    case 'pension_1':
      return {
        id: makeItemId(category),
        category,
        label: 'Pension 1',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        amount: 15000,
        startAge: retirementAge,
        endAge: retirementEndAge,
        inflationAdjusted: true
      };
    case 'pension_2':
      return {
        id: makeItemId(category),
        category,
        label: 'Pension 2',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        amount: 10000,
        startAge: retirementAge,
        endAge: retirementEndAge,
        inflationAdjusted: true
      };
    case 'cash_benefit_1':
      return {
        id: makeItemId(category),
        category,
        label: 'Cash Benefit 1',
        enabled: true,
        cadence: 'one_time',
        direction: 'inflow',
        amount: 25000,
        startAge: retirementAge + 3,
        endAge: retirementAge + 3,
        inflationAdjusted: false
      };
    case 'cash_benefit_2':
      return {
        id: makeItemId(category),
        category,
        label: 'Cash Benefit 2',
        enabled: true,
        cadence: 'one_time',
        direction: 'inflow',
        amount: 15000,
        startAge: retirementAge + 10,
        endAge: retirementAge + 10,
        inflationAdjusted: false
      };
    case 'home_real_estate':
      return {
        id: makeItemId(category),
        category,
        label: 'Home/Real Estate',
        enabled: true,
        cadence: 'one_time',
        direction: 'inflow',
        amount: 80000,
        startAge: retirementAge + 8,
        endAge: retirementAge + 8,
        inflationAdjusted: false
      };
  }
};

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const makeCareerId = (index: number) => `career-${index + 1}-default`;
const makePurchaseId = () => `purchase-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeLongTermPurchaseId = () => `long-term-purchase-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeLoanId = () => `loan-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const defaultPoolBalances = { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 } as const;
const defaultBankAccounts = seedDefaultBankAccounts({ ...defaultPoolBalances });
const defaultCareerSourceLines = defaultBankAccounts.map((account) => ({
  id: `career-source-${account.id}`,
  enabled: true,
  sourceType: 'account' as const,
  sourceId: account.id,
  contributionRate:
    account.poolId === 'emergencyFund'
      ? 2
      : account.poolId === 'hsa'
        ? 3
        : account.poolId === 'investments'
          ? 6
          : account.poolId === 'retirement401k'
            ? 6
            : 0,
  savingsMonthly: false,
  monthlyWithdrawal: 0,
  maxBalance: 0,
  overflowFallbackAccountId: null
}));

export const createDefaultCareerEntry = (
  index: number,
  currentAge: number,
  retirementAge: number
): CareerEntry => {
  const base: CareerEntry = {
  id: makeCareerId(index),
  label: index === 0 ? 'Current Career' : `Career ${index + 1}`,
  enabled: true,
  usePreviousCareerStartAge: false,
  useBirthdayBasedStartAge: false,
  startYearMonth: '',
  endYearMonth: '',
  startAge: index === 0 ? currentAge : currentAge + index * 5,
  endAge: index === 0 ? retirementAge : Math.min(retirementAge, currentAge + index * 5 + 4),
  startingSalary: index === 0 ? 98000 : 110000 + index * 12000,
  annualRaiseRate: index === 0 ? 3.5 : 3,
  savingsRate: index === 0 ? 10 : 9,
  employerMatchRate: index === 0 ? 3 : 2,
  bonusRate: index === 0 ? 8 : 5,
  bonusSavingsRate: index === 0 ? 50 : 40,
  emergencyFundContributionRate: 2,
  hsaContributionRate: 3,
  investmentsContributionRate: 6,
  retirement401kContributionRate: 6,
  emergencyFundSavingsMonthly: false,
  hsaSavingsMonthly: false,
  investmentsSavingsMonthly: false,
  retirement401kSavingsMonthly: false,
  emergencyFundStartBalanceMode: 'auto',
  hsaStartBalanceMode: 'auto',
  investmentsStartBalanceMode: 'auto',
  retirement401kStartBalanceMode: 'auto',
  emergencyFundManualStartBalance: 0,
  hsaManualStartBalance: 0,
  investmentsManualStartBalance: 0,
  retirement401kManualStartBalance: 0,
  emergencyFundMonthlyWithdrawal: 0,
  hsaMonthlyWithdrawal: 0,
  investmentsMonthlyWithdrawal: 0,
  retirement401kMonthlyWithdrawal: 0
  };

  return {
    ...base,
    sourceLines: defaultCareerSourceLines.map((line) => ({ ...line })),
    taxInfo: { untaxedBenefits: 0, leftoverIncome: 0, taxRate: 0, lastEditedField: null }
  };
};

export const createDefaultLargePurchase = (currentAge: number, dateOfBirth: string): LargePurchase => ({
  ...(() => {
    const defaultAccountId = getDefaultBankAccountIdForPool(defaultBankAccounts, 'investments') ?? defaultBankAccounts[0]?.id ?? '';
    const purchase: LargePurchase = {
      id: makePurchaseId(),
  label: 'Large Purchase',
  enabled: true,
  showOnGraph: true,
  yearMonth: formatYearMonthFromAge(currentAge + 1, dateOfBirth, currentAge),
  age: currentAge + 1,
  amount: 10000,
  sourceAmounts: {
    emergencyFund: 0,
    hsa: 0,
    investments: 10000,
    retirement401k: 0
  },
  fundingSource: `account:${defaultAccountId}`
    };

    return { ...purchase, sourceLines: ensureSourceLinesForPurchase(purchase, defaultBankAccounts) };
  })()
});

export const createDefaultLongTermPurchase = (
  currentAge: number,
  dateOfBirth: string
): LongTermPurchase => ({
  ...(() => {
    const defaultAccountId = getDefaultBankAccountIdForPool(defaultBankAccounts, 'investments') ?? defaultBankAccounts[0]?.id ?? '';
    const purchase: LongTermPurchase = {
      id: makeLongTermPurchaseId(),
  label: 'Long-Term Purchase',
  enabled: true,
  showOnGraph: true,
  startYearMonth: formatYearMonthFromAge(currentAge + 1, dateOfBirth, currentAge),
  endMode: 'duration',
  durationMonths: 12,
  endYearMonth: formatYearMonthFromAge(currentAge + 2, dateOfBirth, currentAge),
  monthlyAmount: 500,
  sourceAmounts: {
    emergencyFund: 0,
    hsa: 0,
    investments: 500,
    retirement401k: 0
  },
  fundingSource: `account:${defaultAccountId}`
    };

    return { ...purchase, sourceLines: ensureSourceLinesForPurchase(purchase, defaultBankAccounts) };
  })()
});

export const createDefaultLoan = (currentAge: number, dateOfBirth: string): Loan => ({
  ...(() => {
    const loan: Loan = {
      id: makeLoanId(),
  label: 'Loan',
  enabled: true,
  showOnGraph: true,
  startYearMonth: formatYearMonthFromAge(currentAge, dateOfBirth, currentAge),
  originalAmount: 25000,
  downPayment: 0,
  currentBalance: 25000,
  annualInterestRate: 6.5,
  minimumMonthlyPayment: 350,
  extraMonthlyPayment: 0,
  paymentSourceAccount: 'investments'
    };

    return { ...loan, paymentSource: normalizeLoanPaymentSource(loan, defaultBankAccounts) };
  })()
});

export const defaultScenario: Scenario = {
  profile: {
    currentAge: 45,
    retirementAge: 65,
    retirementYears: 30
  },
  options: {
    useDateBasedAge: false,
    dateOfBirth: '1980-10-01'
  },
  portfolio: {
    currentAssets: 500000,
    equityAllocation: 75,
    fixedIncomeAllocation: 25,
    fixedIncomeDuration: 'one_year'
  },
  contribution: {
    yearlyContribution: 17500,
    yearlyIncreaseRate: 2.9
  },
  careerPlan: {
    enabled: true,
    entries: [createDefaultCareerEntry(0, 45, 65)]
  },
  savingsTracker: {
    annualInterestRates: {
      emergencyFund: 2.5,
      hsa: 5,
      investments: 6.5,
      retirement401k: 6
    }
  },
  netWorth: {
    accountBalances: {
      emergencyFund: 0,
      hsa: 0,
      investments: 0,
      retirement401k: 0
    },
    pools: seedDefaultPools(),
    bankAccounts: defaultBankAccounts,
    customAccounts: [],
    imports: [],
    history: [],
    asOfDate: ''
  },
  futureRetirement: {
    useCareerEndAge: true,
    retirementAge: 65,
    retirementYears: 30
  },
  withdrawal: {
    mode: 'specified',
    firstYearAmount: 40000,
    minimumYearlyWithdrawal: 0,
    maximumYearlyWithdrawal: 1000000,
    useRetirementAgeAsWithdrawalStartAge: true,
    firstYearAccountWithdrawals: {
      emergencyFund: 0,
      hsa: 0,
      investments: 0,
      retirement401k: 40000
    },
    firstYearAccountUseFourPercent: {
      emergencyFund: false,
      hsa: false,
      investments: false,
      retirement401k: false
    },
    sourceLines: ensureSourceLinesForWithdrawal({
      mode: 'specified',
      firstYearAmount: 40000,
      minimumYearlyWithdrawal: 0,
      maximumYearlyWithdrawal: 1000000,
      useRetirementAgeAsWithdrawalStartAge: true,
      firstYearAccountWithdrawals: {
        emergencyFund: 0,
        hsa: 0,
        investments: 0,
        retirement401k: 40000
      },
      firstYearAccountUseFourPercent: {
        emergencyFund: false,
        hsa: false,
        investments: false,
        retirement401k: false
      },
      inflationAdjusted: true
    }),
    inflationAdjusted: true
  },
  returnMode: 'manual',
  manualReturns: {
    inflationEnabled: true,
    inflationRate: 2.9,
    preRetirementEquityReturn: 5,
    postRetirementEquityReturn: 5,
    fixedIncomeReturn: 2.9
  },
  largePurchases: [],
  longTermPurchases: [],
  loans: [],
  incomeFallbackAccountId: null,
  incomeFallbackAccountId2: null,
  cashflowItems: [],
  lifeEvents: [],
  expenses: {
    entries: [],
    imports: [],
    categoriesByAccountId: {},
    weeklyBalanceByAccountId: {},
    maxBalanceByAccountId: {},
    activePlanningAccountId: null,
    recurringEvents: [],
    ui: {
      groupingMode: 'account',
      zoomLevel: 1,
      rowHeight: 56,
      density: 'comfortable',
      snapToDay: true,
      scrubberDate: toIsoDate(addDays(new Date(), 7)),
      windowStartDate: toIsoDate(addDays(new Date(), 7)),
      windowEndDate: toIsoDate(addDays(new Date(), 365)),
      selectedAccountIds: [],
      selectedPoolIds: [],
      collapsedTrackIds: [],
      trackerVisibleAccountIds: [],
      planningWeekStartDay: 5
    }
  }
};
