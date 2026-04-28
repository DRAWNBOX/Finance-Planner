import { type ChangeEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { ChartPanel } from './components/ChartPanel';
import { CashflowItemEditor } from './components/CashflowItemEditor';
import { CareerPlanEditor } from './components/CareerPlanEditor';
import { LifeEventEditor } from './components/LifeEventEditor';
import { NetWorthHistoryChart } from './components/NetWorthHistoryChart';
import { ResultsTable } from './components/ResultsTable';
import { SavingsStackedChart } from './components/SavingsStackedChart';
import { BufferedNumberInput } from './components/BufferedNumberInput';
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
import { calculateAgeFromBirthDate, formatCurrency, projectScenario, resolveCurrentAge } from './engine/projection';
import { parseBankImportFiles } from './importers/bankImport';
import { ageFromYearMonth, formatYearMonthFromAge } from './utils/ageDate';
import { loadAppState, saveAppState, type AppUiState, type CareersSubTab } from './storage';
import type {
  CashflowCategory,
  LifeEventType,
  NetWorthCustomAccount,
  NetWorthHistoryEntry,
  NetWorthHistoryAccountSnapshot,
  NetWorthImportRecord,
  NetWorthImportSourceAccount,
  Scenario,
  SavingsBalances
} from './types';

type AppTab = AppUiState['activeTab'];
type FinancePredictionSubTab = CareersSubTab;

const TOP_TABS: Array<{ id: AppTab; label: string }> = [
  { id: 'retirement', label: 'Retirement' },
  { id: 'options', label: 'Options' },
  { id: 'careers', label: 'Finances Prediction' },
  { id: 'netWorth', label: 'Net Worth' }
];
const FINANCE_PREDICTION_SUB_TABS: Array<{ id: FinancePredictionSubTab; label: string }> = [
  { id: 'retirement', label: 'Retirement' },
  { id: 'careers', label: 'Careers' },
  { id: 'timeline', label: 'Timeline Management' },
  { id: 'purchasesExpenses', label: 'Purchases and expenses' },
  { id: 'loans', label: 'Loans' }
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
  const emergencyFundContributionRate = toNumberOrFallback(career.emergencyFundContributionRate, 2);
  const hsaContributionRate = toNumberOrFallback(career.hsaContributionRate, 3);
  const investmentsContributionRate = toNumberOrFallback(career.investmentsContributionRate, 6);
  const retirement401kContributionRate = toNumberOrFallback(career.retirement401kContributionRate, 6);
  const emergencyFundMonthlyWithdrawal = Math.max(0, toNumberOrFallback(career.emergencyFundMonthlyWithdrawal, 0));
  const hsaMonthlyWithdrawal = Math.max(0, toNumberOrFallback(career.hsaMonthlyWithdrawal, 0));
  const investmentsMonthlyWithdrawal = Math.max(0, toNumberOrFallback(career.investmentsMonthlyWithdrawal, 0));
  const retirement401kMonthlyWithdrawal = Math.max(0, toNumberOrFallback(career.retirement401kMonthlyWithdrawal, 0));
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
    endAge: Math.max(endAge, normalizedStartAge),
    emergencyFundContributionRate,
    hsaContributionRate,
    investmentsContributionRate,
    retirement401kContributionRate,
    savingsRate: emergencyFundContributionRate + hsaContributionRate + investmentsContributionRate + retirement401kContributionRate,
    emergencyFundSavingsMonthly: Boolean(career.emergencyFundSavingsMonthly),
    hsaSavingsMonthly: Boolean(career.hsaSavingsMonthly),
    investmentsSavingsMonthly: Boolean(career.investmentsSavingsMonthly),
    retirement401kSavingsMonthly: Boolean(career.retirement401kSavingsMonthly),
    emergencyFundStartBalanceMode: career.emergencyFundStartBalanceMode === 'manual' ? 'manual' : 'auto',
    hsaStartBalanceMode: career.hsaStartBalanceMode === 'manual' ? 'manual' : 'auto',
    investmentsStartBalanceMode: career.investmentsStartBalanceMode === 'manual' ? 'manual' : 'auto',
    retirement401kStartBalanceMode: career.retirement401kStartBalanceMode === 'manual' ? 'manual' : 'auto',
    emergencyFundManualStartBalance: Math.max(0, toNumberOrFallback(career.emergencyFundManualStartBalance, 0)),
    hsaManualStartBalance: Math.max(0, toNumberOrFallback(career.hsaManualStartBalance, 0)),
    investmentsManualStartBalance: Math.max(0, toNumberOrFallback(career.investmentsManualStartBalance, 0)),
    retirement401kManualStartBalance: Math.max(0, toNumberOrFallback(career.retirement401kManualStartBalance, 0)),
    emergencyFundMonthlyWithdrawal,
    hsaMonthlyWithdrawal,
    investmentsMonthlyWithdrawal,
    retirement401kMonthlyWithdrawal
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
const coreNetWorthAccounts: Array<{ id: keyof SavingsBalances; label: string }> = [
  { id: 'emergencyFund', label: 'Emergency Fund' },
  { id: 'hsa', label: 'HSA' },
  { id: 'investments', label: 'Investments' },
  { id: 'retirement401k', label: '401K' }
];
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
const isCoreSavingsAccount = (value: string): value is keyof SavingsBalances =>
  value === 'emergencyFund' || value === 'hsa' || value === 'investments' || value === 'retirement401k';
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
  applied: Boolean(record.applied),
  appliedAt: normalizeImportDate(record.appliedAt)
});
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
const sumAccountBalances = (balances: Scenario['savingsTracker']['annualInterestRates']) =>
  balances.emergencyFund + balances.hsa + balances.investments + balances.retirement401k;
