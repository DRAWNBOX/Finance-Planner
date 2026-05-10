import { defaultScenario } from './defaultScenario';
import type { CareerEntry, LargePurchase, Scenario, SourceLine } from './types';
import { ageFromYearMonth, formatYearMonthFromAge } from './utils/ageDate';
import {
  careerToSourceLines,
  DEFAULT_POOL_COLORS,
  ensureSourceLinesForPurchase,
  ensureSourceLinesForWithdrawal,
  isLegacyPoolId,
  legacySavingsToSourceLines,
  normalizeLoanPaymentSource,
  normalizeLoanDownPaymentSource,
  seedDefaultBankAccounts,
  seedDefaultPools
} from './financeModel';

const APP_TABS = ['options', 'careers', 'netWorth', 'expenses'] as const;
const CAREERS_SUB_TABS = ['retirement', 'careers', 'timeline', 'purchasesExpenses'] as const;
export type CareersSubTab = (typeof CAREERS_SUB_TABS)[number];
const EXPENSES_SUB_TABS = ['planning', 'tracking'] as const;
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
    sourceLines: (entry.sourceLines?.length ? entry.sourceLines : careerToSourceLines(entry)).map((line) => ({
      ...line,
      maxBalance: Math.max(0, toNumberOrFallback(line.maxBalance, 0)),
      overflowFallbackAccountId:
        typeof line.overflowFallbackAccountId === 'string' &&
        line.overflowFallbackAccountId !== line.sourceId &&
        bankAccountIds.has(line.overflowFallbackAccountId)
          ? line.overflowFallbackAccountId
          : null
    })),
    taxInfo: (() => {
      const ti = (entry as unknown as Record<string, unknown>).taxInfo;
      if (ti && typeof ti === 'object') {
        return {
          untaxedBenefits: Math.max(0, toNumberOrFallback((ti as Record<string, unknown>).untaxedBenefits, 0)),
          leftoverIncome: Math.max(0, toNumberOrFallback((ti as Record<string, unknown>).leftoverIncome, 0)),
          taxRate: Math.max(0, toNumberOrFallback((ti as Record<string, unknown>).taxRate, 0)),
          lastEditedField:
            (ti as Record<string, unknown>).lastEditedField === 'leftoverIncome' || (ti as Record<string, unknown>).lastEditedField === 'taxRate'
              ? (ti as Record<string, unknown>).lastEditedField as 'leftoverIncome' | 'taxRate'
              : null
        };
      }
      const thp = (entry as unknown as Record<string, unknown>).takeHomePay;
      if (thp && typeof thp === 'object') {
        const amount = Math.max(0, toNumberOrFallback((thp as Record<string, unknown>).amount, 0));
        const period = (thp as Record<string, unknown>).period;
        const yearlyAmount = period === 'yearly' ? amount : amount * 12;
        return { untaxedBenefits: 0, leftoverIncome: yearlyAmount, taxRate: 0, lastEditedField: null };
      }
      return { untaxedBenefits: 0, leftoverIncome: 0, taxRate: 0, lastEditedField: null };
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
                      : DEFAULT_POOL_COLORS[index % DEFAULT_POOL_COLORS.length],
                  annualReturnRate:
                    typeof pool.annualReturnRate === 'number'
                      ? pool.annualReturnRate
                      : firstAccount
                        ? toNumberOrFallback(firstAccount.annualReturnRate, 0)
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

            return seedDefaultPools();
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
              : seedDefaultBankAccounts({
                  ...defaultScenario.netWorth.accountBalances,
                  ...scenario.netWorth?.accountBalances
                }),
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
          const fallbackSpecified = Math.max(0, toNumberOrFallback(savedWithdrawal.firstYearAmount, 0));

          const rawSaved = savedWithdrawal as unknown as Record<string, unknown>;
          const legacyWithdrawals = rawSaved.firstYearAccountWithdrawals as Record<string, number> | undefined;
          const legacyFourPercent = rawSaved.firstYearAccountUseFourPercent as Record<string, boolean> | undefined;
          const hasSavedLines = Array.isArray(savedWithdrawal.sourceLines) && savedWithdrawal.sourceLines.length > 0;

          const migratedSourceLines: SourceLine[] = hasSavedLines
            ? savedWithdrawal.sourceLines!
            : (() => {
                const configuredTotal = Object.values(legacyWithdrawals ?? {}).reduce((s, v) => s + Math.max(0, v ?? 0), 0);
                const normalizedConfigured = configuredTotal > 0
                  ? legacyWithdrawals
                  : { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: fallbackSpecified };
                const effectiveFlags: Record<string, boolean> = {
                  emergencyFund: savedWithdrawal.mode === 'four_percent' || Boolean(legacyFourPercent?.emergencyFund),
                  hsa: savedWithdrawal.mode === 'four_percent' || Boolean(legacyFourPercent?.hsa),
                  investments: savedWithdrawal.mode === 'four_percent' || Boolean(legacyFourPercent?.investments),
                  retirement401k: savedWithdrawal.mode === 'four_percent' || Boolean(legacyFourPercent?.retirement401k)
                };
                return legacySavingsToSourceLines(normalizedConfigured as Record<string, number>, effectiveFlags, 'withdrawal-source');
              })();

          const legacyStartAges = Object.fromEntries(
            migratedSourceLines
              .filter((line) => line.sourceType === 'pool' && isLegacyPoolId(line.sourceId))
              .map((line) => [line.sourceId, typeof line.startAge === 'number' ? line.startAge : undefined])
          );
          const legacySyncFlags = Object.fromEntries(
            migratedSourceLines
              .filter((line) => line.sourceType === 'pool' && isLegacyPoolId(line.sourceId))
              .map((line) => [line.sourceId, line.syncWithRetirementAge ?? true])
          );
          const savedLines = Array.isArray(savedWithdrawal.sourceLines) ? savedWithdrawal.sourceLines : [];
          const customLines = savedLines.filter(
            (line) => line.sourceType === 'pool' && !isLegacyPoolId(line.sourceId) && line.enabled && (line.mode === 'four_percent' || line.amount > 0)
          );

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
            sourceLines: [
              ...migratedSourceLines.map((line) =>
                line.sourceType === 'pool' && isLegacyPoolId(line.sourceId)
                  ? { ...line, startAge: legacyStartAges[line.sourceId] ?? line.startAge, syncWithRetirementAge: legacySyncFlags[line.sourceId] ?? true }
                  : line
              ),
              ...customLines
            ]
          };
        })(),
        manualReturns: { ...defaultScenario.manualReturns, ...scenario.manualReturns },
        largePurchases: (scenario.largePurchases ?? defaultScenario.largePurchases).map((purchase, pIdx) => {
          const rawSaved = purchase as unknown as Record<string, unknown>;
          const savedLines = Array.isArray(rawSaved.sourceLines) ? rawSaved.sourceLines as SourceLine[] : [];
          const legacySourceAmounts = rawSaved.sourceAmounts as Record<string, number> | undefined;
          const bankAccounts = scenario.netWorth?.bankAccounts ?? defaultScenario.netWorth.bankAccounts ?? [];
          const hasLegacyAmounts = legacySourceAmounts && (
            typeof legacySourceAmounts.emergencyFund === 'number' ||
            typeof legacySourceAmounts.hsa === 'number' ||
            typeof legacySourceAmounts.investments === 'number' ||
            typeof legacySourceAmounts.retirement401k === 'number'
          );
          return {
            id: typeof purchase.id === 'string' && purchase.id.trim().length > 0 ? purchase.id : `purchase-${pIdx + 1}`,
            label: typeof purchase.label === 'string' && purchase.label.trim().length > 0 ? purchase.label : `Purchase ${pIdx + 1}`,
            enabled: Boolean(purchase.enabled),
            showOnGraph: purchase.showOnGraph !== false,
            flagColor: typeof purchase.flagColor === 'string' && purchase.flagColor.trim().length > 0 ? purchase.flagColor : undefined,
            ...derivePurchaseAgeAndYearMonth(
              purchase,
              scenario.options?.dateOfBirth ?? defaultScenario.options.dateOfBirth,
              scenario.profile?.currentAge ?? defaultScenario.profile.currentAge
            ),
            amount: Math.max(0, toNumberOrFallback(purchase.amount, 0)),
            fundingSource: typeof rawSaved.fundingSource === 'string' ? rawSaved.fundingSource as LargePurchase['fundingSource'] : undefined,
            sourceLines: savedLines.length > 0
              ? savedLines
              : hasLegacyAmounts
                ? legacySavingsToSourceLines(
                    legacySourceAmounts as Record<string, number>,
                    undefined,
                    `${purchase.id ?? `purchase-${pIdx}`}-source`
                  )
                : []
          };
        }),
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

          const rawSaved = purchase as unknown as Record<string, unknown>;
          const savedLines = Array.isArray(rawSaved.sourceLines) ? rawSaved.sourceLines as SourceLine[] : [];
          const legacySourceAmounts = rawSaved.sourceAmounts as Record<string, number> | undefined;
          const bankAccounts = scenario.netWorth?.bankAccounts ?? defaultScenario.netWorth.bankAccounts ?? [];

          return {
            id: typeof purchase.id === 'string' && purchase.id.trim().length > 0 ? purchase.id : `long-term-purchase-${index + 1}`,
            label: typeof purchase.label === 'string' && purchase.label.trim().length > 0 ? purchase.label : `Long-Term Purchase ${index + 1}`,
            enabled: Boolean(purchase.enabled),
            showOnGraph: purchase.showOnGraph !== false,
            flagColor: typeof purchase.flagColor === 'string' && purchase.flagColor.trim().length > 0 ? purchase.flagColor : undefined,
            startYearMonth,
            endMode,
            durationMonths,
            endYearMonth,
            monthlyAmount: Math.max(0, toNumberOrFallback(purchase.monthlyAmount, 0)),
            sourceLines: savedLines.length > 0
              ? savedLines
              : legacySourceAmounts
                ? legacySavingsToSourceLines(
                    legacySourceAmounts as Record<string, number>,
                    undefined,
                    `${purchase.id ?? `lt-purchase-${index}`}-source`
                  )
                : []
          };
        }),
        loans: (scenario.loans ?? defaultScenario.loans ?? []).map((loan, index) => ({
          id: typeof loan.id === 'string' && loan.id.trim().length > 0 ? loan.id : `loan-${index + 1}`,
          label: typeof loan.label === 'string' && loan.label.trim().length > 0 ? loan.label : `Loan ${index + 1}`,
          enabled: Boolean(loan.enabled),
          showOnGraph: loan.showOnGraph !== false,
          flagColor: typeof loan.flagColor === 'string' && loan.flagColor.trim().length > 0 ? loan.flagColor : undefined,
          startYearMonth:
            normalizeYearMonth(loan.startYearMonth) ||
            formatYearMonthFromAge(
              scenario.profile?.currentAge ?? defaultScenario.profile.currentAge,
              scenario.options?.dateOfBirth ?? defaultScenario.options.dateOfBirth,
              scenario.profile?.currentAge ?? defaultScenario.profile.currentAge
            ),
          originalAmount: Math.max(0, toNumberOrFallback(loan.originalAmount, 0)),
          downPayment: Math.max(0, toNumberOrFallback(loan.downPayment, 0)),
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
              : 'investments',
          paymentSource: normalizeLoanPaymentSource(
            loan,
            scenario.netWorth?.bankAccounts ?? defaultScenario.netWorth.bankAccounts ?? []
          ),
          downPaymentSource: normalizeLoanDownPaymentSource(
            loan,
            scenario.netWorth?.bankAccounts ?? defaultScenario.netWorth.bankAccounts ?? []
          )
        })),
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
