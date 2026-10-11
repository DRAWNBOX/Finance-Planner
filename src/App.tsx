import { type ChangeEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRenderCount, useTimedMemo } from './utils/perfTools';
import { ChartPanel } from './components/ChartPanel';
import { CashflowItemEditor } from './components/CashflowItemEditor';
import { CareerPlanEditor } from './components/CareerPlanEditor';
import { NetWorthHistoryChart } from './components/NetWorthHistoryChart';
import { ResultsTable } from './components/ResultsTable';
import { SavingsStackedChart } from './components/SavingsStackedChart';
import { TrajectoryComparisonChart } from './components/TrajectoryComparisonChart';
import { BufferedNumberInput } from './components/BufferedNumberInput';
import { ExpensesPlanner } from './components/ExpensesPlanner';
import { YearMonthInput } from './components/YearMonthInput';
import { HousingEditor } from './components/HousingEditor';
import { ColorPickerField } from './components/ColorPickerField';
import {
  createDefaultCashflowItem,
  createDefaultCareerEntry,
  createDefaultCreditCard,
  createDefaultHousingEntry,
  createDefaultLargePurchase,
  createDefaultLoan,
  createDefaultLongTermPurchase,
  createDefaultRentalEntry,
  defaultScenario
} from './defaultScenario';
import {
  normalizePurchaseFundingSource
} from './financeModel';
import { calculateAgeFromBirthDate, describeIncomeValidationGroup, formatCurrency, projectScenario, resolveCurrentAge } from './engine/projection';
import { addMonthsToYearMonth, ageFromYearMonth, formatYearMonthFromAge } from './utils/ageDate';
import { loadAppState, saveAppState, type AppUiState, type CareersSubTab, type ExpensesSubTab } from './storage';
import type {
  AccountTypePreset,
  BankAccountDefinition,
  CashflowCategory,
  CreditCard,
  PoolDefinition,
  NetWorthCustomAccount,
  NetWorthHistoryEntry,
  NetWorthHistoryAccountSnapshot,
  ProjectionResult,
  ProjectionYear,
  PurchaseCategory,
  PurchaseFlag,
  Scenario,
  SourceLine,
  Timeline,
  TrajectorySnapshot,
  TrajectoryYear
} from './types';
import { pickFlagColor } from './utils/colorPalette';

type AppTab = AppUiState['activeTab'];
type FinancePredictionSubTab = CareersSubTab;
type ExpensesTab = ExpensesSubTab;

const TOP_TABS: Array<{ id: AppTab; label: string }> = [
  { id: 'options', label: 'Options' },
  { id: 'careers', label: 'Finances Prediction' },
  { id: 'netWorth', label: 'Net Worth' },
  { id: 'expenses', label: 'Expenses' }
];
const FINANCE_PREDICTION_SUB_TABS: Array<{ id: FinancePredictionSubTab; label: string }> = [
  { id: 'retirement', label: 'Retirement' },
  { id: 'careers', label: 'Careers' },
  { id: 'timeline', label: 'Timeline Management' },
  { id: 'purchasesExpenses', label: 'Purchases and expenses' },
  { id: 'housing', label: 'Housing Expenses' },
  { id: 'trajectory', label: 'Trajectory' },
  { id: 'warnings', label: 'Warnings' }
];
const EXPENSES_SUB_TABS: Array<{ id: ExpensesTab; label: string }> = [
  { id: 'planning', label: 'Expense Planning' },
  { id: 'tracking', label: 'Expense Tracking' },
  { id: 'creditCards', label: 'Credit Cards' }
];

const ADD_OPTIONS: Array<{ category: CashflowCategory; label: string }> = [
  { category: 'social_security', label: 'Social Security' },
  { category: 'social_security_spouse', label: 'SS (Spouse)' },
  { category: 'inheritance', label: 'Inheritance' },
  { category: 'college_child_1', label: 'College Child 1' },
  { category: 'pension_1', label: 'Pension 1' },
  { category: 'cash_benefit_1', label: 'Cash Benefit 1' },
  { category: 'college_child_2', label: 'College Child 2' },
  { category: 'pension_2', label: 'Pension 2' },
  { category: 'cash_benefit_2', label: 'Cash Benefit 2' },
  { category: 'college_child_3', label: 'College Child 3' },
  { category: 'home_real_estate', label: 'Home/Real Estate' }
];

