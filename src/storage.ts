import { defaultScenario } from './defaultScenario';
import type { CareerEntry, Scenario } from './types';
import { ageFromYearMonth, formatYearMonthFromAge } from './utils/ageDate';

const APP_TABS = ['retirement', 'options', 'careers', 'netWorth'] as const;
const CAREERS_SUB_TABS = ['retirement', 'careers', 'timeline', 'purchasesExpenses', 'loans'] as const;
export type CareersSubTab = (typeof CAREERS_SUB_TABS)[number];

export interface AppUiState {
  activeTab: (typeof APP_TABS)[number];
  selectedCareerId: string;
  careersSubTab: CareersSubTab;
}

export interface PersistedAppState {
  scenario: Scenario;
  ui: AppUiState;
}

const STORAGE_KEY = 'finance-planner-state';

const defaultUiState: AppUiState = {
  activeTab: 'retirement',
  selectedCareerId: '',
  careersSubTab: 'careers'
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

const normalizeCareerTimeline = (entry: CareerEntry): CareerEntry => {
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
    retirement401kMonthlyWithdrawal
  };
};

const normalizeCareerEntries = (entries: CareerEntry[]) => {
  const normalized: CareerEntry[] = [];

  entries.forEach((entry, index) => {
    const base = normalizeCareerTimeline(entry);
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
  if (value === 'retirement' || value === 'options' || value === 'careers' || value === 'netWorth') {
    return value;
  }

  if (value === 'events' || value === 'futureRetirement' || value === 'purchases') {
    return 'careers';
  }

  return 'retirement';
};

const normalizeCareersSubTab = (value: unknown): CareersSubTab => {
  if (value === 'retirement' || value === 'careers' || value === 'timeline' || value === 'purchasesExpenses' || value === 'loans') {
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
              ? normalizeCareerEntries(scenario.careerPlan.entries)
              : defaultScenario.careerPlan.entries
        },
        savingsTracker: {
          ...defaultScenario.savingsTracker,
          ...scenario.savingsTracker,
          annualInterestRates: {
            ...defaultScenario.savingsTracker.annualInterestRates,
            ...scenario.savingsTracker?.annualInterestRates
          }
        },
        netWorth: {
          ...defaultScenario.netWorth,
          ...scenario.netWorth,
          accountBalances: {
            ...defaultScenario.netWorth.accountBalances,
            ...scenario.netWorth?.accountBalances
          },
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
            fileType: record.fileType === 'csv' || record.fileType === 'pdf' ? record.fileType : 'unknown',
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
            applied: Boolean(record.applied),
            appliedAt:
              typeof record.appliedAt === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(record.appliedAt)
                ? record.appliedAt
                : ''
          })),
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
          const hasSavedAccountWithdrawals = Boolean(savedWithdrawal.firstYearAccountWithdrawals);
          const hasSavedFourPercentFlags = Boolean(savedWithdrawal.firstYearAccountUseFourPercent);
          const useAllAccountsFourPercent = savedWithdrawal.mode === 'four_percent';
          const fallbackSpecified = Math.max(0, toNumberOrFallback(savedWithdrawal.firstYearAmount, 0));

          return {
            ...defaultScenario.withdrawal,
            ...savedWithdrawal,
            minimumYearlyWithdrawal: Math.max(0, toNumberOrFallback(savedWithdrawal.minimumYearlyWithdrawal, 0)),
            firstYearAccountWithdrawals: hasSavedAccountWithdrawals
              ? {
                  ...defaultScenario.withdrawal.firstYearAccountWithdrawals,
                  ...savedWithdrawal.firstYearAccountWithdrawals
                }
              : {
                  emergencyFund: 0,
                  hsa: 0,
                  investments: 0,
                  retirement401k: fallbackSpecified
                },
            firstYearAccountUseFourPercent: hasSavedFourPercentFlags
              ? {
                  ...defaultScenario.withdrawal.firstYearAccountUseFourPercent,
                  ...savedWithdrawal.firstYearAccountUseFourPercent
                }
              : {
                  emergencyFund: useAllAccountsFourPercent,
                  hsa: useAllAccountsFourPercent,
                  investments: useAllAccountsFourPercent,
                  retirement401k: useAllAccountsFourPercent
                }
          };
        })(),
        manualReturns: { ...defaultScenario.manualReturns, ...scenario.manualReturns },
        largePurchases: (scenario.largePurchases ?? defaultScenario.largePurchases).map((purchase) => ({
          ...purchase,
          enabled: Boolean(purchase.enabled),
          ...derivePurchaseAgeAndYearMonth(
            purchase,
            scenario.options?.dateOfBirth ?? defaultScenario.options.dateOfBirth,
            scenario.profile?.currentAge ?? defaultScenario.profile.currentAge
          ),
          amount: Math.max(0, toNumberOrFallback(purchase.amount, 0)),
          sourceAmounts: (() => {
            const hasSourceAmounts =
              typeof purchase.sourceAmounts?.emergencyFund === 'number' ||
              typeof purchase.sourceAmounts?.hsa === 'number' ||
              typeof purchase.sourceAmounts?.investments === 'number' ||
              typeof purchase.sourceAmounts?.retirement401k === 'number';

            if (hasSourceAmounts) {
              return {
                emergencyFund: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.emergencyFund, 0)),
                hsa: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.hsa, 0)),
                investments: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.investments, 0)),
                retirement401k: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.retirement401k, 0))
              };
            }

            const selected = {
              emergencyFund: Boolean((purchase as unknown as { sourceAccounts?: { emergencyFund?: boolean } }).sourceAccounts?.emergencyFund),
              hsa: Boolean((purchase as unknown as { sourceAccounts?: { hsa?: boolean } }).sourceAccounts?.hsa),
              investments: Boolean((purchase as unknown as { sourceAccounts?: { investments?: boolean } }).sourceAccounts?.investments),
              retirement401k: Boolean((purchase as unknown as { sourceAccounts?: { retirement401k?: boolean } }).sourceAccounts?.retirement401k)
            };
            const selectedCount =
              Number(selected.emergencyFund) +
              Number(selected.hsa) +
              Number(selected.investments) +
              Number(selected.retirement401k);
            const splitAmount = selectedCount > 0 ? Math.max(0, toNumberOrFallback(purchase.amount, 0)) / selectedCount : 0;

            return {
              emergencyFund: selected.emergencyFund ? splitAmount : 0,
              hsa: selected.hsa ? splitAmount : 0,
              investments: selected.investments ? splitAmount : 0,
              retirement401k: selected.retirement401k ? splitAmount : 0
            };
          })()
        })),
        longTermPurchases: (scenario.longTermPurchases ?? defaultScenario.longTermPurchases ?? []).map((purchase, index) => {
          const fallbackStartAge = scenario.profile?.currentAge ?? defaultScenario.profile.currentAge;
          const startYearMonth =
            normalizeYearMonth((purchase as { startYearMonth?: unknown }).startYearMonth) ||
            formatYearMonthFromAge(fallbackStartAge + 1, scenario.options?.dateOfBirth ?? defaultScenario.options.dateOfBirth, fallbackStartAge);
          const endMode = purchase.endMode === 'endDate' ? 'endDate' : 'duration';
          const durationMonths = Math.max(1, Math.floor(toNumberOrFallback(purchase.durationMonths, 12)));
          const fallbackEndYearMonth = formatYearMonthFromAge(
            fallbackStartAge + 2,
            scenario.options?.dateOfBirth ?? defaultScenario.options.dateOfBirth,
            fallbackStartAge
          );
          const endYearMonth = normalizeYearMonth(purchase.endYearMonth) || fallbackEndYearMonth;

          return {
            id: typeof purchase.id === 'string' && purchase.id.trim().length > 0 ? purchase.id : `long-term-purchase-${index + 1}`,
            label: typeof purchase.label === 'string' && purchase.label.trim().length > 0 ? purchase.label : `Long-Term Purchase ${index + 1}`,
            enabled: Boolean(purchase.enabled),
            startYearMonth,
            endMode,
            durationMonths,
            endYearMonth,
            monthlyAmount: Math.max(0, toNumberOrFallback(purchase.monthlyAmount, 0)),
            sourceAmounts: {
              emergencyFund: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.emergencyFund, 0)),
              hsa: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.hsa, 0)),
              investments: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.investments, 0)),
              retirement401k: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.retirement401k, 0))
            }
          };
        }),
        loans: (scenario.loans ?? defaultScenario.loans ?? []).map((loan, index) => ({
          id: typeof loan.id === 'string' && loan.id.trim().length > 0 ? loan.id : `loan-${index + 1}`,
          label: typeof loan.label === 'string' && loan.label.trim().length > 0 ? loan.label : `Loan ${index + 1}`,
          enabled: Boolean(loan.enabled),
          startYearMonth:
            normalizeYearMonth(loan.startYearMonth) ||
            formatYearMonthFromAge(
              scenario.profile?.currentAge ?? defaultScenario.profile.currentAge,
              scenario.options?.dateOfBirth ?? defaultScenario.options.dateOfBirth,
              scenario.profile?.currentAge ?? defaultScenario.profile.currentAge
            ),
          originalAmount: Math.max(0, toNumberOrFallback(loan.originalAmount, 0)),
          currentBalance: Math.max(0, toNumberOrFallback(loan.currentBalance, 0)),
          annualInterestRate: toNumberOrFallback(loan.annualInterestRate, 0),
          minimumMonthlyPayment: Math.max(0, toNumberOrFallback(loan.minimumMonthlyPayment, 0)),
          extraMonthlyPayment: Math.max(0, toNumberOrFallback(loan.extraMonthlyPayment, 0)),
          paymentSourceAccount:
            loan.paymentSourceAccount === 'emergencyFund' ||
            loan.paymentSourceAccount === 'hsa' ||
            loan.paymentSourceAccount === 'investments' ||
            loan.paymentSourceAccount === 'retirement401k' ||
            loan.paymentSourceAccount === 'income'
              ? loan.paymentSourceAccount
              : 'investments'
        })),
        cashflowItems: scenario.cashflowItems ?? [],
        lifeEvents: scenario.lifeEvents ?? []
      },
      ui: {
        ...defaultUiState,
        ...ui,
        activeTab: normalizeActiveTab(ui.activeTab),
        careersSubTab: normalizeCareersSubTab(ui.careersSubTab)
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
