import type {
  AccountDefinition,
  AccountTypePreset,
  AccountWithdrawalPolicy,
  CareerDepositPlan,
  CareerEntry,
  CareerSourceLine,
  CashflowCategory,
  CashflowItem,
  ExpensesConfig,
  FundingPolicy,
  HousingEntry,
  LargePurchase,
  Loan,
  LongTermPurchase,
  OrdinaryCardSchedule,
  RetirementWithdrawalSourceLine,
  Scenario,
  ZeroInterestCardPlan
} from './types';
import { addMonthsToYearMonth, formatYearMonthFromAge } from './utils/ageDate';
import { createDefaultPaycheck } from './paycheck';

/**
 * P1.2 canonical factories and defaults (account-only target schema).
 *
 * Rules:
 * - Every factory returns a fresh, independent object graph (no shared nested
 *   references, no exported mutable singleton for load/reset).
 * - Date-dependent defaults take an explicit `referenceDate`; no wall-clock is
 *   read inside these factories.
 * - First-launch defaults: `$0` opening balances, `0%` account returns, `null`
 *   retirement-rate override, a configurable `4%` new withdrawal source, an HSA
 *   non-qualified extra penalty of `20%` before age 65, ordinary cards at twelve
 *   inclusive payments (`end = start + 11`), and zero `0%` card debt.
 * - No pool maps/strings and no legacy `$500k` scalar asset are initialized.
 */

const CURRENT_AGE = 45;
const RETIREMENT_AGE = 65;
const RETIREMENT_YEARS = 30;
const DEFAULT_DATE_OF_BIRTH = '1980-10-01';

// Stable first-launch account identities (preserved across load/reset).
const defaultCheckingAccountId = 'checking-account-default';
const defaultEmergencyFundAccountId = 'emergencyFund-account-default';
const defaultHsaAccountId = 'hsa-account-default';
const defaultInvestmentsAccountId = 'investments-account-default';
const defaultRetirement401kAccountId = 'retirement401k-account-default';

// ---------------------------------------------------------------------------
// Date helpers (no wall-clock; the caller supplies the reference date)
// ---------------------------------------------------------------------------