const sumPurchaseSources = (sourceAmounts: Scenario['largePurchases'][number]['sourceAmounts']) =>
  sourceAmounts.emergencyFund + sourceAmounts.hsa + sourceAmounts.investments + sourceAmounts.retirement401k;
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

const App = () => {
  const [appState, setAppState] = useState(() => loadAppState());
  const [graphMode, setGraphMode] = useState<'portfolio' | 'savings'>('portfolio');
  const [isImportingNetWorthFiles, setIsImportingNetWorthFiles] = useState(false);
  const [netWorthHistoryRange, setNetWorthHistoryRange] = useState<NetWorthHistoryRange>('all');
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const scenario = appState.scenario;
  const inflationEnabled = scenario.manualReturns.inflationEnabled;
  const customNetWorthAccounts = scenario.netWorth.customAccounts ?? [];
  const netWorthImports = scenario.netWorth.imports ?? [];
  const netWorthHistory = scenario.netWorth.history ?? [];
  const netWorthImportAccounts: NetWorthImportSourceAccount[] = [
    ...coreNetWorthAccounts.map((account) => ({
      id: account.id,
      label: account.label,
      balance: scenario.netWorth.accountBalances[account.id]
    })),
    ...customNetWorthAccounts.map((account) => ({
      id: account.id,
      label: account.label,
      balance: account.balance
    }))
  ];
  const availableNetWorthHistoryRanges = getAvailableNetWorthHistoryRanges(netWorthHistory);
  const effectiveNetWorthHistoryRange = availableNetWorthHistoryRanges.some((range) => range.id === netWorthHistoryRange)
    ? netWorthHistoryRange
    : 'all';
  const displayedNetWorthHistory = filterNetWorthHistoryByRange(netWorthHistory, effectiveNetWorthHistoryRange);
  const activeTab = appState.ui.activeTab;
  const careersSubTab = appState.ui.careersSubTab;
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
  const projection = activeTab === 'careers' ? futureProjection : retirementProjection;
  const graphProjection = projection;
  const hideResultsForPurchasesExpenses = activeTab === 'careers' && careersSubTab === 'purchasesExpenses';
  const displayedGraphYears = activeTab === 'careers' && !hasEnabledCareers ? [] : graphProjection.years;
  const displayedPortfolioGraphYears =
    activeTab === 'careers'
      ? displayedGraphYears.map((year) => ({
          ...year,
          endBalance: sumSavingsBalances(year.savingsBalances)
        }))
      : displayedGraphYears;
  const displayedTableYears =
    activeTab === 'careers'
      ? (() => {
          let previousEndBalance: number | null = null;

          return projection.years.map((year) => {
            const endBalance = sumSavingsBalances(year.savingsBalances);
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
    activeTab === 'careers' && !hasEnabledCareers
      ? 'No careers are selected for estimation. Enable at least one career to display projections.'
      : activeTab === 'careers'
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
    const normalizedLargePurchases = (nextScenario.largePurchases ?? []).map((purchase) => ({
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
      sourceAmounts: {
        emergencyFund: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.emergencyFund, 0)),
        hsa: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.hsa, 0)),
        investments: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.investments, 0)),
        retirement401k: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.retirement401k, 0))
      }
    }));
    const normalizedLongTermPurchases = (nextScenario.longTermPurchases ?? []).map((purchase, index) => {
      const fallbackStartYearMonth = formatYearMonthFromAge(resolvedAge + 1, nextScenario.options.dateOfBirth, resolvedAge);
      const startYearMonth = normalizeYearMonth(purchase.startYearMonth) || fallbackStartYearMonth;
      const fallbackEndYearMonth = formatYearMonthFromAge(resolvedAge + 2, nextScenario.options.dateOfBirth, resolvedAge);
      const endMode: Scenario['longTermPurchases'][number]['endMode'] =
        purchase.endMode === 'endDate' ? 'endDate' : 'duration';

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
        sourceAmounts: {
          emergencyFund: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.emergencyFund, 0)),
          hsa: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.hsa, 0)),
          investments: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.investments, 0)),
          retirement401k: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.retirement401k, 0))
        }
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
          entries: normalizedCareerEntries
        },
        netWorth: normalizedNetWorth,
        withdrawal: {
          ...nextScenario.withdrawal,
          minimumYearlyWithdrawal: Math.max(0, toNumberOrFallback(nextScenario.withdrawal.minimumYearlyWithdrawal, 0)),
          firstYearAmount: sumAccountBalances(normalizedWithdrawalAccounts),
          firstYearAccountWithdrawals: normalizedWithdrawalAccounts,
          firstYearAccountUseFourPercent: normalizedWithdrawalFourPercentFlags
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
        activeTab: 'retirement',
        selectedCareerId: defaultScenario.careerPlan.entries[0]?.id ?? '',
        careersSubTab: 'careers'
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
    customAccounts: NetWorthCustomAccount[]
  ): NetWorthHistoryAccountSnapshot[] => [
    {
      id: 'emergencyFund',
      label: 'Emergency Fund',
      balance: Math.max(0, balances.emergencyFund)
    },
    {
      id: 'hsa',
      label: 'HSA',
      balance: Math.max(0, balances.hsa)
    },
    {
      id: 'investments',
      label: 'Investments',
      balance: Math.max(0, balances.investments)
    },
    {
      id: 'retirement401k',
      label: '401K',
      balance: Math.max(0, balances.retirement401k)
    },
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
    const previousAccounts = buildNetWorthHistoryAccounts(previousNetWorth.accountBalances, previousNetWorth.customAccounts ?? []);
    const nextAccounts = buildNetWorthHistoryAccounts(nextNetWorth.accountBalances, nextNetWorth.customAccounts ?? []);
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
  };

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
    let nextCustomAccounts = [...customNetWorthAccounts];
    const todayIso = getTodayIsoDate();
    const appliedDates: string[] = [];

    const nextImports = netWorthImports.map((record) => {
      const shouldApply = recordIds.includes(record.id);
      const selectedAccountId = record.selectedAccountId;
      const detectedBalance = record.detectedBalance;
      if (!shouldApply || !selectedAccountId || detectedBalance === null) {
        return record;
      }

      if (isCoreSavingsAccount(selectedAccountId)) {
        nextAccountBalances[selectedAccountId] = Math.max(0, detectedBalance);
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

      const appliedDate = record.statementDate || todayIso;
      appliedDates.push(appliedDate);

      return {
        ...record,
        status: 'applied' as const,
        applied: true,
        appliedAt: todayIso
      };
    });

    const latestAppliedDate = appliedDates.length > 0 ? appliedDates.sort().slice(-1)[0] : todayIso;

    updateNetWorthWithHistory(
      {
        ...scenario.netWorth,
        accountBalances: nextAccountBalances,
        customAccounts: nextCustomAccounts,
        imports: nextImports,
        asOfDate: latestAppliedDate
      },
      { logDate: latestAppliedDate, forceLog: true }
    );
  };

  const applyImportedRecord = (recordId: string) => {
    applyImportedRecords([recordId]);
  };

  const applyAllReadyImports = () => {
    const recordIds = netWorthImports
      .filter((record) => !record.applied && record.selectedAccountId && record.detectedBalance !== null)
      .map((record) => record.id);
    applyImportedRecords(recordIds);
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
          const accountKeys: Array<keyof Scenario['withdrawal']['firstYearAccountWithdrawals']> = [
            'emergencyFund',
            'hsa',
            'investments',
            'retirement401k'
          ];
          const displayedFirstYearTotal = accountKeys.reduce((sum, key) => {
            const useFourPercent = scenario.withdrawal.firstYearAccountUseFourPercent[key];
            const displayedValue = useFourPercent
              ? Math.round(retirementFirstYearPlannedWithdrawals[key])
              : scenario.withdrawal.firstYearAccountWithdrawals[key];

            return sum + displayedValue;
          }, 0);

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
        <div className="career-savings-grid">
          <div className="career-savings-row career-savings-header">
            <div className="career-savings-cell">Account</div>
            <div className="career-savings-cell">Use 4% Rule</div>
            <div className="career-savings-cell">First Year Withdrawal</div>
            <div className="career-savings-cell">Interest (APY)</div>
          </div>
          {[
            ['emergencyFund', 'Emergency Fund'],
            ['hsa', 'HSA'],
            ['investments', 'Investments'],
            ['retirement401k', '401K']
          ].map(([key, label]) => (
            <div key={key} className="career-savings-row">
              <div className="career-savings-cell">{label}</div>
              <div className="career-savings-cell">
                <input
                  type="checkbox"
                  checked={scenario.withdrawal.firstYearAccountUseFourPercent[key as keyof Scenario['withdrawal']['firstYearAccountUseFourPercent']]}
                  onChange={(event) =>
                    updateScenario({
                      ...scenario,
                      withdrawal: {
                        ...scenario.withdrawal,
                        firstYearAccountUseFourPercent: {
                          ...scenario.withdrawal.firstYearAccountUseFourPercent,
                          [key]: event.target.checked
                        }
                      }
                    })
                  }
                />
              </div>
              <div className="career-savings-cell">
                <BufferedNumberInput
                  value={scenario.withdrawal.firstYearAccountUseFourPercent[key as keyof Scenario['withdrawal']['firstYearAccountUseFourPercent']]
                    ? Math.round(
                        retirementFirstYearPlannedWithdrawals[key as keyof typeof retirementFirstYearPlannedWithdrawals]
                      )
                    : scenario.withdrawal.firstYearAccountWithdrawals[
                        key as keyof Scenario['withdrawal']['firstYearAccountWithdrawals']
                      ]}
                  min={0}
                  max={1000000}
                  step={100}
                  disabled={scenario.withdrawal.firstYearAccountUseFourPercent[key as keyof Scenario['withdrawal']['firstYearAccountUseFourPercent']]}
                  onCommit={(next) =>
                    updateScenario({
                      ...scenario,
                      withdrawal: {
                        ...scenario.withdrawal,
                        firstYearAmount: sumAccountBalances({
                          ...scenario.withdrawal.firstYearAccountWithdrawals,
                          [key]: next
                        }),
                        firstYearAccountWithdrawals: {
                          ...scenario.withdrawal.firstYearAccountWithdrawals,
                          [key]: next
                        }
                      }
                    })
                  }
                />
              </div>
              <div className="career-savings-cell">
                <BufferedNumberInput
                  value={scenario.savingsTracker.annualInterestRates[key as keyof Scenario['savingsTracker']['annualInterestRates']]}
                  min={-20}
                  max={25}
                  step={0.1}
                  onCommit={(next) =>
                    updateScenario({
                      ...scenario,
                      savingsTracker: {
                        ...scenario.savingsTracker,
                        annualInterestRates: {
                          ...scenario.savingsTracker.annualInterestRates,
                          [key]: next
                        }
                      }
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
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
        onChangeSavingsReturn={(account, rate) =>
          updateScenario({
            ...scenario,
            savingsTracker: {
              ...scenario.savingsTracker,
              annualInterestRates: {
                ...scenario.savingsTracker.annualInterestRates,
                [account]: rate
              }
            }
          })
        }
        onAddCareer={addCareer}
        onRemoveCareer={removeCareer}
        previewYear={
          futureProjection.years.find((year) => !year.isBaselineNow && year.age === currentAge + 1) ??
          futureProjection.years.find((year) => !year.isBaselineNow) ??
          futureProjection.years[0]
        }
        savingsAnnualRates={scenario.savingsTracker.annualInterestRates}
        netWorthBalances={scenario.netWorth.accountBalances}
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
                  <th title="Emergency Fund">Emergency Fund</th>
                  <th>HSA</th>
                  <th title="Investments">Investments</th>
                  <th>401K</th>
                  <th title="Emergency Fund Balance">Emergency Fund Balance</th>
                  <th title="HSA Balance">HSA Balance</th>
                  <th title="Investments Balance">Investments Balance</th>
                  <th title="401K Balance">401K Balance</th>
                  <th title="Difference">Difference</th>
                  <th title="Remove">Remove</th>
                </tr>
              </thead>
              <tbody>
                {scenario.largePurchases.map((purchase) => {
                  const totalSources = sumPurchaseSources(purchase.sourceAmounts);
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
                  const balancesIfPurchaseApplied = futureProjection.purchasePostPurchaseDisplayBalances[purchase.id] ?? null;
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
                      <td>
                        <BufferedNumberInput
                          value={purchase.sourceAmounts.emergencyFund}
                          min={0}
                          max={50000000}
                          step={100}
                          onCommit={(next) =>
                            updateLargePurchase(purchase.id, {
                              ...purchase,
                              sourceAmounts: { ...purchase.sourceAmounts, emergencyFund: next }
                            })
                          }
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={purchase.sourceAmounts.hsa}
                          min={0}
                          max={50000000}
                          step={100}
                          onCommit={(next) =>
                            updateLargePurchase(purchase.id, { ...purchase, sourceAmounts: { ...purchase.sourceAmounts, hsa: next } })
                          }
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={purchase.sourceAmounts.investments}
                          min={0}
                          max={50000000}
                          step={100}
                          onCommit={(next) =>
                            updateLargePurchase(purchase.id, {
                              ...purchase,
                              sourceAmounts: { ...purchase.sourceAmounts, investments: next }
                            })
                          }
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={purchase.sourceAmounts.retirement401k}
                          min={0}
                          max={50000000}
                          step={100}
                          onCommit={(next) =>
                            updateLargePurchase(purchase.id, {
                              ...purchase,
                              sourceAmounts: { ...purchase.sourceAmounts, retirement401k: next }
                            })
                          }
                        />
                      </td>
                      <td>{balancesIfPurchaseApplied ? formatCurrency(balancesIfPurchaseApplied.emergencyFund) : 'N/A'}</td>
                      <td>{balancesIfPurchaseApplied ? formatCurrency(balancesIfPurchaseApplied.hsa) : 'N/A'}</td>
                      <td>{balancesIfPurchaseApplied ? formatCurrency(balancesIfPurchaseApplied.investments) : 'N/A'}</td>
                      <td>{balancesIfPurchaseApplied ? formatCurrency(balancesIfPurchaseApplied.retirement401k) : 'N/A'}</td>
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
          Difference = Purchase Amount - Sum of source totals. Balance columns show balances immediately after the scheduled purchase date.
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
                  <th>Emergency Fund</th>
                  <th>HSA</th>
                  <th>Investments</th>
                  <th>401K</th>
                  <th>Difference</th>
                  <th>Remove</th>
                </tr>
              </thead>
              <tbody>
                {(scenario.longTermPurchases ?? []).map((purchase) => {
                  const monthlySources = sumPurchaseSources(purchase.sourceAmounts);
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
                      <td>
                        <BufferedNumberInput
                          value={purchase.sourceAmounts.emergencyFund}
                          min={0}
                          max={1000000}
                          step={10}
                          onCommit={(next) =>
                            updateLongTermPurchase(purchase.id, {
                              ...purchase,
                              sourceAmounts: { ...purchase.sourceAmounts, emergencyFund: next }
                            })
                          }
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={purchase.sourceAmounts.hsa}
                          min={0}
                          max={1000000}
                          step={10}
                          onCommit={(next) =>
                            updateLongTermPurchase(purchase.id, {
                              ...purchase,
                              sourceAmounts: { ...purchase.sourceAmounts, hsa: next }
                            })
                          }
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={purchase.sourceAmounts.investments}
                          min={0}
                          max={1000000}
                          step={10}
                          onCommit={(next) =>
                            updateLongTermPurchase(purchase.id, {
                              ...purchase,
                              sourceAmounts: { ...purchase.sourceAmounts, investments: next }
                            })
                          }
                        />
                      </td>
                      <td>
                        <BufferedNumberInput
                          value={purchase.sourceAmounts.retirement401k}
                          min={0}
                          max={1000000}
                          step={10}
                          onCommit={(next) =>
                            updateLongTermPurchase(purchase.id, {
                              ...purchase,
                              sourceAmounts: { ...purchase.sourceAmounts, retirement401k: next }
                            })
                          }
                        />
                      </td>
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

                return (
                  <tr key={loan.id}>
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
                      <select
                        aria-label="Loan Payment Source"
                        value={loan.paymentSourceAccount}
                        onChange={(event) =>
                          updateLoan(loan.id, {
                            ...loan,
                            paymentSourceAccount:
                              event.target.value === 'emergencyFund' ||
                              event.target.value === 'hsa' ||
                              event.target.value === 'investments' ||
                              event.target.value === 'retirement401k' ||
                              event.target.value === 'income'
                                ? event.target.value
                                : 'investments'
                          })
                        }
                      >
                        <option value="emergencyFund">Emergency Fund</option>
                        <option value="hsa">HSA</option>
                        <option value="investments">Investments</option>
                        <option value="retirement401k">401K</option>
                        <option value="income">Income</option>
                      </select>
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
    <>
      <Panel title="Future Life Events" className="panel-wide">
        <div className="event-add-grid">
          {EVENT_OPTIONS.map((option) => (
            <label key={option.type} className="checkbox-row">
              <input
                type="checkbox"
                checked={scenario.lifeEvents.some((event) => event.type === option.type)}
                onChange={(event) => toggleEventOption(option.type, event.target.checked)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        <div className="cashflow-list">
          {scenario.lifeEvents.length === 0 ? (
            <p className="subtle">Enable an event above to model job changes, breaks, homes, or other major changes.</p>
          ) : (
            scenario.lifeEvents.map((event) => (
              <LifeEventEditor
                key={event.id}
                event={event}
                retirementEndAge={futureEndAge}
                dateOfBirth={scenario.options.dateOfBirth}
                currentAge={currentAge}
                inflationControlsDisabled={!inflationEnabled}
                onChange={(nextEvent) =>
                  updateScenario({
                    ...scenario,
                    lifeEvents: scenario.lifeEvents.map((currentEvent) =>
                      currentEvent.id === nextEvent.id ? nextEvent : currentEvent
                    )
                  })
                }
                onRemove={(eventId) =>
                  updateScenario({
                    ...scenario,
                    lifeEvents: scenario.lifeEvents.filter((event) => event.id !== eventId)
                  })
                }
              />
            ))
          )}
        </div>
      </Panel>
    </>
  );

  const renderNetWorthTab = () => {
    const trackedBalanceTotal = sumSavingsBalances(scenario.netWorth.accountBalances);
    const customBalanceTotal = customNetWorthAccounts.reduce((sum, account) => sum + account.balance, 0);
    const fullNetWorthTotal = trackedBalanceTotal + customBalanceTotal;

    return (
      <Panel title="Net Worth Accounts" className="panel-wide">
        <div className="career-grid">
          <label>
            <span>Emergency Fund Balance</span>
            <BufferedNumberInput
              value={scenario.netWorth.accountBalances.emergencyFund}
              min={0}
              max={20000000}
              step={100}
              onCommit={(next) =>
                updateNetWorthWithHistory(
                  {
                    ...scenario.netWorth,
                    accountBalances: {
                      ...scenario.netWorth.accountBalances,
                      emergencyFund: next
                    },
                    asOfDate: getTodayIsoDate()
                  },
                  { logDate: getTodayIsoDate() }
                )
              }
            />
          </label>
          <label>
            <span>HSA Balance</span>
            <BufferedNumberInput
              value={scenario.netWorth.accountBalances.hsa}
              min={0}
              max={20000000}
              step={100}
              onCommit={(next) =>
                updateNetWorthWithHistory(
                  {
                    ...scenario.netWorth,
                    accountBalances: {
                      ...scenario.netWorth.accountBalances,
                      hsa: next
                    },
                    asOfDate: getTodayIsoDate()
                  },
                  { logDate: getTodayIsoDate() }
                )
              }
            />
          </label>
          <label>
            <span>Investments Balance</span>
            <BufferedNumberInput
              value={scenario.netWorth.accountBalances.investments}
              min={0}
              max={20000000}
              step={100}
              onCommit={(next) =>
                updateNetWorthWithHistory(
                  {
                    ...scenario.netWorth,
                    accountBalances: {
                      ...scenario.netWorth.accountBalances,
                      investments: next
                    },
                    asOfDate: getTodayIsoDate()
                  },
                  { logDate: getTodayIsoDate() }
                )
              }
            />
          </label>
          <label>
            <span>401K Balance</span>
            <BufferedNumberInput
              value={scenario.netWorth.accountBalances.retirement401k}
              min={0}
              max={20000000}
              step={100}
              onCommit={(next) =>
                updateNetWorthWithHistory(
                  {
                    ...scenario.netWorth,
                    accountBalances: {
                      ...scenario.netWorth.accountBalances,
                      retirement401k: next
                    },
                    asOfDate: getTodayIsoDate()
                  },
                  { logDate: getTodayIsoDate() }
                )
              }
            />
          </label>
        </div>

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
          <button type="button" className="secondary-button" onClick={promptImportFolder}>
            Import Folder
          </button>
          <button type="button" className="secondary-button" onClick={applyAllReadyImports}>
            Apply Selected
          </button>
          {isImportingNetWorthFiles ? <p className="subtle">Importing files...</p> : null}
        </div>
        {netWorthImports.length > 0 ? (
          <div className="networth-import-list">
            {netWorthImports.map((record) => {
              const selectedAccountLabel =
                netWorthImportAccounts.find((account) => account.id === record.selectedAccountId)?.label ?? 'Unmatched';
              const canApply = !record.applied && Boolean(record.selectedAccountId) && record.detectedBalance !== null;
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
                            status: event.target.value ? 'ready' : 'needs_review'
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
                            status: parsed !== null ? 'ready' : 'needs_review'
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
                            statementDate: event.target.value
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
                    <pre className="networth-file-preview">{record.previewText || 'No preview available.'}</pre>
                  </details>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="subtle">No imported statements yet. Import a CSV or PDF file to stage account updates.</p>
        )}

        <div className="panel-divider" />
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

        <div className="panel-divider" />

        <div className="career-actions">
          <button type="button" className="secondary-button" onClick={addCustomNetWorthAccount}>
            + Add Custom Account
          </button>
        </div>
        {customNetWorthAccounts.length === 0 ? (
          <p className="subtle">No custom accounts yet. Add one for assets you track outside the four projection accounts.</p>
        ) : (
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
        )}
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
    switch (activeTab) {
      case 'retirement':
        return renderRetirementTab();
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

      <div className={hideResultsForPurchasesExpenses ? 'app-grid full-width-content' : 'app-grid'}>
        <aside className="sidebar">{renderTabBody()}</aside>

        <section className="results">
          <div className="results-sticky">
            {hideResultsForPurchasesExpenses ? null : (
              <>
                <div className="results-card graph-card">
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
                  {graphMode === 'portfolio' ? <ChartPanel years={displayedPortfolioGraphYears} /> : <SavingsStackedChart years={displayedGraphYears} />}
                  <div
                    className={displayedGraphDepleted || (activeTab === 'careers' && !hasEnabledCareers) ? 'summary warning' : 'summary success'}
                  >
                    <p>{displayedGraphSummary}</p>
                    <p>
                      Ending balance at age <strong>{displayedGraphEndAge}</strong>: <strong>{formatCurrency(displayedGraphEndingBalance)}</strong>
                    </p>
                  </div>
                </div>

                <div className="results-card table-card">
                  <ResultsTable years={displayedTableYears} />
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
