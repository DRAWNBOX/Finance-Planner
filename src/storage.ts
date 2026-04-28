import { defaultScenario } from './defaultScenario';
import type { CareerEntry, Scenario } from './types';

const APP_TABS = ['retirement', 'options', 'careers', 'netWorth'] as const;

export interface AppUiState {
  activeTab: (typeof APP_TABS)[number];
  selectedCareerId: string;
}

export interface PersistedAppState {
  scenario: Scenario;
  ui: AppUiState;
}

const STORAGE_KEY = 'finance-planner-state';

const defaultUiState: AppUiState = {
  activeTab: 'retirement',
  selectedCareerId: ''
};

const toNumberOrFallback = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

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
          }
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
          age: Math.max(18, toNumberOrFallback(purchase.age, defaultScenario.profile.currentAge)),
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
        cashflowItems: scenario.cashflowItems ?? [],
        lifeEvents: scenario.lifeEvents ?? []
      },
      ui: {
        ...defaultUiState,
        ...ui,
        activeTab: normalizeActiveTab(ui.activeTab)
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
