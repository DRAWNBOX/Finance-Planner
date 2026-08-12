import { defaultScenario } from './defaultScenario';
import type { CareerEntry, CreditCard, HousingEntry, LargePurchase, LoanPaymentSource, LongTermPurchase, PurchaseCategory, Scenario, SourceLine, Timeline } from './types';
import { ageFromYearMonth, formatYearMonthFromAge } from './utils/ageDate';
// Removed financeModel imports (functions inlined or simplified)

const APP_TABS = ['options', 'careers', 'netWorth', 'expenses'] as const;
const CAREERS_SUB_TABS = ['retirement', 'careers', 'timeline', 'purchasesExpenses', 'housing'] as const;
export type CareersSubTab = (typeof CAREERS_SUB_TABS)[number];
const EXPENSES_SUB_TABS = ['planning', 'tracking', 'creditCards'] as const;
export type ExpensesSubTab = (typeof EXPENSES_SUB_TABS)[number];

export interface AppUiState {
  activeTab: (typeof APP_TABS)[number];
  selectedCareerId: string;
  careersSubTab: CareersSubTab;
  expensesSubTab: ExpensesSubTab;
}

export interface PersistedAppState {
  scenario: Scenario;
  ui: AppUiState;
}

const STORAGE_KEY = 'finance-planner-state';

const defaultUiState: AppUiState = {
  activeTab: 'careers',
  selectedCareerId: '',
  careersSubTab: 'careers',
  expensesSubTab: 'planning'
};

const toNumberOrFallback = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const normalizeYearMonth = (value: unknown) => {
  if (typeof value !== 'string') {
    return '';
  }

  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : '';
};

const derivePurchaseAgeAndYearMonth = (
  purchase: { age?: unknown; yearMonth?: unknown },
  dateOfBirth: string,
  currentAge: number
) => {
  const fallbackAge = Math.max(18, toNumberOrFallback(purchase.age, currentAge));
  const normalizedYearMonth = normalizeYearMonth(purchase.yearMonth);
  const yearMonth = normalizedYearMonth || formatYearMonthFromAge(fallbackAge, dateOfBirth, currentAge);
  const derivedAge = ageFromYearMonth(yearMonth, dateOfBirth, currentAge, 18, 110);
  const age = derivedAge === null ? fallbackAge : derivedAge;

  return { age, yearMonth };
};

