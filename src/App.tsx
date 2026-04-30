import { type ChangeEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ChartPanel } from './components/ChartPanel';
import { CashflowItemEditor } from './components/CashflowItemEditor';
import { CareerPlanEditor } from './components/CareerPlanEditor';
import { LifeEventEditor } from './components/LifeEventEditor';
import { NetWorthHistoryChart } from './components/NetWorthHistoryChart';
import { ResultsTable } from './components/ResultsTable';
import { SavingsStackedChart } from './components/SavingsStackedChart';
import { BufferedNumberInput } from './components/BufferedNumberInput';
import { ExpensesPlanner } from './components/ExpensesPlanner';
import { YearMonthInput } from './components/YearMonthInput';
import {
  createDefaultCashflowItem,
  createDefaultCareerEntry,
  createDefaultLargePurchase,
  createDefaultLoan,
  createDefaultLongTermPurchase,
  createDefaultLifeEvent,
  defaultScenario
} from './defaultScenario';
import {
  ACCOUNT_TYPE_DEFAULT_RULES,
  ensureSourceLinesForPurchase,
  normalizeLoanPaymentSource,
  seedDefaultBankAccounts,
  seedDefaultPools
} from './financeModel';
import { calculateAgeFromBirthDate, formatCurrency, projectScenario, resolveCurrentAge } from './engine/projection';
import { parseBankImportFiles } from './importers/bankImport';
import { ageFromYearMonth, formatYearMonthFromAge } from './utils/ageDate';
import { loadAppState, saveAppState, type AppUiState, type CareersSubTab, type ExpensesSubTab } from './storage';
import type {
  AccountTypePreset,
  BankAccountDefinition,
  CashflowCategory,
  LegacyPoolId,
  LifeEventType,
  PoolDefinition,
  NetWorthCustomAccount,
  NetWorthHistoryEntry,
  NetWorthHistoryAccountSnapshot,
  NetWorthImportRecord,
  NetWorthImportApplyMode,
  NetWorthImportSourceAccount,
  ProjectionYear,
  Scenario,
  SavingsBalances,
  SourceLine
} from './types';

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
  { id: 'loans', label: 'Loans' }
];
const EXPENSES_SUB_TABS: Array<{ id: ExpensesTab; label: string }> = [
  { id: 'planning', label: 'Expense Planning' },
  { id: 'tracking', label: 'Expense Tracking' }
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

const EVENT_OPTIONS: Array<{ type: LifeEventType; label: string }> = [
  { type: 'job_change', label: 'Job Change' },
  { type: 'career_break', label: 'Career Break' },
  { type: 'house_purchase', label: 'House Purchase' },
  { type: 'house_sale', label: 'House Sale' },
  { type: 'large_expense', label: 'Large Expense' },
  { type: 'custom_income', label: 'Custom Income' },
  { type: 'custom_expense', label: 'Custom Expense' }
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
      const startAge = previous.endAge;
      const previousEndYearMonth = normalizeYearMonth(previous.endYearMonth) || formatYearMonthFromAge(startAge, dateOfBirth, currentAge);

      normalized.push({
        ...base,
        useBirthdayBasedStartAge: false,
        startAge,
        endAge: Math.max(base.endAge, startAge),
        startYearMonth: previousEndYearMonth
      });
      return;
    }

    normalized.push(base);
  });

  return normalized;
};