const toIsoDate = (value: Date) => {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toYearMonth = (value: Date) => toIsoDate(value).slice(0, 7);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const firstDayOfYearMonth = (yearMonth: string) => (yearMonth ? `${yearMonth}-01` : yearMonth);

// ---------------------------------------------------------------------------
// Deterministic, wall-clock-free ID generation
// ---------------------------------------------------------------------------

let idSeed = 0;
const nextSeed = () => (idSeed += 1).toString(36);
const makeAccountId = () => `account-${nextSeed()}`;
const makeCardPlanId = () => `card-plan-${nextSeed()}`;
const makeRetirementSourceId = () => `retirement-source-${nextSeed()}`;
const makePurchaseId = () => `purchase-${nextSeed()}`;
const makeLongTermPurchaseId = () => `long-term-purchase-${nextSeed()}`;
const makeLoanId = () => `loan-${nextSeed()}`;
const makeHousingId = () => `housing-${nextSeed()}`;
const makeCareerId = (index: number) => `career-${index + 1}-default`;

// ---------------------------------------------------------------------------
// Account / policy / funding factories
// ---------------------------------------------------------------------------

/** Default withdrawal policy for an account type. HSA keeps tax separate from the pre-65 penalty. */
export const createDefaultAccountWithdrawalPolicy = (
  accountType: AccountTypePreset = 'checking',
  overrides: Partial<AccountWithdrawalPolicy> = {}
): AccountWithdrawalPolicy => {
  const isHsa = accountType === 'hsa';
  const policy: AccountWithdrawalPolicy = {
    allowAutomaticFallback:
      overrides.allowAutomaticFallback ??
      (accountType === 'checking' || accountType === 'savings' || accountType === 'taxable'),
    withdrawalTaxRate: overrides.withdrawalTaxRate ?? 0,
    penaltyRate: overrides.penaltyRate ?? 0,
    restrictionNote:
      overrides.restrictionNote ??
      (isHsa ? 'Qualified medical withdrawals are tax/penalty free.' : '')
  };

  if (isHsa || overrides.hsa) {
    policy.hsa = {
      nonQualifiedPenaltyRate: overrides.hsa?.nonQualifiedPenaltyRate ?? 20,
      nonQualifiedPenaltyWaiverAge: overrides.hsa?.nonQualifiedPenaltyWaiverAge ?? 65
    };
  }

  return policy;
};

/** Fresh account: `$0` opening, `0%` return, `null` retirement override. */
export const createDefaultAccount = (overrides: Partial<AccountDefinition> = {}): AccountDefinition => {
  const accountType = overrides.accountType ?? 'checking';
  const isTaxable = accountType === 'taxable';

  return {
    id: overrides.id ?? makeAccountId(),
    label: overrides.label ?? 'Account',
    accountType,
    openingBalance: overrides.openingBalance ?? 0,
    annualReturnRate: overrides.annualReturnRate ?? 0,
    retirementAnnualReturnRate: overrides.retirementAnnualReturnRate ?? null,
    color: overrides.color,
    displayOrder: overrides.displayOrder ?? 0,
    withdrawalPolicy: overrides.withdrawalPolicy ?? createDefaultAccountWithdrawalPolicy(accountType),
    assumedGainPercent: overrides.assumedGainPercent ?? (isTaxable ? 20 : undefined),
    capitalGainsTaxRate: overrides.capitalGainsTaxRate ?? (isTaxable ? 15 : undefined)
  };
};

/** Ordered primary + fallback account funding. Defaults to the $0 cash account with no fallbacks. */
export const createDefaultFundingPolicy = (overrides: Partial<FundingPolicy> = {}): FundingPolicy => ({
  primaryAccountId: overrides.primaryAccountId ?? defaultCheckingAccountId,
  fallbackAccountIds: overrides.fallbackAccountIds ? [...overrides.fallbackAccountIds] : [],
  purpose: overrides.purpose
});

export const createDefaultAccounts = (): AccountDefinition[] => [
  createDefaultAccount({ id: defaultCheckingAccountId, label: 'Checking', accountType: 'checking', displayOrder: 0 }),
  createDefaultAccount({
    id: defaultEmergencyFundAccountId,
    label: 'Emergency Fund',
    accountType: 'savings',
    displayOrder: 1
  }),
  createDefaultAccount({ id: defaultHsaAccountId, label: 'HSA', accountType: 'hsa', displayOrder: 2 }),
  createDefaultAccount({
    id: defaultInvestmentsAccountId,
    label: 'Investments',
    accountType: 'taxable',
    displayOrder: 3
  }),
  createDefaultAccount({
    id: defaultRetirement401kAccountId,
    label: '401K',
    accountType: 'retirement401k',
    displayOrder: 4
  })
];

// ---------------------------------------------------------------------------
// Retirement withdrawal source factory
// ---------------------------------------------------------------------------

/** New percentage withdrawal source: editable `4%` of the source's initial-balance valuation. */
export const createDefaultRetirementWithdrawalSource = (
  referenceDate: Date,
  overrides: Partial<RetirementWithdrawalSourceLine> = {}
): RetirementWithdrawalSourceLine => {
  const firstWithdrawalDate = overrides.firstWithdrawalDate ?? toIsoDate(referenceDate);

  return {
    id: overrides.id ?? makeRetirementSourceId(),
    label: overrides.label ?? 'Retirement Withdrawal',
    enabled: overrides.enabled ?? true,
    accountId: overrides.accountId ?? defaultRetirement401kAccountId,
    mode: overrides.mode ?? 'percentOfInitialBalance',
    amount: overrides.amount ?? 0,
    initialWithdrawalRatePercent: overrides.initialWithdrawalRatePercent ?? 4,
    firstWithdrawalDate,
    initialWithdrawalValuationDate: overrides.initialWithdrawalValuationDate ?? firstWithdrawalDate,
    paymentDay: overrides.paymentDay ?? 1,
    startMarkerId: overrides.startMarkerId ?? null,
    fallbackAccountIds: overrides.fallbackAccountIds ? [...overrides.fallbackAccountIds] : []
  };
};

// ---------------------------------------------------------------------------
// Card plan factories (two card types)
// ---------------------------------------------------------------------------

/** Ordinary expected-payment schedule: twelve inclusive payments, `end = start + 11`. */
export const createDefaultOrdinaryCardSchedule = (
  referenceDate: Date,
  overrides: Partial<OrdinaryCardSchedule> = {}
): OrdinaryCardSchedule => {
  const startYearMonth = overrides.startYearMonth ?? toYearMonth(referenceDate);

  return {
    kind: 'expectedPayment',
    id: overrides.id ?? makeCardPlanId(),
    label: overrides.label ?? 'Expected Payment',
    enabled: overrides.enabled ?? true,
    amount: overrides.amount ?? 0,
    startYearMonth,
    endYearMonth: overrides.endYearMonth ?? addMonthsToYearMonth(startYearMonth, 11),
    startMarkerId: overrides.startMarkerId ?? null,
    endMarkerId: overrides.endMarkerId ?? null,
    paymentDay: overrides.paymentDay ?? 1,
    funding: overrides.funding ?? createDefaultFundingPolicy(),
    showOnGraph: overrides.showOnGraph ?? false,
    flagColor: overrides.flagColor
  };
};

/** Permanent-0% payoff plan: zero opening debt, inclusive target, explicit residual payoff date. */
export const createDefaultZeroInterestCardPlan = (
  referenceDate: Date,
  overrides: Partial<ZeroInterestCardPlan> = {}
): ZeroInterestCardPlan => {
  const startYearMonth = overrides.startYearMonth ?? toYearMonth(referenceDate);
  const targetYearMonth = overrides.targetYearMonth ?? addMonthsToYearMonth(startYearMonth, 11);

  return {
    kind: 'zeroInterestPayoff',
    id: overrides.id ?? makeCardPlanId(),
    label: overrides.label ?? '0% Card Payoff',
    enabled: overrides.enabled ?? true,
    liabilityId: overrides.liabilityId ?? '',
    initialBalance: overrides.initialBalance ?? 0,
    startYearMonth,
    targetYearMonth,
    startMarkerId: overrides.startMarkerId ?? null,
    endMarkerId: overrides.endMarkerId ?? null,
    paymentDay: overrides.paymentDay ?? 1,
    funding: overrides.funding ?? createDefaultFundingPolicy(),
    payoffYearMonth: overrides.payoffYearMonth ?? targetYearMonth,
    payoffFunding: overrides.payoffFunding,
    showOnGraph: overrides.showOnGraph ?? false,
    flagColor: overrides.flagColor
  };
};

// ---------------------------------------------------------------------------
// Career / payroll defaults
// ---------------------------------------------------------------------------

const createDefaultCareerSourceLines = (): CareerSourceLine[] => [
  {
    id: `career-source-${defaultEmergencyFundAccountId}`,
    enabled: true,
    sourceType: 'account',
    sourceId: defaultEmergencyFundAccountId,
    contributionRate: 2,
    savingsMonthly: false,
    monthlyWithdrawal: 0,
    maxBalance: 0,
    overflowFallbackAccountId: null
  },
  {
    id: `career-source-${defaultHsaAccountId}`,
    enabled: true,
    sourceType: 'account',
    sourceId: defaultHsaAccountId,
    contributionRate: 3,
    savingsMonthly: false,
    monthlyWithdrawal: 0,
    maxBalance: 0,
    overflowFallbackAccountId: null
  },
  {
    id: `career-source-${defaultInvestmentsAccountId}`,
    enabled: true,
    sourceType: 'account',
    sourceId: defaultInvestmentsAccountId,
    contributionRate: 6,
    savingsMonthly: false,
    monthlyWithdrawal: 0,
    maxBalance: 0,
    overflowFallbackAccountId: null
  },
  {
    id: `career-source-${defaultRetirement401kAccountId}`,
    enabled: true,
    sourceType: 'account',
    sourceId: defaultRetirement401kAccountId,
    contributionRate: 6,
    savingsMonthly: false,
    monthlyWithdrawal: 0,
    maxBalance: 0,
    overflowFallbackAccountId: null
  }
];

/** Canonical ordered net-pay allocation with the cash account as remainder destination. */
export const createDefaultCareerDepositPlan = (
  allocations: CareerSourceLine[] = createDefaultCareerSourceLines(),
  remainderAccountId: string = defaultCheckingAccountId
): CareerDepositPlan => ({
  allocations: allocations.map((line) => ({ ...line })),
  remainderAccountId,
  postingDay: 1
});

export const createDefaultCareerEntry = (
  index: number,
  currentAge: number,
  retirementAge: number,
  id?: string
): CareerEntry => {
  const sourceLines = createDefaultCareerSourceLines();

  const base: CareerEntry = {
    id: id ?? makeCareerId(index),
    label: index === 0 ? 'Current Career' : `Career ${index + 1}`,
    enabled: true,
    usePreviousCareerStartAge: false,
    useBirthdayBasedStartAge: false,
    startYearMonth: '',
    endYearMonth: '',
    startAge: index === 0 ? currentAge : currentAge + index * 5,
    endAge: index === 0 ? retirementAge : Math.min(retirementAge, currentAge + index * 5 + 4),
    annualRaiseRate: index === 0 ? 3.5 : 3,
    savingsRate: index === 0 ? 10 : 9,
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
    sourceLines: sourceLines.map((line) => ({ ...line })),
    depositPlan: createDefaultCareerDepositPlan(sourceLines),
    paycheckInfo: {
      grossSalary: index === 0 ? 98000 : 110000 + index * 12000,
      taxes: 0,
      healthBenefits: 0,
      retirement: 0,
      retirementMatch: 0,
      hsaContribution: 0,
      hsaEmployerMatch: 0,
      otherBenefits: 0,
      livingExpenses: 0,
      retirementMode: 'amount',
      retirementMatchMode: 'amount',
      employerMaxMatchPercent: 0,
      hsaContributionMode: 'amount',
      hsaEmployerMatchMode: 'amount',
      employerHsaDeposit: 0,
      employerHsaDepositMode: 'amount',
      period: {
        grossSalary: 'yearly',
        taxes: 'yearly',
        healthBenefits: 'yearly',
        retirement: 'yearly',
        retirementMatch: 'yearly',
        hsaContribution: 'yearly',
        hsaEmployerMatch: 'yearly',
        otherBenefits: 'yearly',
        livingExpenses: 'monthly'
      }
    },
    paycheck: createDefaultPaycheck(index),
    payPlans: []
  };
};

// ---------------------------------------------------------------------------
// Cashflow / purchase / loan / housing defaults (preserved capabilities)
// ---------------------------------------------------------------------------

export const createDefaultCashflowItem = (
  category: CashflowCategory,
  currentAge: number,
  retirementAge: number,
  retirementYears: number
): CashflowItem => {
  const retirementEndAge = retirementAge + retirementYears;
  const makeItemId = () => `${category}-default`;

  switch (category) {
    case 'social_security':
      return {
        id: makeItemId(),
        category,
        label: 'Social Security',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        accountId: defaultInvestmentsAccountId,
        amount: 24000,
        startAge: retirementAge,
        endAge: retirementEndAge
      };
    case 'social_security_spouse':
      return {
        id: makeItemId(),
        category,
        label: 'SS (Spouse)',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        accountId: defaultInvestmentsAccountId,
        amount: 18000,
        startAge: retirementAge,
        endAge: retirementEndAge
      };
    case 'inheritance':
      return {
        id: makeItemId(),
        category,
        label: 'Inheritance',
        enabled: true,
        cadence: 'one_time',
        direction: 'inflow',
        accountId: defaultInvestmentsAccountId,
        amount: 50000,
        startAge: retirementAge + 5,
        endAge: retirementAge + 5
      };
    case 'college_child_1':
    case 'college_child_2':
    case 'college_child_3':
      return {
        id: makeItemId(),
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
        accountId: defaultInvestmentsAccountId,
        amount: 12000,
        startAge: currentAge + 5,
        endAge: currentAge + 8
      };
    case 'pension_1':
      return {
        id: makeItemId(),
        category,
        label: 'Pension 1',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        accountId: defaultInvestmentsAccountId,
        amount: 15000,
        startAge: retirementAge,
        endAge: retirementEndAge
      };
    case 'pension_2':
      return {
        id: makeItemId(),
        category,
        label: 'Pension 2',
        enabled: true,
        cadence: 'recurring',
        direction: 'inflow',
        accountId: defaultInvestmentsAccountId,
        amount: 10000,
        startAge: retirementAge,
        endAge: retirementEndAge
      };
    case 'cash_benefit_1':
      return {
        id: makeItemId(),
        category,
        label: 'Cash Benefit 1',
        enabled: true,
        cadence: 'one_time',
        direction: 'inflow',
        accountId: defaultInvestmentsAccountId,
        amount: 25000,
        startAge: retirementAge + 3,
        endAge: retirementAge + 3
      };
    case 'cash_benefit_2':
      return {
        id: makeItemId(),
        category,
        label: 'Cash Benefit 2',
        enabled: true,
        cadence: 'one_time',
        direction: 'inflow',
        accountId: defaultInvestmentsAccountId,
        amount: 15000,
        startAge: retirementAge + 10,
        endAge: retirementAge + 10
      };
    case 'home_real_estate':
      return {
        id: makeItemId(),
        category,
        label: 'Home/Real Estate',
        enabled: true,
        cadence: 'one_time',
        direction: 'inflow',
        accountId: defaultInvestmentsAccountId,
        amount: 80000,
        startAge: retirementAge + 8,
        endAge: retirementAge + 8
      };
  }
};

export const createDefaultLargePurchase = (
  currentAge: number,
  dateOfBirth: string,
  referenceDate: Date
): LargePurchase => ({
  id: makePurchaseId(),
  label: 'Large Purchase',
  enabled: true,
  showOnGraph: true,
  yearMonth: formatYearMonthFromAge(currentAge + 1, dateOfBirth, currentAge, referenceDate),
  age: currentAge + 1,
  amount: 10000,
  fundingSource: `account:${defaultInvestmentsAccountId}`,
  sourceLines: [
    {
      id: `source-${defaultInvestmentsAccountId}`,
      enabled: true,
      accountId: defaultInvestmentsAccountId,
      sourceType: 'account',
      sourceId: defaultInvestmentsAccountId,
      mode: 'amount',
      amount: 10000
    }
  ]
});

export const createDefaultLongTermPurchase = (
  currentAge: number,
  dateOfBirth: string,
  referenceDate: Date
): LongTermPurchase => ({
  id: makeLongTermPurchaseId(),
  label: 'Long-Term Purchase',
  enabled: true,
  showOnGraph: true,
  startYearMonth: formatYearMonthFromAge(currentAge + 1, dateOfBirth, currentAge, referenceDate),
  endMode: 'duration',
  durationMonths: 12,
  endYearMonth: formatYearMonthFromAge(currentAge + 2, dateOfBirth, currentAge, referenceDate),
  monthlyAmount: 500,
  fundingSource: `account:${defaultInvestmentsAccountId}`,
  sourceLines: [
    {
      id: `source-${defaultInvestmentsAccountId}`,
      enabled: true,
      accountId: defaultInvestmentsAccountId,
      sourceType: 'account',
      sourceId: defaultInvestmentsAccountId,
      mode: 'amount',
      amount: 500
    }
  ]
});

export const createDefaultLoan = (
  currentAge: number,
  dateOfBirth: string,
  referenceDate: Date
): Loan => ({
  id: makeLoanId(),
  label: 'Loan',
  enabled: true,
  showOnGraph: true,
  startYearMonth: formatYearMonthFromAge(currentAge, dateOfBirth, currentAge, referenceDate),
  originalAmount: 25000,
  downPayment: 0,
  currentBalance: 25000,
  annualInterestRate: 6.5,
  minimumMonthlyPayment: 350,
  extraMonthlyPayment: 0,
  paymentSourceAccount: defaultInvestmentsAccountId,
  paymentSource: `account:${defaultInvestmentsAccountId}`
});

export const createDefaultHousingEntry = (
  currentAge: number,
  dateOfBirth: string,
  referenceDate: Date
): HousingEntry => ({
  id: makeHousingId(),
  label: 'My Home',
  enabled: true,
  showOnGraph: true,
  housingType: 'mortgage',
  startYearMonth: formatYearMonthFromAge(currentAge, dateOfBirth, currentAge, referenceDate),
  purchasePrice: 300000,
  downPayment: 60000,
  downPaymentSource: `account:${defaultInvestmentsAccountId}`,
  annualInterestRate: 6.5,
  loanTermYears: 30,
  extraMonthlyPayment: 0,
  monthlyRent: 0,
  endYearMonth: '',
  propertyTaxYearly: 3600,
  homeInsuranceYearly: 1200,
  hoaMonthly: 0,
  maintenanceMonthly: 250,
  pmiMonthly: 150,
  rentalIncomeMonthly: 0,
  sellYearMonth: '',
  appreciationRate: 3,
  sellingCostsRate: 6,
  linkedCareerStartId: null,
  linkedCareerEndId: null,
  paymentSource: 'income'
});

export const createDefaultRentalEntry = (
  currentAge: number,
  dateOfBirth: string,
  referenceDate: Date
): HousingEntry => ({
  id: makeHousingId(),
  label: 'Apartment',
  enabled: true,
  showOnGraph: true,
  housingType: 'rental',
  startYearMonth: formatYearMonthFromAge(currentAge, dateOfBirth, currentAge, referenceDate),
  purchasePrice: 0,
  downPayment: 0,
  annualInterestRate: 0,
  loanTermYears: 0,
  extraMonthlyPayment: 0,
  monthlyRent: 1500,
  endYearMonth: '',
  propertyTaxYearly: 0,
  homeInsuranceYearly: 300,
  hoaMonthly: 0,
  maintenanceMonthly: 0,
  pmiMonthly: 0,
  rentalIncomeMonthly: 0,
  sellYearMonth: '',
  appreciationRate: 0,
  sellingCostsRate: 0,
  linkedCareerStartId: null,
  linkedCareerEndId: null,
  paymentSource: 'income'
});

// ---------------------------------------------------------------------------
// Expense planner UI defaults
// ---------------------------------------------------------------------------

export const createDefaultExpensesConfig = (referenceDate: Date): ExpensesConfig => {
  const scrubberDate = toIsoDate(addDays(referenceDate, 7));

  return {
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
      scrubberDate,
      windowStartDate: scrubberDate,
      windowEndDate: toIsoDate(addDays(referenceDate, 365)),
      selectedAccountIds: [],
      collapsedTrackIds: [],
      trackerVisibleAccountIds: [],
      planningWeekStartDay: 5
    }
  };
};