const normalizeCareerTimeline = (entry: CareerEntry, bankAccountIds: Set<string>): CareerEntry => {
  const emergencyFundContributionRate = toNumberOrFallback(entry.emergencyFundContributionRate, 2);
  const hsaContributionRate = toNumberOrFallback(entry.hsaContributionRate, 3);
  const investmentsContributionRate = toNumberOrFallback(entry.investmentsContributionRate, 6);
  const retirement401kContributionRate = toNumberOrFallback(entry.retirement401kContributionRate, 6);
  const emergencyFundMonthlyWithdrawal = Math.max(0, toNumberOrFallback(entry.emergencyFundMonthlyWithdrawal, 0));
  const hsaMonthlyWithdrawal = Math.max(0, toNumberOrFallback(entry.hsaMonthlyWithdrawal, 0));
  const investmentsMonthlyWithdrawal = Math.max(0, toNumberOrFallback(entry.investmentsMonthlyWithdrawal, 0));
  const retirement401kMonthlyWithdrawal = Math.max(0, toNumberOrFallback(entry.retirement401kMonthlyWithdrawal, 0));

  return {
    ...entry,
    usePreviousCareerStartAge: Boolean(entry.usePreviousCareerStartAge),
    useBirthdayBasedStartAge: Boolean(entry.useBirthdayBasedStartAge) && !Boolean(entry.usePreviousCareerStartAge),
    startYearMonth: normalizeYearMonth(entry.startYearMonth),
    endYearMonth: normalizeYearMonth(entry.endYearMonth),
    startAge: Math.min(entry.startAge, entry.endAge),
    endAge: Math.max(entry.startAge, entry.endAge),
    emergencyFundContributionRate,
    hsaContributionRate,
    investmentsContributionRate,
    retirement401kContributionRate,
    savingsRate:
      emergencyFundContributionRate + hsaContributionRate + investmentsContributionRate + retirement401kContributionRate,
    emergencyFundSavingsMonthly: Boolean(entry.emergencyFundSavingsMonthly),
    hsaSavingsMonthly: Boolean(entry.hsaSavingsMonthly),
    investmentsSavingsMonthly: Boolean(entry.investmentsSavingsMonthly),
    retirement401kSavingsMonthly: Boolean(entry.retirement401kSavingsMonthly),
    emergencyFundStartBalanceMode: entry.emergencyFundStartBalanceMode === 'manual' ? 'manual' : 'auto',
    hsaStartBalanceMode: entry.hsaStartBalanceMode === 'manual' ? 'manual' : 'auto',
    investmentsStartBalanceMode: entry.investmentsStartBalanceMode === 'manual' ? 'manual' : 'auto',
    retirement401kStartBalanceMode: entry.retirement401kStartBalanceMode === 'manual' ? 'manual' : 'auto',
    emergencyFundManualStartBalance: Math.max(0, toNumberOrFallback(entry.emergencyFundManualStartBalance, 0)),
    hsaManualStartBalance: Math.max(0, toNumberOrFallback(entry.hsaManualStartBalance, 0)),
    investmentsManualStartBalance: Math.max(0, toNumberOrFallback(entry.investmentsManualStartBalance, 0)),
    retirement401kManualStartBalance: Math.max(0, toNumberOrFallback(entry.retirement401kManualStartBalance, 0)),
    emergencyFundMonthlyWithdrawal,
    hsaMonthlyWithdrawal,
    investmentsMonthlyWithdrawal,
    retirement401kMonthlyWithdrawal,
    sourceLines: (entry.sourceLines?.length ? entry.sourceLines : []).map((line) => ({
      ...line,
      maxBalance: Math.max(0, toNumberOrFallback(line.maxBalance, 0)),
      overflowFallbackAccountId:
        typeof line.overflowFallbackAccountId === 'string' &&
        line.overflowFallbackAccountId !== line.sourceId &&
        bankAccountIds.has(line.overflowFallbackAccountId)
          ? line.overflowFallbackAccountId
          : null
    })),
    paycheckInfo: (() => {
      const pi = (entry as unknown as Record<string, unknown>).paycheckInfo;
      if (pi && typeof pi === 'object') {
        return {
          grossSalary: Math.max(0, toNumberOrFallback((pi as Record<string, unknown>).grossSalary, 0)),
          taxes: Math.max(0, toNumberOrFallback((pi as Record<string, unknown>).taxes, 0)),
          healthBenefits: Math.max(0, toNumberOrFallback((pi as Record<string, unknown>).healthBenefits, 0)),
          retirement: Math.max(0, toNumberOrFallback((pi as Record<string, unknown>).retirement, 0)),
          retirementMatch: Math.max(0, toNumberOrFallback((pi as Record<string, unknown>).retirementMatch, 0)),
          hsaContribution: Math.max(0, toNumberOrFallback((pi as Record<string, unknown>).hsaContribution, 0)),
          hsaEmployerMatch: Math.max(0, toNumberOrFallback((pi as Record<string, unknown>).hsaEmployerMatch, 0)),
          otherBenefits: Math.max(0, toNumberOrFallback((pi as Record<string, unknown>).otherBenefits, 0)),
          retirementAccountId: typeof (pi as Record<string, unknown>).retirementAccountId === 'string'
            ? (pi as Record<string, unknown>).retirementAccountId as string
            : undefined,
          hsaAccountId: typeof (pi as Record<string, unknown>).hsaAccountId === 'string'
            ? (pi as Record<string, unknown>).hsaAccountId as string
            : undefined,
          livingExpenses: Math.max(0, toNumberOrFallback((pi as Record<string, unknown>).livingExpenses, 0)),
          retirementMode: ((pi as Record<string, unknown>).retirementMode === 'amount' || (pi as Record<string, unknown>).retirementMode === 'percentOfSalary') ? (pi as Record<string, unknown>).retirementMode as 'amount' | 'percentOfSalary' : 'amount',
          retirementMatchMode: ((pi as Record<string, unknown>).retirementMatchMode === 'amount' || (pi as Record<string, unknown>).retirementMatchMode === 'percentOfRetirement') ? (pi as Record<string, unknown>).retirementMatchMode as 'amount' | 'percentOfRetirement' : 'amount',
          employerMaxMatchPercent: Math.max(0, toNumberOrFallback((pi as Record<string, unknown>).employerMaxMatchPercent, 0)),
          hsaContributionMode: ((pi as Record<string, unknown>).hsaContributionMode === 'amount' || (pi as Record<string, unknown>).hsaContributionMode === 'percentOfSalary') ? (pi as Record<string, unknown>).hsaContributionMode as 'amount' | 'percentOfSalary' : 'amount',
          hsaEmployerMatchMode: ((pi as Record<string, unknown>).hsaEmployerMatchMode === 'amount' || (pi as Record<string, unknown>).hsaEmployerMatchMode === 'percentOfHsaContribution') ? (pi as Record<string, unknown>).hsaEmployerMatchMode as 'amount' | 'percentOfHsaContribution' : 'amount',
          employerHsaDeposit: Math.max(0, toNumberOrFallback((pi as Record<string, unknown>).employerHsaDeposit, 0)),
          employerHsaDepositMode: ((pi as Record<string, unknown>).employerHsaDepositMode === 'amount' || (pi as Record<string, unknown>).employerHsaDepositMode === 'percentOfSalary') ? (pi as Record<string, unknown>).employerHsaDepositMode as 'amount' | 'percentOfSalary' : 'amount',
          period: (pi as Record<string, unknown>).period as Record<string, 'monthly' | 'yearly'> | undefined
        };
      }
      // Migrate legacy taxInfo → paycheckInfo
      const ti = (entry as unknown as Record<string, unknown>).taxInfo;
      if (ti && typeof ti === 'object') {
        const legacyOther = Math.max(0, toNumberOrFallback((ti as Record<string, unknown>).otherExpenses, 0));
        const legacyLeftover = Math.max(0, toNumberOrFallback((ti as Record<string, unknown>).leftoverIncome, 0));
        const legacySalary = Math.max(0, toNumberOrFallback((entry as unknown as Record<string, unknown>).startingSalary, 0));
        return {
          grossSalary: legacySalary,
          taxes: Math.max(0, legacySalary - legacyLeftover - legacyOther * 12),
          healthBenefits: 0,
          retirement: 0,
          otherBenefits: 0,
          livingExpenses: legacyOther,
          retirementMatch: 0,
          hsaContribution: 0,
          hsaEmployerMatch: 0,
          employerMaxMatchPercent: 0,
          employerHsaDeposit: 0,
          employerHsaDepositMode: 'amount' as const,
          period: { grossSalary: 'yearly', taxes: 'yearly', healthBenefits: 'yearly', retirement: 'yearly', retirementMatch: 'yearly', hsaContribution: 'yearly', hsaEmployerMatch: 'yearly', otherBenefits: 'yearly', livingExpenses: 'monthly' }
        };
      }
      const legacySalary2 = Math.max(0, toNumberOrFallback((entry as unknown as Record<string, unknown>).startingSalary, 0));
      return { grossSalary: legacySalary2, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0, period: { grossSalary: 'yearly', taxes: 'yearly', healthBenefits: 'yearly', retirement: 'yearly', retirementMatch: 'yearly', hsaContribution: 'yearly', hsaEmployerMatch: 'yearly', otherBenefits: 'yearly', livingExpenses: 'monthly' } };
    })()
  };
};

const normalizeCareerEntries = (entries: CareerEntry[], bankAccountIds: Set<string>) => {
  const normalized: CareerEntry[] = [];

  entries.forEach((entry, index) => {
    const base = normalizeCareerTimeline(entry, bankAccountIds);
    const previous = normalized[index - 1];

    if (base.usePreviousCareerStartAge && previous) {
      const startAge = previous.endAge;

      normalized.push({
        ...base,
        useBirthdayBasedStartAge: false,
        startAge,
        endAge: Math.max(base.endAge, startAge)
      });
      return;
    }

    normalized.push(base);
  });

  return normalized;
};