const makeCareerId = () => `career-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeCustomNetWorthAccountId = () => `custom-networth-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makePoolId = () => `pool-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeBankAccountId = () => `bank-account-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeExpenseImportSourceId = () => `expense-import-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeExpenseImportBatchId = () => `expense-import-batch-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeExpenseEntryId = () => `expense-entry-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
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
const normalizeNetWorthImportRecord = (record: Partial<NetWorthImportRecord>, index: number): NetWorthImportRecord => ({
  id: typeof record.id === 'string' && record.id.trim().length > 0 ? record.id : `networth-import-${index + 1}`,
  fileName: typeof record.fileName === 'string' && record.fileName.trim().length > 0 ? record.fileName : `import-${index + 1}.csv`,
  fileType: record.fileType === 'csv' || record.fileType === 'pdf' ? record.fileType : 'unknown',
  previewText: typeof record.previewText === 'string' ? record.previewText : '',
  detectedAccountId: typeof record.detectedAccountId === 'string' && record.detectedAccountId.trim().length > 0 ? record.detectedAccountId : null,
  detectedBalance:
    typeof record.detectedBalance === 'number' && Number.isFinite(record.detectedBalance) ? record.detectedBalance : null,
  statementDate: normalizeImportDate(record.statementDate),
  selectedAccountId: typeof record.selectedAccountId === 'string' && record.selectedAccountId.trim().length > 0 ? record.selectedAccountId : null,
  status:
    record.status === 'ready' || record.status === 'needs_review' || record.status === 'error' || record.status === 'applied'
      ? record.status
      : 'needs_review',
  confidence: typeof record.confidence === 'number' && Number.isFinite(record.confidence) ? Math.min(1, Math.max(0, record.confidence)) : 0,
  parseNotes: Array.isArray(record.parseNotes) ? record.parseNotes.filter((note): note is string => typeof note === 'string') : [],
  applyMode: record.applyMode === 'net_worth_and_expenses' || record.applyMode === 'net_worth_only' ? record.applyMode : 'net_worth_only',
  applied: Boolean(record.applied),
  appliedAt: normalizeImportDate(record.appliedAt)
});
const parseCsvPreview = (text: string) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return [] as string[][];
  }

  const parseLine = (line: string) => {
    const cells: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === ',' && !inQuotes) {
        cells.push(current.trim());
        current = '';
        continue;
      }
      current += char;
    }
    cells.push(current.trim());
    return cells;
  };

  return lines.map(parseLine);
};
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
const confirmAction = (message: string) => {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
    return true;
  }
  try {
    const result = window.confirm(message);
    return typeof result === 'boolean' ? result : true;
  } catch {
    return true;
  }
};

const ControlRow = ({
  label,
  value,
  min,
  max,
  step = 1,
  disabled = false,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
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
      <span>{label}</span>
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

  const parsed = new Date(value);

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
const sumAccountBalances = (balances: Scenario['savingsTracker']['annualInterestRates']) =>
  balances.emergencyFund + balances.hsa + balances.investments + balances.retirement401k;
const sumPurchaseSourceLineAmounts = (sourceLines: SourceLine[]) =>
  sourceLines.reduce((sum, line) => sum + (line.enabled && line.mode === 'amount' ? Math.max(0, line.amount) : 0), 0);
const toLegacySourceAmounts = (
  sourceLines: SourceLine[] | undefined,
  accountsById: ReadonlyMap<string, BankAccountDefinition>
): SavingsBalances => {
  const legacy: SavingsBalances = { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 };
  if (!sourceLines) {
    return legacy;
  }

  sourceLines.forEach((line) => {
    if (!line.enabled || line.mode !== 'amount') {
      return;
    }

    if (line.sourceType === 'pool') {
      if (line.sourceId === 'emergencyFund' || line.sourceId === 'hsa' || line.sourceId === 'investments' || line.sourceId === 'retirement401k') {
        legacy[line.sourceId] += Math.max(0, line.amount);
      }
      return;
    }

    if (line.sourceType === 'account') {
      const account = accountsById.get(line.sourceId);
      if (
        account &&
        (account.poolId === 'emergencyFund' ||
          account.poolId === 'hsa' ||
          account.poolId === 'investments' ||
          account.poolId === 'retirement401k')
      ) {
        legacy[account.poolId] += Math.max(0, line.amount);
      }
    }
  });

  return legacy;
};
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
  const normalizedLines = ensureSourceLinesForPurchase(purchase, bankAccounts);
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
        monthlyWithdrawal: Math.max(0, toNumberOrFallback(source?.monthlyWithdrawal, 0))
      };
    });
};
const isLegacyPoolKey = (value: string): value is LegacyPoolId =>
  value === 'emergencyFund' || value === 'hsa' || value === 'investments' || value === 'retirement401k';

const App = () => {
  const [appState, setAppState] = useState(() => loadAppState());
  const [graphMode, setGraphMode] = useState<'portfolio' | 'savings'>('portfolio');
  const [isImportingNetWorthFiles, setIsImportingNetWorthFiles] = useState(false);
  const [netWorthHistoryRange, setNetWorthHistoryRange] = useState<NetWorthHistoryRange>('all');
  const [showNetWorthImportsModal, setShowNetWorthImportsModal] = useState(false);
  const [selectedNetWorthImportId, setSelectedNetWorthImportId] = useState<string | null>(null);
  const [expandedNetWorthImportIds, setExpandedNetWorthImportIds] = useState<string[]>([]);
  const [checkedNetWorthImportIds, setCheckedNetWorthImportIds] = useState<string[]>([]);
  const [showExpenseTrackerAccountConfig, setShowExpenseTrackerAccountConfig] = useState(false);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const scenario = appState.scenario;
  const inflationEnabled = scenario.manualReturns.inflationEnabled;
  const customNetWorthAccounts = scenario.netWorth.customAccounts ?? [];
  const poolDefinitions = (scenario.netWorth.pools ?? seedDefaultPools()).slice().sort((a, b) => a.priority - b.priority);
  const bankAccounts =
    scenario.netWorth.bankAccounts ?? seedDefaultBankAccounts(scenario.netWorth.accountBalances, scenario.savingsTracker.annualInterestRates);
  const netWorthImports = scenario.netWorth.imports ?? [];
  const pendingNetWorthImports = netWorthImports.filter((record) => !record.applied);
  const netWorthHistory = scenario.netWorth.history ?? [];
  const expenses = scenario.expenses;
  const netWorthImportAccounts: NetWorthImportSourceAccount[] = [
    ...bankAccounts.map((account) => ({
      id: account.id,
      label: account.label,
      balance: account.balance
    })),
    ...customNetWorthAccounts.map((account) => ({
      id: account.id,
      label: account.label,
      balance: account.balance
    }))
  ];
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
  const selectedCareerId = appState.ui.selectedCareerId || scenario.careerPlan.entries[0]?.id || '';
  const currentAge = resolveCurrentAge(scenario);
  const birthdayBasedCareerStartAge = resolveBirthdayBasedCareerStartAge(scenario);
  const retirementScenario: Scenario = {
    ...scenario,
    careerPlan: {
      ...scenario.careerPlan,
      enabled: false,
      entries: scenario.careerPlan.entries.map((entry) => ({ ...entry, enabled: false }))
    },
    lifeEvents: scenario.lifeEvents.filter((event) => event.type !== 'job_change' && event.type !== 'career_break')
  };
  const retirementProjection = projectScenario(retirementScenario);
  const futureScenario: Scenario = {
    ...scenario,
    profile: {
      ...scenario.profile,
      currentAge,
      retirementAge: scenario.futureRetirement.useCareerEndAge
        ? getCareerDerivedRetirementAge(scenario)
        : scenario.futureRetirement.retirementAge,
      retirementYears: scenario.futureRetirement.retirementYears
    }
  };
  const futureProjection = projectScenario(futureScenario);
  const hasEnabledCareers = futureScenario.careerPlan.entries.some((entry) => entry.enabled);
  const usesFinancePredictionResults = activeTab === 'careers' || activeTab === 'options';
  const projection = usesFinancePredictionResults ? futureProjection : retirementProjection;
  const graphProjection = projection;
  const hideResultsForPurchasesExpenses = activeTab === 'careers' && careersSubTab === 'purchasesExpenses';
  const hideResultsForExpenses = activeTab === 'expenses';
  const hideResultsPanel = hideResultsForPurchasesExpenses || hideResultsForExpenses;
  const displayedGraphYears = usesFinancePredictionResults && !hasEnabledCareers ? [] : graphProjection.years;
  const displayedPortfolioGraphYears =
    usesFinancePredictionResults
      ? displayedGraphYears.map((year) => ({
          ...year,
          endBalance: sumDynamicAccountBalances(year.accountBalancesById)
        }))
      : displayedGraphYears;
  const displayedTableYears =
    usesFinancePredictionResults
      ? (() => {
          let previousEndBalance: number | null = null;

          return projection.years.map((year) => {
            const endBalance = sumDynamicAccountBalances(year.accountBalancesById);
            const startBalance = previousEndBalance ?? endBalance;
            previousEndBalance = endBalance;

            return {
              ...year,
              startBalance,
              endBalance
            };
          });
        })()
      : projection.years;
  const graphYearsForMode = graphMode === 'portfolio' ? displayedPortfolioGraphYears : displayedGraphYears;
  const displayedGraphEndingBalance = graphYearsForMode.length > 0 ? graphYearsForMode[graphYearsForMode.length - 1].endBalance : 0;
  const displayedGraphEndAge = graphYearsForMode.length > 0 ? graphYearsForMode[graphYearsForMode.length - 1].age : currentAge;
  const displayedGraphDepleted = graphYearsForMode.some((year) => year.depleted);
  const displayedGraphDepletedAge = graphYearsForMode.find((year) => year.depleted)?.age ?? null;
  const displayedGraphSummary =
    usesFinancePredictionResults && !hasEnabledCareers
      ? 'No careers are selected for estimation. Enable at least one career to display projections.'
      : usesFinancePredictionResults
        ? displayedGraphDepleted && displayedGraphDepletedAge !== null
          ? `Your plan runs out of money at age ${displayedGraphDepletedAge}. Consider retiring later, saving more, or lowering withdrawals.`
          : `Congratulations! Based on your retirement plan, you can retire at age ${futureScenario.profile.retirementAge} and finish with ${formatCurrency(
              displayedGraphEndingBalance
            )} at age ${displayedGraphEndAge}.`
        : graphProjection.summary;
  const retirementFirstYearPlannedWithdrawals = retirementProjection.firstRetirementYearPlannedAccountWithdrawals;
  const retirementEndAge = scenario.profile.retirementAge + scenario.profile.retirementYears;
  const futureEndAge = futureScenario.profile.retirementAge + futureScenario.profile.retirementYears;
  const futureCareerAge = getCareerDerivedRetirementAge(scenario);
  const retirementAssetsFromCareers = scenario.careerPlan.entries.reduce((sum, entry) => {
    const careerBalances = futureProjection.careerEndSavingsBalances[entry.id];

    if (!careerBalances) {
      return sum;
    }

    return sum + sumSavingsBalances(careerBalances);
  }, 0);

  useEffect(() => {
    saveAppState({
      scenario,
      ui: {
        ...appState.ui,
        selectedCareerId
      }
    });
  }, [appState.ui, scenario, selectedCareerId]);

  useEffect(() => {
    if (selectedCareerId || scenario.careerPlan.entries.length === 0) {
      return;
    }

    setAppState((currentState) => ({
      ...currentState,
      ui: {
        ...currentState.ui,
        selectedCareerId: scenario.careerPlan.entries[0].id
      }
    }));
  }, [scenario.careerPlan.entries, selectedCareerId]);

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
    const equityAllocation = Math.min(Math.max(nextScenario.portfolio.equityAllocation, 0), 100);
    const fixedIncomeAllocation = 100 - equityAllocation;
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
      pools: (nextScenario.netWorth.pools ?? seedDefaultPools()).map((pool, index) => ({
        id: typeof pool.id === 'string' && pool.id.trim().length > 0 ? pool.id : `pool-${index + 1}`,
        label: typeof pool.label === 'string' && pool.label.trim().length > 0 ? pool.label : `Pool ${index + 1}`,
        enabled: pool.enabled !== false,
        priority: Math.max(0, Math.floor(toNumberOrFallback(pool.priority, index))),
        legacyFallbackId:
          pool.legacyFallbackId === 'emergencyFund' ||
          pool.legacyFallbackId === 'hsa' ||
          pool.legacyFallbackId === 'investments' ||
          pool.legacyFallbackId === 'retirement401k'
            ? pool.legacyFallbackId
            : undefined
      })),
      bankAccounts: (
        nextScenario.netWorth.bankAccounts ??
        seedDefaultBankAccounts(nextScenario.netWorth.accountBalances, nextScenario.savingsTracker.annualInterestRates)
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
        annualReturnRate: toNumberOrFallback(account.annualReturnRate, 0),
        balance: Math.max(0, toNumberOrFallback(account.balance, 0)),
        ruleOverrides: account.ruleOverrides ?? {}
      })),
      imports: (nextScenario.netWorth.imports ?? []).map((record, index) => normalizeNetWorthImportRecord(record, index)),
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
    const normalizedWithdrawalAccounts = {
      emergencyFund: Math.max(0, toNumberOrFallback(nextScenario.withdrawal.firstYearAccountWithdrawals?.emergencyFund, 0)),
      hsa: Math.max(0, toNumberOrFallback(nextScenario.withdrawal.firstYearAccountWithdrawals?.hsa, 0)),
      investments: Math.max(0, toNumberOrFallback(nextScenario.withdrawal.firstYearAccountWithdrawals?.investments, 0)),
      retirement401k: Math.max(0, toNumberOrFallback(nextScenario.withdrawal.firstYearAccountWithdrawals?.retirement401k, 0))
    };
    const normalizedWithdrawalFourPercentFlags = {
      emergencyFund: Boolean(nextScenario.withdrawal.firstYearAccountUseFourPercent?.emergencyFund),
      hsa: Boolean(nextScenario.withdrawal.firstYearAccountUseFourPercent?.hsa),
      investments: Boolean(nextScenario.withdrawal.firstYearAccountUseFourPercent?.investments),
      retirement401k: Boolean(nextScenario.withdrawal.firstYearAccountUseFourPercent?.retirement401k)
    };
    const existingWithdrawalLines = nextScenario.withdrawal.sourceLines ?? [];
    const legacyWithdrawalStartAges = {
      emergencyFund:
        existingWithdrawalLines.find((line) => line.sourceType === 'pool' && line.sourceId === 'emergencyFund')?.startAge ??
        nextScenario.profile.retirementAge,
      hsa:
        existingWithdrawalLines.find((line) => line.sourceType === 'pool' && line.sourceId === 'hsa')?.startAge ??
        nextScenario.profile.retirementAge,
      investments:
        existingWithdrawalLines.find((line) => line.sourceType === 'pool' && line.sourceId === 'investments')?.startAge ??
        nextScenario.profile.retirementAge,
      retirement401k:
        existingWithdrawalLines.find((line) => line.sourceType === 'pool' && line.sourceId === 'retirement401k')?.startAge ??
        nextScenario.profile.retirementAge
    };
    const normalizedWithdrawalSourceLines: SourceLine[] = [
        {
          id: 'withdrawal-emergency',
          enabled: true,
          sourceType: 'pool' as const,
          sourceId: 'emergencyFund',
          mode: normalizedWithdrawalFourPercentFlags.emergencyFund ? ('four_percent' as const) : ('amount' as const),
          amount: normalizedWithdrawalAccounts.emergencyFund,
          startAge: legacyWithdrawalStartAges.emergencyFund
        },
        {
          id: 'withdrawal-hsa',
          enabled: true,
          sourceType: 'pool' as const,
          sourceId: 'hsa',
          mode: normalizedWithdrawalFourPercentFlags.hsa ? ('four_percent' as const) : ('amount' as const),
          amount: normalizedWithdrawalAccounts.hsa,
          startAge: legacyWithdrawalStartAges.hsa
        },
        {
          id: 'withdrawal-investments',
          enabled: true,
          sourceType: 'pool' as const,
          sourceId: 'investments',
          mode: normalizedWithdrawalFourPercentFlags.investments ? ('four_percent' as const) : ('amount' as const),
          amount: normalizedWithdrawalAccounts.investments,
          startAge: legacyWithdrawalStartAges.investments
        },
        {
          id: 'withdrawal-401k',
          enabled: true,
          sourceType: 'pool' as const,
          sourceId: 'retirement401k',
          mode: normalizedWithdrawalFourPercentFlags.retirement401k ? ('four_percent' as const) : ('amount' as const),
          amount: normalizedWithdrawalAccounts.retirement401k,
          startAge: legacyWithdrawalStartAges.retirement401k
        }
      ].map((line, index): SourceLine => ({
      id: typeof line.id === 'string' && line.id.trim().length > 0 ? line.id : `withdrawal-source-${index + 1}`,
      enabled: line.enabled !== false,
      sourceType: line.sourceType,
      sourceId: typeof line.sourceId === 'string' ? line.sourceId : 'investments',
      mode: line.mode,
      amount: Math.max(0, toNumberOrFallback(line.amount, 0)),
      startAge: Math.min(110, Math.max(18, toNumberOrFallback(line.startAge, nextScenario.profile.retirementAge)))
    }));
    const normalizedUseRetirementAgeAsWithdrawalStartAge =
      nextScenario.withdrawal.useRetirementAgeAsWithdrawalStartAge !== undefined
        ? Boolean(nextScenario.withdrawal.useRetirementAgeAsWithdrawalStartAge)
        : true;
    const effectiveWithdrawalSourceLines = normalizedUseRetirementAgeAsWithdrawalStartAge
      ? normalizedWithdrawalSourceLines.map((line) => ({
          ...line,
          startAge: nextScenario.profile.retirementAge
        }))
      : normalizedWithdrawalSourceLines;
    const normalizedLargePurchases = (nextScenario.largePurchases ?? []).map((purchase) => {
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
      sourceAmounts: toLegacySourceAmounts(sourceLines, new Map((normalizedNetWorth.bankAccounts ?? []).map((account) => [account.id, account]))),
      sourceLines
    };
    });
    const normalizedLongTermPurchases = (nextScenario.longTermPurchases ?? []).map((purchase, index) => {
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
        sourceAmounts: toLegacySourceAmounts(sourceLines, new Map((normalizedNetWorth.bankAccounts ?? []).map((account) => [account.id, account]))),
        sourceLines
      };
    });
    const normalizedLoans = (nextScenario.loans ?? []).map((loan, index) => ({
      id: typeof loan.id === 'string' && loan.id.trim().length > 0 ? loan.id : `loan-${index + 1}`,
      label: typeof loan.label === 'string' && loan.label.trim().length > 0 ? loan.label : `Loan ${index + 1}`,
      enabled: Boolean(loan.enabled),
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
      paymentSource:
        normalizeLoanPaymentSource(loan, normalizedNetWorth.bankAccounts ?? []) as Scenario['loans'][number]['paymentSource']
    }));
    const normalizedCareerEntriesWithBankTargets = normalizedCareerEntries.map((entry) => ({
      ...entry,
      sourceLines: normalizeCareerSourceLinesForBankAccounts(entry, normalizedNetWorth.bankAccounts ?? [])
    }));

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
        withdrawal: {
          ...nextScenario.withdrawal,
          minimumYearlyWithdrawal: Math.max(0, toNumberOrFallback(nextScenario.withdrawal.minimumYearlyWithdrawal, 0)),
          maximumYearlyWithdrawal: Math.max(
            0,
            toNumberOrFallback(nextScenario.withdrawal.maximumYearlyWithdrawal, defaultScenario.withdrawal.maximumYearlyWithdrawal)
          ),
          useRetirementAgeAsWithdrawalStartAge: normalizedUseRetirementAgeAsWithdrawalStartAge,
          firstYearAmount: sumAccountBalances(normalizedWithdrawalAccounts),
          firstYearAccountWithdrawals: normalizedWithdrawalAccounts,
          firstYearAccountUseFourPercent: normalizedWithdrawalFourPercentFlags,
          sourceLines: effectiveWithdrawalSourceLines
        },
        largePurchases: normalizedLargePurchases,
        longTermPurchases: normalizedLongTermPurchases,
        loans: normalizedLoans,
        portfolio: {
          ...nextScenario.portfolio,
          equityAllocation,
          fixedIncomeAllocation
        }
      }
    }));
  };

  const updateSidebarTab = (nextTab: AppTab) => {
    setAppState((currentState) => ({
      ...currentState,
      ui: {
        ...currentState.ui,
        activeTab: nextTab,
        careersSubTab: nextTab === 'careers' && currentState.ui.activeTab !== 'careers' ? 'careers' : currentState.ui.careersSubTab
      }
    }));
  };

  const updateCareersSubTab = (nextSubTab: FinancePredictionSubTab) => {
    setAppState((currentState) => ({
      ...currentState,
      ui: {
        ...currentState.ui,
        careersSubTab: nextSubTab
      }
    }));
  };

  const resetScenario = () => {
    if (!window.confirm('Reset the scenario to default values? This will clear your current plan settings.')) {
      return;
    }

    setAppState({
      scenario: defaultScenario,
      ui: {
        activeTab: 'careers',
        selectedCareerId: defaultScenario.careerPlan.entries[0]?.id ?? '',
        careersSubTab: 'careers',
        expensesSubTab: 'planning'
      }
    });
  };

  const updateSelectedCareerId = (careerId: string) => {
    setAppState((currentState) => ({
      ...currentState,
      ui: {
        ...currentState.ui,
        selectedCareerId: careerId
      }
    }));
  };

  const updateCareer = (nextCareer: Scenario['careerPlan']['entries'][number]) => {
    updateScenario({
      ...scenario,
      careerPlan: {
        ...scenario.careerPlan,
        entries: scenario.careerPlan.entries.map((career) => (career.id === nextCareer.id ? nextCareer : career))
      }
    });
  };

  const addCareer = () => {
    const nextIndex = scenario.careerPlan.entries.length;
    const entry = createDefaultCareerEntry(nextIndex, currentAge, scenario.profile.retirementAge);

    updateScenario({
      ...scenario,
      careerPlan: {
        ...scenario.careerPlan,
        entries: [...scenario.careerPlan.entries, entry]
      }
    });
    updateSelectedCareerId(entry.id);
  };

  const removeCareer = (careerId: string) => {
    const remaining = scenario.careerPlan.entries.filter((career) => career.id !== careerId);

    updateScenario({
      ...scenario,
      careerPlan: {
        ...scenario.careerPlan,
        entries: remaining
      }
    });

    if (selectedCareerId === careerId) {
      updateSelectedCareerId(remaining[0]?.id ?? '');
    }
  };

  const duplicateCareer = (careerId: string) => {
    const sourceIndex = scenario.careerPlan.entries.findIndex((career) => career.id === careerId);

    if (sourceIndex < 0) {
      return;
    }

    const source = scenario.careerPlan.entries[sourceIndex];
    const duplicate = {
      ...source,
      id: makeCareerId(),
      label: `${source.label} Copy`
    };
    const nextEntries = [...scenario.careerPlan.entries];

    nextEntries.splice(sourceIndex + 1, 0, duplicate);

    updateScenario({
      ...scenario,
      careerPlan: {
        ...scenario.careerPlan,
        entries: nextEntries
      }
    });
    updateSelectedCareerId(duplicate.id);
  };

  const reorderCareers = (fromCareerId: string, toCareerId: string) => {
    if (fromCareerId === toCareerId) {
      return;
    }

    const fromIndex = scenario.careerPlan.entries.findIndex((career) => career.id === fromCareerId);
    const toIndex = scenario.careerPlan.entries.findIndex((career) => career.id === toCareerId);

    if (fromIndex < 0 || toIndex < 0) {
      return;
    }

    const nextEntries = [...scenario.careerPlan.entries];
    const [movingCareer] = nextEntries.splice(fromIndex, 1);

    nextEntries.splice(toIndex, 0, movingCareer);

    updateScenario({
      ...scenario,
      careerPlan: {
        ...scenario.careerPlan,
        entries: nextEntries
      }
    });
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

  const toggleEventOption = (type: LifeEventType, checked: boolean) => {
    if (checked) {
      if (scenario.lifeEvents.some((event) => event.type === type)) {
        return;
      }

      updateScenario({
        ...scenario,
        lifeEvents: [...scenario.lifeEvents, createDefaultLifeEvent(type, currentAge, scenario.profile.retirementAge)]
      });
      return;
    }

    updateScenario({
      ...scenario,
      lifeEvents: scenario.lifeEvents.filter((event) => event.type !== type)
    });
  };

  const addLargePurchase = () => {
    const entry = createDefaultLargePurchase(currentAge, scenario.options.dateOfBirth);

    updateScenario({
      ...scenario,
      largePurchases: [...scenario.largePurchases, entry]
    });
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
      sourceLines: nextSourceLines,
      sourceAmounts: toLegacySourceAmounts(nextSourceLines, bankAccountById)
    };
  };

  const updateLargePurchase = (purchaseId: string, nextPurchase: Scenario['largePurchases'][number]) => {
    updateScenario({
      ...scenario,
      largePurchases: scenario.largePurchases.map((purchase) => (purchase.id === purchaseId ? nextPurchase : purchase))
    });
  };

  const removeLargePurchase = (purchaseId: string) => {
    updateScenario({
      ...scenario,
      largePurchases: scenario.largePurchases.filter((purchase) => purchase.id !== purchaseId)
    });
  };

  const addLongTermPurchase = () => {
    const entry = createDefaultLongTermPurchase(currentAge, scenario.options.dateOfBirth);

    updateScenario({
      ...scenario,
      longTermPurchases: [...(scenario.longTermPurchases ?? []), entry]
    });
  };

  const updateLongTermPurchase = (
    purchaseId: string,
    nextPurchase: Scenario['longTermPurchases'][number]
  ) => {
    updateScenario({
      ...scenario,
      longTermPurchases: (scenario.longTermPurchases ?? []).map((purchase) =>
        purchase.id === purchaseId ? nextPurchase : purchase
      )
    });
  };

  const removeLongTermPurchase = (purchaseId: string) => {
    updateScenario({
      ...scenario,
      longTermPurchases: (scenario.longTermPurchases ?? []).filter((purchase) => purchase.id !== purchaseId)
    });
  };

  const addLoan = () => {
    const entry = createDefaultLoan(currentAge, scenario.options.dateOfBirth);

    updateScenario({
      ...scenario,
      loans: [...(scenario.loans ?? []), entry]
    });
  };

  const updateLoan = (loanId: string, nextLoan: Scenario['loans'][number]) => {
    updateScenario({
      ...scenario,
      loans: (scenario.loans ?? []).map((loan) => (loan.id === loanId ? nextLoan : loan))
    });
  };

  const removeLoan = (loanId: string) => {
    updateScenario({
      ...scenario,
      loans: (scenario.loans ?? []).filter((loan) => loan.id !== loanId)
    });
  };

  const addPool = () => {
    const nextPool: PoolDefinition = {
      id: makePoolId(),
      label: `Pool ${poolDefinitions.length + 1}`,
      enabled: true,
      priority: poolDefinitions.length
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
      annualReturnRate: 5,
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
            ? {
                ...account,
                ...changes,
                ruleOverrides: {
                  ...(account.ruleOverrides ?? {}),
                  ...(changes.ruleOverrides ?? {})
                }
              }
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

  const updateNetWorthImportRecord = (recordId: string, changes: Partial<NetWorthImportRecord>) => {
    updateScenario({
      ...scenario,
      netWorth: {
        ...scenario.netWorth,
        imports: netWorthImports.map((record) => (record.id === recordId ? { ...record, ...changes } : record))
      }
    });
  };

  const toggleExpandedNetWorthImport = (recordId: string) => {
    setExpandedNetWorthImportIds((current) => (current.includes(recordId) ? current.filter((id) => id !== recordId) : [recordId]));
    setSelectedNetWorthImportId(recordId);
  };

  const appendNetWorthImports = (records: NetWorthImportRecord[]) => {
    if (records.length === 0) {
      return;
    }

    updateScenario({
      ...scenario,
      netWorth: {
        ...scenario.netWorth,
        imports: [...netWorthImports, ...records]
      }
    });
    setSelectedNetWorthImportId(records[0]?.id ?? null);
    setExpandedNetWorthImportIds([]);
    setCheckedNetWorthImportIds((current) => [...new Set([...current, ...records.map((record) => record.id)])]);
  };

  useEffect(() => {
    const pendingIds = new Set(pendingNetWorthImports.map((record) => record.id));
    setCheckedNetWorthImportIds((current) => {
      const next = current.filter((id) => pendingIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [pendingNetWorthImports]);

  const handleNetWorthImportInput = async (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = '';

    if (selectedFiles.length === 0) {
      return;
    }

    setIsImportingNetWorthFiles(true);
    try {
      const parsed = await parseBankImportFiles(selectedFiles, netWorthImportAccounts);
      appendNetWorthImports(parsed);
    } finally {
      setIsImportingNetWorthFiles(false);
    }
  };

  const promptImportFiles = () => {
    if (filesInputRef.current) {
      filesInputRef.current.value = '';
      filesInputRef.current.click();
    }
  };

  const promptImportFolder = () => {
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
      folderInputRef.current.click();
    }
  };

  const applyImportedRecords = (recordIds: string[]) => {
    const recordsToApply = netWorthImports.filter((record) => recordIds.includes(record.id));
    if (recordsToApply.length === 0) {
      return;
    }

    const nextAccountBalances = { ...scenario.netWorth.accountBalances };
    let nextBankAccounts = [...bankAccounts];
    let nextCustomAccounts = [...customNetWorthAccounts];
    let nextExpenseImports = [...(scenario.expenses.imports ?? [])];
    let nextExpenseEntries = [...(scenario.expenses.entries ?? [])];
    const todayIso = getTodayIsoDate();
    const appliedDates: string[] = [];

    const nextImports = netWorthImports.map((record) => {
      const shouldApply = recordIds.includes(record.id);
      const selectedAccountId = record.selectedAccountId;
      const detectedBalance = record.detectedBalance;
      if (!shouldApply || !selectedAccountId || detectedBalance === null || !record.statementDate) {
        return record;
      }

      const matchedBankAccount = nextBankAccounts.find((account) => account.id === selectedAccountId);
      if (matchedBankAccount) {
        nextBankAccounts = nextBankAccounts.map((account) =>
          account.id === selectedAccountId ? { ...account, balance: Math.max(0, detectedBalance) } : account
        );
      } else {
        const mappedBankAccountId = getDefaultBankAccountIdForPool(nextBankAccounts, selectedAccountId);
        if (mappedBankAccountId) {
          nextBankAccounts = nextBankAccounts.map((account) =>
            account.id === mappedBankAccountId ? { ...account, balance: Math.max(0, detectedBalance) } : account
          );
        } else {
          nextCustomAccounts = nextCustomAccounts.map((account) =>
            account.id === selectedAccountId
              ? {
                  ...account,
                  balance: Math.max(0, detectedBalance)
                }
              : account
          );
        }
      }

      const appliedDate = record.statementDate || todayIso;
      appliedDates.push(appliedDate);

      if (record.applyMode === 'net_worth_and_expenses') {
        const expenseSourceId = makeExpenseImportSourceId();
        const expenseBatchId = makeExpenseImportBatchId();
        const normalizedAmount = Math.max(0, detectedBalance);
        const matchedPoolId = nextBankAccounts.find((account) => account.id === selectedAccountId)?.poolId ?? null;

        nextExpenseImports.push({
          id: expenseSourceId,
          batchId: expenseBatchId,
          fileName: record.fileName,
          fileType: record.fileType === 'csv' || record.fileType === 'pdf' ? record.fileType : 'unknown',
          previewText: record.previewText,
          status: 'needs_review',
          parseNotes: [
            'Generated from net worth import with "Net Worth + Expenses" enabled.',
            'Review and adjust imported expense placeholder entry as needed.'
          ],
          confidence: record.confidence,
          importedAt: todayIso,
          appliedAt: todayIso,
          entryIds: []
        });

        const expenseEntryId = makeExpenseEntryId();
        nextExpenseEntries.push({
          id: expenseEntryId,
          label: `${record.fileName} (Statement Import)`,
          amount: normalizedAmount,
          startDate: appliedDate,
          endDate: appliedDate,
          accountId: selectedAccountId,
          poolId: matchedPoolId,
          notes: 'Auto-created from net worth import. Edit as needed.',
          originType: 'imported',
          importSourceId: expenseSourceId,
          importBatchId: expenseBatchId,
          createdAt: todayIso,
          updatedAt: todayIso,
          categoryId: null
        });
        nextExpenseImports = nextExpenseImports.map((source) =>
          source.id === expenseSourceId ? { ...source, entryIds: [...source.entryIds, expenseEntryId] } : source
        );
      }

      return {
        ...record,
        status: 'applied' as const,
        applied: true,
        appliedAt: todayIso
      };
    });

    const persistedImports = nextImports.filter((record) => {
      if (record.applied) {
        return true;
      }
      const hasNetWorthSelection = Boolean(record.selectedAccountId) && record.detectedBalance !== null && Boolean(record.statementDate);
      return hasNetWorthSelection && record.applyMode === 'net_worth_and_expenses';
    });

    const latestAppliedDate = appliedDates.length > 0 ? appliedDates.sort().slice(-1)[0] : todayIso;

    updateNetWorthWithHistory(
      {
        ...scenario.netWorth,
        accountBalances: nextAccountBalances,
        bankAccounts: nextBankAccounts,
        customAccounts: nextCustomAccounts,
        imports: persistedImports,
        asOfDate: latestAppliedDate
      },
      { logDate: latestAppliedDate, forceLog: true }
    );

    if (nextExpenseImports.length !== scenario.expenses.imports.length || nextExpenseEntries.length !== scenario.expenses.entries.length) {
      setAppState((currentState) => ({
        ...currentState,
        scenario: {
          ...currentState.scenario,
          expenses: {
            ...currentState.scenario.expenses,
            imports: nextExpenseImports,
            entries: nextExpenseEntries
          }
        }
      }));
    }
  };

  const applyImportedRecord = (recordId: string) => {
    const record = netWorthImports.find((item) => item.id === recordId);
    if (!record) {
      return;
    }
    const selectedLabel =
      netWorthImportAccounts.find((account) => account.id === record.selectedAccountId)?.label ?? 'Unmatched account';
    const statementLabel = record.statementDate ? formatShortDate(record.statementDate) : 'missing statement date';
    const shouldApply = confirmAction(
      `Confirm import for "${record.fileName}"?\nAccount: ${selectedLabel}\nBalance: ${record.detectedBalance ?? 'missing'}\nDate: ${statementLabel}`
    );
    if (!shouldApply) {
      return;
    }
    applyImportedRecords([recordId]);
  };

  const applyAllReadyImports = () => {
    const recordIds = netWorthImports
      .filter((record) => !record.applied && record.selectedAccountId && record.detectedBalance !== null && record.statementDate)
      .map((record) => record.id);
    if (recordIds.length === 0) {
      return;
    }
    const shouldApplyAll = confirmAction(`Confirm import for ${recordIds.length} selected report(s)?`);
    if (!shouldApplyAll) {
      return;
    }
    applyImportedRecords(recordIds);
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
        startAge: scenario.profile.retirementAge
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
    changes: Partial<{ mode: 'amount' | 'four_percent'; amount: number; enabled: boolean; startAge: number }>
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
      startAge: scenario.profile.retirementAge
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

    let nextLegacyWithdrawals = { ...scenario.withdrawal.firstYearAccountWithdrawals };
    let nextLegacyFlags = { ...scenario.withdrawal.firstYearAccountUseFourPercent };
    if (isLegacyPoolKey(poolId)) {
      nextLegacyWithdrawals = {
        ...nextLegacyWithdrawals,
        [poolId]: Math.max(0, toNumberOrFallback(nextLine.amount, 0))
      };
      nextLegacyFlags = {
        ...nextLegacyFlags,
        [poolId]: nextLine.mode === 'four_percent'
      };
    }

    updateScenario({
      ...scenario,
      withdrawal: {
        ...scenario.withdrawal,
        sourceLines: nextLines,
        firstYearAccountWithdrawals: nextLegacyWithdrawals,
        firstYearAccountUseFourPercent: nextLegacyFlags,
        firstYearAmount: Object.values(nextLegacyWithdrawals).reduce((sum, value) => sum + value, 0)
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
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={scenario.options.useDateBasedAge}
              onChange={(event) =>
                updateScenario({
                  ...scenario,
                  options: {
                    ...scenario.options,
                    useDateBasedAge: event.target.checked
                  }
                })
              }
            />
            <span>Make current age based on date of birth</span>
          </label>
          {!forCareerRetirementItem ? (
            <ControlRow
              label="Current Age"
              value={currentAge}
              min={18}
              max={100}
              disabled={scenario.options.useDateBasedAge}
              onChange={(value) =>
                updateScenario({
                  ...scenario,
                  profile: { ...scenario.profile, currentAge: value }
                })
              }
            />
          ) : null}
          {scenario.options.useDateBasedAge ? (
            <p className="subtle">Current age is derived from the date of birth set in Options.</p>
          ) : null}
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
          label="Inflation %"
          value={scenario.manualReturns.inflationRate}
          min={-2}
          max={15}
          step={0.1}
          disabled={!inflationEnabled}
          onChange={(value) =>
            updateScenario({
              ...scenario,
              manualReturns: { ...scenario.manualReturns, inflationRate: value }
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
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={scenario.withdrawal.useRetirementAgeAsWithdrawalStartAge !== false}
            onChange={(event) =>
              updateScenario({
                ...scenario,
                withdrawal: {
                  ...scenario.withdrawal,
                  useRetirementAgeAsWithdrawalStartAge: event.target.checked,
                  sourceLines: event.target.checked
                    ? (scenario.withdrawal.sourceLines ?? []).map((line) =>
                        line.sourceType === 'pool'
                          ? {
                              ...line,
                              startAge: scenario.profile.retirementAge
                            }
                          : line
                      )
                    : scenario.withdrawal.sourceLines
                }
              })
            }
          />
          <span>Use retirement age as withdrawal start age</span>
        </label>
        <div className="career-savings-grid">
          <div className="career-savings-row career-savings-header">
            <div className="career-savings-cell">Pool</div>
            <div className="career-savings-cell">Start Age</div>
            <div className="career-savings-cell">Use 4% Rule</div>
            <div className="career-savings-cell">First Year Withdrawal</div>
          </div>
          {retirementPoolRows.map(({ pool, sourceLine, plannedValue }) => (
            <div key={pool.id} className="career-savings-row">
              <div className="career-savings-cell">{pool.label}</div>
              <div className="career-savings-cell">
                <BufferedNumberInput
                  value={sourceLine.startAge ?? scenario.profile.retirementAge}
                  min={18}
                  max={110}
                  step={1}
                  disabled={scenario.withdrawal.useRetirementAgeAsWithdrawalStartAge !== false}
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
            </div>
          ))}
        </div>
        <p className="subtle">Pool APY is managed through underlying bank accounts in Net Worth.</p>
            </>
          );
        })()}
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={scenario.withdrawal.inflationAdjusted}
            disabled={!inflationEnabled}
            onChange={(event) =>
              updateScenario({
                ...scenario,
                withdrawal: { ...scenario.withdrawal, inflationAdjusted: event.target.checked }
              })
            }
          />
          <span>Adjust expenses for inflation</span>
        </label>
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
                inflationControlsDisabled={!inflationEnabled}
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
    </>
  );

  const renderCareersTab = () => (
    <>
      <Panel title="Career Timeline" className="panel-wide">
        <CareerPlanEditor
          value={scenario.careerPlan}
          selectedCareerId={selectedCareerId}
          isRetirementSelected={false}
          showRetirementItem={false}
          onSelectRetirementItem={() => {}}
          onSelectCareer={updateSelectedCareerId}
        onChangeCareer={updateCareer}
        onDuplicateCareer={duplicateCareer}
        onReorderCareers={reorderCareers}
        onChangeBankAccountReturn={(accountId, rate) => updateBankAccount(accountId, { annualReturnRate: rate })}
        onAddCareer={addCareer}
        onRemoveCareer={removeCareer}
        previewYear={
          futureProjection.years.find((year) => !year.isBaselineNow && year.age === currentAge + 1) ??
          futureProjection.years.find((year) => !year.isBaselineNow) ??
          futureProjection.years[0]
        }
        bankAccounts={bankAccounts}
        birthdayBasedCareerStartAge={birthdayBasedCareerStartAge}
        dateOfBirth={scenario.options.dateOfBirth}
        currentAge={currentAge}
      />
      </Panel>
    </>
  );

  const renderPurchasesTab = () => (
    <>
      <Panel title="Large Purchases Table" className="panel-wide">
        <div className="career-actions">
          <button type="button" className="secondary-button" onClick={addLargePurchase}>
            + Purchase
          </button>
        </div>
        {scenario.largePurchases.length === 0 ? (
          <p className="subtle">Add a purchase with year-month, value, and source amounts per account.</p>
        ) : (
          <div className="table-wrap">
            <table className="purchases-table">
              <thead>
                <tr>
                  <th title="Enabled">Enabled</th>
                  <th>Name</th>
                  <th title="Year-Month">Year-Month</th>
                  {orderedBankAccounts.map((account) => (
                    <th
                      key={`large-purchase-account-header-${account.id}`}
                      title={`${account.label} (${poolLabelById.get(account.poolId) ?? account.poolId})`}
                    >
                      {account.label}
                    </th>
                  ))}
                  <th title="Difference">Difference</th>
                  <th title="Remove">Remove</th>
                </tr>
              </thead>
              <tbody>
                {scenario.largePurchases.map((purchase) => {
                  const purchaseSourceLines = normalizePurchaseSourceLinesForAccounts(purchase);
                  const sourceAmountByAccountId = new Map(
                    purchaseSourceLines.map((line) => [line.sourceId, Math.max(0, line.amount)])
                  );
                  const totalSources = sumPurchaseSourceLineAmounts(purchaseSourceLines);
                  const difference = purchase.amount - totalSources;
                  const sourceMismatch = Math.abs(difference) > 0.01;
                  const fundingShortfall = futureProjection.purchaseFundingShortfalls[purchase.id] ?? 0;
                  const hasFundingShortfall = fundingShortfall > 0.01;
                  const purchaseNotViable = purchase.enabled && (sourceMismatch || hasFundingShortfall);
                  const firstAffordableAge = futureProjection.purchaseFirstAffordableAge[purchase.id] ?? null;
                  const firstAffordableYearMonth =
                    firstAffordableAge !== null
                      ? formatYearMonthFromAge(firstAffordableAge, scenario.options.dateOfBirth, currentAge)
                      : null;
                  const hasNextAffordableDate = firstAffordableAge !== null && firstAffordableAge > purchase.age;
                  const nonViableTitle = (() => {
                    if (!purchaseNotViable) {
                      return undefined;
                    }

                    const details: string[] = [];

                    if (sourceMismatch) {
                      details.push('Not viable: amount does not match source totals.');
                    }

                    if (hasFundingShortfall) {
                      details.push('Not viable: one or more source accounts cannot fund the requested amount.');
                      details.push(
                        hasNextAffordableDate
                          ? `First affordable date: ${firstAffordableYearMonth}.`
                          : 'No affordable future date found in the current projection window.'
                      );
                    }

                    return details.join(' ');
                  })();

                  return (
                    <tr
                      key={purchase.id}
                      className={purchaseNotViable ? 'purchase-row invalid' : 'purchase-row'}
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
                          type="text"
                          value={purchase.label}
                          onChange={(event) => updateLargePurchase(purchase.id, { ...purchase, label: event.target.value })}
                        />
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
                      {orderedBankAccounts.map((account) => (
                        <td key={`${purchase.id}-${account.id}`}>
                          <BufferedNumberInput
                            value={sourceAmountByAccountId.get(account.id) ?? 0}
                            min={0}
                            max={50000000}
                            step={100}
                            onCommit={(next) => {
                              const updatedSources = withUpdatedPurchaseAccountAmount(purchase, account.id, next);
                              updateLargePurchase(purchase.id, {
                                ...purchase,
                                ...updatedSources
                              });
                            }}
                          />
                        </td>
                      ))}
                      <td>{formatCurrency(difference)}</td>
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
        <p className="subtle purchases-legend">
          Difference = Purchase Amount - Sum of account source totals.
        </p>
      </Panel>

      <Panel title="Long-Term Purchases (Monthly)" className="panel-wide">
        <div className="career-actions">
          <button type="button" className="secondary-button" onClick={addLongTermPurchase}>
            + Long-Term Purchase
          </button>
        </div>
        {(scenario.longTermPurchases ?? []).length === 0 ? (
          <p className="subtle">Add long-term purchases with monthly spending from selected accounts.</p>
        ) : (
          <div className="table-wrap">
            <table className="purchases-table">
              <thead>
                <tr>
                  <th>Enabled</th>
                  <th>Name</th>
                  <th>Start</th>
                  <th>Duration (Months)</th>
                  <th>End Date</th>
                  {orderedBankAccounts.map((account) => (
                    <th
                      key={`long-term-account-header-${account.id}`}
                      title={`${account.label} (${poolLabelById.get(account.poolId) ?? account.poolId})`}
                    >
                      {account.label}
                    </th>
                  ))}
                  <th>Difference</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {(scenario.longTermPurchases ?? []).map((purchase) => {
                  const purchaseSourceLines = normalizePurchaseSourceLinesForAccounts(purchase);
                  const sourceAmountByAccountId = new Map(
                    purchaseSourceLines.map((line) => [line.sourceId, Math.max(0, line.amount)])
                  );
                  const monthlySources = sumPurchaseSourceLineAmounts(purchaseSourceLines);
                  const difference = purchase.monthlyAmount - monthlySources;
                  const sourceMismatch = Math.abs(difference) > 0.01;
                  const fundingShortfall = futureProjection.longTermPurchaseFundingShortfalls[purchase.id] ?? 0;
                  const hasFundingShortfall = fundingShortfall > 0.01;
                  const purchaseNotViable = purchase.enabled && (sourceMismatch || hasFundingShortfall);
                  const title = purchaseNotViable
                    ? sourceMismatch
                      ? 'Not viable: monthly amount does not match source totals.'
                      : 'Not viable: one or more selected accounts cannot sustain this monthly purchase plan.'
                    : undefined;

                  return (
                    <tr key={purchase.id} className={purchaseNotViable ? 'purchase-row invalid' : 'purchase-row'} title={title}>
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
                      {orderedBankAccounts.map((account) => (
                        <td key={`${purchase.id}-${account.id}`}>
                          <BufferedNumberInput
                            value={sourceAmountByAccountId.get(account.id) ?? 0}
                            min={0}
                            max={1000000}
                            step={10}
                            onCommit={(next) => {
                              const updatedSources = withUpdatedPurchaseAccountAmount(purchase, account.id, next);
                              updateLongTermPurchase(purchase.id, {
                                ...purchase,
                                ...updatedSources
                              });
                            }}
                          />
                        </td>
                      ))}
                      <td>{formatCurrency(difference)}</td>
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
          Difference = Monthly Amount - Sum of monthly source totals. End can be defined by duration or explicit end date.
        </p>
      </Panel>
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

  const renderLoansTab = () => (
    <Panel title="Loans Table" className="panel-wide">
      <div className="career-actions">
        <button type="button" className="secondary-button" onClick={addLoan}>
          + Loan
        </button>
      </div>
      {(scenario.loans ?? []).length === 0 ? (
        <p className="subtle">Add loans to track balances, rates, payments, and payment source accounts.</p>
      ) : (
        <div className="table-wrap">
          <table className="purchases-table">
            <thead>
              <tr>
                <th>Enabled</th>
                <th>Name</th>
                <th>Start</th>
                <th>Original Amount</th>
                <th>Down Payment</th>
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
              {(scenario.loans ?? []).map((loan) => {
                const totalMonthlyPayment = loan.minimumMonthlyPayment + loan.extraMonthlyPayment;
                const payoffMonths = estimateLoanPayoffMonths(loan.currentBalance, loan.annualInterestRate, totalMonthlyPayment);
                const fundingShortfall = futureProjection.loanFundingShortfalls[loan.id] ?? 0;
                const loanNotViable = loan.enabled && fundingShortfall > 0.01;
                const title = loanNotViable
                  ? 'Not viable: selected payment source account cannot fund this loan without running empty.'
                  : undefined;

                return (
                  <tr key={loan.id} className={loanNotViable ? 'purchase-row invalid' : 'purchase-row'} title={title}>
                    <td>
                      <input
                        type="checkbox"
                        checked={loan.enabled}
                        onChange={(event) => updateLoan(loan.id, { ...loan, enabled: event.target.checked })}
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
  );

  const renderTimelineManagementTab = () => (
    <></>
  );

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
        </div>
        <div className="table-wrap">
          <table className="purchases-table">
            <thead>
              <tr>
                <th>Pool</th>
                <th>Enabled</th>
                <th>Priority</th>
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
                <th>APY %</th>
                <th>Balance</th>
                <th>Tax %</th>
                <th>Penalty %</th>
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
                          accountType: event.target.value as AccountTypePreset,
                          ruleOverrides: {
                            taxRate: ACCOUNT_TYPE_DEFAULT_RULES[event.target.value as AccountTypePreset]?.taxRate ?? 0,
                            penaltyRate: ACCOUNT_TYPE_DEFAULT_RULES[event.target.value as AccountTypePreset]?.penaltyRate ?? 0
                          }
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
                      value={account.annualReturnRate}
                      min={-20}
                      max={40}
                      step={0.1}
                      onCommit={(next) => updateBankAccount(account.id, { annualReturnRate: next })}
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
                    <BufferedNumberInput
                      value={
                        typeof account.ruleOverrides?.taxRate === 'number'
                          ? account.ruleOverrides.taxRate
                          : ACCOUNT_TYPE_DEFAULT_RULES[account.accountType].taxRate
                      }
                      min={0}
                      max={60}
                      step={0.1}
                      onCommit={(next) =>
                        updateBankAccount(account.id, { ruleOverrides: { ...(account.ruleOverrides ?? {}), taxRate: next } })
                      }
                    />
                  </td>
                  <td>
                    <BufferedNumberInput
                      value={
                        typeof account.ruleOverrides?.penaltyRate === 'number'
                          ? account.ruleOverrides.penaltyRate
                          : ACCOUNT_TYPE_DEFAULT_RULES[account.accountType].penaltyRate
                      }
                      min={0}
                      max={60}
                      step={0.1}
                      onCommit={(next) =>
                        updateBankAccount(account.id, {
                          ruleOverrides: { ...(account.ruleOverrides ?? {}), penaltyRate: next }
                        })
                      }
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

        <div className="career-actions networth-import-actions">
          <input
            ref={filesInputRef}
            data-testid="networth-import-files-input"
            type="file"
            multiple
            accept=".csv,.pdf"
            onChange={handleNetWorthImportInput}
            style={{ display: 'none' }}
          />
          <input
            ref={folderInputRef}
            data-testid="networth-import-folder-input"
            type="file"
            multiple
            accept=".csv,.pdf"
            onChange={handleNetWorthImportInput}
            style={{ display: 'none' }}
            {...({ webkitdirectory: '' } as unknown as Record<string, string>)}
          />
          <button type="button" className="secondary-button" onClick={promptImportFiles}>
            Import Files
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setShowNetWorthImportsModal(true);
              setExpandedNetWorthImportIds([]);
              promptImportFolder();
            }}
          >
            Import Folder
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              setShowNetWorthImportsModal(true);
              setExpandedNetWorthImportIds([]);
              if (!selectedNetWorthImportId && pendingNetWorthImports.length > 0) {
                setSelectedNetWorthImportId(pendingNetWorthImports[0].id);
              }
            }}
          >
            Manage Imports
          </button>
          <button type="button" className="secondary-button" onClick={applyAllReadyImports}>
            Apply Selected
          </button>
          {isImportingNetWorthFiles ? <p className="subtle">Importing files...</p> : null}
        </div>
        {pendingNetWorthImports.length > 0 ? (
          <div className="networth-import-list">
            {pendingNetWorthImports.map((record) => {
              const selectedAccountLabel =
                netWorthImportAccounts.find((account) => account.id === record.selectedAccountId)?.label ?? 'Unmatched';
              const canApply =
                !record.applied && Boolean(record.selectedAccountId) && record.detectedBalance !== null && Boolean(record.statementDate);
              const statementDate = record.statementDate ? formatShortDate(record.statementDate) : 'Not detected';
              const accountBalanceText =
                record.detectedBalance === null ? 'Not detected' : formatCurrency(Math.max(0, record.detectedBalance));

              return (
                <div key={record.id} className="networth-import-item">
                  <div className="networth-import-item-row">
                    <div>
                      <strong>{selectedAccountLabel}</strong>
                    </div>
                    <div>
                      <span>Account Balance: </span>
                      <strong>{accountBalanceText}</strong>
                    </div>
                    <div>
                      <span>Statement Date: </span>
                      <strong>{statementDate}</strong>
                    </div>
                  </div>
                  <div className="networth-import-item-row">
                    <label>
                      <span>Assign Account</span>
                      <select
                        value={record.selectedAccountId ?? ''}
                        onChange={(event) =>
                          updateNetWorthImportRecord(record.id, {
                            selectedAccountId: event.target.value || null,
                            status:
                              event.target.value && record.detectedBalance !== null && Boolean(record.statementDate)
                                ? 'ready'
                                : 'needs_review'
                          })
                        }
                      >
                        <option value="">Select account</option>
                        {netWorthImportAccounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Balance</span>
                      <input
                        type="number"
                        value={record.detectedBalance ?? ''}
                        onChange={(event) => {
                          const raw = event.target.value;
                          const parsed = raw === '' ? null : Number(raw);
                          updateNetWorthImportRecord(record.id, {
                            detectedBalance: parsed !== null && Number.isFinite(parsed) ? parsed : null,
                            status:
                              parsed !== null && Number.isFinite(parsed) && Boolean(record.selectedAccountId) && Boolean(record.statementDate)
                                ? 'ready'
                                : 'needs_review'
                          });
                        }}
                      />
                    </label>
                    <label>
                      <span>Date</span>
                      <input
                        type="date"
                        value={record.statementDate}
                        onChange={(event) =>
                          updateNetWorthImportRecord(record.id, {
                            statementDate: event.target.value,
                            status:
                              Boolean(event.target.value) && Boolean(record.selectedAccountId) && record.detectedBalance !== null
                                ? 'ready'
                                : 'needs_review'
                          })
                        }
                      />
                    </label>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!canApply}
                      onClick={() => applyImportedRecord(record.id)}
                    >
                      Apply
                    </button>
                    <label>
                      <span>Apply Mode</span>
                      <select
                        value={record.applyMode ?? 'net_worth_only'}
                        onChange={(event) =>
                          updateNetWorthImportRecord(record.id, {
                            applyMode: event.target.value as NetWorthImportApplyMode
                          })
                        }
                      >
                        <option value="net_worth_only">Net Worth Only</option>
                        <option value="net_worth_and_expenses">Net Worth + Expenses</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => {
                        setSelectedNetWorthImportId(record.id);
                        setExpandedNetWorthImportIds([]);
                        setShowNetWorthImportsModal(true);
                      }}
                    >
                      Open In Popup
                    </button>
                  </div>
                  <div className="subtle">
                    <p>
                      File: <strong>{record.fileName}</strong> ({record.fileType.toUpperCase()}) | Status: <strong>{record.status}</strong> | Confidence:{' '}
                      <strong>{Math.round(record.confidence * 100)}%</strong>
                    </p>
                    {record.parseNotes.length > 0 ? <p>Notes: {record.parseNotes.join(' ')}</p> : null}
                    {record.applied ? <p>Applied on {formatShortDate(record.appliedAt)}.</p> : null}
                  </div>
                  <details>
                    <summary>View File</summary>
                    {record.fileType === 'csv' ? (
                      (() => {
                        const rows = parseCsvPreview(record.previewText || '');
                        if (rows.length === 0) {
                          return <pre className="networth-file-preview">No preview available.</pre>;
                        }
                        const [headers, ...body] = rows;
                        return (
                          <div className="table-wrap expense-import-preview-table">
                            <table className="purchases-table">
                              <thead>
                                <tr>
                                  {headers.map((header, index) => (
                                    <th key={`networth-inline-header-${record.id}-${index}`}>{header || `Column ${index + 1}`}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {body.map((row, rowIndex) => (
                                  <tr key={`networth-inline-row-${record.id}-${rowIndex}`}>
                                    {headers.map((_, colIndex) => (
                                      <td key={`networth-inline-cell-${record.id}-${rowIndex}-${colIndex}`}>{row[colIndex] ?? ''}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      })()
                    ) : (
                      <pre className="networth-file-preview">{record.previewText || 'No preview available.'}</pre>
                    )}
                  </details>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="subtle">No imported statements yet. Import a CSV or PDF file to stage account updates.</p>
        )}
        {showNetWorthImportsModal ? (
          <div className="expense-modal-backdrop" onClick={() => setShowNetWorthImportsModal(false)}>
            <div className="expense-imports-modal" onClick={(event) => event.stopPropagation()}>
              <div className="expense-imports-modal-header">
                <h3>Net Worth Import Documents</h3>
                <div className="expense-imports-modal-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const checkedSet = new Set(checkedNetWorthImportIds);
                      const importableIds = pendingNetWorthImports
                        .filter(
                          (record) =>
                            checkedSet.has(record.id) &&
                            Boolean(record.selectedAccountId) &&
                            record.detectedBalance !== null &&
                            Boolean(record.statementDate)
                        )
                        .map((record) => record.id);
                      if (importableIds.length === 0) {
                        return;
                      }
                      const shouldImport = confirmAction(`Import ${importableIds.length} checked report(s)?`);
                      if (!shouldImport) {
                        return;
                      }
                      applyImportedRecords(importableIds);
                    }}
                    disabled={
                      pendingNetWorthImports.filter(
                        (record) =>
                          checkedNetWorthImportIds.includes(record.id) &&
                          Boolean(record.selectedAccountId) &&
                          record.detectedBalance !== null &&
                          Boolean(record.statementDate)
                      ).length === 0
                    }
                  >
                    Import Checked
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setCheckedNetWorthImportIds(pendingNetWorthImports.map((record) => record.id))}
                  >
                    Select All
                  </button>
                  <button type="button" className="text-button" onClick={() => setCheckedNetWorthImportIds([])}>
                    Deselect All
                  </button>
                  <button type="button" className="text-button" onClick={() => setShowNetWorthImportsModal(false)}>
                    Close
                  </button>
                </div>
              </div>
              <div className="expense-imports-modal-grid">
                <div className="expense-imports-documents">
                  {pendingNetWorthImports.length === 0 ? <p className="subtle">No new imported documents yet.</p> : null}
                  {[...pendingNetWorthImports]
                    .sort((a, b) => {
                      const aSelected = a.id === selectedNetWorthImportId ? 1 : 0;
                      const bSelected = b.id === selectedNetWorthImportId ? 1 : 0;
                      return bSelected - aSelected;
                    })
                    .map((record) => {
                    const isExpanded = expandedNetWorthImportIds.includes(record.id);
                    return (
                      <div key={`nw-import-${record.id}`} className={`expense-import-doc${isExpanded ? ' networth-import-doc-expanded' : ''}`}>
                        <div className="expense-import-doc-header networth-import-doc-header">
                          <label className="checkbox-row">
                            <input
                              type="checkbox"
                              checked={checkedNetWorthImportIds.includes(record.id)}
                              onChange={(event) =>
                                setCheckedNetWorthImportIds((current) =>
                                  event.target.checked ? [...new Set([...current, record.id])] : current.filter((id) => id !== record.id)
                                )
                              }
                            />
                          </label>
                          <button type="button" className="text-button" onClick={() => toggleExpandedNetWorthImport(record.id)}>
                            {isExpanded ? 'Collapse' : 'Expand'}
                          </button>
                          <strong>{record.fileName}</strong>
                        </div>
                        {isExpanded ? (
                          record.fileType === 'csv' ? (
                            (() => {
                              const rows = parseCsvPreview(record.previewText || '');
                              if (rows.length === 0) {
                                return <pre className="expense-import-preview">No preview available.</pre>;
                              }
                              const [headers, ...body] = rows;
                              return (
                                <div className="table-wrap expense-import-preview-table">
                                  <table className="purchases-table">
                                    <thead>
                                      <tr>
                                        {headers.map((header, index) => (
                                          <th key={`networth-modal-header-${record.id}-${index}`}>{header || `Column ${index + 1}`}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {body.map((row, rowIndex) => (
                                        <tr key={`networth-modal-row-${record.id}-${rowIndex}`}>
                                          {headers.map((_, colIndex) => (
                                            <td key={`networth-modal-cell-${record.id}-${rowIndex}-${colIndex}`}>{row[colIndex] ?? ''}</td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              );
                            })()
                          ) : (
                            <pre className="expense-import-preview">{record.previewText || 'No preview available.'}</pre>
                          )
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className="expense-import-details">
                  {(() => {
                    const selectedRecord =
                      (selectedNetWorthImportId ? pendingNetWorthImports.find((record) => record.id === selectedNetWorthImportId) : null) ??
                      pendingNetWorthImports[0] ??
                      null;
                    if (!selectedRecord) {
                      return <p className="subtle">Import files or folders to configure reports.</p>;
                    }
                    const selectedAccountLabel =
                      netWorthImportAccounts.find((account) => account.id === selectedRecord.selectedAccountId)?.label ?? 'Unmatched';
                    const canApply =
                      !selectedRecord.applied &&
                      Boolean(selectedRecord.selectedAccountId) &&
                      selectedRecord.detectedBalance !== null &&
                      Boolean(selectedRecord.statementDate);
                    return (
                      <>
                        <h4>Details</h4>
                        <p><strong>File:</strong> {selectedRecord.fileName}</p>
                        <p><strong>Type:</strong> {selectedRecord.fileType.toUpperCase()}</p>
                        <p><strong>Matched Account:</strong> {selectedAccountLabel}</p>
                        <label>
                          <span>Assign Account</span>
                          <select
                            value={selectedRecord.selectedAccountId ?? ''}
                            onChange={(event) =>
                              updateNetWorthImportRecord(selectedRecord.id, {
                                selectedAccountId: event.target.value || null,
                                status:
                                  event.target.value && selectedRecord.detectedBalance !== null && Boolean(selectedRecord.statementDate)
                                    ? 'ready'
                                    : 'needs_review'
                              })
                            }
                          >
                            <option value="">Select account</option>
                            {netWorthImportAccounts.map((account) => (
                              <option key={`modal-${account.id}`} value={account.id}>
                                {account.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Balance</span>
                          <input
                            type="number"
                            value={selectedRecord.detectedBalance ?? ''}
                            onChange={(event) => {
                              const raw = event.target.value;
                              const parsed = raw === '' ? null : Number(raw);
                              updateNetWorthImportRecord(selectedRecord.id, {
                                detectedBalance: parsed !== null && Number.isFinite(parsed) ? parsed : null,
                                status:
                                  parsed !== null &&
                                  Number.isFinite(parsed) &&
                                  Boolean(selectedRecord.selectedAccountId) &&
                                  Boolean(selectedRecord.statementDate)
                                    ? 'ready'
                                    : 'needs_review'
                              });
                            }}
                          />
                        </label>
                        <label>
                          <span>Date</span>
                          <input
                            type="date"
                            value={selectedRecord.statementDate}
                            onChange={(event) =>
                              updateNetWorthImportRecord(selectedRecord.id, {
                                statementDate: event.target.value,
                                status:
                                  Boolean(event.target.value) &&
                                  Boolean(selectedRecord.selectedAccountId) &&
                                  selectedRecord.detectedBalance !== null
                                    ? 'ready'
                                    : 'needs_review'
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>Status</span>
                          <select
                            value={selectedRecord.status}
                            onChange={(event) =>
                              updateNetWorthImportRecord(selectedRecord.id, {
                                status: event.target.value as NetWorthImportRecord['status']
                              })
                            }
                          >
                            <option value="ready">Ready</option>
                            <option value="needs_review">Needs Review</option>
                            <option value="error">Error</option>
                            <option value="applied">Applied</option>
                          </select>
                        </label>
                        <label>
                          <span>Apply Mode</span>
                          <select
                            value={selectedRecord.applyMode ?? 'net_worth_only'}
                            onChange={(event) =>
                              updateNetWorthImportRecord(selectedRecord.id, {
                                applyMode: event.target.value as NetWorthImportApplyMode
                              })
                            }
                          >
                            <option value="net_worth_only">Net Worth Only</option>
                            <option value="net_worth_and_expenses">Net Worth + Expenses</option>
                          </select>
                        </label>
                        <label>
                          <span>Confidence</span>
                          <input
                            type="number"
                            min={0}
                            max={1}
                            step={0.01}
                            value={selectedRecord.confidence}
                            onChange={(event) =>
                              updateNetWorthImportRecord(selectedRecord.id, {
                                confidence: Math.min(1, Math.max(0, Number(event.target.value) || 0))
                              })
                            }
                          />
                        </label>
                        <label>
                          <span>Parse Notes (one per line)</span>
                          <textarea
                            rows={7}
                            value={selectedRecord.parseNotes.join('\n')}
                            onChange={(event) =>
                              updateNetWorthImportRecord(selectedRecord.id, {
                                parseNotes: event.target.value
                                  .split('\n')
                                  .map((note) => note.trim())
                                  .filter((note) => note.length > 0)
                              })
                            }
                          />
                        </label>
                        <div className="expense-modal-actions">
                          <button type="button" className="secondary-button" disabled={!canApply} onClick={() => applyImportedRecord(selectedRecord.id)}>
                            Apply
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        ) : null}

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
                    : renderLoansTab()}
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
            {expensesSubTab === 'planning' ? (
              renderExpensesTab()
            ) : (
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

      <div className={hideResultsPanel ? 'app-grid full-width-content' : 'app-grid'}>
        <aside className="sidebar">{renderTabBody()}</aside>

        <section className="results">
          <div className="results-sticky">
            {hideResultsPanel ? null : (
              <>
                <div className="results-card graph-card">
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
                      {graphMode === 'portfolio' ? (
                        <ChartPanel years={displayedPortfolioGraphYears} />
                      ) : (
                        <SavingsStackedChart
                          years={displayedGraphYears}
                          pools={poolDefinitions}
                          bankAccounts={orderedBankAccounts}
                        />
                      )}
                      <div
                        className={displayedGraphDepleted || (usesFinancePredictionResults && !hasEnabledCareers) ? 'summary warning' : 'summary success'}
                      >
                        <p>{displayedGraphSummary}</p>
                        <p>
                          Ending balance at age <strong>{displayedGraphEndAge}</strong>: <strong>{formatCurrency(displayedGraphEndingBalance)}</strong>
                        </p>
                      </div>
                    </>
                  )}
                </div>

                <div className="results-card table-card">
                  <ResultsTable
                    years={displayedTableYears}
                    accountColumns={orderedBankAccounts.map((account) => ({ id: account.id, label: account.label }))}
                  />
                </div>
              </>
            )}
          </div>

        </section>
      </div>
    </main>
  );
};

export default App;