// ---------------------------------------------------------------------------
// Full scenario factory
// ---------------------------------------------------------------------------

/**
 * First-launch canonical scenario. The caller must supply the reference date;
 * this factory never reads the wall clock and never returns a shared singleton.
 */
export const createDefaultScenario = (referenceDate: Date): Scenario => {
  const accounts = createDefaultAccounts();
  const retirementStartYearMonth = formatYearMonthFromAge(
    RETIREMENT_AGE,
    DEFAULT_DATE_OF_BIRTH,
    CURRENT_AGE,
    referenceDate
  );
  const firstWithdrawalDate = firstDayOfYearMonth(retirementStartYearMonth);

  return {
    profile: {
      currentAge: CURRENT_AGE,
      retirementAge: RETIREMENT_AGE,
      retirementYears: RETIREMENT_YEARS
    },
    options: {
      dateOfBirth: DEFAULT_DATE_OF_BIRTH
    },
    // No seeded scalar asset: account openings are the only source of assets.
    portfolio: {
      currentAssets: 0
    },
    careerPlan: {
      enabled: true,
      entries: [createDefaultCareerEntry(0, CURRENT_AGE, RETIREMENT_AGE)]
    },
    netWorth: {
      accounts,
      customAccounts: [],
      history: [],
      asOfDate: toIsoDate(referenceDate)
    },
    futureRetirement: {
      useCareerEndAge: true,
      retirementAge: RETIREMENT_AGE,
      retirementYears: RETIREMENT_YEARS
    },
    withdrawal: {
      mode: 'percentOfInitialBalance',
      minimumYearlyWithdrawal: 0,
      maximumYearlyWithdrawal: 1000000,
      useRetirementAgeAsWithdrawalStartAge: true,
      fallbackAccountIds: [],
      sourceLines: [
        createDefaultRetirementWithdrawalSource(referenceDate, {
          accountId: defaultRetirement401kAccountId,
          firstWithdrawalDate,
          initialWithdrawalValuationDate: firstWithdrawalDate
        })
      ]
    },
    manualReturns: {
      inflationEnabled: true,
      inflationRate: 2.9
    },
    purchaseCategories: [],
    dateMarkers: [],
    timelines: [],
    activeTimelineId: null,
    trajectorySnapshots: [],
    largePurchases: [],
    creditCards: [],
    longTermPurchases: [],
    loans: [],
    housing: [],
    cashflowItems: [],
    lifeEvents: [],
    expenses: createDefaultExpensesConfig(referenceDate),
    incomeFallbackAccountId: null,
    incomeFallbackAccountId2: null,
    fundingPolicy: createDefaultFundingPolicy(),
    liabilities: [],
    properties: [],
    cardPlans: []
  };
};