const normalizeActiveTab = (value: unknown): AppUiState['activeTab'] => {
  if (value === 'options' || value === 'careers' || value === 'netWorth' || value === 'expenses') {
    return value;
  }

  if (value === 'retirement' || value === 'events' || value === 'futureRetirement' || value === 'purchases') {
    return 'careers';
  }

  return 'careers';
};

const normalizeIsoDate = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value) ? value : '';

const normalizeCareersSubTab = (value: unknown): CareersSubTab => {
  if (value === 'retirement' || value === 'careers' || value === 'timeline' || value === 'purchasesExpenses') {
    return value;
  }

  if (value === 'futureRetirement') {
    return 'retirement';
  }

  if (value === 'events') {
    return 'timeline';
  }

  if (value === 'purchases') {
    return 'purchasesExpenses';
  }

  return 'careers';
};

const normalizeExpensesSubTab = (value: unknown): ExpensesSubTab => {
  if (value === 'planning' || value === 'tracking') {
    return value;
  }

  return 'planning';
};

export const loadAppState = (): PersistedAppState => {
  if (typeof window === 'undefined') {
    return {
      scenario: defaultScenario,
      ui: defaultUiState
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return {
        scenario: defaultScenario,
        ui: defaultUiState
      };
    }

    const parsed = JSON.parse(raw) as Partial<PersistedAppState> & Partial<Scenario>;
    const scenario = parsed.scenario ?? parsed;
    const ui = parsed.ui ?? defaultUiState;
    const bankAccountIds = new Set(
      (scenario.netWorth?.bankAccounts ?? defaultScenario.netWorth.bankAccounts ?? [])
        .map((account) => (typeof account.id === 'string' ? account.id.trim() : ''))
        .filter((id) => id.length > 0)
    );

    const normalizeIncomeFallbackId = (value: unknown, bankIds: Set<string>): string | null => {
      if (typeof value === 'string' && value.trim().length > 0 && bankIds.has(value.trim())) {
        return value.trim();
      }
      return null;
    };

    const normalizeLargePurchase = (purchase: unknown, pIdx: number) => {
      const rawSaved = purchase as unknown as Record<string, unknown>;
      const savedLines = Array.isArray(rawSaved?.sourceLines) ? rawSaved.sourceLines as SourceLine[] : [];
      return {
        id: typeof rawSaved?.id === 'string' && rawSaved.id.trim().length > 0 ? rawSaved.id : `purchase-${pIdx + 1}`,
        label: typeof rawSaved?.label === 'string' && rawSaved.label.trim().length > 0 ? rawSaved.label : `Purchase ${pIdx + 1}`,
        enabled: Boolean(rawSaved?.enabled),
        showOnGraph: rawSaved?.showOnGraph !== false,
        flagColor: typeof rawSaved?.flagColor === 'string' && rawSaved.flagColor.trim().length > 0 ? rawSaved.flagColor : undefined,
        ...derivePurchaseAgeAndYearMonth(
          rawSaved as Record<string, unknown>,
          scenario.options?.dateOfBirth ?? defaultScenario.options.dateOfBirth,
          scenario.profile?.currentAge ?? defaultScenario.profile.currentAge
        ),
        amount: Math.max(0, toNumberOrFallback(rawSaved?.amount, 0)),
        fundingSource: (typeof rawSaved?.fundingSource === 'string' && rawSaved.fundingSource) ? rawSaved.fundingSource as LargePurchase['fundingSource'] : 'income',
        categoryId: typeof rawSaved?.categoryId === 'string' && rawSaved.categoryId.trim().length > 0 ? rawSaved.categoryId : null,
        sourceLines: savedLines.length > 0
          ? savedLines
          : []
      };
    };

    const normalizeLongTermPurchase = (purchase: unknown, index: number): LongTermPurchase => {
      const p = purchase as LongTermPurchase;
      const fallbackStartAge = scenario.profile?.currentAge ?? defaultScenario.profile.currentAge;
      const startYearMonth =
        normalizeYearMonth((p as { startYearMonth?: unknown }).startYearMonth) ||
        formatYearMonthFromAge(fallbackStartAge + 1, scenario.options?.dateOfBirth ?? defaultScenario.options.dateOfBirth, fallbackStartAge);
      const endMode: LongTermPurchase['endMode'] = p.endMode === 'endDate' ? 'endDate' : 'duration';
      const durationMonths = Math.max(1, Math.floor(toNumberOrFallback(p.durationMonths, 12)));
      const fallbackEndYearMonth = formatYearMonthFromAge(
        fallbackStartAge + 2,
        scenario.options?.dateOfBirth ?? defaultScenario.options.dateOfBirth,
        fallbackStartAge
      );
      const endYearMonth = normalizeYearMonth(p.endYearMonth) || fallbackEndYearMonth;
      const rawSaved = p as unknown as Record<string, unknown>;
      const savedLines = Array.isArray(rawSaved.sourceLines) ? rawSaved.sourceLines as SourceLine[] : [];

      return {
        id: typeof p.id === 'string' && p.id.trim().length > 0 ? p.id : `long-term-purchase-${index + 1}`,
        label: typeof p.label === 'string' && p.label.trim().length > 0 ? p.label : `Long-Term Purchase ${index + 1}`,
        enabled: Boolean(p.enabled),
        showOnGraph: p.showOnGraph !== false,
        flagColor: typeof p.flagColor === 'string' && p.flagColor.trim().length > 0 ? p.flagColor : undefined,
        startYearMonth,
        endMode,
        durationMonths,
        endYearMonth,
        monthlyAmount: Math.max(0, toNumberOrFallback(p.monthlyAmount, 0)),
        fundingSource: (typeof rawSaved.fundingSource === 'string' && rawSaved.fundingSource) ? rawSaved.fundingSource as LongTermPurchase['fundingSource'] : 'income',
        sourceLines: savedLines.length > 0
          ? savedLines
          : []
      };
    };

    const normalizeLoan = (loan: unknown, index: number): Scenario['loans'][number] => {
      const l = loan as Record<string, unknown>;
      return {
        id: typeof l.id === 'string' && (l.id as string).trim().length > 0 ? l.id : `loan-${index + 1}`,
        label: typeof l.label === 'string' && (l.label as string).trim().length > 0 ? l.label : `Loan ${index + 1}`,
        enabled: Boolean(l.enabled),
        showOnGraph: l.showOnGraph !== false,
        flagColor: typeof l.flagColor === 'string' && (l.flagColor as string).trim().length > 0 ? l.flagColor : undefined,
        startYearMonth:
          normalizeYearMonth(l.startYearMonth) ||
          formatYearMonthFromAge(
            scenario.profile?.currentAge ?? defaultScenario.profile.currentAge,
            scenario.options?.dateOfBirth ?? defaultScenario.options.dateOfBirth,
            scenario.profile?.currentAge ?? defaultScenario.profile.currentAge
          ),
        originalAmount: Math.max(0, toNumberOrFallback(l.originalAmount, 0)),
        downPayment: Math.max(0, toNumberOrFallback(l.downPayment, 0)),
        currentBalance: Math.max(0, toNumberOrFallback(l.currentBalance, 0)),
        annualInterestRate: toNumberOrFallback(l.annualInterestRate, 0),
        minimumMonthlyPayment: Math.max(0, toNumberOrFallback(l.minimumMonthlyPayment, 0)),
        extraMonthlyPayment: Math.max(0, toNumberOrFallback(l.extraMonthlyPayment, 0)),
        paymentSourceAccount:
          l.paymentSourceAccount === 'emergencyFund' ||
          l.paymentSourceAccount === 'hsa' ||
          l.paymentSourceAccount === 'investments' ||
          l.paymentSourceAccount === 'retirement401k' ||
          l.paymentSourceAccount === 'income'
            ? (l.paymentSourceAccount as Scenario['loans'][number]['paymentSourceAccount'])
            : 'investments',
        paymentSource: (l.paymentSource ?? 'income') as Scenario['loans'][number]['paymentSource'],
        downPaymentSource: l.downPaymentSource as Scenario['loans'][number]['downPaymentSource']
      };
    };

    const normalizeCreditCard = (cc: unknown, index: number): CreditCard => {
      const raw = (cc ?? {}) as Record<string, unknown>;
      return {
        id: typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id : `cc-${index + 1}`,
        label: typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label : `Credit Card ${index + 1}`,
        enabled: raw.enabled !== false,
        currentBalance: Math.max(0, toNumberOrFallback(raw.currentBalance as number, 0)),
        annualInterestRate: toNumberOrFallback(raw.annualInterestRate as number, 24.99),
        introEnabled: Boolean(raw.introEnabled),
        introEndYearMonth: normalizeYearMonth(raw.introEndYearMonth as string | undefined) || '',
        monthlyCharges: Math.max(0, toNumberOrFallback(raw.monthlyCharges as number, 0)),
        paymentMode: raw.paymentMode === 'fixed' || raw.paymentMode === 'payInFull' || raw.paymentMode === 'minimum' || raw.paymentMode === 'fixedPlusLump' || raw.paymentMode === 'autopay' ? raw.paymentMode as CreditCard['paymentMode'] : 'minimum',
        fixedPaymentAmount: Math.max(0, toNumberOrFallback(raw.fixedPaymentAmount as number, 100)),
        minimumPaymentPercent: Math.max(0, toNumberOrFallback(raw.minimumPaymentPercent as number, 2)),
        minimumPaymentFloor: Math.max(0, toNumberOrFallback(raw.minimumPaymentFloor as number, 25)),
        paymentSource: typeof raw.paymentSource === 'string' && raw.paymentSource.length > 0 ? raw.paymentSource as CreditCard['paymentSource'] : 'income',
        lumpSumPaymentSource: typeof raw.lumpSumPaymentSource === 'string' && raw.lumpSumPaymentSource.length > 0 ? raw.lumpSumPaymentSource as CreditCard['lumpSumPaymentSource'] : 'income',
        paymentDay: Math.max(1, Math.min(28, Math.floor(toNumberOrFallback(raw.paymentDay as number, 15)))),
        showOnGraph: Boolean(raw.showOnGraph),
        flagColor: typeof raw.flagColor === 'string' && raw.flagColor.trim().length > 0 ? raw.flagColor : undefined
      };
    };

    const normalizeHousing = (h: unknown, index: number): HousingEntry => {
      const entry = (h ?? {}) as Record<string, unknown>;
      return {
        id: typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id : `housing-${index + 1}`,
        label: typeof entry.label === 'string' && entry.label.trim().length > 0 ? entry.label : `Home ${index + 1}`,
        enabled: entry.enabled !== false,
        showOnGraph: entry.showOnGraph !== false,
        flagColor: typeof entry.flagColor === 'string' && entry.flagColor.trim().length > 0 ? entry.flagColor : undefined,
        housingType: entry.housingType === 'rental' ? 'rental' : 'mortgage',
        startYearMonth:
          normalizeYearMonth(entry.startYearMonth as string | undefined) ||
          formatYearMonthFromAge(
            scenario.profile?.currentAge ?? defaultScenario.profile.currentAge,
            scenario.options?.dateOfBirth ?? defaultScenario.options.dateOfBirth,
            scenario.profile?.currentAge ?? defaultScenario.profile.currentAge
          ),
        purchasePrice: Math.max(0, toNumberOrFallback(entry.purchasePrice, 0)),
        downPayment: Math.max(0, toNumberOrFallback(entry.downPayment, 0)),
        downPaymentSource: typeof entry.downPaymentSource === 'string' ? entry.downPaymentSource as LoanPaymentSource : undefined,
        annualInterestRate: toNumberOrFallback(entry.annualInterestRate, 0),
        loanTermYears: Math.max(1, toNumberOrFallback(entry.loanTermYears, 30)),
        extraMonthlyPayment: Math.max(0, toNumberOrFallback(entry.extraMonthlyPayment, 0)),
        monthlyRent: Math.max(0, toNumberOrFallback(entry.monthlyRent, 0)),
        endYearMonth: normalizeYearMonth(entry.endYearMonth as string | undefined) || '',
        propertyTaxYearly: Math.max(0, toNumberOrFallback(entry.propertyTaxYearly, 0)),
        homeInsuranceYearly: Math.max(0, toNumberOrFallback(entry.homeInsuranceYearly, 0)),
        hoaMonthly: Math.max(0, toNumberOrFallback(entry.hoaMonthly, 0)),
        maintenanceMonthly: Math.max(0, toNumberOrFallback(entry.maintenanceMonthly, 0)),
        pmiMonthly: Math.max(0, toNumberOrFallback(entry.pmiMonthly, 0)),
        rentalIncomeMonthly: Math.max(0, toNumberOrFallback(entry.rentalIncomeMonthly, 0)),
        rentalIncomeAccountId: typeof entry.rentalIncomeAccountId === 'string' ? entry.rentalIncomeAccountId : undefined,
        sellYearMonth: normalizeYearMonth(entry.sellYearMonth as string | undefined) || '',
        appreciationRate: toNumberOrFallback(entry.appreciationRate, 0),
        sellingCostsRate: Math.max(0, toNumberOrFallback(entry.sellingCostsRate, 0)),
        saleProceedsAccountId: typeof entry.saleProceedsAccountId === 'string' ? entry.saleProceedsAccountId : undefined,
        paymentSource: typeof entry.paymentSource === 'string' ? entry.paymentSource as LoanPaymentSource : 'income'
      };
    };

    const normalizeTimeline = (timeline: unknown, tIdx: number) => {
      const raw = timeline as Record<string, unknown> | null;
      const rawCareerPlan = (raw?.careerPlan ?? {}) as Record<string, unknown>;
      return {
        id: typeof raw?.id === 'string' && raw.id.trim().length > 0 ? raw.id : `timeline-${tIdx + 1}`,
        label: typeof raw?.label === 'string' && raw.label.trim().length > 0 ? raw.label : `Timeline ${tIdx + 1}`,
        purchases: (Array.isArray(raw?.purchases) ? raw.purchases : []).map((p, pIdx) => normalizeLargePurchase(p, pIdx)),
        longTermPurchases: (Array.isArray(raw?.longTermPurchases) ? raw.longTermPurchases : []).map((p, i) => normalizeLongTermPurchase(p, i)),
        loans: (Array.isArray(raw?.loans) ? raw.loans : []).map((l, i) => normalizeLoan(l, i)),
        creditCards: (Array.isArray(raw?.creditCards) ? raw.creditCards : []).map((cc, i) => normalizeCreditCard(cc, i)),
        careerPlan: {
          enabled: rawCareerPlan.enabled !== false,
          entries: Array.isArray(rawCareerPlan.entries)
            ? normalizeCareerEntries(rawCareerPlan.entries as CareerEntry[], bankAccountIds)
            : []
        },
        housing: (Array.isArray(raw?.housing) ? raw.housing : []).map((h, i) => normalizeHousing(h, i))
      } satisfies Timeline;
    };

    return {
      scenario: {
        ...defaultScenario,
        ...scenario,
        profile: { ...defaultScenario.profile, ...scenario.profile },
        options: { ...defaultScenario.options, ...scenario.options },
        portfolio: { ...defaultScenario.portfolio, ...scenario.portfolio },
        contribution: { ...defaultScenario.contribution, ...scenario.contribution },
        careerPlan: {
          enabled: scenario.careerPlan?.enabled ?? defaultScenario.careerPlan.enabled,
          entries:
            scenario.careerPlan?.entries?.length
              ? normalizeCareerEntries(scenario.careerPlan.entries, bankAccountIds)
              : defaultScenario.careerPlan.entries
        },
        netWorth: {
          ...defaultScenario.netWorth,
          ...scenario.netWorth,
          accountBalances: {
            ...defaultScenario.netWorth.accountBalances,
            ...scenario.netWorth?.accountBalances
          },
          pools: (() => {
            const rawBankAccounts = (scenario.netWorth?.bankAccounts ?? []) as unknown as Record<string, unknown>[];
            const firstAccountByPoolId = new Map<string, Record<string, unknown>>();
            rawBankAccounts.forEach((account) => {
              const pid = typeof account.poolId === 'string' ? account.poolId : '';
              if (pid && !firstAccountByPoolId.has(pid)) {
                firstAccountByPoolId.set(pid, account);
              }
            });

            const savedPools = scenario.netWorth?.pools;
            if (savedPools && savedPools.length > 0) {
              return savedPools.map((pool, index) => {
                const firstAccount = firstAccountByPoolId.get(pool.id as string);
                const ruleOverrides =
                  firstAccount && typeof firstAccount.ruleOverrides === 'object' && firstAccount.ruleOverrides
                    ? (firstAccount.ruleOverrides as Record<string, unknown>)
                    : null;

                return {
                  id: typeof pool.id === 'string' && pool.id.trim().length > 0 ? pool.id : `pool-${index + 1}`,
                  label: typeof pool.label === 'string' && pool.label.trim().length > 0 ? pool.label : `Pool ${index + 1}`,
                  enabled: pool.enabled !== false,
                  priority: Math.max(0, Math.floor(toNumberOrFallback(pool.priority, index))),
                  color:
                    typeof pool.color === 'string' && pool.color.trim().length > 0
                      ? pool.color.trim()
                      : (['#4b87d9', '#32a884', '#f0a235', '#ca5d7b', '#7a75d8', '#3e9ab1', '#d0735a', '#6e9c4e'])[index % 8],
                  preRetirementReturnRate:
                    typeof pool.preRetirementReturnRate === 'number'
                      ? pool.preRetirementReturnRate
                      : typeof (pool as unknown as Record<string, unknown>).annualReturnRate === 'number'
                        ? (pool as unknown as Record<string, unknown>).annualReturnRate as number
                        : 0,
                  postRetirementReturnRate:
                    typeof pool.postRetirementReturnRate === 'number'
                      ? pool.postRetirementReturnRate
                      : typeof (pool as unknown as Record<string, unknown>).annualReturnRate === 'number'
                        ? (pool as unknown as Record<string, unknown>).annualReturnRate as number
                        : 0,
                  taxRate:
                    typeof pool.taxRate === 'number'
                      ? pool.taxRate
                      : ruleOverrides
                        ? toNumberOrFallback(ruleOverrides.taxRate, 0)
                        : 0,
                  penaltyRate:
                    typeof pool.penaltyRate === 'number'
                      ? pool.penaltyRate
                      : ruleOverrides
                        ? toNumberOrFallback(ruleOverrides.penaltyRate, 0)
                        : 0,
                  isHSA:
                    typeof pool.isHSA === 'boolean'
                      ? pool.isHSA
                      : undefined,
                  softRestrictionNote:
                    typeof pool.softRestrictionNote === 'string'
                      ? pool.softRestrictionNote
                      : ruleOverrides && typeof ruleOverrides.softRestrictionNote === 'string'
                        ? ruleOverrides.softRestrictionNote
                        : ''
                };
              });
            }

            return [];
          })(),
          bankAccounts:
            scenario.netWorth?.bankAccounts?.length
              ? scenario.netWorth.bankAccounts.map((account, index) => ({
                  id: typeof account.id === 'string' && account.id.trim().length > 0 ? account.id : `bank-account-${index + 1}`,
                  label:
                    typeof account.label === 'string' && account.label.trim().length > 0
                      ? account.label
                      : `Bank Account ${index + 1}`,
                  poolId:
                    typeof account.poolId === 'string' && account.poolId.trim().length > 0 ? account.poolId : 'investments',
                  priority: Math.max(0, Math.floor(toNumberOrFallback(account.priority, 0))),
                  accountType:
                    account.accountType === 'checking' ||
                    account.accountType === 'savings' ||
                    account.accountType === 'taxable' ||
                    account.accountType === 'retirement401k' ||
                    account.accountType === 'roth' ||
                    account.accountType === 'hsa'
                      ? account.accountType
                      : 'taxable',
                  balance: Math.max(0, toNumberOrFallback(account.balance, 0))
                }))
              : [],
          customAccounts: (scenario.netWorth?.customAccounts ?? defaultScenario.netWorth.customAccounts ?? []).map((account, index) => ({
            id: typeof account.id === 'string' && account.id.trim().length > 0 ? account.id : `custom-account-${index + 1}`,
            label: typeof account.label === 'string' && account.label.trim().length > 0 ? account.label : `Account ${index + 1}`,
            balance: Math.max(0, toNumberOrFallback(account.balance, 0))
          })),
          imports: (scenario.netWorth?.imports ?? defaultScenario.netWorth.imports ?? []).map((record, index) => ({
            id: typeof record.id === 'string' && record.id.trim().length > 0 ? record.id : `networth-import-${index + 1}`,
            fileName:
              typeof record.fileName === 'string' && record.fileName.trim().length > 0
                ? record.fileName
                : `import-${index + 1}.csv`,
            fileType: (record.fileType === 'csv' || record.fileType === 'pdf' ? record.fileType : 'unknown') as
              | 'csv'
              | 'pdf'
              | 'unknown',
            previewText: typeof record.previewText === 'string' ? record.previewText : '',
            detectedAccountId: typeof record.detectedAccountId === 'string' && record.detectedAccountId.trim().length > 0 ? record.detectedAccountId : null,
            detectedBalance:
              typeof record.detectedBalance === 'number' && Number.isFinite(record.detectedBalance)
                ? record.detectedBalance
                : null,
            statementDate:
              typeof record.statementDate === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(record.statementDate)
                ? record.statementDate
                : '',
            selectedAccountId:
              typeof record.selectedAccountId === 'string' && record.selectedAccountId.trim().length > 0 ? record.selectedAccountId : null,
            status:
              record.status === 'applied' || record.status === 'ready' || record.status === 'needs_review' || record.status === 'error'
                ? record.status
                : 'needs_review',
            confidence:
              typeof record.confidence === 'number' && Number.isFinite(record.confidence)
                ? Math.min(1, Math.max(0, record.confidence))
                : 0,
            parseNotes: Array.isArray(record.parseNotes)
              ? record.parseNotes.filter((note): note is string => typeof note === 'string')
              : [],
            applyMode:
              record.applyMode === 'net_worth_and_expenses' || record.applyMode === 'net_worth_only'
                ? record.applyMode
                : 'net_worth_only',
            applied: Boolean(record.applied),
            appliedAt:
              typeof record.appliedAt === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(record.appliedAt)
                ? record.appliedAt
                : ''
          })).filter((record) => record.applied),
          history: (scenario.netWorth?.history ?? defaultScenario.netWorth.history ?? []).map((entry, index) => ({
            id: typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id : `networth-history-${index + 1}`,
            date: typeof entry.date === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(entry.date) ? entry.date : '',
            accounts: Array.isArray(entry.accounts)
              ? entry.accounts.map((account, accountIndex) => ({
                  id:
                    typeof account.id === 'string' && account.id.trim().length > 0
                      ? account.id
                      : `history-account-${accountIndex + 1}`,
                  label:
                    typeof account.label === 'string' && account.label.trim().length > 0
                      ? account.label
                      : `Account ${accountIndex + 1}`,
                  balance: Math.max(0, toNumberOrFallback(account.balance, 0))
                }))
              : [],
            totalNetWorth: Math.max(0, toNumberOrFallback(entry.totalNetWorth, 0))
          }))
        },
        futureRetirement: {
          ...defaultScenario.futureRetirement,
          ...scenario.futureRetirement
        },
        withdrawal: (() => {
          const savedWithdrawal = scenario.withdrawal ?? defaultScenario.withdrawal;

          return {
            ...defaultScenario.withdrawal,
            ...savedWithdrawal,
            minimumYearlyWithdrawal: Math.max(0, toNumberOrFallback(savedWithdrawal.minimumYearlyWithdrawal, 0)),
            maximumYearlyWithdrawal: Math.max(
              0,
              toNumberOrFallback(savedWithdrawal.maximumYearlyWithdrawal, defaultScenario.withdrawal.maximumYearlyWithdrawal)
            ),
            useRetirementAgeAsWithdrawalStartAge:
              savedWithdrawal.useRetirementAgeAsWithdrawalStartAge !== undefined
                ? Boolean(savedWithdrawal.useRetirementAgeAsWithdrawalStartAge)
                : true,
            sourceLines: (savedWithdrawal.sourceLines ?? []).map((line) => ({
              ...line,
              startAge: typeof line.startAge === 'number' ? line.startAge : undefined,
              syncWithRetirementAge: line.syncWithRetirementAge !== false
            }))
          };
        })(),
        manualReturns: (() => {
          const mr = (scenario.manualReturns ?? {}) as Record<string, unknown>;
          return {
            inflationEnabled: mr.inflationEnabled !== false,
            inflationRate: toNumberOrFallback(mr.inflationRate, defaultScenario.manualReturns.inflationRate)
          };
        })(),
        purchaseCategories: (Array.isArray(scenario.purchaseCategories) ? scenario.purchaseCategories : defaultScenario.purchaseCategories).map((cat: unknown, cIdx: number) => {
          const raw = cat as Record<string, unknown> | null;
          return {
            id: typeof raw?.id === 'string' && raw.id.trim().length > 0 ? raw.id : `purchase-category-${cIdx + 1}`,
            label: typeof raw?.label === 'string' && raw.label.trim().length > 0 ? raw.label : `Category ${cIdx + 1}`
          } satisfies PurchaseCategory;
        }).filter((c) => c.label.length > 0),
        timelines: (Array.isArray(scenario.timelines) ? scenario.timelines : defaultScenario.timelines).map((timeline: unknown, tIdx: number) => normalizeTimeline(timeline, tIdx)),
        activeTimelineId: (typeof scenario.activeTimelineId === 'string' && scenario.activeTimelineId.trim().length > 0)
          ? scenario.activeTimelineId
          : null,
        largePurchases: (scenario.largePurchases ?? defaultScenario.largePurchases).map((purchase, pIdx) => normalizeLargePurchase(purchase, pIdx)),
        longTermPurchases: (scenario.longTermPurchases ?? defaultScenario.longTermPurchases ?? []).map((purchase, index) => normalizeLongTermPurchase(purchase, index)),
        loans: (scenario.loans ?? defaultScenario.loans ?? []).map((loan, index) => normalizeLoan(loan, index)),
        creditCards: (Array.isArray(scenario.creditCards) ? scenario.creditCards : defaultScenario.creditCards).map((cc: unknown, index: number) => normalizeCreditCard(cc, index)),
        housing: ((scenario as Record<string, unknown>).housing as unknown[] ?? []).map((h: unknown, index: number) => normalizeHousing(h, index)),
        expenses: {
          entries: (scenario.expenses?.entries ?? defaultScenario.expenses.entries).map((entry, index) => ({
            id: typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id : `expense-${index + 1}`,
            label: typeof entry.label === 'string' && entry.label.trim().length > 0 ? entry.label : `Expense ${index + 1}`,
            amount: Math.max(0, toNumberOrFallback(entry.amount, 0)),
            startDate: normalizeIsoDate(entry.startDate) || defaultScenario.expenses.ui.windowStartDate,
            endDate: normalizeIsoDate(entry.endDate) || normalizeIsoDate(entry.startDate) || defaultScenario.expenses.ui.windowStartDate,
            accountId: typeof entry.accountId === 'string' && entry.accountId.trim().length > 0 ? entry.accountId : null,
            poolId: typeof entry.poolId === 'string' && entry.poolId.trim().length > 0 ? entry.poolId : null,
            notes: typeof entry.notes === 'string' ? entry.notes : '',
            originType: entry.originType === 'imported' ? 'imported' : 'manual',
            importSourceId:
              typeof entry.importSourceId === 'string' && entry.importSourceId.trim().length > 0 ? entry.importSourceId : null,
            importBatchId:
              typeof entry.importBatchId === 'string' && entry.importBatchId.trim().length > 0 ? entry.importBatchId : null,
            createdAt: normalizeIsoDate(entry.createdAt) || defaultScenario.expenses.ui.windowStartDate,
            updatedAt: normalizeIsoDate(entry.updatedAt) || defaultScenario.expenses.ui.windowStartDate,
            categoryId: typeof entry.categoryId === 'string' && entry.categoryId.trim().length > 0 ? entry.categoryId : null,
            color: typeof entry.color === 'string' && entry.color.trim().length > 0 ? entry.color : undefined,
            fundingSource: (() => {
              const src = (entry as unknown as Record<string, unknown>).fundingSource;
              if (src === 'income') return 'income';
              if (typeof src === 'string' && src.startsWith('account:') && bankAccountIds.has(src.slice('account:'.length))) return src as `account:${string}`;
              return undefined;
            })()
          })),
          imports: (scenario.expenses?.imports ?? defaultScenario.expenses.imports).map((item, index) => ({
            id: typeof item.id === 'string' && item.id.trim().length > 0 ? item.id : `expense-import-${index + 1}`,
            batchId: typeof item.batchId === 'string' && item.batchId.trim().length > 0 ? item.batchId : `batch-${index + 1}`,
            fileName: typeof item.fileName === 'string' && item.fileName.trim().length > 0 ? item.fileName : `import-${index + 1}.csv`,
            fileType: item.fileType === 'csv' || item.fileType === 'pdf' ? item.fileType : 'unknown',
            previewText: typeof item.previewText === 'string' ? item.previewText : '',
            status:
              item.status === 'staged' || item.status === 'ready' || item.status === 'needs_review' || item.status === 'error' || item.status === 'applied'
                ? item.status
                : 'staged',
            parseNotes: Array.isArray(item.parseNotes) ? item.parseNotes.filter((note): note is string => typeof note === 'string') : [],
            confidence: Math.min(1, Math.max(0, toNumberOrFallback(item.confidence, 0))),
            importedAt: normalizeIsoDate(item.importedAt) || defaultScenario.expenses.ui.windowStartDate,
            appliedAt: normalizeIsoDate(item.appliedAt),
            entryIds: Array.isArray(item.entryIds) ? item.entryIds.filter((id): id is string => typeof id === 'string') : []
          })),
          categoriesByAccountId: Object.fromEntries(
            Object.entries(scenario.expenses?.categoriesByAccountId ?? defaultScenario.expenses.categoriesByAccountId).map(([accountId, categories]) => [
              accountId,
              Array.isArray(categories)
                ? categories
                    .map((category, index) => ({
                      id:
                        typeof category?.id === 'string' && category.id.trim().length > 0
                          ? category.id
                          : `expense-category-${index + 1}`,
                      label:
                        typeof category?.label === 'string' && category.label.trim().length > 0
                          ? category.label
                          : `Category ${index + 1}`,
                      color: typeof category?.color === 'string' && category.color.trim().length > 0 ? category.color : undefined
                    }))
                    .filter((category) => category.label.length > 0)
                : []
            ])
          ),
          weeklyBalanceByAccountId: Object.fromEntries(
            Object.entries(scenario.expenses?.weeklyBalanceByAccountId ?? defaultScenario.expenses.weeklyBalanceByAccountId).map(
              ([accountId, points]) => [
                accountId,
                Array.isArray(points)
                  ? points
                      .map((point) => ({
                        weekStartDate: normalizeIsoDate(point?.weekStartDate) || defaultScenario.expenses.ui.windowStartDate,
                        balance: toNumberOrFallback(point?.balance, 0)
                      }))
                      .filter((point) => point.weekStartDate !== '')
                  : []
              ]
            )
          ),
          maxBalanceByAccountId: Object.fromEntries(
            Object.entries(scenario.expenses?.maxBalanceByAccountId ?? defaultScenario.expenses.maxBalanceByAccountId).map(
              ([accountId, value]) => [accountId, Math.max(0, toNumberOrFallback(value, 0))]
            )
          ),
          activePlanningAccountId:
            typeof scenario.expenses?.activePlanningAccountId === 'string' && scenario.expenses.activePlanningAccountId.trim().length > 0
              ? scenario.expenses.activePlanningAccountId
              : null,
          recurringEvents: (scenario.expenses?.recurringEvents ?? defaultScenario.expenses.recurringEvents ?? []).map((event, index) => ({
            id: typeof event.id === 'string' && event.id.trim().length > 0 ? event.id : `recurring-expense-${index + 1}`,
            label:
              typeof event.label === 'string' && event.label.trim().length > 0 ? event.label : `Recurring Event ${index + 1}`,
            amount: Math.max(0, toNumberOrFallback(event.amount, 0)),
            accountId: typeof event.accountId === 'string' && event.accountId.trim().length > 0 ? event.accountId : '',
            paymentAccountId:
              typeof event.paymentAccountId === 'string' && event.paymentAccountId.trim().length > 0 ? event.paymentAccountId : null,
            categoryId: typeof event.categoryId === 'string' && event.categoryId.trim().length > 0 ? event.categoryId : null,
            cadence: event.cadence === 'monthly' ? 'monthly' : 'weekly',
            rule:
              event.rule === 'every_friday' || event.rule === 'first_monday_after' || event.rule === 'on_date'
                ? event.rule
                : 'on_date',
            startDate: normalizeIsoDate(event.startDate) || defaultScenario.expenses.ui.windowStartDate,
            endDate: normalizeIsoDate(event.endDate) || defaultScenario.expenses.ui.windowEndDate,
            dayOfMonth: Math.min(31, Math.max(1, Math.floor(toNumberOrFallback(event.dayOfMonth, 1)))),
            anchorDate: normalizeIsoDate(event.anchorDate),
            enabled: event.enabled !== false,
            color: typeof event.color === 'string' && event.color.trim().length > 0 ? event.color : undefined,
            fundingSource: (() => {
              const src = (event as unknown as Record<string, unknown>).fundingSource;
              if (src === 'income') return 'income';
              if (typeof src === 'string' && src.startsWith('account:') && bankAccountIds.has(src.slice('account:'.length))) return src as `account:${string}`;
              return undefined;
            })()
          })),
          ui: {
            groupingMode: scenario.expenses?.ui?.groupingMode === 'pool' ? 'pool' : 'account',
            zoomLevel: Math.min(4, Math.max(0.5, toNumberOrFallback(scenario.expenses?.ui?.zoomLevel, defaultScenario.expenses.ui.zoomLevel))),
            rowHeight: Math.min(120, Math.max(32, Math.floor(toNumberOrFallback(scenario.expenses?.ui?.rowHeight, defaultScenario.expenses.ui.rowHeight)))),
            density: scenario.expenses?.ui?.density === 'compact' ? 'compact' : 'comfortable',
            snapToDay: scenario.expenses?.ui?.snapToDay !== false,
            scrubberDate: normalizeIsoDate(scenario.expenses?.ui?.scrubberDate) || defaultScenario.expenses.ui.scrubberDate,
            windowStartDate: normalizeIsoDate(scenario.expenses?.ui?.windowStartDate) || defaultScenario.expenses.ui.windowStartDate,
            windowEndDate: normalizeIsoDate(scenario.expenses?.ui?.windowEndDate) || defaultScenario.expenses.ui.windowEndDate,
            selectedAccountIds: Array.isArray(scenario.expenses?.ui?.selectedAccountIds)
              ? scenario.expenses?.ui?.selectedAccountIds.filter((id): id is string => typeof id === 'string')
              : [],
            selectedPoolIds: Array.isArray(scenario.expenses?.ui?.selectedPoolIds)
              ? scenario.expenses?.ui?.selectedPoolIds.filter((id): id is string => typeof id === 'string')
              : [],
            collapsedTrackIds: Array.isArray(scenario.expenses?.ui?.collapsedTrackIds)
              ? scenario.expenses?.ui?.collapsedTrackIds.filter((id): id is string => typeof id === 'string')
              : [],
            trackerVisibleAccountIds: Array.isArray(scenario.expenses?.ui?.trackerVisibleAccountIds)
              ? scenario.expenses?.ui?.trackerVisibleAccountIds.filter((id): id is string => typeof id === 'string')
              : [],
            planningWeekStartDay: Math.min(
              6,
              Math.max(0, Math.floor(toNumberOrFallback(scenario.expenses?.ui?.planningWeekStartDay, defaultScenario.expenses.ui.planningWeekStartDay)))
            )
          }
        },
        cashflowItems: scenario.cashflowItems ?? [],
        lifeEvents: scenario.lifeEvents ?? [],
        incomeFallbackAccountId: normalizeIncomeFallbackId(scenario.incomeFallbackAccountId, bankAccountIds),
        incomeFallbackAccountId2: normalizeIncomeFallbackId(scenario.incomeFallbackAccountId2, bankAccountIds)
      },
      ui: {
        ...defaultUiState,
        ...ui,
        activeTab: normalizeActiveTab(ui.activeTab),
        careersSubTab: normalizeCareersSubTab(ui.careersSubTab),
        expensesSubTab: normalizeExpensesSubTab(ui.expensesSubTab)
      }
    };
  } catch {
    return {
      scenario: defaultScenario,
      ui: defaultUiState
    };
  }
};

export const saveAppState = (state: PersistedAppState) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};