const numberFromInput = (value: string) => Number(value) || 0;
const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const toNumberOrFallback = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
const normalizeYearMonth = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : '';
const parseYearMonthSerial = (value: string) => {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 12 + (Number(match[2]) - 1);
};
const formatYearMonthFromSerial = (serial: number) => {
  const year = Math.floor(serial / 12);
  const month = (serial % 12) + 1;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`;
};
const deriveEndYearMonthFromDuration = (startYearMonth: string, durationMonths: number) => {
  const startSerial = parseYearMonthSerial(startYearMonth);
  if (startSerial === null) {
    return startYearMonth;
  }

  const normalizedDuration = Math.max(1, Math.floor(durationMonths));
  return formatYearMonthFromSerial(startSerial + normalizedDuration - 1);
};
const deriveDurationFromStartAndEnd = (startYearMonth: string, endYearMonth: string) => {
  const startSerial = parseYearMonthSerial(startYearMonth);
  const endSerial = parseYearMonthSerial(endYearMonth);
  if (startSerial === null || endSerial === null) {
    return 1;
  }

  return Math.max(1, endSerial - startSerial + 1);
};
const resolveBirthdayBasedCareerStartAge = (scenario: Scenario, referenceDate = new Date()) => {
  const birthdayAge = calculateAgeFromBirthDate(scenario.options.dateOfBirth, referenceDate);
  const fallbackAge = resolveCurrentAge(scenario, referenceDate);

  return Math.floor(clampNumber(birthdayAge ?? fallbackAge, 18, 110));
};

const normalizeCareerTimeline = (
  career: Scenario['careerPlan']['entries'][number],
  birthdayBasedCareerStartAge: number,
  dateOfBirth: string,
  currentAge: number
) => {
  const startYearMonth = normalizeYearMonth(career.startYearMonth);
  const endYearMonth = normalizeYearMonth(career.endYearMonth);
  const startAgeFromCalendar =
    startYearMonth !== ''
      ? ageFromYearMonth(startYearMonth, dateOfBirth, currentAge, 18, 110)
      : null;
  const fallbackStartAge = Math.min(career.startAge, career.endAge);
  const effectiveStartAge = startAgeFromCalendar ?? fallbackStartAge;
  const endAgeFromCalendar =
    endYearMonth !== ''
      ? ageFromYearMonth(endYearMonth, dateOfBirth, currentAge, effectiveStartAge, 110)
      : null;
  const fallbackEndAge = Math.max(career.startAge, career.endAge);
  const startAge = effectiveStartAge;
  const endAge = endAgeFromCalendar ?? fallbackEndAge;
  const usePreviousCareerStartAge = Boolean(career.usePreviousCareerStartAge);
  const useBirthdayBasedStartAge = Boolean(career.useBirthdayBasedStartAge) && !usePreviousCareerStartAge;
  const normalizedStartAge = useBirthdayBasedStartAge ? birthdayBasedCareerStartAge : startAge;
  const normalizedStartYearMonth =
    useBirthdayBasedStartAge || usePreviousCareerStartAge
      ? formatYearMonthFromAge(normalizedStartAge, dateOfBirth, currentAge)
      : startYearMonth || formatYearMonthFromAge(normalizedStartAge, dateOfBirth, currentAge);
  const normalizedEndYearMonth = endYearMonth || formatYearMonthFromAge(Math.max(endAge, normalizedStartAge), dateOfBirth, currentAge);

  return {
    ...career,
    usePreviousCareerStartAge,
    useBirthdayBasedStartAge,
    startYearMonth: normalizedStartYearMonth,
    endYearMonth: normalizedEndYearMonth,
    startAge: normalizedStartAge,
    endAge: Math.max(endAge, normalizedStartAge)
  };
};

const ensureUniqueCareerIds = <T extends { id: string }>(entries: T[]): T[] => {
  const seen = new Set<string>();

  return entries.map((entry) => {
    let id = entry.id;
    if (!id || seen.has(id)) {
      const baseId = id || 'career';
      let suffix = 1;
      let candidate = `${baseId}-${suffix}`;
      while (seen.has(candidate)) {
        suffix += 1;
        candidate = `${baseId}-${suffix}`;
      }
      id = candidate;
    }
    seen.add(id);
    return id === entry.id ? entry : { ...entry, id };
  });
};

const normalizeCareerEntries = (
  entries: Scenario['careerPlan']['entries'],
  birthdayBasedCareerStartAge: number,
  dateOfBirth: string,
  currentAge: number
) => {
  const normalized: Scenario['careerPlan']['entries'] = [];

  entries.forEach((entry, index) => {
    const base = normalizeCareerTimeline(entry, birthdayBasedCareerStartAge, dateOfBirth, currentAge);
    const previous = normalized[index - 1];

    if (base.useBirthdayBasedStartAge) {
      const startAge = birthdayBasedCareerStartAge;

      normalized.push({
        ...base,
        usePreviousCareerStartAge: false,
        startAge,
        endAge: Math.max(base.endAge, startAge),
        startYearMonth: formatYearMonthFromAge(startAge, dateOfBirth, currentAge)
      });
      return;
    }

    if (base.usePreviousCareerStartAge && previous) {
      const previousEndYearMonth =
        normalizeYearMonth(previous.endYearMonth) || formatYearMonthFromAge(previous.endAge, dateOfBirth, currentAge);
      const startYearMonth = addMonthsToYearMonth(previousEndYearMonth, 1);
      const startAge = ageFromYearMonth(startYearMonth, dateOfBirth, currentAge, 18, 110) ?? previous.endAge;

      normalized.push({
        ...base,
        useBirthdayBasedStartAge: false,
        startAge,
        endAge: Math.max(base.endAge, startAge),
        startYearMonth
      });
      return;
    }

    normalized.push(base);
  });

  return ensureUniqueCareerIds(normalized);
};

const makeCareerId = () => `career-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeHousingId = () => `housing-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;const makeCustomNetWorthAccountId = () => `custom-networth-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makePoolId = () => `pool-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeBankAccountId = () => `bank-account-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
type NetWorthHistoryRange = '30d' | '60d' | '90d' | '180d' | '1y' | '3y' | '5y' | '10y' | 'all';
const NET_WORTH_HISTORY_RANGE_OPTIONS: Array<{ id: NetWorthHistoryRange; label: string; days: number | null }> = [
  { id: '30d', label: '30 days', days: 30 },
  { id: '60d', label: '60 days', days: 60 },
  { id: '90d', label: '90 days', days: 90 },
  { id: '180d', label: '180 days', days: 180 },
  { id: '1y', label: '1 year', days: 365 },
  { id: '3y', label: '3 years', days: 365 * 3 },
  { id: '5y', label: '5 years', days: 365 * 5 },
  { id: '10y', label: '10 years', days: 365 * 10 },
  { id: 'all', label: 'All', days: null }
];
const ACCOUNT_TYPE_OPTIONS: Array<{ id: AccountTypePreset; label: string }> = [
  { id: 'checking', label: 'Checking' },
  { id: 'savings', label: 'Savings' },
  { id: 'taxable', label: 'Taxable' },
  { id: 'retirement401k', label: '401K' },
  { id: 'roth', label: 'Roth' },
  { id: 'hsa', label: 'HSA' }
];
const normalizeImportDate = (value: unknown) =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value) ? value : '';
const makeNetWorthHistoryEntryId = () => `networth-history-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const daysBetweenDates = (startDate: string, endDate: string) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
};
const getAvailableNetWorthHistoryRanges = (history: NetWorthHistoryEntry[]) => {
  if (history.length < 2) {
    return NET_WORTH_HISTORY_RANGE_OPTIONS.filter((option) => option.id === 'all');
  }

  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const spanDays = daysBetweenDates(sorted[0].date, sorted[sorted.length - 1].date);

  return NET_WORTH_HISTORY_RANGE_OPTIONS.filter((option) => option.id === 'all' || (option.days !== null && spanDays >= option.days));
};
const filterNetWorthHistoryByRange = (history: NetWorthHistoryEntry[], range: NetWorthHistoryRange) => {
  if (range === 'all' || history.length === 0) {
    return history;
  }

  const rangeDays = NET_WORTH_HISTORY_RANGE_OPTIONS.find((option) => option.id === range)?.days;
  if (!rangeDays) {
    return history;
  }

  const sorted = [...history].sort((a, b) => a.date.localeCompare(b.date));
  const latestDate = sorted[sorted.length - 1].date;
  const latest = new Date(latestDate);
  if (Number.isNaN(latest.getTime())) {
    return sorted;
  }

  const cutoff = new Date(latest);
  cutoff.setDate(cutoff.getDate() - rangeDays);
  return sorted.filter((entry) => {
    const parsed = new Date(entry.date);
    return !Number.isNaN(parsed.getTime()) && parsed >= cutoff;
  });
};
const deflateTrajectoryYears = (years: TrajectoryYear[], showRealDollars: boolean): TrajectoryYear[] => {
  if (!showRealDollars || years.length === 0) {
    return years;
  }
  let cumFactor = 1;
  return years.map((year) => {
    if (!year.isBaselineNow && year.inflationRate !== 0) {
      cumFactor *= 1 + year.inflationRate;
    }
    if (Math.abs(cumFactor - 1) < 0.0001) {
      return year;
    }
    const d = (value: number) => value / cumFactor;
    const dRecord = (record: Record<string, number>) =>
      Object.fromEntries(Object.entries(record).map(([key, value]) => [key, d(value)]));
    return {
      ...year,
      startBalance: d(year.startBalance),
      endBalance: d(year.endBalance),
      salary: d(year.salary),
      careerContribution: d(year.careerContribution),
      contribution: d(year.contribution),
      withdrawal: d(year.withdrawal),
      taxesPaid: d(year.taxesPaid),
      penaltiesPaid: d(year.penaltiesPaid),
      savingsBalances: dRecord(year.savingsBalances),
      accountBalancesById: dRecord(year.accountBalancesById),
      creditCardBalancesById: dRecord(year.creditCardBalancesById),
      totalCreditCardDebt: d(year.totalCreditCardDebt)
    };
  });
};
const summarizeTrajectoryYears = (years: Array<ProjectionYear | TrajectoryYear>) => {
  const last = years[years.length - 1];
  return {
    endingBalance: last ? last.endBalance : 0,
    depletionAge: years.find((year) => year.depleted)?.age ?? null,
    survives: !years.some((year) => year.depleted),
    contributions: years.reduce((sum, year) => sum + year.contribution, 0),
    withdrawals: years.reduce((sum, year) => sum + year.withdrawal, 0),
    taxes: years.reduce((sum, year) => sum + year.taxesPaid, 0),
    penalties: years.reduce((sum, year) => sum + year.penaltiesPaid, 0)
  };
};
const ControlRow = ({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  title,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  title?: string;
  onChange: (nextValue: number) => void;
}) => {
  const [draftValue, setDraftValue] = useState(String(value));
  const inputId = useId();

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const commitDraft = () => {
    if (draftValue.trim() === '' || Number.isNaN(Number(draftValue))) {
      setDraftValue(String(value));
      return;
    }

    const nextValue = clampNumber(Number(draftValue), min, max);
    setDraftValue(String(nextValue));
    onChange(nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      if (event.key === 'Escape') {
        setDraftValue(String(value));
      }

      event.currentTarget.blur();
    }
  };

  return (
    <label className="control-row" htmlFor={inputId}>
      <span title={title}>{label}</span>
      <div className="control-inputs">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={clampNumber(value, min, max)}
          disabled={disabled}
          onChange={(event) => onChange(numberFromInput(event.target.value))}
        />
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          step={step}
          disabled={disabled}
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={handleKeyDown}
        />
      </div>
    </label>
  );
};

const Panel = ({
  title,
  children,
  className = ''
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) => (
  <section className={`panel ${className}`.trim()}>
    <div className="panel-title">{title}</div>
    <div className="panel-body">{children}</div>
  </section>
);

const formatShortDate = (value: string) => {
  if (!value) {
    return 'Not set';
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = dateOnly
    ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
    : new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return 'Not set';
  }

  return parsed.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

const getCareerDerivedRetirementAge = (scenario: Scenario) => {
  const ages = scenario.careerPlan.entries.filter((entry) => entry.enabled).map((entry) => entry.endAge);
  const fallback = scenario.futureRetirement.retirementAge;
  const derived = ages.length > 0 ? Math.max(...ages) : fallback;

  return Math.max(derived, resolveCurrentAge(scenario));
};

const getTodayIsoDate = () => new Date().toISOString().slice(0, 10);
const sumSavingsBalances = (balances: Scenario['netWorth']['accountBalances']) =>
  balances.emergencyFund + balances.hsa + balances.investments + balances.retirement401k;
const sumDynamicAccountBalances = (accountBalancesById: Record<string, number>) =>
  Object.values(accountBalancesById).reduce((sum, value) => sum + Math.max(0, value), 0);
const sumPurchaseSourceLineAmounts = (sourceLines: SourceLine[]) =>
  sourceLines.reduce((sum, line) => sum + (line.enabled && line.mode === 'amount' ? Math.max(0, line.amount) : 0), 0);
const estimateLoanPayoffMonths = (currentBalance: number, annualInterestRate: number, monthlyPayment: number) => {
  let balance = Math.max(0, currentBalance);
  const rate = Math.max(-99, annualInterestRate) / 100 / 12;
  const payment = Math.max(0, monthlyPayment);

  if (balance <= 0) {
    return 0;
  }

  if (payment <= 0) {
    return null;
  }

  let months = 0;
  while (balance > 0.01 && months < 1200) {
    const interest = balance * rate;
    const nextBalance = balance + interest - payment;
    if (nextBalance >= balance) {
      return null;
    }

    balance = Math.max(0, nextBalance);
    months += 1;
  }

  return months >= 1200 ? null : months;
};
const formatLoanPayoffEstimate = (payoffMonths: number | null) => {
  if (payoffMonths === null) {
    return 'No payoff';
  }

  if (payoffMonths > 18) {
    return `${(payoffMonths / 12).toFixed(1)} yr`;
  }

  return `${payoffMonths} mo`;
};
const getDefaultBankAccountIdForPool = (accounts: BankAccountDefinition[], poolId: string) =>
  accounts
    .filter((account) => account.poolId === poolId)
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label))[0]?.id ?? null;

const normalizePurchaseSourceLinesToAccounts = (
  purchase: Scenario['largePurchases'][number] | Scenario['longTermPurchases'][number],
  bankAccounts: BankAccountDefinition[]
): SourceLine[] => {
  const normalizedLines = purchase.sourceLines ?? [];
  const byAccount = new Map<string, SourceLine>();
  const bankAccountById = new Map(bankAccounts.map((account) => [account.id, account]));

  normalizedLines.forEach((line) => {
    if (!line.enabled || line.mode !== 'amount') {
      return;
    }

    let accountId: string | null = null;
    if (line.sourceType === 'account' && bankAccountById.has(line.sourceId)) {
      accountId = line.sourceId;
    } else if (line.sourceType === 'pool') {
      accountId = getDefaultBankAccountIdForPool(bankAccounts, line.sourceId);
    }

    if (!accountId) {
      return;
    }

    const existing = byAccount.get(accountId);
    if (existing) {
      existing.amount += Math.max(0, line.amount);
      return;
    }

    byAccount.set(accountId, {
      id: line.id,
      enabled: true,
      sourceType: 'account',
      sourceId: accountId,
      mode: 'amount',
      amount: Math.max(0, line.amount)
    });
  });

  return Array.from(byAccount.values());
};

const normalizeCareerSourceLinesForBankAccounts = (
  career: Scenario['careerPlan']['entries'][number],
  accounts: BankAccountDefinition[]
) => {
  const existingLines = career.sourceLines ?? [];
  const accountIds = new Set(accounts.map((account) => account.id));

  return accounts
    .slice()
    .sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label))
    .map((account) => {
      const directLine = existingLines.find((line) => line.sourceType === 'account' && line.sourceId === account.id);
      const poolLine = existingLines.find((line) => line.sourceType === 'pool' && line.sourceId === account.poolId);
      const source = directLine ?? poolLine;

      return {
        id: source?.id ?? `career-source-${account.id}`,
        enabled: source?.enabled ?? true,
        sourceType: 'account' as const,
        sourceId: account.id,
        contributionRate: Math.max(0, toNumberOrFallback(source?.contributionRate, 0)),
        savingsMonthly: Boolean(source?.savingsMonthly),
        monthlyWithdrawal: Math.max(0, toNumberOrFallback(source?.monthlyWithdrawal, 0)),
        maxBalance: Math.max(0, toNumberOrFallback(source?.maxBalance, 0)),
        overflowFallbackAccountId:
          typeof source?.overflowFallbackAccountId === 'string' &&
          source.overflowFallbackAccountId !== account.id &&
          accountIds.has(source.overflowFallbackAccountId)
            ? source.overflowFallbackAccountId
            : null
      };
    });
};
const isLegacyPoolKey = (value: string) =>
  value === 'emergencyFund' || value === 'hsa' || value === 'investments' || value === 'retirement401k';

const App = () => {
  useRenderCount('App');
  const [appState, setAppState] = useState(() => loadAppState());
  const [graphMode, setGraphMode] = useState<'portfolio' | 'savings'>('portfolio');
  const showRealDollars = appState.ui.showRealDollars;
  const setShowRealDollars = useCallback((value: boolean) => {
    setAppState((currentState) => ({
      ...currentState,
      ui: { ...currentState.ui, showRealDollars: value }
    }));
  }, []);
  const [showPurchaseFlags, setShowPurchaseFlags] = useState(true);
  const [showHousingFlags, setShowHousingFlags] = useState(true);
  const [showMonths, setShowMonths] = useState(false);
  const [graphAgeMin, setGraphAgeMin] = useState(0);
  const [graphAgeMax, setGraphAgeMax] = useState(999);
  const [netWorthHistoryRange, setNetWorthHistoryRange] = useState<NetWorthHistoryRange>('all');
  const [trajectoryCompareAge, setTrajectoryCompareAge] = useState<number | null>(null);
  const [showExpenseTrackerAccountConfig, setShowExpenseTrackerAccountConfig] = useState(false);
  const [purchaseSort, setPurchaseSort] = useState<{ column: 'yearMonth' | 'amount' | 'fundingSource' | null; direction: 'asc' | 'desc' }>({ column: null, direction: 'asc' });
  const [showPurchaseCategoryManager, setShowPurchaseCategoryManager] = useState(false);
  const [showTimelineManager, setShowTimelineManager] = useState(false);
  const [purchaseCategoryFilter, setPurchaseCategoryFilter] = useState<Set<string | null>>(new Set());
  const [newPurchaseCategoryLabel, setNewPurchaseCategoryLabel] = useState('');
  const [showAddPurchaseModal, setShowAddPurchaseModal] = useState(false);
  const [editingCreditCardId, setEditingCreditCardId] = useState<string | null>(null);
  const [selectedHousingId, setSelectedHousingId] = useState<string>('');
  const [timelineSelection, setTimelineSelection] = useState<'career' | 'housing'>('career');
  const [timelineStartYear, setTimelineStartYear] = useState<number | null>(null);
  const [timelineEndYear, setTimelineEndYear] = useState<number | null>(null);
  const scenario = appState.scenario;
  const inflationEnabled = scenario.manualReturns.inflationEnabled;
  const customNetWorthAccounts = scenario.netWorth.customAccounts ?? [];
  const poolDefinitions = (scenario.netWorth.pools ?? []).slice().sort((a, b) => a.priority - b.priority);
  const bankAccounts =
    scenario.netWorth.bankAccounts ?? [];
  const netWorthHistory = scenario.netWorth.history ?? [];
  const expenses = scenario.expenses;
  const accountSelectionOptions: Array<{ value: string; label: string }> = bankAccounts.map((account) => ({
    value: `account:${account.id}`,
    label: `${account.label} (Account)`
  }));
  const poolPriorityById = new Map(poolDefinitions.map((pool) => [pool.id, pool.priority]));
  const poolLabelById = new Map(poolDefinitions.map((pool) => [pool.id, pool.label]));
  const orderedBankAccounts = [...bankAccounts].sort((a, b) => {
    const poolPriorityA = poolPriorityById.get(a.poolId) ?? Number.MAX_SAFE_INTEGER;
    const poolPriorityB = poolPriorityById.get(b.poolId) ?? Number.MAX_SAFE_INTEGER;

    if (poolPriorityA !== poolPriorityB) {
      return poolPriorityA - poolPriorityB;
    }

    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    return a.label.localeCompare(b.label);
  });
  const bankAccountById = new Map(bankAccounts.map((account) => [account.id, account]));
  const availableNetWorthHistoryRanges = getAvailableNetWorthHistoryRanges(netWorthHistory);
  const effectiveNetWorthHistoryRange = availableNetWorthHistoryRanges.some((range) => range.id === netWorthHistoryRange)
    ? netWorthHistoryRange
    : 'all';
  const displayedNetWorthHistory = filterNetWorthHistoryByRange(netWorthHistory, effectiveNetWorthHistoryRange);
  const activeTab = appState.ui.activeTab;
  const careersSubTab = appState.ui.careersSubTab;
  const expensesSubTab = appState.ui.expensesSubTab;
  const compareTrajectoryId = appState.ui.compareTrajectoryId;
  const simulationStartEntry = useMemo(() => {
    const entries = [...(scenario.netWorth.history ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    return entries.length > 0 ? entries[entries.length - 1] : null;
  }, [scenario.netWorth.history]);
  const simulationStartDate = simulationStartEntry?.date || getTodayIsoDate();
  const simulationReferenceDate = useMemo(() => {
    const parsed = new Date(simulationStartDate);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [simulationStartDate]);
  const simulationStartBalancesById = useMemo(
    () => (simulationStartEntry ? Object.fromEntries(simulationStartEntry.accounts.map((account) => [account.id, account.balance])) : null),
    [simulationStartEntry]
  );
  const anchoredBankAccounts = useMemo(
    () =>
      simulationStartBalancesById
        ? bankAccounts.map((account) => {
            const anchoredBalance = simulationStartBalancesById[account.id];
            return typeof anchoredBalance === 'number' ? { ...account, balance: anchoredBalance } : account;
          })
        : bankAccounts,
    [bankAccounts, simulationStartBalancesById]
  );
  const anchoredNetWorth = useMemo(
    () => (simulationStartBalancesById ? { ...scenario.netWorth, bankAccounts: anchoredBankAccounts } : scenario.netWorth),
    [scenario.netWorth, anchoredBankAccounts, simulationStartBalancesById]
  );
  const anchoredPortfolio = useMemo(
    () =>
      simulationStartEntry && anchoredBankAccounts.length === 0
        ? { ...scenario.portfolio, currentAssets: simulationStartEntry.totalNetWorth }
        : scenario.portfolio,
    [scenario.portfolio, simulationStartEntry, anchoredBankAccounts]
  );
  const currentAge = resolveCurrentAge(scenario, simulationReferenceDate);
  const birthdayBasedCareerStartAge = resolveBirthdayBasedCareerStartAge(scenario, simulationReferenceDate);
  const activeTimelineData = useMemo(() => {
    const activeTimelineId = scenario.activeTimelineId ?? null;
    const timeline = activeTimelineId
      ? ((scenario.timelines ?? []).find((t) => t.id === activeTimelineId) ?? null)
      : null;
    return {
      timeline,
      largePurchases: timeline ? timeline.purchases : scenario.largePurchases,
      longTermPurchases: timeline ? timeline.longTermPurchases : (scenario.longTermPurchases ?? []),
      loans: timeline ? timeline.loans : (scenario.loans ?? []),
      creditCards: timeline ? timeline.creditCards : (scenario.creditCards ?? []),
      careerPlan: timeline ? timeline.careerPlan : scenario.careerPlan,
      housing: timeline ? timeline.housing : (scenario.housing ?? [])
    };
  }, [scenario]);
  const activeLargePurchases = activeTimelineData.largePurchases;
  const activeLongTermPurchases = activeTimelineData.longTermPurchases;
  const activeLoans = activeTimelineData.loans;
  const activeCreditCards = activeTimelineData.creditCards;
  const activeCareerPlan = activeTimelineData.careerPlan;
  const activeHousing = activeTimelineData.housing;
  const selectedCareerId = appState.ui.selectedCareerId || activeCareerPlan.entries[0]?.id || '';
  const retirementScenario = useMemo((): Scenario => ({
    ...scenario,
    largePurchases: activeLargePurchases,
    longTermPurchases: activeLongTermPurchases,
    loans: activeLoans,
    creditCards: activeCreditCards,
    housing: activeHousing,
    netWorth: anchoredNetWorth,
    portfolio: anchoredPortfolio,
    careerPlan: {
      ...activeCareerPlan,
      enabled: false,
      entries: activeCareerPlan.entries.map((entry) => ({ ...entry, enabled: false }))
    },
    lifeEvents: scenario.lifeEvents.filter((event) => event.type !== 'job_change' && event.type !== 'career_break')
  }), [scenario, activeTimelineData, anchoredNetWorth, anchoredPortfolio]);
  const retirementProjection = useTimedMemo(
    'retirementProjection',
    () => projectScenario(retirementScenario, { startDate: simulationStartDate }),
    [retirementScenario, simulationStartDate]
  );
  const futureScenario = useMemo((): Scenario => ({
    ...scenario,
    largePurchases: activeLargePurchases,
    longTermPurchases: activeLongTermPurchases,
    loans: activeLoans,
    creditCards: activeCreditCards,
    housing: activeHousing,
    netWorth: anchoredNetWorth,
    portfolio: anchoredPortfolio,
    careerPlan: activeCareerPlan,
    profile: {
      ...scenario.profile,
      currentAge,
      retirementAge: scenario.futureRetirement.useCareerEndAge
        ? getCareerDerivedRetirementAge({ ...scenario, careerPlan: activeCareerPlan })
        : scenario.futureRetirement.retirementAge,
      retirementYears: scenario.futureRetirement.retirementYears
    }
  }), [scenario, currentAge, activeTimelineData, anchoredNetWorth, anchoredPortfolio]);
  const futureProjection = useTimedMemo(
    'futureProjection',
    () => projectScenario(futureScenario, { startDate: simulationStartDate }),
    [futureScenario, simulationStartDate]
  );
  const hasEnabledCareers = futureScenario.careerPlan.entries.some((entry) => entry.enabled);
  const usesFinancePredictionResults = activeTab === 'careers' || activeTab === 'options';
  const showTrajectoryComparison = activeTab === 'careers' && careersSubTab === 'trajectory';
  const projection = usesFinancePredictionResults ? futureProjection : retirementProjection;
  const graphProjection = projection;
  const hideResultsForExpenses = activeTab === 'expenses';
  const hideResultsPanel = hideResultsForExpenses;
  const displayedGraphYears = usesFinancePredictionResults && !hasEnabledCareers ? [] : graphProjection.years;
  const displayedPortfolioGraphYears = displayedGraphYears;

  useEffect(() => {
    if (displayedGraphYears.length > 0) {
      setGraphAgeMin(displayedGraphYears[0].age);
      const maxAge = Math.min(displayedGraphYears[displayedGraphYears.length - 1].age, futureScenario.profile.retirementAge + futureScenario.profile.retirementYears);
      setGraphAgeMax(maxAge);
    }
  }, [displayedGraphYears.length > 0 ? displayedGraphYears[0]?.age : 0, displayedGraphYears.length > 0 ? displayedGraphYears[displayedGraphYears.length - 1]?.age : 0]);
  const displayedTableYears =
    usesFinancePredictionResults && !hasEnabledCareers ? [] : projection.years;
  const deflationRate = inflationEnabled ? scenario.manualReturns.inflationRate / 100 : 0;

  const adjustedYears = useMemo(() => {
    if (!showRealDollars || displayedTableYears.length === 0) return displayedTableYears;
    let cumFactor = 1;
    return displayedTableYears.map((year) => {
      if (!year.isBaselineNow && year.inflationRate !== 0) {
        cumFactor *= (1 + year.inflationRate);
      }
      if (Math.abs(cumFactor - 1) < 0.0001) return year;
      const d = (v: number) => v / cumFactor;
      const dRecord = (rec: Record<string, number>) =>
        Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, d(v)]));
      return {
        ...year,
        startBalance: d(year.startBalance),
        salary: d(year.salary),
        careerContribution: d(year.careerContribution),
        contribution: d(year.contribution),
        withdrawal: d(year.withdrawal),
        extraCashflow: d(year.extraCashflow),
        lifeEventCashflow: d(year.lifeEventCashflow),
        taxesPaid: d(year.taxesPaid),
        penaltiesPaid: d(year.penaltiesPaid),
        savingsBalances: dRecord(year.savingsBalances),
        accountBalancesById: dRecord(year.accountBalancesById),
        creditCardBalancesById: dRecord(year.creditCardBalancesById),
        totalCreditCardDebt: d(year.totalCreditCardDebt),
        endBalance: d(year.endBalance)
      };
    });
  }, [showRealDollars, displayedTableYears]);

  const adjustedMonthlySnapshots = useMemo(() => {
    const snaps = projection?.monthlySnapshots;
    if (!showRealDollars || !snaps || snaps.length === 0 || deflationRate === 0) return snaps;
    const first = snaps[0];
    const firstSerial = first.calendarYear * 12 + (first.calendarMonth - 1);
    return snaps.map((snap) => {
      const serial = snap.calendarYear * 12 + (snap.calendarMonth - 1);
      const months = Math.max(0, serial - firstSerial);
      const factor = Math.pow(1 + deflationRate, months / 12);
      if (Math.abs(factor - 1) < 0.0001) return snap;
      const d = (v: number) => v / factor;
      const dRecord = (rec: Record<string, number>) =>
        Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, d(v)]));
      return {
        ...snap,
        startBalance: d(snap.startBalance),
        salary: d(snap.salary),
        careerContribution: d(snap.careerContribution),
        contribution: d(snap.contribution),
        withdrawal: d(snap.withdrawal),
        taxesPaid: d(snap.taxesPaid),
        penaltiesPaid: d(snap.penaltiesPaid),
        endBalance: d(snap.endBalance),
        accountBalancesById: dRecord(snap.accountBalancesById)
      };
    });
  }, [showRealDollars, projection?.monthlySnapshots, deflationRate]);

  const adjustedIncomeUsageByMonth = useMemo(() => {
    const usage = projection?.incomeUsageByMonth;
    if (!showRealDollars || !usage || deflationRate === 0) return usage;
    const keys = Object.keys(usage);
    if (keys.length === 0) return usage;
    const parseKey = (key: string) => {
      const [y, m] = key.split('-').map(Number);
      return y * 12 + (m - 1);
    };
    const firstSerial = parseKey(keys[0]);
    const result: NonNullable<typeof usage> = {};
    keys.forEach((key) => {
      const months = Math.max(0, parseKey(key) - firstSerial);
      const factor = Math.pow(1 + deflationRate, months / 12);
      const d = (v: number) => v / factor;
      result[key] = {
        availableIncome: d(usage[key].availableIncome),
        items: usage[key].items.map((item) => ({ ...item, amount: d(item.amount) }))
      };
    });
    return result;
  }, [showRealDollars, projection?.incomeUsageByMonth, deflationRate]);

  const filteredGraphYears = useMemo(() => {
    if (adjustedYears.length === 0) return adjustedYears;
    const minAge = adjustedYears[0].age;
    const maxAge = adjustedYears[adjustedYears.length - 1].age;
    const effectiveMin = graphAgeMin > minAge ? graphAgeMin : minAge;
    const effectiveMax = graphAgeMax < maxAge ? graphAgeMax : maxAge;
    if (effectiveMin <= minAge && effectiveMax >= maxAge) return adjustedYears;
    return adjustedYears.filter((y) => y.age >= effectiveMin && y.age <= effectiveMax);
  }, [adjustedYears, graphAgeMin, graphAgeMax]);
  const trajectorySnapshots = scenario.trajectorySnapshots ?? [];
  const selectedTrajectorySnapshot = trajectorySnapshots.find((snapshot) => snapshot.id === compareTrajectoryId) ?? null;
  const netWorthHistoryPoints = useMemo(
    () =>
      (scenario.netWorth.history ?? [])
        .map((entry) => {
          const parsed = new Date(entry.date);
          if (Number.isNaN(parsed.getTime())) {
            return null;
          }
          const birthAge = calculateAgeFromBirthDate(scenario.options.dateOfBirth, parsed);
          const age = birthAge ?? currentAge + (parsed.getFullYear() - new Date().getFullYear());
          return { date: entry.date, age, value: entry.totalNetWorth };
        })
        .filter((point): point is { date: string; age: number; value: number } => point !== null),
    [scenario.netWorth.history, scenario.options.dateOfBirth, currentAge]
  );
  const adjustedSelectedTrajectory = useMemo(() => {
    if (!selectedTrajectorySnapshot) {
      return null;
    }
    return { ...selectedTrajectorySnapshot, years: deflateTrajectoryYears(selectedTrajectorySnapshot.years, showRealDollars) };
  }, [selectedTrajectorySnapshot, showRealDollars]);
  const adjustedSelectedTrajectoryYears = adjustedSelectedTrajectory?.years ?? [];
  const graphYearsForMode = graphMode === 'portfolio' ? filteredGraphYears : filteredGraphYears;
  const displayedGraphEndingBalance = adjustedYears.length > 0 ? adjustedYears[adjustedYears.length - 1].endBalance : 0;
  const displayedGraphBalanceForSummary = displayedGraphEndingBalance;
  const displayedGraphEndAge = displayedGraphYears.length > 0 ? displayedGraphYears[displayedGraphYears.length - 1].age : currentAge;
  const displayedGraphDepleted = displayedGraphYears.some((year) => year.depleted);
  const displayedGraphDepletedAge = displayedGraphYears.find((year) => year.depleted)?.age ?? null;
  const displayedGraphSummary =
    usesFinancePredictionResults && !hasEnabledCareers
      ? 'No careers are selected for estimation. Enable at least one career to display projections.'
      : usesFinancePredictionResults
        ? displayedGraphDepleted && displayedGraphDepletedAge !== null
          ? `Your plan runs out of money at age ${displayedGraphDepletedAge}. Consider retiring later, saving more, or lowering withdrawals.`
          : `Congratulations! Based on your retirement plan, you can retire at age ${futureScenario.profile.retirementAge} and finish with ${formatCurrency(
              displayedGraphBalanceForSummary
            )} at age ${displayedGraphEndAge}.`
        : graphProjection.summary;
  const retirementFirstYearPlannedWithdrawals = retirementProjection.firstRetirementYearPlannedAccountWithdrawals;
  const retirementEndAge = scenario.profile.retirementAge + scenario.profile.retirementYears;
  const futureRetirementAge = futureScenario.profile.retirementAge;
  const futureEndAge = futureRetirementAge + futureScenario.profile.retirementYears;
  const futureCareerAge = getCareerDerivedRetirementAge(scenario);
  const retirementAssetsFromCareers = useMemo(() =>
    activeCareerPlan.entries.reduce((sum, entry) => {
    const careerBalances = futureProjection.careerEndSavingsBalances[entry.id];

    if (!careerBalances) {
      return sum;
    }

    return sum + sumSavingsBalances(careerBalances);
  }, 0), [activeCareerPlan.entries, futureProjection.careerEndSavingsBalances]);

  const purchaseFlags: PurchaseFlag[] = useMemo(() => {
    const raw: PurchaseFlag[] = [
      ...activeLargePurchases
        .filter((p) => p.enabled && p.showOnGraph && (purchaseCategoryFilter.size === 0 || purchaseCategoryFilter.has(p.categoryId ?? null)))
        .map((p) => ({
          id: p.id,
          label: p.label,
          age: p.age,
          amount: p.amount,
          type: 'large_purchase' as const,
          color: p.flagColor ?? '',
          yearMonth: p.yearMonth
        })),
      ...activeLongTermPurchases
        .filter((p) => p.enabled && p.showOnGraph)
        .map((p) => {
          const startAge = ageFromYearMonth(p.startYearMonth, scenario.options.dateOfBirth, currentAge, currentAge, 110);
          return {
            id: p.id,
            label: p.label,
            age: startAge ?? currentAge,
            amount: p.monthlyAmount,
            type: 'long_term_purchase' as const,
            color: p.flagColor ?? '',
            yearMonth: p.startYearMonth
          };
        }),
      ...activeLoans
        .filter((l) => l.enabled && l.showOnGraph)
        .map((l) => {
          const startAge = ageFromYearMonth(l.startYearMonth, scenario.options.dateOfBirth, currentAge, currentAge, 110);
          return {
            id: l.id,
            label: l.label,
            age: startAge ?? currentAge,
            amount: l.originalAmount,
            type: 'loan' as const,
            color: l.flagColor ?? '',
            yearMonth: l.startYearMonth
          };
        }),
      ...activeHousing
        .filter((h) => h.enabled && h.showOnGraph)
        .map((h) => {
          const startAge = ageFromYearMonth(h.startYearMonth, scenario.options.dateOfBirth, currentAge, currentAge, 110);
          return {
            id: h.id,
            label: h.label,
            age: startAge ?? currentAge,
            amount: h.purchasePrice || h.monthlyRent,
            type: 'housing' as const,
            color: h.flagColor ?? '',
            yearMonth: h.startYearMonth
          };
        })
    ];
    const colorMap = new Map<string, string>();
    raw.forEach((flag) => {
      if (flag.color) {
        colorMap.set(flag.id, flag.color);
      }
    });
    const existingColors = Array.from(colorMap.values());
    raw.forEach((flag) => {
      if (!flag.color) {
        flag.color = pickFlagColor(existingColors);
        existingColors.push(flag.color);
      }
    });
    return raw;
  }, [activeLargePurchases, activeLongTermPurchases, activeLoans, activeHousing, scenario.options.dateOfBirth, currentAge, purchaseCategoryFilter]);

  const visibleFlags = useMemo(() => purchaseFlags.filter((flag) => {
    if (flag.type === 'housing') return showHousingFlags;
    return showPurchaseFlags;
  }), [purchaseFlags, showHousingFlags, showPurchaseFlags]);

  useEffect(() => {
    saveAppState({
      scenario,
      ui: {
        ...appState.ui,
        selectedCareerId
      }
    });
  }, [appState.ui.activeTab, appState.ui.careersSubTab, appState.ui.expensesSubTab, appState.ui.compareTrajectoryId, appState.ui.showRealDollars, scenario, selectedCareerId]);

  useEffect(() => {
    if (selectedCareerId || activeCareerPlan.entries.length === 0) {
      return;
    }

    setAppState((currentState) => ({
      ...currentState,
      ui: {
        ...currentState.ui,
        selectedCareerId: activeCareerPlan.entries[0].id
      }
    }));
  }, [activeCareerPlan.entries, selectedCareerId]);

  useEffect(() => {
    if (selectedHousingId || activeHousing.length === 0) {
      return;
    }
    setSelectedHousingId(activeHousing[0].id);
  }, [activeHousing, selectedHousingId]);

  useEffect(() => {
    if (availableNetWorthHistoryRanges.some((range) => range.id === netWorthHistoryRange)) {
      return;
    }

    setNetWorthHistoryRange('all');
  }, [availableNetWorthHistoryRanges, netWorthHistoryRange]);

  useEffect(() => {
    const normalizedCareerEntries = normalizeCareerEntries(
      scenario.careerPlan.entries,
      birthdayBasedCareerStartAge,
      scenario.options.dateOfBirth,
      currentAge
    );
    const entriesChanged = normalizedCareerEntries.some((entry, index) => {
      const current = scenario.careerPlan.entries[index];

      if (!current) {
        return true;
      }

      return (
        current.startAge !== entry.startAge ||
        current.endAge !== entry.endAge ||
        Boolean(current.usePreviousCareerStartAge) !== entry.usePreviousCareerStartAge ||
        Boolean(current.useBirthdayBasedStartAge) !== Boolean(entry.useBirthdayBasedStartAge) ||
        (current.startYearMonth ?? '') !== (entry.startYearMonth ?? '') ||
        (current.endYearMonth ?? '') !== (entry.endYearMonth ?? '')
      );
    });

    if (!entriesChanged) {
      return;
    }

    setAppState((currentState) => ({
      ...currentState,
      scenario: {
        ...currentState.scenario,
        careerPlan: {
          ...currentState.scenario.careerPlan,
          entries: normalizedCareerEntries
        }
      }
    }));
  }, [birthdayBasedCareerStartAge, scenario.careerPlan.entries]);

  useEffect(() => {
    const syncedEntries = scenario.careerPlan.entries.map((entry) => ({
      ...entry,
      sourceLines: normalizeCareerSourceLinesForBankAccounts(entry, bankAccounts)
    }));
    const changed = syncedEntries.some((entry, index) => {
      const current = scenario.careerPlan.entries[index];
      const currentSignature = JSON.stringify(current?.sourceLines ?? []);
      const nextSignature = JSON.stringify(entry.sourceLines ?? []);
      return currentSignature !== nextSignature;
    });

    if (!changed) {
      return;
    }

    setAppState((currentState) => ({
      ...currentState,
      scenario: {
        ...currentState.scenario,
        careerPlan: {
          ...currentState.scenario.careerPlan,
          entries: syncedEntries
        }
      }
    }));
  }, [bankAccounts, scenario.careerPlan.entries]);

  const updateScenario = (nextScenario: Scenario) => {
    const resolvedAge = resolveCurrentAge(nextScenario);
    const normalizedBirthdayBasedCareerStartAge = resolveBirthdayBasedCareerStartAge(nextScenario);
    const normalizedCareerEntries = normalizeCareerEntries(
      nextScenario.careerPlan.entries,
      normalizedBirthdayBasedCareerStartAge,
      nextScenario.options.dateOfBirth,
      resolvedAge
    );
    const normalizedNetWorth = {
      ...nextScenario.netWorth,
      accountBalances: {
        emergencyFund: Math.max(0, toNumberOrFallback(nextScenario.netWorth.accountBalances.emergencyFund, 0)),
        hsa: Math.max(0, toNumberOrFallback(nextScenario.netWorth.accountBalances.hsa, 0)),
        investments: Math.max(0, toNumberOrFallback(nextScenario.netWorth.accountBalances.investments, 0)),
        retirement401k: Math.max(0, toNumberOrFallback(nextScenario.netWorth.accountBalances.retirement401k, 0))
      },
      customAccounts: (nextScenario.netWorth.customAccounts ?? []).map((account, index) => ({
        id:
          typeof account.id === 'string' && account.id.trim().length > 0
            ? account.id
            : `custom-networth-${index + 1}`,
        label:
          typeof account.label === 'string' && account.label.trim().length > 0
            ? account.label
            : `Account ${index + 1}`,
        balance: Math.max(0, toNumberOrFallback(account.balance, 0))
      })),
      pools: (nextScenario.netWorth.pools ?? []).map((pool, index) => ({
        id: typeof pool.id === 'string' && pool.id.trim().length > 0 ? pool.id : `pool-${index + 1}`,
        label: typeof pool.label === 'string' && pool.label.trim().length > 0 ? pool.label : `Pool ${index + 1}`,
        enabled: pool.enabled !== false,
        priority: Math.max(0, Math.floor(toNumberOrFallback(pool.priority, index))),
        preRetirementReturnRate: toNumberOrFallback(pool.preRetirementReturnRate, toNumberOrFallback((pool as unknown as Record<string, unknown>).annualReturnRate, 5)),
        postRetirementReturnRate: toNumberOrFallback(pool.postRetirementReturnRate, toNumberOrFallback((pool as unknown as Record<string, unknown>).annualReturnRate, 5)),
        taxRate: toNumberOrFallback(pool.taxRate, 0),
        penaltyRate: toNumberOrFallback(pool.penaltyRate, 0),
        isHSA: pool.isHSA ?? undefined,
        softRestrictionNote: typeof pool.softRestrictionNote === 'string' ? pool.softRestrictionNote : ''
      })),
      bankAccounts: (
        nextScenario.netWorth.bankAccounts ??
        []
      ).map((account, index) => ({
        id: typeof account.id === 'string' && account.id.trim().length > 0 ? account.id : `bank-account-${index + 1}`,
        label: typeof account.label === 'string' && account.label.trim().length > 0 ? account.label : `Bank Account ${index + 1}`,
        poolId: typeof account.poolId === 'string' && account.poolId.trim().length > 0 ? account.poolId : 'investments',
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
      })),
      history: (nextScenario.netWorth.history ?? []).map((entry, index) => ({
        id: typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id : `networth-history-${index + 1}`,
        date: normalizeImportDate(entry.date),
        accounts: Array.isArray(entry.accounts)
          ? entry.accounts.map((account, accountIndex) => ({
              id: typeof account.id === 'string' && account.id.trim().length > 0 ? account.id : `history-account-${accountIndex + 1}`,
              label:
                typeof account.label === 'string' && account.label.trim().length > 0 ? account.label : `Account ${accountIndex + 1}`,
              balance: Math.max(0, toNumberOrFallback(account.balance, 0))
            }))
          : [],
        totalNetWorth: Math.max(0, toNumberOrFallback(entry.totalNetWorth, 0))
      })),
      asOfDate: nextScenario.netWorth.asOfDate || ''
    };
    const existingWithdrawalLines = nextScenario.withdrawal.sourceLines ?? [];
    const nextFutureRetirementAge = nextScenario.futureRetirement.useCareerEndAge
      ? getCareerDerivedRetirementAge(nextScenario)
      : nextScenario.futureRetirement.retirementAge;
    const effectiveWithdrawalSourceLines = existingWithdrawalLines.map((line) =>
      line.syncWithRetirementAge !== false
        ? { ...line, startAge: nextFutureRetirementAge }
        : line
    );
    const normalizeLargePurchase = (purchase: Scenario['largePurchases'][number]) => {
      const sourceLines = normalizePurchaseSourceLinesToAccounts(purchase, normalizedNetWorth.bankAccounts ?? []);
      return {
        ...purchase,
        enabled: Boolean(purchase.enabled),
        yearMonth:
          normalizeYearMonth(purchase.yearMonth) ||
          formatYearMonthFromAge(toNumberOrFallback(purchase.age, resolvedAge), nextScenario.options.dateOfBirth, resolvedAge),
        age: (() => {
          const normalizedYearMonth =
            normalizeYearMonth(purchase.yearMonth) ||
            formatYearMonthFromAge(toNumberOrFallback(purchase.age, resolvedAge), nextScenario.options.dateOfBirth, resolvedAge);
          const derivedAge = ageFromYearMonth(
            normalizedYearMonth,
            nextScenario.options.dateOfBirth,
            resolvedAge,
            resolvedAge,
            110
          );

          return Math.floor(derivedAge ?? Math.max(resolvedAge, toNumberOrFallback(purchase.age, resolvedAge)));
        })(),
        amount: Math.max(0, toNumberOrFallback(purchase.amount, 0)),
        sourceLines
      };
    };
    const normalizeLongTermPurchase = (purchase: Scenario['longTermPurchases'][number], index: number) => {
      const fallbackStartYearMonth = formatYearMonthFromAge(resolvedAge + 1, nextScenario.options.dateOfBirth, resolvedAge);
      const startYearMonth = normalizeYearMonth(purchase.startYearMonth) || fallbackStartYearMonth;
      const fallbackEndYearMonth = formatYearMonthFromAge(resolvedAge + 2, nextScenario.options.dateOfBirth, resolvedAge);
      const endMode: Scenario['longTermPurchases'][number]['endMode'] =
        purchase.endMode === 'endDate' ? 'endDate' : 'duration';

      const sourceLines = normalizePurchaseSourceLinesToAccounts(purchase, normalizedNetWorth.bankAccounts ?? []);
      return {
        ...purchase,
        id:
          typeof purchase.id === 'string' && purchase.id.trim().length > 0
            ? purchase.id
            : `long-term-purchase-${index + 1}`,
        label:
          typeof purchase.label === 'string' && purchase.label.trim().length > 0
            ? purchase.label
            : `Long-Term Purchase ${index + 1}`,
        enabled: Boolean(purchase.enabled),
        startYearMonth,
        endMode,
        durationMonths: Math.max(1, Math.floor(toNumberOrFallback(purchase.durationMonths, 12))),
        endYearMonth: normalizeYearMonth(purchase.endYearMonth) || fallbackEndYearMonth,
        monthlyAmount: Math.max(0, toNumberOrFallback(purchase.monthlyAmount, 0)),
        sourceLines
      };
    };
    const normalizeLoan = (loan: Scenario['loans'][number], index: number) => ({
      id: typeof loan.id === 'string' && loan.id.trim().length > 0 ? loan.id : `loan-${index + 1}`,
      label: typeof loan.label === 'string' && loan.label.trim().length > 0 ? loan.label : `Loan ${index + 1}`,
      enabled: Boolean(loan.enabled),
      showOnGraph: loan.showOnGraph !== false,
      flagColor: typeof loan.flagColor === 'string' && loan.flagColor.trim().length > 0 ? loan.flagColor : undefined,
      startYearMonth:
        normalizeYearMonth(loan.startYearMonth) ||
        formatYearMonthFromAge(resolvedAge, nextScenario.options.dateOfBirth, resolvedAge),
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
      paymentSource: (loan.paymentSource ?? 'income') as Scenario['loans'][number]['paymentSource'],
      downPaymentSource: loan.downPaymentSource as Scenario['loans'][number]['downPaymentSource']
    });
    const normalizeCareerWithBankTargets = (entry: Scenario['careerPlan']['entries'][number]) => ({
      ...entry,
      sourceLines: normalizeCareerSourceLinesForBankAccounts(entry, normalizedNetWorth.bankAccounts ?? [])
    });
    const normalizeHousingChain = (
      entries: Scenario['housing'],
      careers: Scenario['careerPlan']['entries']
    ) => {
      const careerById = new Map(careers.map((career) => [career.id, career]));
      const careerStartYearMonth = (career: Scenario['careerPlan']['entries'][number]) =>
        normalizeYearMonth(career.startYearMonth) ||
        formatYearMonthFromAge(career.startAge, nextScenario.options.dateOfBirth, resolvedAge);
      const careerEndYearMonth = (career: Scenario['careerPlan']['entries'][number]) =>
        normalizeYearMonth(career.endYearMonth) ||
        formatYearMonthFromAge(career.endAge, nextScenario.options.dateOfBirth, resolvedAge);
      const result: Scenario['housing'] = [];
      entries.forEach((entry) => {
        const previous = result[result.length - 1];
        let nextEntry = entry;
        const startCareer = entry.linkedCareerStartId ? careerById.get(entry.linkedCareerStartId) : undefined;
        if (startCareer) {
          nextEntry = { ...nextEntry, startYearMonth: careerStartYearMonth(startCareer) };
        } else if (entry.usePreviousEndAsStart && previous) {
          const prevEnd = normalizeYearMonth(
            previous.housingType === 'mortgage' ? previous.sellYearMonth : previous.endYearMonth
          );
          if (prevEnd) {
            nextEntry = { ...nextEntry, startYearMonth: addMonthsToYearMonth(prevEnd, 1) };
          }
        }
        const endCareer = entry.linkedCareerEndId ? careerById.get(entry.linkedCareerEndId) : undefined;
        if (endCareer) {
          const linkedEnd = careerEndYearMonth(endCareer);
          nextEntry = nextEntry.housingType === 'mortgage'
            ? { ...nextEntry, sellYearMonth: linkedEnd }
            : { ...nextEntry, endYearMonth: linkedEnd };
        }
        result.push(nextEntry);
      });
      return result;
    };
    const normalizedHousing = normalizeHousingChain(nextScenario.housing ?? [], normalizedCareerEntries);
    const normalizedLargePurchases = (nextScenario.largePurchases ?? []).map(normalizeLargePurchase);
    const normalizedLongTermPurchases = (nextScenario.longTermPurchases ?? []).map(normalizeLongTermPurchase);
    const normalizedLoans = (nextScenario.loans ?? []).map(normalizeLoan);
    const normalizedCareerEntriesWithBankTargets = normalizedCareerEntries.map(normalizeCareerWithBankTargets);
    const normalizedTimelines = (nextScenario.timelines ?? []).map((timeline) => {
      const timelineCareerEntries = normalizeCareerEntries(
        timeline.careerPlan.entries ?? [],
        normalizedBirthdayBasedCareerStartAge,
        nextScenario.options.dateOfBirth,
        resolvedAge
      );
      return {
        ...timeline,
        purchases: (timeline.purchases ?? []).map(normalizeLargePurchase),
        longTermPurchases: (timeline.longTermPurchases ?? []).map(normalizeLongTermPurchase),
        loans: (timeline.loans ?? []).map(normalizeLoan),
        creditCards: timeline.creditCards ?? [],
        careerPlan: {
          enabled: timeline.careerPlan.enabled,
          entries: timelineCareerEntries.map(normalizeCareerWithBankTargets)
        },
        housing: normalizeHousingChain(timeline.housing ?? [], timelineCareerEntries)
      };
    });

    setAppState((currentState) => ({
      ...currentState,
      scenario: {
        ...nextScenario,
        profile: {
          ...nextScenario.profile,
          currentAge: nextScenario.profile.currentAge,
          retirementAge: Math.max(nextScenario.profile.retirementAge, resolvedAge)
        },
        futureRetirement: {
          ...nextScenario.futureRetirement,
          retirementAge: Math.max(nextScenario.futureRetirement.retirementAge, resolvedAge)
        },
        careerPlan: {
          ...nextScenario.careerPlan,
          entries: normalizedCareerEntriesWithBankTargets
        },
        netWorth: normalizedNetWorth,
        housing: normalizedHousing,
        withdrawal: {
          ...nextScenario.withdrawal,
          minimumYearlyWithdrawal: Math.max(0, toNumberOrFallback(nextScenario.withdrawal.minimumYearlyWithdrawal, 0)),
          maximumYearlyWithdrawal: Math.max(
            0,
            toNumberOrFallback(nextScenario.withdrawal.maximumYearlyWithdrawal, defaultScenario.withdrawal.maximumYearlyWithdrawal)
          ),
          useRetirementAgeAsWithdrawalStartAge: true,
          firstYearAmount: effectiveWithdrawalSourceLines.reduce((sum, line) => sum + Math.max(0, line.amount), 0),
          sourceLines: effectiveWithdrawalSourceLines
        },
        largePurchases: normalizedLargePurchases,
        timelines: normalizedTimelines,
        longTermPurchases: normalizedLongTermPurchases,
        loans: normalizedLoans,
        portfolio: { ...nextScenario.portfolio }
      }
    }));
  };

  const updateSidebarTab = useCallback((nextTab: AppTab) => {
    setAppState((currentState) => ({
      ...currentState,
      ui: {
        ...currentState.ui,
        activeTab: nextTab,
        careersSubTab: nextTab === 'careers' && currentState.ui.activeTab !== 'careers' ? 'careers' : currentState.ui.careersSubTab
      }
    }));
  }, []);

  const updateCareersSubTab = useCallback((nextSubTab: FinancePredictionSubTab) => {
    setAppState((currentState) => ({
      ...currentState,
      ui: {
        ...currentState.ui,
        careersSubTab: nextSubTab
      }
    }));
  }, []);

  const resetScenario = useCallback(() => {
    if (!window.confirm('Reset the scenario to default values? This will clear your current plan settings.')) {
      return;
    }

    setAppState({
      scenario: defaultScenario,
      ui: {
        activeTab: 'careers',
        selectedCareerId: defaultScenario.careerPlan.entries[0]?.id ?? '',
        careersSubTab: 'careers',
        expensesSubTab: 'planning',
        compareTrajectoryId: '',
        showRealDollars: false
      }
    });
  }, []);

  const updateSelectedCareerId = useCallback((careerId: string) => {
    setAppState((currentState) => ({
      ...currentState,
      ui: {
        ...currentState.ui,
        selectedCareerId: careerId
      }
    }));
  }, []);

  const updateCareer = (nextCareer: Scenario['careerPlan']['entries'][number]) => {
    updateScenario(applyToActiveTimeline(({ careerPlan, ...rest }) => ({
      ...rest,
      careerPlan: {
        ...careerPlan,
        entries: careerPlan.entries.map((career) => (career.id === nextCareer.id ? nextCareer : career))
      }
    })));
  };

  const addCareer = () => {
    const nextIndex = activeCareerPlan.entries.length;
    const entry = createDefaultCareerEntry(nextIndex, currentAge, scenario.profile.retirementAge, makeCareerId());

    updateScenario(applyToActiveTimeline(({ careerPlan, ...rest }) => ({
      ...rest,
      careerPlan: {
        ...careerPlan,
        entries: [...careerPlan.entries, entry]
      }
    })));
    updateSelectedCareerId(entry.id);
  };

  const removeCareer = (careerId: string) => {
    const remaining = activeCareerPlan.entries.filter((career) => career.id !== careerId);

    updateScenario(applyToActiveTimeline(({ careerPlan, housing, ...rest }) => ({
      ...rest,
      careerPlan: {
        ...careerPlan,
        entries: remaining
      },
      housing: housing.map((entry) => ({
        ...entry,
        linkedCareerStartId: entry.linkedCareerStartId === careerId ? null : entry.linkedCareerStartId,
        linkedCareerEndId: entry.linkedCareerEndId === careerId ? null : entry.linkedCareerEndId
      }))
    })));

    if (selectedCareerId === careerId) {
      updateSelectedCareerId(remaining[0]?.id ?? '');
    }
  };

  const duplicateCareer = (careerId: string) => {
    const sourceIndex = activeCareerPlan.entries.findIndex((career) => career.id === careerId);

    if (sourceIndex < 0) {
      return;
    }

    const source = activeCareerPlan.entries[sourceIndex];
    const duplicate = {
      ...source,
      id: makeCareerId(),
      label: `${source.label} Copy`
    };
    const nextEntries = [...activeCareerPlan.entries];

    nextEntries.splice(sourceIndex + 1, 0, duplicate);

    updateScenario(applyToActiveTimeline(({ careerPlan, ...rest }) => ({
      ...rest,
      careerPlan: {
        ...careerPlan,
        entries: nextEntries
      }
    })));
    updateSelectedCareerId(duplicate.id);
  };

  const reorderCareers = (fromCareerId: string, toCareerId: string) => {
    if (fromCareerId === toCareerId) {
      return;
    }

    const fromIndex = activeCareerPlan.entries.findIndex((career) => career.id === fromCareerId);
    const toIndex = activeCareerPlan.entries.findIndex((career) => career.id === toCareerId);

    if (fromIndex < 0 || toIndex < 0) {
      return;
    }

    const nextEntries = [...activeCareerPlan.entries];
    const [movingCareer] = nextEntries.splice(fromIndex, 1);

    nextEntries.splice(toIndex, 0, movingCareer);

    updateScenario(applyToActiveTimeline(({ careerPlan, ...rest }) => ({
      ...rest,
      careerPlan: {
        ...careerPlan,
        entries: nextEntries
      }
    })));
  };

  const toggleAddOption = (category: CashflowCategory, checked: boolean) => {
    if (checked) {
      if (scenario.cashflowItems.some((item) => item.category === category)) {
        return;
      }

      updateScenario({
        ...scenario,
        cashflowItems: [
          ...scenario.cashflowItems,
          createDefaultCashflowItem(category, currentAge, scenario.profile.retirementAge, scenario.profile.retirementYears)
        ]
      });
      return;
    }

    updateScenario({
      ...scenario,
      cashflowItems: scenario.cashflowItems.filter((item) => item.category !== category)
    });
  };

  const addLargePurchase = () => {
    setShowAddPurchaseModal(true);
  };

  type TimelineDomainData = {
    purchases: Scenario['largePurchases'][number][];
    longTermPurchases: Scenario['longTermPurchases'][number][];
    loans: Scenario['loans'][number][];
    creditCards: CreditCard[];
    careerPlan: Scenario['careerPlan'];
    housing: Scenario['housing'][number][];
  };

  const applyToActiveTimeline = (
    transform: (data: TimelineDomainData) => TimelineDomainData
  ): Scenario => {
    const activeTimelineId = scenario.activeTimelineId ?? null;
    const data: TimelineDomainData = {
      purchases: activeLargePurchases,
      longTermPurchases: activeLongTermPurchases,
      loans: activeLoans,
      creditCards: activeCreditCards,
      careerPlan: activeCareerPlan,
      housing: activeHousing
    };
    const next = transform(data);
    if (!activeTimelineId) {
      return {
        ...scenario,
        largePurchases: next.purchases,
        longTermPurchases: next.longTermPurchases,
        loans: next.loans,
        creditCards: next.creditCards,
        careerPlan: next.careerPlan,
        housing: next.housing
      };
    }
    return {
      ...scenario,
      timelines: (scenario.timelines ?? []).map((timeline) =>
        timeline.id === activeTimelineId
          ? {
              ...timeline,
              purchases: next.purchases,
              longTermPurchases: next.longTermPurchases,
              loans: next.loans,
              creditCards: next.creditCards,
              careerPlan: next.careerPlan,
              housing: next.housing
            }
          : timeline
      )
    };
  };

  const confirmAddPurchase = (categoryId: string | null) => {
    const entry = createDefaultLargePurchase(currentAge, scenario.options.dateOfBirth);
    entry.categoryId = categoryId;

    updateScenario(applyToActiveTimeline(({ purchases, ...rest }) => ({ ...rest, purchases: [...purchases, entry] })));

    setShowAddPurchaseModal(false);
  };

  const cloneCareer = (career: Scenario['careerPlan']['entries'][number]) => ({
    ...career,
    sourceLines: career.sourceLines ? career.sourceLines.map((line) => ({ ...line })) : undefined,
    paycheckInfo: career.paycheckInfo
      ? { ...career.paycheckInfo, period: career.paycheckInfo.period ? { ...career.paycheckInfo.period } : undefined }
      : undefined
  });

  const addTimeline = () => {
    const label = `Timeline ${(scenario.timelines ?? []).length + 1}`;
    const id = `timeline-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
    const timeline = {
      id,
      label,
      purchases: activeLargePurchases.map((purchase) => ({
        ...purchase,
        sourceLines: purchase.sourceLines ? purchase.sourceLines.map((line) => ({ ...line })) : undefined
      })),
      longTermPurchases: activeLongTermPurchases.map((purchase) => ({
        ...purchase,
        sourceLines: purchase.sourceLines ? purchase.sourceLines.map((line) => ({ ...line })) : undefined
      })),
      loans: activeLoans.map((loan) => ({ ...loan })),
      creditCards: activeCreditCards.map((cc) => ({ ...cc })),
      careerPlan: { ...activeCareerPlan, entries: activeCareerPlan.entries.map(cloneCareer) },
      housing: activeHousing.map((h) => ({ ...h }))
    };
    updateScenario({
      ...scenario,
      timelines: [...(scenario.timelines ?? []), timeline],
      activeTimelineId: id
    });
  };

  const switchTimeline = (timelineId: string | null) => {
    updateScenario({
      ...scenario,
      activeTimelineId: timelineId
    });
  };

  const renameTimeline = (timelineId: string, label: string) => {
    updateScenario({
      ...scenario,
      timelines: (scenario.timelines ?? []).map((timeline) =>
        timeline.id === timelineId ? { ...timeline, label } : timeline
      )
    });
  };

  const deleteTimeline = (timelineId: string) => {
    updateScenario({
      ...scenario,
      timelines: (scenario.timelines ?? []).filter((timeline) => timeline.id !== timelineId),
      activeTimelineId: scenario.activeTimelineId === timelineId ? null : scenario.activeTimelineId
    });
  };

  const duplicateTimeline = (timelineId: string) => {
    const source = (scenario.timelines ?? []).find((timeline) => timeline.id === timelineId);
    if (!source) {
      return;
    }

    const copy: Timeline = {
      id: `timeline-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`,
      label: `${source.label} (copy)`,
      purchases: source.purchases.map((purchase) => ({
        ...purchase,
        sourceLines: purchase.sourceLines ? purchase.sourceLines.map((line) => ({ ...line })) : undefined
      })),
      longTermPurchases: source.longTermPurchases.map((purchase) => ({
        ...purchase,
        sourceLines: purchase.sourceLines ? purchase.sourceLines.map((line) => ({ ...line })) : undefined
      })),
      loans: source.loans.map((loan) => ({ ...loan })),
      creditCards: source.creditCards.map((creditCard) => ({ ...creditCard })),
      careerPlan: { ...source.careerPlan, entries: source.careerPlan.entries.map(cloneCareer) },
      housing: source.housing.map((entry) => ({ ...entry }))
    };

    updateScenario({
      ...scenario,
      timelines: [...(scenario.timelines ?? []), copy]
    });
  };

  const saveTrajectorySnapshot = () => {
    const snapshotYears: TrajectoryYear[] = futureProjection.years.map((year) => ({
      age: year.age,
      calendarYear: year.calendarYear,
      isBaselineNow: year.isBaselineNow,
      startBalance: year.startBalance,
      endBalance: year.endBalance,
      salary: year.salary,
      careerContribution: year.careerContribution,
      contribution: year.contribution,
      withdrawal: year.withdrawal,
      taxesPaid: year.taxesPaid,
      penaltiesPaid: year.penaltiesPaid,
      annualReturnRate: year.annualReturnRate,
      inflationRate: year.inflationRate,
      depleted: year.depleted,
      savingsBalances: { ...year.savingsBalances },
      accountBalancesById: { ...year.accountBalancesById },
      creditCardBalancesById: { ...year.creditCardBalancesById },
      totalCreditCardDebt: year.totalCreditCardDebt
    }));
    const snapshot: TrajectorySnapshot = {
      id: `trajectory-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`,
      label: `Trajectory ${trajectorySnapshots.length + 1}`,
      createdAt: getTodayIsoDate(),
      survivesToEnd: futureProjection.survivesToEnd,
      depletedAge: futureProjection.depletedAge,
      endAge: futureProjection.endAge,
      endingBalance: futureProjection.endingBalance,
      summary: futureProjection.summary,
      years: snapshotYears
    };

    updateScenario({
      ...scenario,
      trajectorySnapshots: [...trajectorySnapshots, snapshot]
    });
    setAppState((currentState) => ({
      ...currentState,
      ui: { ...currentState.ui, compareTrajectoryId: snapshot.id }
    }));
  };

  const renameTrajectorySnapshot = (snapshotId: string, label: string) => {
    updateScenario({
      ...scenario,
      trajectorySnapshots: trajectorySnapshots.map((snapshot) =>
        snapshot.id === snapshotId ? { ...snapshot, label } : snapshot
      )
    });
  };

  const deleteTrajectorySnapshot = (snapshotId: string) => {
    updateScenario({
      ...scenario,
      trajectorySnapshots: trajectorySnapshots.filter((snapshot) => snapshot.id !== snapshotId)
    });
    setAppState((currentState) => ({
      ...currentState,
      ui: {
        ...currentState.ui,
        compareTrajectoryId: currentState.ui.compareTrajectoryId === snapshotId ? '' : currentState.ui.compareTrajectoryId
      }
    }));
  };

  const setCompareTrajectoryId = (snapshotId: string) => {
    setAppState((currentState) => ({
      ...currentState,
      ui: { ...currentState.ui, compareTrajectoryId: snapshotId }
    }));
  };

  const normalizePurchaseSourceLinesForAccounts = (
    purchase: Scenario['largePurchases'][number] | Scenario['longTermPurchases'][number]
  ): SourceLine[] => {
    return normalizePurchaseSourceLinesToAccounts(purchase, bankAccounts);
  };

  const withUpdatedPurchaseAccountAmount = (
    purchase: Scenario['largePurchases'][number] | Scenario['longTermPurchases'][number],
    accountId: string,
    nextAmount: number
  ) => {
    const clampedAmount = Math.max(0, nextAmount);
    const current = normalizePurchaseSourceLinesForAccounts(purchase);
    const filtered = current.filter((line) => line.sourceId !== accountId);
    const existing = current.find((line) => line.sourceId === accountId);
    const nextSourceLines =
      clampedAmount > 0
        ? [
            ...filtered,
            {
              id: existing?.id ?? `${purchase.id}-source-${accountId}`,
              enabled: true,
              sourceType: 'account' as const,
              sourceId: accountId,
              mode: 'amount' as const,
              amount: clampedAmount
            }
          ]
        : filtered;

    return {
      sourceLines: nextSourceLines
    };
  };

  const updateLargePurchase = (purchaseId: string, nextPurchase: Scenario['largePurchases'][number]) => {
    updateScenario(applyToActiveTimeline(({ purchases, ...rest }) => ({
      ...rest,
      purchases: purchases.map((purchase) => (purchase.id === purchaseId ? nextPurchase : purchase))
    })));
  };

  const removeLargePurchase = (purchaseId: string) => {
    updateScenario(applyToActiveTimeline(({ purchases, ...rest }) => ({
      ...rest,
      purchases: purchases.filter((purchase) => purchase.id !== purchaseId)
    })));
  };

  const addPurchaseCategory = () => {
    const label = newPurchaseCategoryLabel.trim();
    if (label.length === 0) return;
    const id = `purchase-category-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
    updateScenario({
      ...scenario,
      purchaseCategories: [...scenario.purchaseCategories, { id, label }]
    });
    setNewPurchaseCategoryLabel('');
  };

  const renamePurchaseCategory = (categoryId: string, label: string) => {
    updateScenario({
      ...scenario,
      purchaseCategories: scenario.purchaseCategories.map((cat) =>
        cat.id === categoryId ? { ...cat, label } : cat
      )
    });
  };

  const removePurchaseCategory = (categoryId: string) => {
    updateScenario({
      ...scenario,
      purchaseCategories: scenario.purchaseCategories.filter((cat) => cat.id !== categoryId),
      largePurchases: scenario.largePurchases.map((purchase) =>
        purchase.categoryId === categoryId ? { ...purchase, categoryId: null } : purchase
      ),
      timelines: (scenario.timelines ?? []).map((timeline) => ({
        ...timeline,
        purchases: (timeline.purchases ?? []).map((purchase) =>
          purchase.categoryId === categoryId ? { ...purchase, categoryId: null } : purchase
        )
      }))
    });
    setPurchaseCategoryFilter((prev) => {
      const next = new Set(prev);
      next.delete(categoryId);
      return next;
    });
  };

  const addLongTermPurchase = () => {
    const entry = createDefaultLongTermPurchase(currentAge, scenario.options.dateOfBirth);

    updateScenario(applyToActiveTimeline(({ longTermPurchases, ...rest }) => ({
      ...rest,
      longTermPurchases: [...longTermPurchases, entry]
    })));
  };

  const updateLongTermPurchase = (
    purchaseId: string,
    nextPurchase: Scenario['longTermPurchases'][number]
  ) => {
    updateScenario(applyToActiveTimeline(({ longTermPurchases, ...rest }) => ({
      ...rest,
      longTermPurchases: longTermPurchases.map((purchase) =>
        purchase.id === purchaseId ? nextPurchase : purchase
      )
    })));
  };

  const removeLongTermPurchase = (purchaseId: string) => {
    updateScenario(applyToActiveTimeline(({ longTermPurchases, ...rest }) => ({
      ...rest,
      longTermPurchases: longTermPurchases.filter((purchase) => purchase.id !== purchaseId)
    })));
  };

  const applyPurchaseFundingSource = <T extends Scenario['largePurchases'][number] | Scenario['longTermPurchases'][number]>(
    purchase: T,
    nextFundingSource: string,
    customAmount?: number
  ): T => {
    const amount = customAmount ?? ('amount' in purchase ? purchase.amount : purchase.monthlyAmount);
    const newFundingSource: 'income' | `account:${string}` = nextFundingSource === 'income' ? 'income' : (nextFundingSource as `account:${string}`);
    const newSourceLines = normalizePurchaseFundingSource(newFundingSource, amount, bankAccounts);

    return {
      ...purchase,
      ...('amount' in purchase ? { amount } : { monthlyAmount: amount }),
      fundingSource: newFundingSource,
      sourceLines: newSourceLines
    };
  };

  const addLoan = () => {
    const entry = createDefaultLoan(currentAge, scenario.options.dateOfBirth);

    updateScenario(applyToActiveTimeline(({ loans, ...rest }) => ({
      ...rest,
      loans: [...loans, entry]
    })));
  };

  const updateLoan = (loanId: string, nextLoan: Scenario['loans'][number]) => {
    updateScenario(applyToActiveTimeline(({ loans, ...rest }) => ({
      ...rest,
      loans: loans.map((loan) => (loan.id === loanId ? nextLoan : loan))
    })));
  };

  const removeLoan = (loanId: string) => {
    updateScenario(applyToActiveTimeline(({ loans, ...rest }) => ({
      ...rest,
      loans: loans.filter((loan) => loan.id !== loanId)
    })));
  };

  const addCreditCard = () => {
    updateScenario(applyToActiveTimeline(({ creditCards, ...rest }) => ({
      ...rest,
      creditCards: [...creditCards, createDefaultCreditCard()]
    })));
  };

  const updateCreditCard = (cardId: string, nextCard: CreditCard) => {
    updateScenario(applyToActiveTimeline(({ creditCards, ...rest }) => ({
      ...rest,
      creditCards: creditCards.map((cc) => (cc.id === cardId ? nextCard : cc))
    })));
  };

  const removeCreditCard = (cardId: string) => {
    updateScenario(applyToActiveTimeline(({ creditCards, ...rest }) => ({
      ...rest,
      creditCards: creditCards.filter((cc) => cc.id !== cardId)
    })));
  };

  const addHousing = (type: 'mortgage' | 'rental') => {
    const entry = type === 'mortgage'
      ? createDefaultHousingEntry(currentAge, scenario.options.dateOfBirth)
      : createDefaultRentalEntry(currentAge, scenario.options.dateOfBirth);
    updateScenario(applyToActiveTimeline(({ housing, ...rest }) => ({
      ...rest,
      housing: [...housing, entry]
    })));
    setSelectedHousingId(entry.id);
  };

  const updateHousing = (housingId: string, nextHousing: Scenario['housing'][number]) => {
    updateScenario(applyToActiveTimeline(({ housing, ...rest }) => ({
      ...rest,
      housing: housing.map((h) => (h.id === housingId ? nextHousing : h))
    })));
  };

  const removeHousing = (housingId: string) => {
    updateScenario(applyToActiveTimeline(({ housing, ...rest }) => ({
      ...rest,
      housing: housing.filter((h) => h.id !== housingId)
    })));
    if (selectedHousingId === housingId) {
      const remaining = activeHousing.filter((h) => h.id !== housingId);
      setSelectedHousingId(remaining[0]?.id ?? '');
    }
  };

  const reorderHousing = (fromHousingId: string, toHousingId: string) => {
    if (fromHousingId === toHousingId) return;
    const fromIndex = activeHousing.findIndex((h) => h.id === fromHousingId);
    const toIndex = activeHousing.findIndex((h) => h.id === toHousingId);
    if (fromIndex < 0 || toIndex < 0) return;

    const nextHousing = [...activeHousing];
    const [moving] = nextHousing.splice(fromIndex, 1);
    nextHousing.splice(toIndex, 0, moving);

    updateScenario(applyToActiveTimeline(({ housing, ...rest }) => ({
      ...rest,
      housing: nextHousing
    })));
  };

  const duplicateHousing = (housingId: string) => {
    const sourceIndex = activeHousing.findIndex((h) => h.id === housingId);
    if (sourceIndex < 0) return;
    const source = activeHousing[sourceIndex];
    const duplicate = {
      ...source,
      id: makeHousingId(),
      label: `${source.label} Copy`
    };
    const nextHousing = [...activeHousing];
    nextHousing.splice(sourceIndex + 1, 0, duplicate);
    updateScenario(applyToActiveTimeline(({ housing, ...rest }) => ({
      ...rest,
      housing: nextHousing
    })));
    setSelectedHousingId(duplicate.id);
  };

  const handleFlagColorChange = (flagId: string, color: string) => {
    const matchLarge = activeLargePurchases.find((p) => p.id === flagId);
    if (matchLarge) {
      updateLargePurchase(flagId, { ...matchLarge, flagColor: color });
      return;
    }
    const matchLongTerm = activeLongTermPurchases.find((p) => p.id === flagId);
    if (matchLongTerm) {
      updateLongTermPurchase(flagId, { ...matchLongTerm, flagColor: color });
      return;
    }
    const matchLoan = activeLoans.find((l) => l.id === flagId);
    if (matchLoan) {
      updateLoan(flagId, { ...matchLoan, flagColor: color });
      return;
    }
    const matchHousing = activeHousing.find((h) => h.id === flagId);
    if (matchHousing) {
      updateHousing(flagId, { ...matchHousing, flagColor: color });
    }
  };

  const addPool = () => {
    const nextPool: PoolDefinition = {
      id: makePoolId(),
      label: `Pool ${poolDefinitions.length + 1}`,
      enabled: true,
      priority: poolDefinitions.length,
      preRetirementReturnRate: 5,
      postRetirementReturnRate: 5,
      taxRate: 0,
      penaltyRate: 0
    };

    updateScenario({
      ...scenario,
      netWorth: {
        ...scenario.netWorth,
        pools: [...poolDefinitions, nextPool]
      }
    });
  };

  const updatePool = (poolId: string, changes: Partial<PoolDefinition>) => {
    updateScenario({
      ...scenario,
      netWorth: {
        ...scenario.netWorth,
        pools: poolDefinitions.map((pool) => (pool.id === poolId ? { ...pool, ...changes } : pool))
      }
    });
  };

  const removePool = (poolId: string) => {
    if (!window.confirm('Remove this pool? Any accounts in it will be reassigned to Investments if available.')) {
      return;
    }

    const fallbackPoolId = poolDefinitions.find((pool) => pool.id === 'investments')?.id ?? poolDefinitions[0]?.id ?? 'investments';
    updateScenario({
      ...scenario,
      netWorth: {
        ...scenario.netWorth,
        pools: poolDefinitions.filter((pool) => pool.id !== poolId),
        bankAccounts: bankAccounts.map((account) => (account.poolId === poolId ? { ...account, poolId: fallbackPoolId } : account))
      }
    });
  };

  const addBankAccount = () => {
    const targetPoolId = poolDefinitions[0]?.id ?? 'investments';
    const nextAccount: BankAccountDefinition = {
      id: makeBankAccountId(),
      label: `Bank Account ${bankAccounts.length + 1}`,
      poolId: targetPoolId,
      priority: 0,
      accountType: 'taxable',
      balance: 0
    };

    updateScenario({
      ...scenario,
      netWorth: {
        ...scenario.netWorth,
        bankAccounts: [...bankAccounts, nextAccount]
      }
    });
  };

  const updateBankAccount = (accountId: string, changes: Partial<BankAccountDefinition>) => {
    updateScenario({
      ...scenario,
      netWorth: {
        ...scenario.netWorth,
        bankAccounts: bankAccounts.map((account) =>
          account.id === accountId
            ? { ...account, ...changes }
            : account
        )
      }
    });
  };

  const removeBankAccount = (accountId: string) => {
    if (!window.confirm('Remove this bank account?')) {
      return;
    }

    updateScenario({
      ...scenario,
      netWorth: {
        ...scenario.netWorth,
        bankAccounts: bankAccounts.filter((account) => account.id !== accountId)
      }
    });
  };

  const addCustomNetWorthAccount = () => {
    const nextIndex = customNetWorthAccounts.length + 1;
    const nextAccount = {
      id: makeCustomNetWorthAccountId(),
      label: `Account ${nextIndex}`,
      balance: 0
    };

    updateNetWorthWithHistory(
      {
        ...scenario.netWorth,
        customAccounts: [...customNetWorthAccounts, nextAccount],
        asOfDate: getTodayIsoDate()
      },
      { logDate: getTodayIsoDate() }
    );
  };

  const updateCustomNetWorthAccount = (
    accountId: string,
    changes: Partial<NetWorthCustomAccount>
  ) => {
    const nextCustomAccounts = customNetWorthAccounts.map((account) =>
      account.id === accountId ? { ...account, ...changes } : account
    );
    const shouldLog = Object.prototype.hasOwnProperty.call(changes, 'balance');

    updateNetWorthWithHistory(
      {
        ...scenario.netWorth,
        customAccounts: nextCustomAccounts,
        asOfDate: getTodayIsoDate()
      },
      { logDate: getTodayIsoDate(), forceLog: shouldLog }
    );
  };

  const removeCustomNetWorthAccount = (accountId: string) => {
    const account = customNetWorthAccounts.find((entry) => entry.id === accountId);

    if (!account) {
      return;
    }

    if (!window.confirm(`Remove "${account.label}" from custom net worth accounts?`)) {
      return;
    }

    updateNetWorthWithHistory(
      {
        ...scenario.netWorth,
        customAccounts: customNetWorthAccounts.filter((entry) => entry.id !== accountId),
        asOfDate: getTodayIsoDate()
      },
      { logDate: getTodayIsoDate() }
    );
  };

  const buildNetWorthHistoryAccounts = (
    balances: Scenario['netWorth']['accountBalances'],
    customAccounts: NetWorthCustomAccount[],
    trackedBankAccounts: BankAccountDefinition[]
  ): NetWorthHistoryAccountSnapshot[] => [
    ...trackedBankAccounts.map((account) => ({
      id: account.id,
      label: account.label,
      balance: Math.max(0, account.balance)
    })),
    ...(!trackedBankAccounts.length
      ? [
          { id: 'emergencyFund', label: 'Emergency Fund', balance: Math.max(0, balances.emergencyFund) },
          { id: 'hsa', label: 'HSA', balance: Math.max(0, balances.hsa) },
          { id: 'investments', label: 'Investments', balance: Math.max(0, balances.investments) },
          { id: 'retirement401k', label: '401K', balance: Math.max(0, balances.retirement401k) }
        ]
      : []),
    ...customAccounts.map((account) => ({
      id: account.id,
      label: account.label,
      balance: Math.max(0, account.balance)
    }))
  ];

  const appendNetWorthHistoryEntry = (
    previousNetWorth: Scenario['netWorth'],
    nextNetWorth: Scenario['netWorth'],
    logDate: string,
    forceLog = false
  ) => {
    const previousAccounts = buildNetWorthHistoryAccounts(
      previousNetWorth.accountBalances,
      previousNetWorth.customAccounts ?? [],
      previousNetWorth.bankAccounts ?? []
    );
    const nextAccounts = buildNetWorthHistoryAccounts(
      nextNetWorth.accountBalances,
      nextNetWorth.customAccounts ?? [],
      nextNetWorth.bankAccounts ?? []
    );
    const previousSignature = previousAccounts.map((account) => `${account.id}:${account.balance}`).join('|');
    const nextSignature = nextAccounts.map((account) => `${account.id}:${account.balance}`).join('|');
    const changed = previousSignature !== nextSignature;

    if (!forceLog && !changed) {
      return nextNetWorth.history ?? previousNetWorth.history ?? [];
    }

    const totalNetWorth = nextAccounts.reduce((sum, account) => sum + account.balance, 0);
    const nextHistoryEntry: NetWorthHistoryEntry = {
      id: makeNetWorthHistoryEntryId(),
      date: logDate,
      accounts: nextAccounts,
      totalNetWorth
    };

    return [...(nextNetWorth.history ?? previousNetWorth.history ?? []), nextHistoryEntry];
  };

  const updateNetWorthWithHistory = (
    nextNetWorth: Scenario['netWorth'],
    options?: { logDate?: string; forceLog?: boolean }
  ) => {
    const logDate = options?.logDate ?? getTodayIsoDate();
    const history = appendNetWorthHistoryEntry(scenario.netWorth, nextNetWorth, logDate, options?.forceLog ?? false);

    updateScenario({
      ...scenario,
      netWorth: {
        ...nextNetWorth,
        history
      }
    });
  };

  const saveNetWorthSnapshot = () => {
    const today = getTodayIsoDate();
    const historyWithoutToday = (scenario.netWorth.history ?? []).filter((entry) => entry.date !== today);

    updateNetWorthWithHistory(
      {
        ...scenario.netWorth,
        asOfDate: today,
        history: historyWithoutToday
      },
      { logDate: today, forceLog: true }
    );
  };

  const retirementPoolRows = poolDefinitions.map((pool, index) => {
    const sourceLine =
      scenario.withdrawal.sourceLines?.find((line) => line.enabled && line.sourceType === 'pool' && line.sourceId === pool.id) ??
      {
        id: `withdrawal-pool-${index + 1}`,
        enabled: true,
        sourceType: 'pool' as const,
        sourceId: pool.id,
        mode: 'amount' as const,
        amount: 0,
        startAge: scenario.profile.retirementAge,
        syncWithRetirementAge: true
      };
    const plannedValue = isLegacyPoolKey(pool.id)
      ? Math.round(retirementFirstYearPlannedWithdrawals[pool.id])
      : Math.round(sourceLine.amount);

    return {
      pool,
      sourceLine,
      plannedValue
    };
  });

  const updateRetirementPoolLine = (
    poolId: string,
    changes: Partial<{ mode: 'amount' | 'four_percent'; amount: number; enabled: boolean; startAge: number; syncWithRetirementAge: boolean }>
  ) => {
    const nextLines = [...(scenario.withdrawal.sourceLines ?? [])];
    const existingIndex = nextLines.findIndex((line) => line.sourceType === 'pool' && line.sourceId === poolId);
    const fallbackLine = {
      id: `withdrawal-pool-${poolId}`,
      enabled: true,
      sourceType: 'pool' as const,
      sourceId: poolId,
      mode: 'amount' as const,
      amount: 0,
      startAge: scenario.profile.retirementAge,
      syncWithRetirementAge: true
    };
    const currentLine = existingIndex >= 0 ? nextLines[existingIndex] : fallbackLine;
    const nextLine = {
      ...currentLine,
      ...changes,
      startAge: Math.min(110, Math.max(18, toNumberOrFallback(changes.startAge ?? currentLine.startAge, scenario.profile.retirementAge)))
    };

    if (existingIndex >= 0) {
      nextLines[existingIndex] = nextLine;
    } else {
      nextLines.push(nextLine);
    }

    updateScenario({
      ...scenario,
      withdrawal: {
        ...scenario.withdrawal,
        sourceLines: nextLines,
        firstYearAmount: nextLines.reduce((sum, line) => sum + Math.max(0, line.amount), 0)
      }
    });
  };

  const renderRetirementTab = ({
    forCareerRetirementItem = false,
    showRetirementCalculator = true
  }: { forCareerRetirementItem?: boolean; showRetirementCalculator?: boolean } = {}) => (
    <>
      {showRetirementCalculator ? (
        <Panel title="Retirement Calculator">
          <label className="control-row">
            <span>Current Age</span>
            <div className="control-inputs">
              <input type="range" min={18} max={100} value={currentAge} disabled />
              <input type="number" value={currentAge} readOnly disabled />
            </div>
            <span className="subtle">Derived from the date of birth set in Options.</span>
          </label>
          <ControlRow
            label="Retirement Age"
            value={scenario.profile.retirementAge}
            min={currentAge}
            max={90}
            onChange={(value) =>
              updateScenario({
                ...scenario,
                profile: { ...scenario.profile, retirementAge: value }
              })
            }
          />
          <ControlRow
            label="Retirement Length (Years)"
            value={scenario.profile.retirementYears}
            min={1}
            max={60}
            onChange={(value) =>
              updateScenario({
                ...scenario,
                profile: { ...scenario.profile, retirementYears: value }
              })
            }
          />
          <label className="control-row">
            <span>Retirement Assets</span>
            <div className="control-inputs">
              <input type="range" min={0} max={5000000} step={5000} value={retirementAssetsFromCareers} disabled />
              <input type="number" value={Math.round(retirementAssetsFromCareers)} readOnly disabled />
            </div>
            <span className="subtle">Summed from projected end balances across all careers.</span>
          </label>
        </Panel>
      ) : null}

      {!forCareerRetirementItem ? (
        <Panel title="Contributions">
          <ControlRow
            label="Yearly Contribution"
            value={scenario.contribution.yearlyContribution}
            min={0}
            max={100000}
            step={500}
            onChange={(value) =>
              updateScenario({
                ...scenario,
                contribution: { ...scenario.contribution, yearlyContribution: value }
              })
            }
          />
          <ControlRow
            label="Yearly % Increase"
            value={scenario.contribution.yearlyIncreaseRate}
            min={0}
            max={15}
            step={0.1}
            onChange={(value) =>
              updateScenario({
                ...scenario,
                contribution: { ...scenario.contribution, yearlyIncreaseRate: value }
              })
            }
          />
        </Panel>
      ) : null}

      <Panel title="Retirement Spending" className="panel-wide">
        {(() => {
          const displayedFirstYearTotal = retirementPoolRows.reduce(
            (sum, row) => sum + (row.sourceLine.mode === 'four_percent' ? row.plannedValue : row.sourceLine.amount),
            0
          );

          return (
            <>
        <ControlRow
          label="First Year Expenses"
          value={displayedFirstYearTotal}
          min={0}
          max={1000000}
          step={500}
          disabled
          onChange={() => {}}
        />
        <ControlRow
          label="Minimum Yearly Withdrawal"
          value={scenario.withdrawal.minimumYearlyWithdrawal}
          min={0}
          max={1000000}
          step={500}
          onChange={(value) =>
            updateScenario({
              ...scenario,
              withdrawal: {
                ...scenario.withdrawal,
                minimumYearlyWithdrawal: value
              }
            })
          }
        />
        <ControlRow
          label="Maximum Yearly Withdrawal"
          value={scenario.withdrawal.maximumYearlyWithdrawal}
          min={0}
          max={1000000}
          step={500}
          onChange={(value) =>
            updateScenario({
              ...scenario,
              withdrawal: {
                ...scenario.withdrawal,
                maximumYearlyWithdrawal: value
              }
            })
          }
        />
          <div className="career-savings-grid">
            <div className="career-savings-row career-savings-header">
              <div className="career-savings-cell">Pool</div>
              <div className="career-savings-cell">Use Ret. Age</div>
              <div className="career-savings-cell">Start Age</div>
              <div className="career-savings-cell">Use 4% Rule</div>
              <div className="career-savings-cell">First Year Withdrawal</div>
              <div className="career-savings-cell">Post-Ret %</div>
              <div className="career-savings-cell">Tax %</div>
              <div className="career-savings-cell">Penalty %</div>
              <div className="career-savings-cell">HSA</div>
            </div>
          {retirementPoolRows.map(({ pool, sourceLine, plannedValue }) => (
            <div key={pool.id} className="career-savings-row">
              <div className="career-savings-cell">{pool.label}</div>
              <div className="career-savings-cell">
                <input
                  type="checkbox"
                  checked={sourceLine.syncWithRetirementAge !== false}
                  onChange={(event) => {
                    const nextSync = event.target.checked;
                    updateRetirementPoolLine(pool.id, {
                      syncWithRetirementAge: nextSync,
                      startAge: nextSync ? futureRetirementAge : (sourceLine.startAge ?? futureRetirementAge)
                    });
                  }}
                />
              </div>
              <div className="career-savings-cell">
                <BufferedNumberInput
                  value={sourceLine.startAge ?? scenario.profile.retirementAge}
                  min={18}
                  max={110}
                  step={1}
                  disabled={sourceLine.syncWithRetirementAge !== false}
                  onCommit={(next) => updateRetirementPoolLine(pool.id, { startAge: next })}
                />
              </div>
              <div className="career-savings-cell">
                <input
                  type="checkbox"
                  checked={sourceLine.mode === 'four_percent'}
                  onChange={(event) => updateRetirementPoolLine(pool.id, { mode: event.target.checked ? 'four_percent' : 'amount' })}
                />
              </div>
              <div className="career-savings-cell">
                <BufferedNumberInput
                  value={sourceLine.mode === 'four_percent' ? plannedValue : sourceLine.amount}
                  min={0}
                  max={1000000}
                  step={100}
                  disabled={sourceLine.mode === 'four_percent'}
                  onCommit={(next) => updateRetirementPoolLine(pool.id, { amount: next })}
                />
              </div>
              <div className="career-savings-cell">
                <BufferedNumberInput
                  value={pool.postRetirementReturnRate}
                  min={-20}
                  max={40}
                  step={0.1}
                  onCommit={(next) => updatePool(pool.id, { postRetirementReturnRate: next })}
                />
              </div>
              <div className="career-savings-cell">
                <BufferedNumberInput
                  value={pool.taxRate}
                  min={0}
                  max={60}
                  step={0.1}
                  onCommit={(next) => updatePool(pool.id, { taxRate: next })}
                />
              </div>
              <div className="career-savings-cell">
                <BufferedNumberInput
                  value={pool.penaltyRate}
                  min={0}
                  max={60}
                  step={0.1}
                  onCommit={(next) => updatePool(pool.id, { penaltyRate: next })}
                />
              </div>
              <div className="career-savings-cell">
                <input
                  type="checkbox"
                  checked={pool.isHSA === true}
                  onChange={(event) => updatePool(pool.id, { isHSA: event.target.checked })}
                />
              </div>
            </div>
          ))}
        </div>
            </>
          );
        })()}
      </Panel>

      <Panel title="Retirement Add-Ons" className="panel-wide">
        <div className="add-grid">
          {ADD_OPTIONS.map((option) => (
            <label key={option.category} className="checkbox-row">
              <input
                type="checkbox"
                checked={scenario.cashflowItems.some((item) => item.category === option.category)}
                onChange={(event) => toggleAddOption(option.category, event.target.checked)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <div className="cashflow-list">
          {scenario.cashflowItems.length === 0 ? (
            <p className="subtle">Enable any item above to add custom income or expense timing.</p>
          ) : (
            scenario.cashflowItems.map((item) => (
              <CashflowItemEditor
                key={item.id}
                item={item}
                retirementEndAge={retirementEndAge}
                dateOfBirth={scenario.options.dateOfBirth}
                currentAge={currentAge}
                accounts={bankAccounts.map((account) => ({ id: account.id, label: account.label }))}
                onChange={(nextItem) =>
                  updateScenario({
                    ...scenario,
                    cashflowItems: scenario.cashflowItems.map((currentItem) =>
                      currentItem.id === nextItem.id ? nextItem : currentItem
                    )
                  })
                }
                onRemove={(itemId) =>
                  updateScenario({
                    ...scenario,
                    cashflowItems: scenario.cashflowItems.filter((item) => item.id !== itemId)
                  })
                }
              />
            ))
          )}
        </div>
      </Panel>
    </>
  );

  const renderOptionsTab = () => (
    <>
      <Panel title="Age Options">
        <label className="full-span">
          <span>Date of Birth</span>
          <input
            type="date"
            value={scenario.options.dateOfBirth}
            onChange={(event) =>
              updateScenario({
                ...scenario,
                options: {
                  ...scenario.options,
                  dateOfBirth: event.target.value
                }
              })
            }
          />
        </label>
        <div className="career-summary">
          <p>
            Derived current age: <strong>{currentAge}</strong>
          </p>
          <p>Age uses completed years from the selected birth date.</p>
          <p>Birth date: <strong>{formatShortDate(scenario.options.dateOfBirth)}</strong></p>
        </div>
        <div className="career-actions">
          <button type="button" className="secondary-button" onClick={resetScenario}>
            Reset Scenario
          </button>
        </div>
      </Panel>
      <Panel title="Inflation">
        <p className="subtle" style={{ marginTop: 0, marginBottom: '0.55rem' }}>
          When enabled, cashflow items, life events, and retirement withdrawals grow with inflation each year.
        </p>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={inflationEnabled}
            onChange={(event) =>
              updateScenario({
                ...scenario,
                manualReturns: { ...scenario.manualReturns, inflationEnabled: event.target.checked }
              })
            }
          />
          <span>Enable inflation</span>
        </label>
        <label>
          <span>Inflation Rate %</span>
          <BufferedNumberInput
            value={scenario.manualReturns.inflationRate}
            min={-2}
            max={15}
            step={0.1}
            disabled={!inflationEnabled}
            onCommit={(next) =>
              updateScenario({
                ...scenario,
                manualReturns: { ...scenario.manualReturns, inflationRate: next }
              })
            }
          />
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={showRealDollars}
            onChange={(event) => setShowRealDollars(event.target.checked)}
          />
          <span>Display values in current dollars</span>
        </label>
      </Panel>
      <Panel title="Expense Planning Options">
        <label className="full-span">
          <span>Expense Week Start Day</span>
          <select
            value={scenario.expenses.ui.planningWeekStartDay}
            onChange={(event) =>
              updateScenario({
                ...scenario,
                expenses: {
                  ...scenario.expenses,
                  ui: {
                    ...scenario.expenses.ui,
                    planningWeekStartDay: Math.min(6, Math.max(0, Number(event.target.value) || 0))
                  }
                }
              })
            }
          >
            <option value={0}>Sunday</option>
            <option value={1}>Monday</option>
            <option value={2}>Tuesday</option>
            <option value={3}>Wednesday</option>
            <option value={4}>Thursday</option>
            <option value={5}>Friday</option>
            <option value={6}>Saturday</option>
          </select>
        </label>
      </Panel>
      <Panel title="Chart Colors">
        <p className="subtle" style={{ marginTop: 0, marginBottom: '0.55rem' }}>
          Customize the colors used in the stacked savings graph for each pool.
        </p>
        {(scenario.netWorth.pools ?? []).map((pool) => (
          <ColorPickerField
            key={pool.id}
            label={pool.label}
            value={pool.color || '#4b87d9'}
            onChange={(color) =>
              updateScenario({
                ...scenario,
                netWorth: {
                  ...scenario.netWorth,
                  pools: (scenario.netWorth.pools ?? []).map((p) =>
                    p.id === pool.id ? { ...p, color } : p
                  )
                }
              })
            }
          />
        ))}
      </Panel>
    </>
  );

  const renderWarningsTab = () => {
    const validation = futureProjection.incomeValidation;
    const allWarnings = futureProjection.warnings ?? [];
    const otherWarnings = allWarnings.filter((warning) => !warning.startsWith('Income validation:'));
    const hasIncomeWarnings = Boolean(validation?.hasOverspend);
    return (
      <Panel title="Warnings" className="panel-wide">
        <div className={`income-validation-banner${hasIncomeWarnings ? '' : ' success'}`}>
          <div className="income-validation-header">
            <strong>Income usage warnings</strong>
            <span>
              {hasIncomeWarnings
                ? `${validation!.groups.length} consolidated ${validation!.groups.length === 1 ? 'issue' : 'issues'} across ${validation!.periods.length} ${validation!.periods.length === 1 ? 'period' : 'periods'} where income-funded spending exceeds career take-home income.`
                : 'No periods where income-funded spending exceeds career take-home income.'}
            </span>
          </div>
          {hasIncomeWarnings ? (
            <div className="income-validation-list">
              {validation!.groups.map((group) => {
                const overageText = group.minOverage === group.maxOverage
                  ? formatCurrency(group.maxOverage)
                  : `${formatCurrency(group.minOverage)}–${formatCurrency(group.maxOverage)}`;
                return (
                  <div
                    key={`${group.pool}-${group.periodKeys[0]}`}
                    className={`income-validation-period${group.hasUnmet ? ' invalid' : ' warning'}`}
                  >
                    <div className="income-validation-period-head">
                      <strong>{describeIncomeValidationGroup(group)}</strong>
                      <span>
                        Budget {formatCurrency(group.budget)} · Requested {formatCurrency(group.totalRequested)}
                        {group.maxOverage > 0.01 ? ` · Over by ${overageText}` : ''}
                        {group.totalFromFallback > 0.01 ? ` · From fallback ${formatCurrency(group.totalFromFallback)}` : ''}
                        {group.totalShortfall > 0.01 ? ` · Unpaid ${formatCurrency(group.totalShortfall)}` : ''}
                      </span>
                    </div>
                    <ul className="income-validation-items">
                      {group.items.map((item, index) => (
                        <li key={`${item.id}-${index}`}>
                          <span>{item.label}</span>
                          <span>
                            {formatCurrency(item.requested)}
                            {item.fromFallback > 0.01 ? ` (fallback ${formatCurrency(item.fromFallback)})` : ''}
                            {item.shortfall > 0.01 ? ` (unpaid ${formatCurrency(item.shortfall)})` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
        {otherWarnings.length > 0 ? (
          <div className="income-validation-banner">
            <div className="income-validation-header">
              <strong>Other warnings</strong>
              <span>{otherWarnings.length === 1 ? '1 other warning.' : `${otherWarnings.length} other warnings.`}</span>
            </div>
            <ul className="income-validation-items">
              {otherWarnings.map((warning, index) => (
                <li key={index}>
                  <span>{warning}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>
    );
  };

  const renderTrajectoryTab = () => {
    const currentDisplayYears: Array<ProjectionYear | TrajectoryYear> =
      adjustedYears.length > 0 ? adjustedYears : futureProjection.years;
    const selectedDisplayYears = adjustedSelectedTrajectoryYears;
    const currentSummary = summarizeTrajectoryYears(currentDisplayYears);
    const selectedSummary = selectedTrajectorySnapshot ? summarizeTrajectoryYears(selectedDisplayYears) : null;
    const ageOptions = currentDisplayYears.map((year) => year.age);
    const chosenAge =
      trajectoryCompareAge !== null && ageOptions.includes(trajectoryCompareAge)
        ? trajectoryCompareAge
        : ageOptions[ageOptions.length - 1] ?? currentAge;
    const currentRow = currentDisplayYears.find((year) => year.age === chosenAge) ?? null;
    const selectedRow = selectedDisplayYears.find((year) => year.age === chosenAge) ?? null;

    const formatMetric = (value: number | null, format: 'currency' | 'age') => {
      if (value === null) {
        return format === 'age' ? 'Never' : '—';
      }
      return format === 'age' ? `Age ${value}` : formatCurrency(value);
    };
    const absDiff = (current: number | null, selected: number | null) =>
      current === null || selected === null ? '—' : formatCurrency(selected - current);
    const pctDiff = (current: number | null, selected: number | null) => {
      if (current === null || selected === null || current === 0) {
        return '—';
      }
      return `${(((selected - current) / Math.abs(current)) * 100).toFixed(1)}%`;
    };

    const metricRows: Array<{ label: string; current: number | null; selected: number | null; format: 'currency' | 'age' }> = [
      { label: 'Ending balance', current: currentSummary.endingBalance, selected: selectedSummary?.endingBalance ?? null, format: 'currency' },
      { label: 'Depletion age', current: currentSummary.depletionAge, selected: selectedSummary?.depletionAge ?? null, format: 'age' },
      { label: 'Total contributions', current: currentSummary.contributions, selected: selectedSummary?.contributions ?? null, format: 'currency' },
      { label: 'Total withdrawals', current: currentSummary.withdrawals, selected: selectedSummary?.withdrawals ?? null, format: 'currency' },
      { label: 'Total taxes paid', current: currentSummary.taxes, selected: selectedSummary?.taxes ?? null, format: 'currency' },
      { label: 'Total penalties paid', current: currentSummary.penalties, selected: selectedSummary?.penalties ?? null, format: 'currency' }
    ];

    return (
      <Panel title="Trajectory Comparison" className="panel-wide">
        <div className="career-actions">
          <button type="button" className="secondary-button" onClick={saveTrajectorySnapshot}>
            Save Current Trajectory
          </button>
          <span className="subtle">Freezes the current projection. Saved trajectories never change.</span>
        </div>

        {trajectorySnapshots.length === 0 ? (
          <p className="subtle">
            No saved trajectories yet. Click "Save Current Trajectory" to snapshot the current projection.
          </p>
        ) : (
          <div className="trajectory-list">
            <label className="trajectory-row trajectory-row-none">
              <span className="trajectory-compare-toggle">
                <input
                  type="radio"
                  name="trajectory-compare"
                  checked={!selectedTrajectorySnapshot}
                  onChange={() => setCompareTrajectoryId('')}
                />
                <span>No comparison</span>
              </span>
            </label>
            {trajectorySnapshots.map((snapshot) => (
              <div key={snapshot.id} className="trajectory-row">
                <label className="trajectory-compare-toggle">
                  <input
                    type="radio"
                    name="trajectory-compare"
                    checked={compareTrajectoryId === snapshot.id}
                    onChange={() => setCompareTrajectoryId(snapshot.id)}
                  />
                  <span>Compare</span>
                </label>
                <input
                  type="text"
                  className="trajectory-name-input"
                  aria-label={`${snapshot.label} name`}
                  value={snapshot.label}
                  onChange={(event) => renameTrajectorySnapshot(snapshot.id, event.target.value)}
                />
                <span className="subtle">Saved {formatShortDate(snapshot.createdAt)}</span>
                <button type="button" className="text-button danger-text" onClick={() => deleteTrajectorySnapshot(snapshot.id)}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {selectedTrajectorySnapshot ? (
          <>
            <div className="panel-divider" />
            <h3>Metrics vs {selectedTrajectorySnapshot.label}</h3>
            <div className="table-wrap">
              <table className="purchases-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    <th>Current</th>
                    <th>Selected</th>
                    <th>Δ</th>
                    <th>Δ %</th>
                  </tr>
                </thead>
                <tbody>
                  {metricRows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{formatMetric(row.current, row.format)}</td>
                      <td>{formatMetric(row.selected, row.format)}</td>
                      <td>{absDiff(row.current, row.selected)}</td>
                      <td>{pctDiff(row.current, row.selected)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td>Survives to end</td>
                    <td>{currentSummary.survives ? 'Yes' : 'No'}</td>
                    <td>{selectedSummary?.survives ? 'Yes' : 'No'}</td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <h3>Account balances at age {chosenAge}</h3>
            <label className="trajectory-age-select">
              <span>Compare age</span>
              <select value={chosenAge} onChange={(event) => setTrajectoryCompareAge(Number(event.target.value))}>
                {ageOptions.map((age) => (
                  <option key={age} value={age}>
                    {age}
                  </option>
                ))}
              </select>
            </label>
            <div className="table-wrap">
              <table className="purchases-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Current</th>
                    <th>Selected</th>
                    <th>Δ</th>
                    <th>Δ %</th>
                  </tr>
                </thead>
                <tbody>
                  {orderedBankAccounts.map((account) => {
                    const currentValue = currentRow?.accountBalancesById[account.id] ?? 0;
                    const selectedValue = selectedRow ? selectedRow.accountBalancesById[account.id] ?? 0 : null;
                    return (
                      <tr key={account.id}>
                        <td>{account.label}</td>
                        <td>{formatCurrency(currentValue)}</td>
                        <td>{selectedValue === null ? '—' : formatCurrency(selectedValue)}</td>
                        <td>{absDiff(currentValue, selectedValue)}</td>
                        <td>{pctDiff(currentValue, selectedValue)}</td>
                      </tr>
                    );
                  })}
                  <tr>
                    <td>Total</td>
                    <td>{formatCurrency(currentRow ? Object.values(currentRow.accountBalancesById).reduce((sum, value) => sum + value, 0) : 0)}</td>
                    <td>
                      {selectedRow
                        ? formatCurrency(Object.values(selectedRow.accountBalancesById).reduce((sum, value) => sum + value, 0))
                        : '—'}
                    </td>
                    <td>—</td>
                    <td>—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="subtle">Select a saved trajectory to compare metrics and account balances.</p>
        )}

        <div className="panel-divider" />
        <h3>Actual balance history</h3>
        {netWorthHistoryPoints.length === 0 ? (
          <p className="subtle">No saved balance snapshots yet. Use "Save Account Balance" on the Net Worth tab.</p>
        ) : (
          <div className="table-wrap">
            <table className="purchases-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Age</th>
                  <th>Total net worth</th>
                </tr>
              </thead>
              <tbody>
                {[...netWorthHistoryPoints]
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((point) => (
                    <tr key={`${point.date}-${point.age}`}>
                      <td>{formatShortDate(point.date)}</td>
                      <td>{point.age}</td>
                      <td>{formatCurrency(point.value)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    );
  };

  const renderCareersTab = () => (
    <>
      <Panel title="Career Timeline" className="panel-wide">
        <CareerPlanEditor
          value={activeCareerPlan}
          selectedCareerId={selectedCareerId}
          onSelectCareer={updateSelectedCareerId}
        onChangeCareer={updateCareer}
        onDuplicateCareer={duplicateCareer}
        onReorderCareers={reorderCareers}
        onAddCareer={addCareer}
        onRemoveCareer={removeCareer}
        previewYear={
          futureProjection.years.find((year) => !year.isBaselineNow && year.age === currentAge + 1) ??
          futureProjection.years.find((year) => !year.isBaselineNow) ??
          futureProjection.years[0]
        }
        bankAccounts={bankAccounts}
        pools={poolDefinitions}
        birthdayBasedCareerStartAge={birthdayBasedCareerStartAge}
        dateOfBirth={scenario.options.dateOfBirth}
        currentAge={currentAge}
        incomeFallbackAccountId={scenario.incomeFallbackAccountId}
        incomeFallbackAccountId2={scenario.incomeFallbackAccountId2}
        onChangeIncomeFallbackAccount1={(accountId) => updateScenario({ ...scenario, incomeFallbackAccountId: accountId })}
        onChangeIncomeFallbackAccount2={(accountId) => updateScenario({ ...scenario, incomeFallbackAccountId2: accountId })}
      />
      </Panel>
    </>
  );

  const formatIncomeFallbackTooltip = (
    incomeStatus: ProjectionResult['incomeFundedItemStatuses'][string] | undefined,
    incomeUsageByMonth: ProjectionResult['incomeUsageByMonth'],
    fallbackDetails: { accountId: string; amount: number }[] | undefined,
    bankAccts: BankAccountDefinition[]
  ) => {
    if (!incomeStatus || incomeStatus.status !== 'fallback') return null;
    const parts: string[] = [];
    const monthKey = incomeStatus.firstFallbackYearMonth;
    if (monthKey) {
      parts.push(`Starting ${monthKey}:`);
      const usage = incomeUsageByMonth[monthKey];
      if (usage) {
        parts.push(`Monthly income: ${formatCurrency(usage.availableIncome)}`);
        let totalUsed = 0;
        usage.items.forEach((item) => {
          parts.push(`  ${item.label}: ${formatCurrency(item.amount)}`);
          totalUsed += item.amount;
        });
        parts.push(`  Total used: ${formatCurrency(totalUsed)}`);
        parts.push(`  Remaining: ${formatCurrency(Math.max(0, usage.availableIncome - totalUsed))}`);
      }
    }
    if (fallbackDetails?.length) {
      const detailStrs = fallbackDetails.map((d) => {
        const acct = bankAccts.find((a) => a.id === d.accountId);
        return `${acct?.label ?? d.accountId} (${formatCurrency(d.amount)})`;
      });
      parts.push(`Using fallback: ${detailStrs.join(', ')}`);
    }
    return parts.join('\n');
  };

  const formatPurchaseTooltip = (
    purchase: Scenario['largePurchases'][number],
    incomeStatus: ProjectionResult['incomeFundedItemStatuses'][string] | undefined,
    incomeUsageByMonth: ProjectionResult['incomeUsageByMonth'],
    bankAccounts: BankAccountDefinition[]
  ) => {
    const parts: string[] = [];
    const fbTotal = (incomeStatus?.fallbackDetails ?? []).reduce((s, d) => s + d.amount, 0);
    const shortfallAmt = incomeStatus?.shortfallAmount ?? 0;
    const incomeUsed = Math.max(0, purchase.amount - fbTotal - shortfallAmt);

    parts.push(`Amount: ${formatCurrency(purchase.amount)}`);

    if (purchase.fundingSource === 'income') {
      if (incomeUsed > 0) parts.push(`  From income: ${formatCurrency(incomeUsed)}`);
      if (fbTotal > 0) {
        parts.push('  From fallback:');
        (incomeStatus!.fallbackDetails ?? []).forEach((d) => {
          const acct = bankAccounts.find((a) => a.id === d.accountId);
          parts.push(`    ${acct?.label ?? d.accountId}: ${formatCurrency(d.amount)}`);
        });
      }
      if (shortfallAmt > 0) parts.push(`  Unpaid: ${formatCurrency(shortfallAmt)}`);
    } else {
      const acct = bankAccounts.find((a) => a.id === (purchase.fundingSource ?? '').replace('account:', ''));
      parts.push(`  From: ${acct?.label ?? purchase.fundingSource ?? 'Unknown'}`);
    }

    const monthKey = purchase.yearMonth;
    if (monthKey) {
      const usage = incomeUsageByMonth[monthKey];
      if (usage && usage.items.length > 0) {
        parts.push(`Monthly income: ${formatCurrency(usage.availableIncome)}`);
        usage.items.forEach((item) => {
          const isThis = item.id === purchase.id;
          parts.push(`  ${isThis ? '\u2192 ' : '  '}${item.label}: ${formatCurrency(item.amount)}`);
        });
        const total = usage.items.reduce((s, i) => s + i.amount, 0);
        parts.push(`  Total: ${formatCurrency(total)}`);
      }
    }

    return parts.join('\n');
  };

  const togglePurchaseSort = (column: 'yearMonth' | 'amount' | 'fundingSource') => {
    setPurchaseSort((prev) => {
      if (prev.column === column) {
        if (prev.direction === 'asc') return { column, direction: 'desc' };
        return { column: null, direction: 'asc' };
      }
      return { column, direction: 'asc' };
    });
  };

  const sortedLargePurchases = useMemo(() => {
    let items = activeLargePurchases;
    if (purchaseCategoryFilter.size > 0) {
      items = items.filter((p) => purchaseCategoryFilter.has(p.categoryId ?? null));
    }
    if (!purchaseSort.column) return items;
    const { column, direction } = purchaseSort;
    const fundingLabel = (fs: string | undefined) => {
      if (!fs || fs === 'income') return 'Income';
      const accountId = fs.startsWith('account:') ? fs.split(':', 2)[1] : null;
      const account = accountId ? bankAccounts.find((a) => a.id === accountId) : null;
      return account ? account.label : fs;
    };
    return [...items].sort((a, b) => {
      let cmp = 0;
      if (column === 'yearMonth') {
        cmp = a.yearMonth.localeCompare(b.yearMonth);
      } else if (column === 'amount') {
        cmp = a.amount - b.amount;
      } else if (column === 'fundingSource') {
        cmp = fundingLabel(a.fundingSource).localeCompare(fundingLabel(b.fundingSource));
      }
      return direction === 'desc' ? -cmp : cmp;
    });
  }, [activeLargePurchases, purchaseSort, purchaseCategoryFilter, bankAccounts]);

  const renderPurchasesTab = () => (
    <>
      <Panel title="Large Purchases Table" className="panel-wide">
        <div className="career-actions">
          <button type="button" className="secondary-button" onClick={addLargePurchase}>
            + Purchase
          </button>
          <button type="button" className="secondary-button" onClick={() => setShowPurchaseCategoryManager(true)}>
            Categories
          </button>
        </div>
        {scenario.purchaseCategories.length > 0 && (
          <div className="purchase-category-chips">
            <span className="chip-group-label">Categories:</span>
            <button
              type="button"
              className={`purchase-category-chip${purchaseCategoryFilter.has(null) ? ' active' : ''}`}
              onClick={() => setPurchaseCategoryFilter((prev) => {
                const next = new Set(prev);
                if (next.has(null)) next.delete(null); else next.add(null);
                return next;
              })}
            >
              Uncategorized
            </button>
            {scenario.purchaseCategories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                className={`purchase-category-chip${purchaseCategoryFilter.has(cat.id) ? ' active' : ''}`}
                onClick={() => setPurchaseCategoryFilter((prev) => {
                  const next = new Set(prev);
                  if (next.has(cat.id)) next.delete(cat.id); else next.add(cat.id);
                  return next;
                })}
              >
                {cat.label}
              </button>
            ))}
            {purchaseCategoryFilter.size > 0 && (
              <button
                type="button"
                className="purchase-category-chip clear"
                onClick={() => setPurchaseCategoryFilter(new Set())}
              >
                Clear
              </button>
            )}
          </div>
        )}
        {activeLargePurchases.length === 0 ? (
          <p className="subtle">Add a purchase with year-month, value, and source amounts per account.</p>
        ) : (
          <div className="table-wrap">
            <table className="purchases-table">
              <thead>
                <tr>
                  <th title="Enabled">Enabled</th>
                  <th title="Show flag on graph">Flag</th>
                  <th>Name</th>
                  <th>Category</th>
                  <th title="Year-Month" className="sortable-th" onClick={() => togglePurchaseSort('yearMonth')}>
                    <span>Year-Month</span>
                    <span className="sort-arrows" aria-hidden="true">
                      <span className={purchaseSort.column === 'yearMonth' && purchaseSort.direction === 'asc' ? 'active' : ''}>▲</span>
                      <span className={purchaseSort.column === 'yearMonth' && purchaseSort.direction === 'desc' ? 'active' : ''}>▼</span>
                    </span>
                  </th>
                  <th title="Amount" className="sortable-th" onClick={() => togglePurchaseSort('amount')}>
                    <span>Amount</span>
                    <span className="sort-arrows" aria-hidden="true">
                      <span className={purchaseSort.column === 'amount' && purchaseSort.direction === 'asc' ? 'active' : ''}>▲</span>
                      <span className={purchaseSort.column === 'amount' && purchaseSort.direction === 'desc' ? 'active' : ''}>▼</span>
                    </span>
                  </th>
                  <th title="Pay From" className="sortable-th" onClick={() => togglePurchaseSort('fundingSource')}>
                    <span>Pay From</span>
                    <span className="sort-arrows" aria-hidden="true">
                      <span className={purchaseSort.column === 'fundingSource' && purchaseSort.direction === 'asc' ? 'active' : ''}>▲</span>
                      <span className={purchaseSort.column === 'fundingSource' && purchaseSort.direction === 'desc' ? 'active' : ''}>▼</span>
                    </span>
                  </th>
                  <th title="Account Balance After Purchase">Account Balance After Purchase</th>
                  <th title="Remove">Remove</th>
                </tr>
              </thead>
              <tbody>
                {sortedLargePurchases.map((purchase) => {
                  const fundingSourceValue = purchase.fundingSource ?? 'income';
                  const selectedAccountId = fundingSourceValue.startsWith('account:')
                    ? fundingSourceValue.split(':', 2)[1] ?? null
                    : null;
                  const postPurchaseBalances = projection.purchasePostPurchaseDisplayBalances[purchase.id];
                  const selectedAccountPostPurchaseBalance =
                    selectedAccountId && postPurchaseBalances ? postPurchaseBalances[selectedAccountId] : null;
                  const purchaseNotViable =
                    purchase.enabled &&
                    selectedAccountId !== null &&
                    Number.isFinite(selectedAccountPostPurchaseBalance) &&
                    (selectedAccountPostPurchaseBalance as number) < 0;
                  const incomeStatus = projection.incomeFundedItemStatuses[purchase.id];
                  const incomeShortfall = incomeStatus?.status === 'shortfall';
                  const incomeFallback = incomeStatus?.status === 'fallback';
                  const purchaseTooltip = formatPurchaseTooltip(purchase, incomeStatus, projection.incomeUsageByMonth, bankAccounts);
                  const nonViableTitle = purchaseNotViable
                    ? `Not viable: selected pay-from account balance goes negative after this purchase.\n\n${purchaseTooltip}`
                    : purchaseTooltip;
                  const rowClass =
                    purchaseNotViable || incomeShortfall
                      ? 'purchase-row invalid'
                      : incomeFallback
                        ? 'purchase-row warning'
                        : 'purchase-row';
                  const accountBalanceAfterPurchase = (() => {
                    if (fundingSourceValue === 'income') {
                      const monthKey = purchase.yearMonth;
                      const usage = monthKey ? projection.incomeUsageByMonth[monthKey] : undefined;
                      if (usage) {
                        const consumed = usage.items.reduce((sum, item) => sum + item.amount, 0);
                        return formatCurrency(Math.max(0, usage.availableIncome - consumed));
                      }
                      return formatCurrency(0);
                    }

                    const [, accountId] = fundingSourceValue.split(':', 2);
                    if (!accountId || !postPurchaseBalances) {
                      return 'N/A';
                    }

                    const postPurchaseBalance = postPurchaseBalances[accountId];
                    if (!Number.isFinite(postPurchaseBalance)) {
                      return 'N/A';
                    }

                    return formatCurrency(postPurchaseBalance);
                  })();

                  return (
                    <tr
                      key={purchase.id}
                      className={rowClass}
                      title={nonViableTitle}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={purchase.enabled}
                          onChange={(event) => updateLargePurchase(purchase.id, { ...purchase, enabled: event.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={purchase.showOnGraph}
                          onChange={(event) => updateLargePurchase(purchase.id, { ...purchase, showOnGraph: event.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={purchase.label}
                          onChange={(event) => updateLargePurchase(purchase.id, { ...purchase, label: event.target.value })}
                        />
                      </td>
                      <td>
                        <select
                          aria-label="Purchase Category"
                          value={purchase.categoryId ?? ''}
                          onChange={(event) => updateLargePurchase(purchase.id, { ...purchase, categoryId: event.target.value || null })}
                        >
                          <option value="">-</option>
                          {scenario.purchaseCategories.map((cat) => (
                            <option key={cat.id} value={cat.id}>{cat.label}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <YearMonthInput
                          label="Purchase"
                          value={purchase.yearMonth}
                          onChange={(nextYearMonth) => {
                            const derivedAge = ageFromYearMonth(nextYearMonth, scenario.options.dateOfBirth, currentAge, currentAge, futureEndAge);

                            if (derivedAge === null) {
                              return;
                            }

                            updateLargePurchase(purchase.id, {
                              ...purchase,
                              yearMonth: nextYearMonth,
                              age: derivedAge
                            });
                          }}
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={purchase.amount}
                          min={0}
                          max={50000000}
                          step={100}
                          commitOnChange
                          onCommit={(next) => {
                            const updated = applyPurchaseFundingSource(purchase, fundingSourceValue, next);
                            updateLargePurchase(purchase.id, updated);
                          }}
                        />
                      </td>
                      <td>
                        <select
                          aria-label="Purchase Funding Source"
                          value={fundingSourceValue}
                          onChange={(event) => {
                            const updated = applyPurchaseFundingSource(purchase, event.target.value, purchase.amount);
                            updateLargePurchase(purchase.id, updated);
                          }}
                        >
                          <option value="income">Income</option>
                          {accountSelectionOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{accountBalanceAfterPurchase}</td>
                      <td>
                        <button type="button" className="text-button" onClick={() => removeLargePurchase(purchase.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="subtle purchases-legend">Account Balance After Purchase reflects the selected Pay From account after purchase is applied.</p>
      </Panel>

      <Panel title="Long-Term Purchases (Monthly)" className="panel-wide">
        <div className="career-actions">
          <button type="button" className="secondary-button" onClick={addLongTermPurchase}>
            + Long-Term Purchase
          </button>
        </div>
        {activeLongTermPurchases.length === 0 ? (
          <p className="subtle">Add long-term purchases with monthly spending from selected accounts.</p>
        ) : (
          <div className="table-wrap">
            <table className="purchases-table">
              <thead>
                <tr>
                  <th>Enabled</th>
                  <th>Flag</th>
                  <th>Name</th>
                  <th>Start</th>
                  <th>Duration (Months)</th>
                  <th>End Date</th>
                  <th>Monthly Amount</th>
                  <th>Pay From</th>
                  <th>Account Balance</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {activeLongTermPurchases.map((purchase) => {
                  const fundingShortfall = futureProjection.longTermPurchaseFundingShortfalls[purchase.id] ?? 0;
                  const hasFundingShortfall = fundingShortfall > 0.01;
                  const incomeStatus = futureProjection.incomeFundedItemStatuses[purchase.id];
                  const incomeShortfall = incomeStatus?.status === 'shortfall';
                  const incomeFallback = incomeStatus?.status === 'fallback';
                  const purchaseNotViable = purchase.enabled && (hasFundingShortfall || incomeShortfall);
                  const ltFallbackTooltip = formatIncomeFallbackTooltip(incomeStatus, futureProjection.incomeUsageByMonth, incomeStatus?.fallbackDetails, bankAccounts);
                  const title = purchaseNotViable
                    ? incomeShortfall
                      ? 'Not enough income or fallback accounts to cover this purchase.'
                      : 'Not viable: one or more selected accounts cannot sustain this monthly purchase plan.'
                    : ltFallbackTooltip ?? undefined;
                  const rowClass =
                    (purchaseNotViable && (hasFundingShortfall || incomeShortfall))
                      ? 'purchase-row invalid'
                      : incomeFallback
                        ? 'purchase-row warning'
                        : 'purchase-row';
                  const fundingSourceValue = purchase.fundingSource ?? 'income';

                  return (
                    <tr key={purchase.id} className={rowClass} title={title}>
                      <td>
                        <input
                          type="checkbox"
                          checked={purchase.enabled}
                          onChange={(event) =>
                            updateLongTermPurchase(purchase.id, { ...purchase, enabled: event.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={purchase.showOnGraph}
                          onChange={(event) =>
                            updateLongTermPurchase(purchase.id, { ...purchase, showOnGraph: event.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={purchase.label}
                          onChange={(event) =>
                            updateLongTermPurchase(purchase.id, { ...purchase, label: event.target.value })
                          }
                        />
                      </td>
                      <td>
                        <YearMonthInput
                          label="Long-Term Start"
                          value={purchase.startYearMonth}
                          onChange={(nextYearMonth) => {
                            const nextEndYearMonth =
                              purchase.endMode === 'duration'
                                ? deriveEndYearMonthFromDuration(nextYearMonth, purchase.durationMonths)
                                : purchase.endYearMonth;
                            const nextDurationMonths =
                              purchase.endMode === 'endDate'
                                ? deriveDurationFromStartAndEnd(nextYearMonth, purchase.endYearMonth)
                                : purchase.durationMonths;

                            updateLongTermPurchase(purchase.id, {
                              ...purchase,
                              startYearMonth: nextYearMonth,
                              endYearMonth: nextEndYearMonth,
                              durationMonths: nextDurationMonths
                            });
                          }}
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={purchase.durationMonths}
                          min={1}
                          max={600}
                          step={1}
                          onCommit={(next) =>
                            updateLongTermPurchase(purchase.id, {
                              ...purchase,
                              endMode: 'duration',
                              durationMonths: Math.max(1, Math.floor(next)),
                              endYearMonth: deriveEndYearMonthFromDuration(purchase.startYearMonth, Math.max(1, Math.floor(next)))
                            })
                          }
                        />
                      </td>
                      <td>
                        <YearMonthInput
                          label="Long-Term End"
                          value={purchase.endYearMonth}
                          onChange={(nextYearMonth) =>
                            updateLongTermPurchase(purchase.id, {
                              ...purchase,
                              endMode: 'endDate',
                              endYearMonth: nextYearMonth,
                              durationMonths: deriveDurationFromStartAndEnd(purchase.startYearMonth, nextYearMonth)
                            })
                          }
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={purchase.monthlyAmount}
                          min={0}
                          max={1000000}
                          step={10}
                          onCommit={(next) => {
                            const updated = applyPurchaseFundingSource(purchase, fundingSourceValue, next);
                            updateLongTermPurchase(purchase.id, updated);
                          }}
                        />
                      </td>
                      <td>
                        <select
                          aria-label="Long-Term Funding Source"
                          value={fundingSourceValue}
                          onChange={(event) => {
                            const updated = applyPurchaseFundingSource(purchase, event.target.value, purchase.monthlyAmount);
                            updateLongTermPurchase(purchase.id, updated);
                          }}
                        >
                          <option value="income">Income</option>
                          {accountSelectionOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                          </select>
                      </td>
                      <td>
                        {fundingSourceValue === 'income' ? '--' : (() => {
                          const [, accountId] = fundingSourceValue.split(':', 2);
                          if (!accountId) return 'N/A';
                          const endYearMonth = purchase.endMode === 'endDate'
                            ? purchase.endYearMonth
                            : deriveEndYearMonthFromDuration(purchase.startYearMonth, purchase.durationMonths);
                          const endAge = ageFromYearMonth(endYearMonth, scenario.options.dateOfBirth, currentAge, currentAge, 110);
                          if (endAge === null) return 'N/A';
                          const years = projection.years;
                          let targetYear = years[0];
                          let closestDist = Infinity;
                          for (const year of years) {
                            const dist = Math.abs(year.age - endAge);
                            if (dist < closestDist) {
                              closestDist = dist;
                              targetYear = year;
                            }
                          }
                          if (!targetYear) return 'N/A';
                          const balance = targetYear.accountBalancesById[accountId];
                          return Number.isFinite(balance) ? formatCurrency(balance) : 'N/A';
                        })()}
                      </td>
                      <td>
                        <button type="button" className="text-button" onClick={() => removeLongTermPurchase(purchase.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="subtle purchases-legend">
          End can be defined by duration or explicit end date.
        </p>
      </Panel>

      <Panel title="Loans Table" className="panel-wide">
        <div className="career-actions">
          <button type="button" className="secondary-button" onClick={addLoan}>
            + Loan
          </button>
        </div>
        {activeLoans.length === 0 ? (
          <p className="subtle">Add loans to track balances, rates, payments, and payment source accounts.</p>
        ) : (
          <div className="table-wrap">
            <table className="purchases-table">
              <thead>
                <tr>
                  <th>Enabled</th>
                  <th>Flag</th>
                  <th>Name</th>
                  <th>Start</th>
                  <th>Original Amount</th>
                  <th>Down Payment</th>
                  <th>Down Pay From</th>
                  <th>Current Balance</th>
                  <th>APR %</th>
                  <th>Minimum Payment</th>
                  <th>Extra Payment</th>
                  <th>Total Monthly</th>
                  <th>Pay From</th>
                  <th>Est. Payoff</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {activeLoans.map((loan) => {
                  const totalMonthlyPayment = loan.minimumMonthlyPayment + loan.extraMonthlyPayment;
                  const payoffMonths = estimateLoanPayoffMonths(loan.currentBalance, loan.annualInterestRate, totalMonthlyPayment);
                  const fundingShortfall = futureProjection.loanFundingShortfalls[loan.id] ?? 0;
                  const incomeStatus = futureProjection.incomeFundedItemStatuses[loan.id];
                  const incomeShortfall = incomeStatus?.status === 'shortfall';
                  const incomeFallback = incomeStatus?.status === 'fallback';
                  const loanNotViable = loan.enabled && (fundingShortfall > 0.01 || incomeShortfall);
                  const loanFallbackTooltip = formatIncomeFallbackTooltip(incomeStatus, futureProjection.incomeUsageByMonth, incomeStatus?.fallbackDetails, bankAccounts);
                  const title = loanNotViable
                    ? incomeShortfall
                      ? 'Not enough income or fallback accounts to cover this loan payment.'
                      : 'Not viable: selected payment source account cannot fund this loan without running empty.'
                    : loanFallbackTooltip ?? undefined;
                  const loanRowClass =
                    (loanNotViable && (fundingShortfall > 0.01 || incomeShortfall))
                      ? 'purchase-row invalid'
                      : incomeFallback
                        ? 'purchase-row warning'
                        : 'purchase-row';

                  return (
                    <tr key={loan.id} className={loanRowClass} title={title}>
                      <td>
                        <input
                          type="checkbox"
                          checked={loan.enabled}
                          onChange={(event) => updateLoan(loan.id, { ...loan, enabled: event.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={loan.showOnGraph}
                          onChange={(event) => updateLoan(loan.id, { ...loan, showOnGraph: event.target.checked })}
                        />
                      </td>
                      <td>
                        <input
                          type="text"
                          value={loan.label}
                          onChange={(event) => updateLoan(loan.id, { ...loan, label: event.target.value })}
                        />
                      </td>
                      <td>
                        <YearMonthInput
                          label="Loan Start"
                          value={loan.startYearMonth}
                          onChange={(nextYearMonth) => updateLoan(loan.id, { ...loan, startYearMonth: nextYearMonth })}
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={loan.originalAmount}
                          min={0}
                          max={50000000}
                          step={100}
                          onCommit={(next) => updateLoan(loan.id, { ...loan, originalAmount: next })}
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={loan.downPayment}
                          min={0}
                          max={50000000}
                          step={100}
                          onCommit={(next) => updateLoan(loan.id, { ...loan, downPayment: next })}
                        />
                      </td>
                      <td>
                        {(() => {
                          const dpSourceValue = loan.downPaymentSource ?? loan.paymentSource ?? 'income';
                          return (
                        <select
                          aria-label="Loan Down Payment Source"
                          value={dpSourceValue}
                          onChange={(event) =>
                            updateLoan(loan.id, {
                              ...loan,
                              downPaymentSource:
                                event.target.value === 'income'
                                  ? 'income'
                                  : (event.target.value as `account:${string}`)
                            })
                          }
                        >
                          <option value="income">Income</option>
                          {accountSelectionOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                          );
                        })()}
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={loan.currentBalance}
                          min={0}
                          max={50000000}
                          step={100}
                          onCommit={(next) => updateLoan(loan.id, { ...loan, currentBalance: next })}
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={loan.annualInterestRate}
                          min={-5}
                          max={80}
                          step={0.1}
                          onCommit={(next) => updateLoan(loan.id, { ...loan, annualInterestRate: next })}
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={loan.minimumMonthlyPayment}
                          min={0}
                          max={500000}
                          step={10}
                          onCommit={(next) => updateLoan(loan.id, { ...loan, minimumMonthlyPayment: next })}
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={loan.extraMonthlyPayment}
                          min={0}
                          max={500000}
                          step={10}
                          onCommit={(next) => updateLoan(loan.id, { ...loan, extraMonthlyPayment: next })}
                        />
                      </td>
                      <td>{formatCurrency(totalMonthlyPayment)}</td>
                      <td>
                        {(() => {
                          const paymentSourceValue =
                            typeof loan.paymentSource === 'string'
                              ? loan.paymentSource
                              : loan.paymentSourceAccount === 'income'
                                ? 'income'
                                : `pool:${loan.paymentSourceAccount}`;

                          return (
                        <select
                          aria-label="Loan Payment Source"
                          value={paymentSourceValue}
                          onChange={(event) =>
                            updateLoan(loan.id, {
                              ...loan,
                              paymentSource:
                                event.target.value === 'income'
                                  ? 'income'
                                  : (event.target.value as `account:${string}`),
                              paymentSourceAccount:
                                event.target.value === 'income'
                                  ? 'income'
                                  : 'investments'
                            })
                          }
                        >
                          <option value="income">Income</option>
                          {accountSelectionOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                          );
                        })()}
                      </td>
                      <td>{formatLoanPayoffEstimate(payoffMonths)}</td>
                      <td>
                        <button type="button" className="text-button" onClick={() => removeLoan(loan.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="subtle purchases-legend">
          Estimated payoff assumes fixed monthly payments and APR with no new borrowing.
        </p>
      </Panel>

      {showAddPurchaseModal && (
        <div className="expense-modal-backdrop" onClick={() => setShowAddPurchaseModal(false)}>
          <div className="expense-modal" onClick={(e) => e.stopPropagation()}>
            <div className="expense-modal-header">
              <strong>Choose Purchase Category</strong>
              <button type="button" className="text-button" onClick={() => setShowAddPurchaseModal(false)}>Cancel</button>
            </div>
            <div className="purchase-category-list">
              <button
                type="button"
                className="purchase-category-option"
                onClick={() => confirmAddPurchase(null)}
              >
                Uncategorized
              </button>
              {scenario.purchaseCategories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className="purchase-category-option"
                  onClick={() => confirmAddPurchase(cat.id)}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            {scenario.purchaseCategories.length === 0 && (
              <p className="subtle" style={{ textAlign: 'center', padding: '0.25rem 0' }}>
                No categories defined. Use the Categories button to add one, or select Uncategorized.
              </p>
            )}
          </div>
        </div>
      )}
      {showPurchaseCategoryManager && (
        <div className="expense-modal-backdrop" onClick={() => setShowPurchaseCategoryManager(false)}>
          <div className="expense-modal" onClick={(e) => e.stopPropagation()}>
            <div className="expense-modal-header">
              <strong>Manage Purchase Categories</strong>
              <button type="button" className="text-button" onClick={() => setShowPurchaseCategoryManager(false)}>Close</button>
            </div>
            <div className="purchase-category-list">
              {scenario.purchaseCategories.length === 0 && (
                <p className="subtle">No categories defined yet.</p>
              )}
              {scenario.purchaseCategories.map((cat) => (
                <div key={cat.id} className="purchase-category-row">
                  <input
                    type="text"
                    value={cat.label}
                    onChange={(event) => renamePurchaseCategory(cat.id, event.target.value)}
                  />
                  <button type="button" className="text-button danger-text" onClick={() => removePurchaseCategory(cat.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className="purchase-category-add">
              <input
                type="text"
                value={newPurchaseCategoryLabel}
                onChange={(event) => setNewPurchaseCategoryLabel(event.target.value)}
                placeholder="New category name"
                onKeyDown={(event) => { if (event.key === 'Enter') addPurchaseCategory(); }}
              />
              <button type="button" className="secondary-button" onClick={addPurchaseCategory}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  const renderFutureRetirementPanel = () => (
    <>
      <Panel title="Future Retirement" className="panel-wide">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={scenario.futureRetirement.useCareerEndAge}
            onChange={(event) =>
              updateScenario({
                ...scenario,
                futureRetirement: {
                  ...scenario.futureRetirement,
                  useCareerEndAge: event.target.checked
                }
              })
            }
          />
          <span>Base retirement age on the careers timeline</span>
        </label>
        <ControlRow
          label="Retirement Age"
          value={scenario.futureRetirement.useCareerEndAge ? futureCareerAge : scenario.futureRetirement.retirementAge}
          min={currentAge}
          max={100}
          disabled={scenario.futureRetirement.useCareerEndAge}
          onChange={(value) =>
            updateScenario({
              ...scenario,
              futureRetirement: {
                ...scenario.futureRetirement,
                retirementAge: value
              }
            })
          }
        />
        <ControlRow
          label="Retirement Years"
          value={scenario.futureRetirement.retirementYears}
          min={1}
          max={60}
          onChange={(value) =>
            updateScenario({
              ...scenario,
              futureRetirement: {
                ...scenario.futureRetirement,
                retirementYears: value
              }
            })
          }
        />
        <ControlRow
          label="Minimum Yearly Withdrawal"
          value={scenario.withdrawal.minimumYearlyWithdrawal}
          min={0}
          max={1000000}
          step={500}
          onChange={(value) =>
            updateScenario({
              ...scenario,
              withdrawal: {
                ...scenario.withdrawal,
                minimumYearlyWithdrawal: value
              }
            })
          }
        />
        <ControlRow
          label="Maximum Yearly Withdrawal"
          value={scenario.withdrawal.maximumYearlyWithdrawal}
          min={0}
          max={1000000}
          step={500}
          title="This value is adjusted for inflation each year"
          onChange={(value) =>
            updateScenario({
              ...scenario,
              withdrawal: {
                ...scenario.withdrawal,
                maximumYearlyWithdrawal: value
              }
            })
          }
        />
        <div className="career-summary">
          <p>
            Current age from Options: <strong>{currentAge}</strong>
          </p>
          <p>
            Career-derived retirement age: <strong>{futureCareerAge}</strong>
          </p>
          <p>
            Retirement horizon: <strong>{futureEndAge}</strong>
          </p>
          <p>
            Retirement assets: <strong>{formatCurrency(retirementAssetsFromCareers)}</strong>
          </p>
        </div>
      </Panel>
    </>
  );

  const renderHousingTab = () => (
    <Panel title="Housing Expenses" className="panel-wide">
      <HousingEditor
        housing={activeHousing}
        selectedHousingId={selectedHousingId}
        onSelectHousing={setSelectedHousingId}
        onChangeHousing={(housingEntry) => updateHousing(housingEntry.id, housingEntry)}
        onReorderHousing={reorderHousing}
        onAddHousing={addHousing}
        onDuplicateHousing={duplicateHousing}
        onRemoveHousing={removeHousing}
        accountOptions={accountSelectionOptions}
        orderedBankAccounts={orderedBankAccounts}
        careerOptions={activeCareerPlan.entries.map((career) => ({ id: career.id, label: career.label }))}
      />
    </Panel>
  );

  const renderTimelineManagementTab = () => {
    const waterfall = futureProjection.monthlyWaterfall ?? [];
    const waterfallFirstSerial = waterfall.length > 0 ? waterfall[0].calendarYear * 12 + waterfall[0].calendarMonth - 1 : 0;
    const displayedWaterfall = showRealDollars && deflationRate !== 0
      ? waterfall.map((month) => {
          const serial = month.calendarYear * 12 + month.calendarMonth - 1;
          const factor = Math.pow(1 + deflationRate, Math.max(0, serial - waterfallFirstSerial) / 12);
          const deflate = (value: number) => value / factor;
          return {
            ...month,
            takeHomeIncome: deflate(month.takeHomeIncome),
            careerSavingsDeposits: deflate(month.careerSavingsDeposits),
            careerWithdrawals: deflate(month.careerWithdrawals),
            housingCosts: deflate(month.housingCosts),
            housingIncomeCosts: deflate(month.housingIncomeCosts),
            otherIncomeExpenses: deflate(month.otherIncomeExpenses),
            leftoverIncome: deflate(month.leftoverIncome)
          };
        })
      : waterfall;
    const availableYears = Array.from(new Set(displayedWaterfall.map((month) => month.calendarYear))).sort((a, b) => a - b);
    const firstYear = availableYears[0] ?? new Date().getFullYear();
    const lastYear = availableYears[availableYears.length - 1] ?? firstYear;
    const startYear = timelineStartYear ?? firstYear;
    const endYear = timelineEndYear ?? lastYear;
    const visibleWaterfall = displayedWaterfall.filter((month) => month.calendarYear >= startYear && month.calendarYear <= endYear);
    const timelineItems = [
      ...activeCareerPlan.entries.filter((entry) => entry.enabled).map((entry) => ({
        id: entry.id,
        kind: 'career' as const,
        label: entry.label,
        start: entry.startYearMonth || formatYearMonthFromAge(entry.startAge, scenario.options.dateOfBirth, currentAge),
        end: entry.endYearMonth || formatYearMonthFromAge(entry.endAge, scenario.options.dateOfBirth, currentAge),
        color: '#2b5fe2'
      })),
      ...activeHousing.filter((entry) => entry.enabled).map((entry) => ({
        id: entry.id,
        kind: 'housing' as const,
        label: entry.label,
        start: entry.startYearMonth,
        end: entry.housingType === 'mortgage' ? entry.sellYearMonth : entry.endYearMonth,
        color: '#18a58b'
      }))
    ].sort((a, b) => (parseYearMonthSerial(a.start) ?? Number.MAX_SAFE_INTEGER) - (parseYearMonthSerial(b.start) ?? Number.MAX_SAFE_INTEGER));
    const rangeStart = `${startYear}-01`;
    const rangeEnd = `${endYear}-12`;
    const rangeStartSerial = parseYearMonthSerial(rangeStart) ?? 0;
    const rangeEndSerial = parseYearMonthSerial(rangeEnd) ?? rangeStartSerial;
    const visibleTimelineItems = timelineItems.filter((item) => {
      const itemStart = parseYearMonthSerial(item.start);
      const itemEnd = item.end ? parseYearMonthSerial(item.end) : null;
      return itemStart === null || itemStart <= rangeEndSerial && (itemEnd === null || itemEnd >= rangeStartSerial);
    });
    const positionFor = (yearMonth: string, fallbackEnd = yearMonth) => {
      const start = Math.max(rangeStartSerial, parseYearMonthSerial(yearMonth) ?? rangeStartSerial);
      const end = Math.min(rangeEndSerial, parseYearMonthSerial(fallbackEnd) ?? rangeEndSerial);
      return {
        left: ((start - rangeStartSerial) / Math.max(1, rangeEndSerial - rangeStartSerial)) * 100,
        width: Math.max(1.5, ((Math.max(start, end) - start + 1) / Math.max(1, rangeEndSerial - rangeStartSerial + 1)) * 100)
      };
    };
    const maxChartValue = Math.max(1, ...visibleWaterfall.map((month) => Math.max(month.takeHomeIncome, month.housingCosts, month.leftoverIncome)));
    const chartWidth = 760;
    const chartHeight = 260;
    const chartPadding = { left: 58, right: 18, top: 18, bottom: 36 };
    const chartPlotWidth = chartWidth - chartPadding.left - chartPadding.right;
    const chartPlotHeight = chartHeight - chartPadding.top - chartPadding.bottom;
    const chartY = (value: number) => chartPadding.top + chartPlotHeight - (Math.max(0, value) / maxChartValue) * chartPlotHeight;
    const chartPoint = (index: number, value: number) => ({
      x: chartPadding.left + (index / Math.max(1, visibleWaterfall.length - 1)) * chartPlotWidth,
      y: chartY(value)
    });
    const leftoverPath = visibleWaterfall.map((month, index) => {
      const point = chartPoint(index, month.leftoverIncome);
      return `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`;
    }).join(' ');
    const selectedCareer = activeCareerPlan.entries.find((entry) => entry.id === selectedCareerId);
    const selectedHousing = activeHousing.find((entry) => entry.id === selectedHousingId);

    return (
      <>
        <Panel title="Career and Housing Timeline" className="panel-wide">
          <div className="timeline-toolbar">
            <label><span>From year</span><select value={startYear} onChange={(event) => setTimelineStartYear(Number(event.target.value))}>{availableYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
            <label><span>Through year</span><select value={endYear} onChange={(event) => setTimelineEndYear(Number(event.target.value))}>{availableYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>
            <button type="button" className="text-button" onClick={() => { setTimelineStartYear(firstYear); setTimelineEndYear(lastYear); }}>Show full range</button>
          </div>
          <div className="timeline-scroll">
            <div className="timeline-axis">
              {Array.from({ length: Math.max(1, endYear - startYear + 1) }, (_, index) => <span key={startYear + index}>{startYear + index}</span>)}
            </div>
            <div className="timeline-track">
              {visibleTimelineItems.length === 0 && <p className="subtle">Enable careers or housing entries to see them here.</p>}
              {visibleTimelineItems.map((item, index) => {
                const position = positionFor(item.start, item.end || rangeEnd);
                const active = (item.kind === 'career' ? timelineSelection === 'career' && item.id === selectedCareerId : timelineSelection === 'housing' && item.id === selectedHousingId);
                return <button key={`${item.kind}-${item.id}`} type="button" className={`timeline-chip${active ? ' active' : ''}`} style={{ left: `${position.left}%`, width: `${position.width}%`, top: `${0.8 + (index % 2) * 2.15}rem`, borderColor: item.color, backgroundColor: `${item.color}18` }} onClick={() => { setTimelineSelection(item.kind); if (item.kind === 'career') updateSelectedCareerId(item.id); else setSelectedHousingId(item.id); }}><strong>{item.kind === 'career' ? 'Career' : 'Housing'}</strong><span>{item.label}</span><small>{item.start} to {item.end || 'ongoing'}</small></button>;
              })}
            </div>
          </div>
        </Panel>

        <Panel title="Monthly Income Waterfall" className="panel-wide">
          {visibleWaterfall.length === 0 ? <p className="subtle">No monthly projection data is available for this range.</p> : <>
            <div className="timeline-chart-wrap">
              <svg className="timeline-chart" viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label="Monthly leftover income chart">
                {[0, 0.5, 1].map((fraction) => <line key={fraction} x1={chartPadding.left} x2={chartWidth - chartPadding.right} y1={chartY(maxChartValue * fraction)} y2={chartY(maxChartValue * fraction)} stroke="#dbe4ef" />)}
                <path d={leftoverPath} fill="none" stroke="#2b5fe2" strokeWidth="3" />
                {visibleWaterfall.map((month, index) => { const point = chartPoint(index, month.leftoverIncome); return <circle key={`${month.calendarYear}-${month.calendarMonth}`} cx={point.x} cy={point.y} r="3" fill="#2b5fe2"><title>{`${month.calendarYear}-${String(month.calendarMonth).padStart(2, '0')}: ${formatCurrency(month.leftoverIncome)} leftover`}</title></circle>; })}
                <text x={chartPadding.left} y={chartHeight - 8} className="timeline-chart-label">{`${visibleWaterfall[0].calendarYear}-${String(visibleWaterfall[0].calendarMonth).padStart(2, '0')}`}</text>
                <text x={chartWidth - chartPadding.right} y={chartHeight - 8} textAnchor="end" className="timeline-chart-label">{`${visibleWaterfall[visibleWaterfall.length - 1].calendarYear}-${String(visibleWaterfall[visibleWaterfall.length - 1].calendarMonth).padStart(2, '0')}`}</text>
              </svg>
            </div>
            <div className="table-wrap"><table className="purchases-table timeline-waterfall-table"><thead><tr><th>Month</th><th>Career</th><th>Take-home</th><th>Career savings</th><th>Career withdrawals</th><th>Housing</th><th>Other expenses</th><th>Leftover</th></tr></thead><tbody>{visibleWaterfall.map((month) => <tr key={`${month.calendarYear}-${month.calendarMonth}`}><td>{`${month.calendarYear}-${String(month.calendarMonth).padStart(2, '0')}`}</td><td>{month.careerLabel}</td><td>{formatCurrency(month.takeHomeIncome)}</td><td>{formatCurrency(month.careerSavingsDeposits)}</td><td>{formatCurrency(month.careerWithdrawals)}</td><td>{formatCurrency(month.housingCosts)}</td><td>{formatCurrency(month.otherIncomeExpenses)}</td><td className={month.leftoverIncome < 0.01 ? 'negative-value' : ''}>{formatCurrency(month.leftoverIncome)}</td></tr>)}</tbody></table></div>
          </>}
        </Panel>

        {timelineSelection === 'career' && selectedCareer && <Panel title={`Edit Career: ${selectedCareer.label}`} className="panel-wide"><CareerPlanEditor value={activeCareerPlan} selectedCareerId={selectedCareerId} onSelectCareer={updateSelectedCareerId} onChangeCareer={updateCareer} onDuplicateCareer={duplicateCareer} onReorderCareers={reorderCareers} onAddCareer={addCareer} onRemoveCareer={removeCareer} previewYear={futureProjection.years.find((year) => !year.isBaselineNow) ?? futureProjection.years[0]} bankAccounts={bankAccounts} pools={poolDefinitions} birthdayBasedCareerStartAge={birthdayBasedCareerStartAge} dateOfBirth={scenario.options.dateOfBirth} currentAge={currentAge} incomeFallbackAccountId={scenario.incomeFallbackAccountId} incomeFallbackAccountId2={scenario.incomeFallbackAccountId2} onChangeIncomeFallbackAccount1={(accountId) => updateScenario({ ...scenario, incomeFallbackAccountId: accountId })} onChangeIncomeFallbackAccount2={(accountId) => updateScenario({ ...scenario, incomeFallbackAccountId2: accountId })} allowReordering={false} /></Panel>}
        {timelineSelection === 'housing' && selectedHousing && <Panel title={`Edit Housing: ${selectedHousing.label}`} className="panel-wide"><HousingEditor housing={activeHousing} selectedHousingId={selectedHousingId} onSelectHousing={setSelectedHousingId} onChangeHousing={(entry) => updateHousing(entry.id, entry)} onReorderHousing={reorderHousing} onAddHousing={addHousing} onDuplicateHousing={duplicateHousing} onRemoveHousing={removeHousing} accountOptions={accountSelectionOptions} orderedBankAccounts={orderedBankAccounts} careerOptions={activeCareerPlan.entries.map((career) => ({ id: career.id, label: career.label }))} allowReordering={false} /></Panel>}
      </>
    );
  };

  const renderNetWorthTab = () => {
    const trackedBalanceTotal =
      bankAccounts.length > 0
        ? bankAccounts.reduce((sum, account) => sum + account.balance, 0)
        : sumSavingsBalances(scenario.netWorth.accountBalances);
    const customBalanceTotal = customNetWorthAccounts.reduce((sum, account) => sum + account.balance, 0);
    const fullNetWorthTotal = trackedBalanceTotal + customBalanceTotal;

    return (
      <Panel title="Net Worth Accounts" className="panel-wide">
          <>
        <div className="career-actions">
          <button type="button" className="secondary-button" onClick={addPool}>
            + Add Pool
          </button>
          <button type="button" className="secondary-button" onClick={addBankAccount}>
            + Add Bank Account
          </button>
          <button type="button" className="secondary-button" onClick={saveNetWorthSnapshot}>
            Save Account Balance
          </button>
        </div>
        <div className="table-wrap">
          <table className="purchases-table">
            <thead>
              <tr>
                <th>Pool</th>
                <th>Enabled</th>
                <th>Priority</th>
                <th>Pre-Ret %</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {poolDefinitions.map((pool, index) => (
                <tr key={pool.id}>
                  <td>
                    <input
                      type="text"
                      value={pool.label}
                      onChange={(event) => updatePool(pool.id, { label: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={pool.enabled}
                      onChange={(event) => updatePool(pool.id, { enabled: event.target.checked })}
                    />
                  </td>
                  <td>
                    <BufferedNumberInput
                      value={pool.priority}
                      min={0}
                      max={50}
                      step={1}
                      onCommit={(next) => updatePool(pool.id, { priority: Math.floor(next) })}
                    />
                    <span className="subtle">Order {index + 1}</span>
                  </td>
                  <td>
                    <BufferedNumberInput
                      value={pool.preRetirementReturnRate}
                      min={-20}
                      max={40}
                      step={0.1}
                      onCommit={(next) => updatePool(pool.id, { preRetirementReturnRate: next })}
                    />
                  </td>
                  <td>
                    <button type="button" className="text-button" onClick={() => removePool(pool.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table className="purchases-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Pool</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Balance</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {bankAccounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <input
                      type="text"
                      value={account.label}
                      onChange={(event) => updateBankAccount(account.id, { label: event.target.value })}
                    />
                  </td>
                  <td>
                    <select
                      value={account.poolId}
                      onChange={(event) => updateBankAccount(account.id, { poolId: event.target.value })}
                    >
                      {poolDefinitions.map((pool) => (
                        <option key={pool.id} value={pool.id}>
                          {pool.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={account.accountType}
                      onChange={(event) =>
                        updateBankAccount(account.id, {
                          accountType: event.target.value as AccountTypePreset
                        })
                      }
                    >
                      {ACCOUNT_TYPE_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <BufferedNumberInput
                      value={account.priority}
                      min={0}
                      max={50}
                      step={1}
                      onCommit={(next) => updateBankAccount(account.id, { priority: Math.floor(next) })}
                    />
                  </td>
                  <td>
                    <BufferedNumberInput
                      value={account.balance}
                      min={0}
                      max={20000000}
                      step={100}
                      onCommit={(next) => updateBankAccount(account.id, { balance: next })}
                    />
                  </td>
                  <td>
                    <button type="button" className="text-button" onClick={() => removeBankAccount(account.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          </>

        <div className="panel-divider" />

        {customNetWorthAccounts.length > 0 ? (
          <>
          <h3>Legacy Custom Accounts</h3>
          <p className="subtle">Custom accounts from older scenarios are still supported for review/removal.</p>
          <div className="table-wrap">
            <table className="purchases-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Balance</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {customNetWorthAccounts.map((account) => (
                  <tr key={account.id}>
                    <td>
                      <input
                        type="text"
                        aria-label={`${account.label} Name`}
                        value={account.label}
                        onChange={(event) => updateCustomNetWorthAccount(account.id, { label: event.target.value })}
                      />
                    </td>
                    <td>
                      <BufferedNumberInput
                        value={account.balance}
                        min={0}
                        max={20000000}
                        step={100}
                        onCommit={(next) => updateCustomNetWorthAccount(account.id, { balance: next })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => removeCustomNetWorthAccount(account.id)}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        ) : null}
        <div className="career-summary">
          <p>
            Projection tracked balances:{' '}
            <strong>{formatCurrency(trackedBalanceTotal)}</strong>
          </p>
          <p>
            Custom account balances: <strong>{formatCurrency(customBalanceTotal)}</strong>
          </p>
          <p>
            Total net worth (tracked + custom): <strong>{formatCurrency(fullNetWorthTotal)}</strong>
          </p>
          <p>
            Last updated: <strong>{formatShortDate(scenario.netWorth.asOfDate)}</strong>
          </p>
          <p>Balances are stored in local storage with the save date.</p>
        </div>
      </Panel>
    );
  };

  const renderTabBody = () => {
    const renderExpensesTab = () => (
      <ExpensesPlanner
        expenses={expenses}
        bankAccounts={orderedBankAccounts}
        pools={poolDefinitions}
        netWorthHistory={netWorthHistory}
        projectionYears={futureProjection.years as ProjectionYear[]}
        onChange={(nextExpenses) =>
          setAppState((currentState) => ({
            ...currentState,
            scenario: {
              ...currentState.scenario,
              expenses: nextExpenses
            }
          }))
        }
      />
    );

    switch (activeTab) {
      case 'options':
        return renderOptionsTab();
      case 'careers':
        return (
          <>
            <div className="tabs">
              {FINANCE_PREDICTION_SUB_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={careersSubTab === tab.id ? 'tab active' : 'tab'}
                  onClick={() => updateCareersSubTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {careersSubTab === 'careers'
              ? renderCareersTab()
              : careersSubTab === 'retirement'
                ? (
                    <>
                      {renderRetirementTab({ forCareerRetirementItem: true, showRetirementCalculator: false })}
                      {renderFutureRetirementPanel()}
                    </>
                  )
                : careersSubTab === 'timeline'
                  ? renderTimelineManagementTab()
                  : careersSubTab === 'purchasesExpenses'
                    ? renderPurchasesTab()
                    : careersSubTab === 'housing'
                      ? renderHousingTab()
                      : careersSubTab === 'trajectory'
                        ? renderTrajectoryTab()
                        : careersSubTab === 'warnings'
                          ? renderWarningsTab()
                          : null}
          </>
        );
      case 'netWorth':
        return renderNetWorthTab();
      case 'expenses':
        {
          const trackerVisibleAccountIds =
            expenses.ui.trackerVisibleAccountIds.length > 0
              ? expenses.ui.trackerVisibleAccountIds
              : orderedBankAccounts.map((account) => account.id);
        return (
          <>
            <div className="tabs">
              {EXPENSES_SUB_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={expensesSubTab === tab.id ? 'tab active' : 'tab'}
                  onClick={() =>
                    setAppState((currentState) => ({
                      ...currentState,
                      ui: {
                        ...currentState.ui,
                        expensesSubTab: tab.id
                      }
                    }))
                  }
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {expensesSubTab === 'planning' && renderExpensesTab()}
            {expensesSubTab === 'tracking' && (
              <Panel title="Expense Tracking">
                <div className="career-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setShowExpenseTrackerAccountConfig((current) => !current)}
                  >
                    Configure Accounts
                  </button>
                </div>
                {showExpenseTrackerAccountConfig ? (
                  <div className="panel-divider">
                    {orderedBankAccounts.map((account) => (
                      <label key={account.id} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={trackerVisibleAccountIds.includes(account.id)}
                          onChange={(event) =>
                            setAppState((currentState) => {
                              const currentlyVisible =
                                currentState.scenario.expenses.ui.trackerVisibleAccountIds.length > 0
                                  ? currentState.scenario.expenses.ui.trackerVisibleAccountIds
                                  : orderedBankAccounts.map((item) => item.id);
                              const nextVisible = event.target.checked
                                ? [...currentlyVisible, account.id]
                                : currentlyVisible.filter((id) => id !== account.id);

                              return {
                                ...currentState,
                                scenario: {
                                  ...currentState.scenario,
                                  expenses: {
                                    ...currentState.scenario.expenses,
                                    ui: {
                                      ...currentState.scenario.expenses.ui,
                                      trackerVisibleAccountIds: Array.from(new Set(nextVisible))
                                    }
                                  }
                                }
                              };
                            })
                          }
                        />
                        <span>{account.label}</span>
                      </label>
                    ))}
                  </div>
                ) : null}
                <p className="subtle">Expense tracking view coming soon.</p>
              </Panel>
            )}
            {expensesSubTab === 'creditCards' && (
              <>
                <Panel title="Credit Cards" className="panel-wide">
                  <div className="career-actions">
                    <button type="button" className="secondary-button" onClick={addCreditCard}>
                      + Credit Card
                    </button>
                  </div>
                  {activeCreditCards.length === 0 ? (
                    <p className="subtle">Add credit cards to track balances, interest, and payments.</p>
                  ) : (
                    <div className="table-wrap">
                      <table className="purchases-table">
                        <thead>
                          <tr>
                            <th>Enabled</th>
                            <th>Name</th>
                            <th>Balance</th>
                            <th>Due Date</th>
                            <th>Monthly Payment</th>
                            <th>Pay From</th>
                            <th>Edit</th>
                            <th>Remove</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeCreditCards.map((cc) => (
                            <tr key={cc.id} className="purchase-row">
                              <td>
                                <input
                                  type="checkbox"
                                  checked={cc.enabled}
                                  onChange={(e) => updateCreditCard(cc.id, { ...cc, enabled: e.target.checked })}
                                />
                              </td>
                              <td>
                                <input
                                  type="text"
                                  value={cc.label}
                                  onChange={(e) => updateCreditCard(cc.id, { ...cc, label: e.target.value })}
                                />
                              </td>
                              <td>{cc.paymentMode === 'autopay' ? '-' : formatCurrency(cc.currentBalance)}</td>
                              <td>{cc.paymentDay}<sup>th</sup></td>
                              <td>
                                {cc.paymentMode === 'payInFull' ? 'Full' : cc.paymentMode === 'minimum' ? `${cc.minimumPaymentPercent}%` : formatCurrency(cc.fixedPaymentAmount)}
                              </td>
                              <td>
                                {cc.paymentSource === 'income' ? 'Income' : (() => {
                                  const aid = cc.paymentSource?.startsWith('account:') ? cc.paymentSource.split(':', 2)[1] : null;
                                  const acct = aid ? bankAccounts.find((a) => a.id === aid) : null;
                                  return acct ? acct.label : cc.paymentSource;
                                })()}
                              </td>
                              <td>
                                <button type="button" className="secondary-button" onClick={() => setEditingCreditCardId(cc.id)}>
                                  Edit
                                </button>
                              </td>
                              <td>
                                <button type="button" className="text-button" onClick={() => removeCreditCard(cc.id)}>
                                  Remove
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Panel>

                {activeCreditCards.filter((cc) => cc.enabled && cc.currentBalance > 0).length > 0 && (
                  <Panel title="Payment Schedule Projection" className="panel-wide">
                    {activeCreditCards.filter((cc) => cc.enabled && cc.currentBalance > 0).map((cc) => {
                      const rows: Array<{ month: string; opening: number; charges: number; interest: number; payment: number; closing: number; payFromBal: number; lumpSumBal: number }> = [];
                      let bal = cc.currentBalance;
                      const now = new Date();
                      let serial = now.getFullYear() * 12 + now.getMonth();
                      const introEnd = cc.introEnabled && cc.introEndYearMonth ? (() => {
                        const [y, m] = cc.introEndYearMonth.split('-').map(Number);
                        return y * 12 + (m - 1);
                      })() : null;
                      const isIncome = cc.paymentSource === 'income';
                      const payFromAcctId = !isIncome && cc.paymentSource.startsWith('account:') ? cc.paymentSource.split(':', 2)[1] : null;
                      const lumpSumAcctId = !isIncome && cc.lumpSumPaymentSource?.startsWith('account:') ? cc.lumpSumPaymentSource.split(':', 2)[1] : null;
                      const payFromBalance = { value: payFromAcctId ? (projection.years[0]?.accountBalancesById[payFromAcctId] ?? 0) : 0 };
                      const lumpSumBalance = { value: lumpSumAcctId ? (projection.years[0]?.accountBalancesById[lumpSumAcctId] ?? 0) : 0 };

                      for (let i = 0; i < 24 && bal > 0.01; i += 1) {
                        const opening = bal;
                        bal += cc.monthlyCharges;
                        const pastIntro = !introEnd || serial >= introEnd;
                        const interest = pastIntro && cc.annualInterestRate > 0 ? bal * (cc.annualInterestRate / 100 / 12) : 0;
                        bal += interest;
                        let payment: number;
                        let isLump = false;
                        if (cc.paymentMode === 'payInFull') {
                          payment = bal;
                        } else if (cc.paymentMode === 'fixed') {
                          payment = Math.min(cc.fixedPaymentAmount, bal);
                        } else if (cc.paymentMode === 'fixedPlusLump') {
                          const isLastIntroMonth = introEnd !== null && serial === introEnd - 1;
                          isLump = isLastIntroMonth;
                          payment = isLastIntroMonth ? bal : Math.min(cc.fixedPaymentAmount, bal);
                        } else {
                          payment = Math.min(bal, Math.max(cc.minimumPaymentFloor, bal * cc.minimumPaymentPercent / 100));
                        }
                        bal = Math.max(0, bal - payment);
                        if (!isIncome) {
                          if (isLump && lumpSumAcctId) {
                            lumpSumBalance.value = Math.max(0, lumpSumBalance.value - payment);
                          } else {
                            payFromBalance.value = Math.max(0, payFromBalance.value - payment);
                          }
                        }
                        const y = Math.floor(serial / 12);
                        const m = (serial % 12) + 1;
                        rows.push({
                          month: `${y}-${String(m).padStart(2, '0')}`,
                          opening,
                          charges: cc.monthlyCharges,
                          interest,
                          payment,
                          closing: bal,
                          payFromBal: payFromBalance.value,
                          lumpSumBal: lumpSumBalance.value
                        });
                        serial += 1;
                      }

                      return (
                        <div key={cc.id} className="credit-card-schedule">
                          <h4>{cc.label}</h4>
                          <div className="table-wrap">
                            <table className="purchases-table">
                              <thead>
                                <tr>
                                  <th>Month</th>
                                  <th>Opening</th>
                                  <th>Charges</th>
                                  <th>Interest</th>
                                  <th>Payment</th>
                                  <th>Pay From Bal</th>
                                  <th>Lump Sum Bal</th>
                                  <th>Closing</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((row) => (
                                  <tr key={row.month}>
                                    <td>{row.month}</td>
                                    <td>{formatCurrency(row.opening)}</td>
                                    <td>{formatCurrency(row.charges)}</td>
                                    <td>{formatCurrency(row.interest)}</td>
                                    <td>{formatCurrency(row.payment)}</td>
                                    <td>{isIncome ? '--' : formatCurrency(row.payFromBal)}</td>
                                    <td>{isIncome || cc.paymentMode !== 'fixedPlusLump' ? '--' : formatCurrency(row.lumpSumBal)}</td>
                                    <td>{formatCurrency(row.closing)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {bal <= 0.01 && <p className="subtle">Paid off in {rows.length} months.</p>}
                          {bal > 0.01 && <p className="subtle">Balance after 24 months: {formatCurrency(bal)}</p>}
                        </div>
                      );
                    })}
                  </Panel>
                )}

                {editingCreditCardId && (() => {
                  const cc = activeCreditCards.find((c) => c.id === editingCreditCardId);
                  if (!cc) return null;
                  return (
                    <div className="expense-modal-backdrop" onClick={() => setEditingCreditCardId(null)}>
                      <div className="expense-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="expense-modal-header">
                          <strong>Edit: {cc.label}</strong>
                          <button type="button" className="secondary-button" onClick={() => setEditingCreditCardId(null)}>Done</button>
                        </div>
                        <div className="cc-edit-form">
                          <label>
                            <span>Name</span>
                            <input type="text" value={cc.label} onChange={(e) => updateCreditCard(cc.id, { ...cc, label: e.target.value })} />
                          </label>
                          {cc.paymentMode !== 'autopay' && (
                            <>
                          <label>
                            <span>Balance</span>
                            <BufferedNumberInput value={cc.currentBalance} min={0} max={1000000} step={100} onCommit={(v) => updateCreditCard(cc.id, { ...cc, currentBalance: v })} />
                          </label>
                          <label>
                            <span>APR %</span>
                            <BufferedNumberInput value={cc.annualInterestRate} min={0} max={100} step={0.01} onCommit={(v) => updateCreditCard(cc.id, { ...cc, annualInterestRate: v })} />
                          </label>
                          <label>
                            <span>0% Intro APR</span>
                            <input type="checkbox" checked={cc.introEnabled} onChange={(e) => updateCreditCard(cc.id, { ...cc, introEnabled: e.target.checked })} />
                          </label>
                          {cc.introEnabled && (
                            <label>
                              <span>0% Ends</span>
                              <YearMonthInput label="Intro End" value={cc.introEndYearMonth} onChange={(v) => updateCreditCard(cc.id, { ...cc, introEndYearMonth: v })} />
                            </label>
                          )}
                          <label>
                            <span>Monthly Charges</span>
                            <BufferedNumberInput value={cc.monthlyCharges} min={0} max={100000} step={10} onCommit={(v) => updateCreditCard(cc.id, { ...cc, monthlyCharges: v })} />
                          </label>
                          <label>
                            <span>Payment Mode</span>
                            <select value={cc.paymentMode} onChange={(e) => {
                              const mode = e.target.value as CreditCard['paymentMode'];
                              const updates: Partial<CreditCard> = { paymentMode: mode };
                              if (mode === 'fixedPlusLump' && !cc.introEnabled) {
                                updates.introEnabled = true;
                              }
                              if (mode === 'autopay') {
                                updates.currentBalance = 0;
                              }
                              updateCreditCard(cc.id, { ...cc, ...updates });
                            }}>
                              <option value="minimum">Minimum</option>
                              <option value="fixed">Fixed</option>
                              <option value="fixedPlusLump">Fixed + Lump Sum</option>
                              <option value="payInFull">Pay in Full</option>
                              <option value="autopay">Autopay</option>
                            </select>
                          </label>
                          {(cc.paymentMode === 'fixed' || cc.paymentMode === 'fixedPlusLump') && (
                            <label>
                              <span>Fixed Payment</span>
                              <BufferedNumberInput value={cc.fixedPaymentAmount} min={0} max={100000} step={10} onCommit={(v) => updateCreditCard(cc.id, { ...cc, fixedPaymentAmount: v })} />
                            </label>
                          )}
                          {cc.paymentMode === 'fixedPlusLump' && (
                            <label>
                              <span>Lump Sum Pay From</span>
                              <select value={cc.lumpSumPaymentSource} onChange={(e) => updateCreditCard(cc.id, { ...cc, lumpSumPaymentSource: e.target.value as CreditCard['lumpSumPaymentSource'] })}>
                                <option value="income">Income</option>
                                {accountSelectionOptions.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            </label>
                          )}
                          {cc.paymentMode === 'fixedPlusLump' && (() => {
                            if (!cc.introEnabled || !cc.introEndYearMonth) {
                              return <p className="subtle">Set 0% end date to calculate lump sum.</p>;
                            }
                            const [ey, em] = cc.introEndYearMonth.split('-').map(Number);
                            const introEndSerial = ey * 12 + (em - 1);
                            const nowDate = new Date();
                            const nowSerial = nowDate.getFullYear() * 12 + nowDate.getMonth();
                            const monthsUntilLump = Math.max(0, introEndSerial - 1 - nowSerial);
                            let simBal = cc.currentBalance;
                            for (let i = 0; i < monthsUntilLump && simBal > 0.01; i += 1) {
                              simBal += cc.monthlyCharges;
                              simBal = Math.max(0, simBal - Math.min(cc.fixedPaymentAmount, simBal));
                            }
                            return (
                              <p className="subtle">
                                Remaining balance paid in full at end of 0% period.
                                <br />
                                <strong>Estimated lump sum: {formatCurrency(Math.max(0, simBal))}</strong>
                                {monthsUntilLump > 0 && <> ({monthsUntilLump} months of fixed payments)</>}
                              </p>
                            );
                          })()}
                          {cc.paymentMode === 'minimum' && (
                            <>
                              <label>
                                <span>Min Payment %</span>
                                <BufferedNumberInput value={cc.minimumPaymentPercent} min={0} max={100} step={0.1} onCommit={(v) => updateCreditCard(cc.id, { ...cc, minimumPaymentPercent: v })} />
                              </label>
                              <label>
                                <span>Min Payment Floor ($)</span>
                                <BufferedNumberInput value={cc.minimumPaymentFloor} min={0} max={10000} step={5} onCommit={(v) => updateCreditCard(cc.id, { ...cc, minimumPaymentFloor: v })} />
                              </label>
                            </>
                          )}
                            </>
                          )}
                          {cc.paymentMode === 'autopay' && (
                            <label>
                              <span>Monthly Autopay</span>
                              <BufferedNumberInput value={cc.fixedPaymentAmount} min={0} max={100000} step={10} onCommit={(v) => updateCreditCard(cc.id, { ...cc, fixedPaymentAmount: v })} />
                            </label>
                          )}
                          <label>
                            <span>Pay From</span>
                            <select value={cc.paymentSource} onChange={(e) => updateCreditCard(cc.id, { ...cc, paymentSource: e.target.value as CreditCard['paymentSource'] })}>
                              <option value="income">Income</option>
                              {accountSelectionOptions.map((opt) => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            <span>Due Date (day)</span>
                            <BufferedNumberInput value={cc.paymentDay} min={1} max={28} step={1} onCommit={(v) => updateCreditCard(cc.id, { ...cc, paymentDay: Math.floor(v) })} />
                          </label>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </>
        );
        }
      default:
        return null;
    }
  };

  return (
    <main className="app-shell">
      <div className="top-tabs">
        {TOP_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? 'top-tab active' : 'top-tab'}
            onClick={() => updateSidebarTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="timeline-bar">
        <button type="button" className="secondary-button" onClick={addTimeline}>
          Add Timeline
        </button>
        <button type="button" className="secondary-button" onClick={() => setShowTimelineManager(true)}>
          Timelines
        </button>
        <span className="chip-group-label">Timelines:</span>
        <button
          type="button"
          className={`purchase-category-chip${(scenario.activeTimelineId ?? null) === null ? ' active' : ''}`}
          onClick={() => switchTimeline(null)}
        >
          Default
        </button>
        {(scenario.timelines ?? []).map((timeline) => (
          <button
            key={timeline.id}
            type="button"
            className={`purchase-category-chip${scenario.activeTimelineId === timeline.id ? ' active' : ''}`}
            onClick={() => switchTimeline(timeline.id)}
          >
            {timeline.label}
          </button>
        ))}
      </div>

      <div className={hideResultsPanel ? 'app-grid full-width-content' : 'app-grid'}>
        <aside className="sidebar">{renderTabBody()}</aside>

        <section className="results">
          <div className="results-sticky">
            {hideResultsPanel ? null : (
              <>
                <div className="results-card graph-card">
                  {usesFinancePredictionResults && simulationStartEntry ? (
                    <p className="simulation-start-note">
                      Simulating from <strong>{formatShortDate(simulationStartDate)}</strong> using the last saved account balance.
                    </p>
                  ) : null}
                  {activeTab === 'netWorth' ? (
                    <>
                      <div className="networth-history-header">
                        <h3>Net Worth History</h3>
                        <div className="history-range-row" role="radiogroup" aria-label="Net worth history range">
                          {availableNetWorthHistoryRanges.map((range) => (
                            <label key={range.id} className="checkbox-row">
                              <input
                                type="radio"
                                name="networth-history-range"
                                checked={effectiveNetWorthHistoryRange === range.id}
                                onChange={() => setNetWorthHistoryRange(range.id)}
                              />
                              <span>{range.label}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                      <NetWorthHistoryChart entries={displayedNetWorthHistory} />
                    </>
                  ) : showTrajectoryComparison ? (
                    <TrajectoryComparisonChart
                      currentYears={adjustedYears.length > 0 ? adjustedYears : futureProjection.years}
                      selected={adjustedSelectedTrajectory}
                      historyPoints={netWorthHistoryPoints}
                    />
                  ) : (
                    <>
                      <div className="chart-mode-row">
                        <label className="checkbox-row">
                          <input type="radio" name="graph-mode" checked={graphMode === 'portfolio'} onChange={() => setGraphMode('portfolio')} />
                          <span>Portfolio Graph</span>
                        </label>
                        <label className="checkbox-row">
                          <input type="radio" name="graph-mode" checked={graphMode === 'savings'} onChange={() => setGraphMode('savings')} />
                          <span>Stacked Savings Graph</span>
                        </label>
                      </div>
                      <div className="chart-mode-row">
                        <label className="checkbox-row">
                          <input type="checkbox" checked={showPurchaseFlags} onChange={(e) => setShowPurchaseFlags(e.target.checked)} />
                          <span>Purchases / Expenses</span>
                        </label>
                        <label className="checkbox-row">
                          <input type="checkbox" checked={showHousingFlags} onChange={(e) => setShowHousingFlags(e.target.checked)} />
                          <span>Housing Expenses</span>
                        </label>
                      </div>
                      {graphMode === 'portfolio' ? (
                        <ChartPanel
                          years={filteredGraphYears}
                          flags={visibleFlags}
                          monthlySnapshots={adjustedMonthlySnapshots}
                          onFlagColorChange={handleFlagColorChange}
                        />
                      ) : (
                        <SavingsStackedChart
                          years={filteredGraphYears}
                          pools={poolDefinitions}
                          bankAccounts={orderedBankAccounts}
                          flags={visibleFlags}
                          monthlySnapshots={adjustedMonthlySnapshots}
                          onFlagColorChange={handleFlagColorChange}
                        />
                      )}
                      {displayedGraphYears.length > 1 && (() => {
                        const fullMin = displayedGraphYears[0].age;
                        const fullMax = displayedGraphYears[displayedGraphYears.length - 1].age;
                        const sliderMax = Math.min(fullMax, futureEndAge);
                        const sliderRange = sliderMax - fullMin;
                        const leftPct = sliderRange > 0 ? ((graphAgeMin - fullMin) / sliderRange) * 100 : 0;
                        const rightPct = sliderRange > 0 ? ((graphAgeMax - fullMin) / sliderRange) * 100 : 100;
                        const widthPct = rightPct - leftPct;
                        return (
                        <div className="graph-range-slider">
                          <span className="range-boundary range-boundary-left">{fullMin}</span>
                          <div className="range-track">
                            <span className="range-label" style={{ left: `${leftPct}%` }}>{graphAgeMin}</span>
                            <span className="range-label" style={{ left: `${rightPct}%` }}>{graphAgeMax}</span>
                            <div className="range-track-bg" />
                            <div className="range-track-fill" style={{ left: `${leftPct}%`, width: `${widthPct}%` }} />
                            <input
                              type="range"
                              min={fullMin}
                              max={sliderMax}
                              value={graphAgeMin}
                              onChange={(e) => setGraphAgeMin(Math.min(+e.target.value, graphAgeMax - 1))}
                              className="range-thumb range-thumb-left"
                            />
                            <input
                              type="range"
                              min={fullMin}
                              max={sliderMax}
                              value={graphAgeMax}
                              onChange={(e) => setGraphAgeMax(Math.max(+e.target.value, graphAgeMin + 1))}
                              className="range-thumb range-thumb-right"
                            />
                          </div>
                          <span className="range-boundary range-boundary-right">{sliderMax}</span>
                        </div>
                        );
                      })()}
                      <div
                        className={displayedGraphDepleted || (usesFinancePredictionResults && !hasEnabledCareers) ? 'summary warning' : 'summary success'}
                      >
                        <p>{displayedGraphSummary}</p>
                        <p>
                          Ending balance at age <strong>{displayedGraphEndAge}</strong>
                          : <strong>{formatCurrency(displayedGraphBalanceForSummary)}</strong>
                        </p>
                      </div>
                    </>
                  )}
                </div>

                {!showTrajectoryComparison && (
                <div className="results-card table-card">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={showMonths}
                      onChange={(e) => setShowMonths(e.target.checked)}
                    />
                    <span>Display months</span>
                  </label>
                  <ResultsTable
                    years={adjustedYears}
                    accountColumns={orderedBankAccounts.map((account) => ({ id: account.id, label: account.label }))}
                    showMonths={showMonths}
                    monthlySnapshots={adjustedMonthlySnapshots}
                    rowTooltip={showMonths ? (row, _i) => {
                      if (!('calendarMonth' in row)) return undefined;
                      const snap = row as import('./types').MonthlySnapshot;
                      const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                      const monthAbbr = MONTHS[snap.calendarMonth - 1] ?? snap.calendarMonth;
                      const mk = `${snap.calendarYear}-${String(snap.calendarMonth).padStart(2, '0')}`;
                      const usage = adjustedIncomeUsageByMonth?.[mk];
                      const change = snap.endBalance - snap.startBalance;
                      const parts: string[] = [];
                      parts.push(`${monthAbbr} ${snap.calendarYear} \u2014 Age ${snap.age}`);
                      parts.push(`Starting balance: ${formatCurrency(snap.startBalance)}`);
                      if (usage && usage.items.length > 0) {
                        parts.push(`Monthly income (${formatCurrency(usage.availableIncome)} take-home):`);
                        usage.items.forEach((item) => parts.push(`  \u2192 ${item.label}: ${formatCurrency(item.amount)}`));
                        const total = usage.items.reduce((s, i) => s + i.amount, 0);
                        parts.push(`  Total income used: ${formatCurrency(total)}`);
                      }
                      parts.push(`Ending balance: ${formatCurrency(snap.endBalance)}`);
                      parts.push(`Change: ${change >= 0 ? '+' : '-'}${formatCurrency(Math.abs(change))}`);
                      return parts.join('\n');
                    } : undefined}
                    cellTooltip={showMonths ? (columnId, row, _i) => {
                      if (!('calendarMonth' in row)) return undefined;
                      const snap = row as import('./types').MonthlySnapshot;
                      const activity = snap.accountActivity?.[columnId];
                      const acctLabel = bankAccounts.find((a) => a.id === columnId)?.label ?? columnId;
                      const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                      const monthAbbr = MONTHS[snap.calendarMonth - 1] ?? snap.calendarMonth;
                      const endBal = snap.accountBalancesById[columnId] ?? 0;
                      const creditCards = activeCreditCards;
                      const friendlyLabel = (raw: string): string => {
                        for (const cc of creditCards) {
                          if (raw.startsWith(cc.id + '-')) return cc.label;
                          if (raw === cc.id) return cc.label;
                        }
                        for (const lp of activeLargePurchases) {
                          for (const sl of (lp.sourceLines ?? [])) { if (sl.id === raw) return lp.label; }
                          if (raw.startsWith(lp.id)) return lp.label;
                        }
                        for (const ltp of activeLongTermPurchases) {
                          for (const sl of (ltp.sourceLines ?? [])) { if (sl.id === raw) return ltp.label; }
                          if (raw.startsWith(ltp.id)) return ltp.label;
                        }
                        for (const h of activeHousing) {
                          if (raw.startsWith(h.id)) return h.label;
                        }
                        for (const l of activeLoans) {
                          if (raw.startsWith(l.id)) return l.label;
                        }
                        if (raw.startsWith('funding-source-')) {
                          const acctId = raw.replace('funding-source-', '');
                          const acct = bankAccounts.find(a => a.id === acctId);
                          if (acct) return acct.label;
                        }
                        const acct = bankAccounts.find(a => a.id === raw);
                        if (acct) return acct.label;
                        return raw;
                      };
                      const parts: string[] = [];
                      parts.push(`${acctLabel} \u2014 ${monthAbbr} ${snap.calendarYear}`);
                      if (activity && activity.length > 0) {
                        activity.forEach((a) => parts.push(`  ${friendlyLabel(a.label)}: ${a.amount >= 0 ? '+' : ''}${formatCurrency(a.amount)}`));
                        const net = activity.reduce((s, a) => s + a.amount, 0);
                        parts.push(`  Net activity: ${net >= 0 ? '+' : ''}${formatCurrency(net)}`);
                      }
                      parts.push(`Ending balance: ${formatCurrency(endBal)}`);
                      return parts.join('\n');
                    } : undefined}
                  />
                </div>
                )}
              </>
            )}
          </div>

        </section>
      </div>

      {showTimelineManager && (
        <div className="expense-modal-backdrop" onClick={() => setShowTimelineManager(false)}>
          <div className="expense-modal" onClick={(e) => e.stopPropagation()}>
            <div className="expense-modal-header">
              <strong>Manage Timelines</strong>
              <button type="button" className="text-button" onClick={() => setShowTimelineManager(false)}>Close</button>
            </div>
            <div className="purchase-category-list">
              {(scenario.timelines ?? []).length === 0 && (
                <p className="subtle">No timelines yet. Use "Add Timeline" to duplicate the current state.</p>
              )}
              {(scenario.timelines ?? []).map((timeline) => (
                <div key={timeline.id} className="purchase-category-row">
                  <input
                    type="text"
                    value={timeline.label}
                    onChange={(event) => renameTimeline(timeline.id, event.target.value)}
                  />
                  <button type="button" className="text-button" onClick={() => duplicateTimeline(timeline.id)}>
                    Copy
                  </button>
                  <button type="button" className="text-button danger-text" onClick={() => deleteTimeline(timeline.id)}>
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default App;
