import { type KeyboardEvent, type ReactNode, useEffect, useId, useState } from 'react';
import { ChartPanel } from './components/ChartPanel';
import { CashflowItemEditor } from './components/CashflowItemEditor';
import { CareerPlanEditor } from './components/CareerPlanEditor';
import { LifeEventEditor } from './components/LifeEventEditor';
import { ResultsTable } from './components/ResultsTable';
import { SavingsStackedChart } from './components/SavingsStackedChart';
import { BufferedNumberInput } from './components/BufferedNumberInput';
import {
  createDefaultCashflowItem,
  createDefaultCareerEntry,
  createDefaultLargePurchase,
  createDefaultLifeEvent,
  defaultScenario
} from './defaultScenario';
import { formatCurrency, projectScenario, resolveCurrentAge } from './engine/projection';
import { loadAppState, saveAppState, type AppUiState } from './storage';
import type { CashflowCategory, LifeEventType, Scenario } from './types';

type AppTab = AppUiState['activeTab'];

const TOP_TABS: Array<{ id: AppTab; label: string }> = [
  { id: 'retirement', label: 'Retirement' },
  { id: 'options', label: 'Options' },
  { id: 'careers', label: 'Finances Prediction' },
  { id: 'netWorth', label: 'Net Worth' }
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
const normalizeCareerTimeline = (career: Scenario['careerPlan']['entries'][number]) => {
  const startAge = Math.min(career.startAge, career.endAge);
  const endAge = Math.max(career.startAge, career.endAge);
  const emergencyFundContributionRate = toNumberOrFallback(career.emergencyFundContributionRate, 2);
  const hsaContributionRate = toNumberOrFallback(career.hsaContributionRate, 3);
  const investmentsContributionRate = toNumberOrFallback(career.investmentsContributionRate, 6);
  const retirement401kContributionRate = toNumberOrFallback(career.retirement401kContributionRate, 6);
  const emergencyFundMonthlyWithdrawal = Math.max(0, toNumberOrFallback(career.emergencyFundMonthlyWithdrawal, 0));
  const hsaMonthlyWithdrawal = Math.max(0, toNumberOrFallback(career.hsaMonthlyWithdrawal, 0));
  const investmentsMonthlyWithdrawal = Math.max(0, toNumberOrFallback(career.investmentsMonthlyWithdrawal, 0));
  const retirement401kMonthlyWithdrawal = Math.max(0, toNumberOrFallback(career.retirement401kMonthlyWithdrawal, 0));

  return {
    ...career,
    usePreviousCareerStartAge: Boolean(career.usePreviousCareerStartAge),
    startAge,
    endAge,
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

const normalizeCareerEntries = (entries: Scenario['careerPlan']['entries']) => {
  const normalized: Scenario['careerPlan']['entries'] = [];

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

const makeCareerId = () => `career-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const RETIREMENT_CAREER_ITEM_ID = 'career-retirement-fixed';

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

const App = () => {
  const [appState, setAppState] = useState(() => loadAppState());
  const [graphMode, setGraphMode] = useState<'portfolio' | 'savings'>('portfolio');
  const scenario = appState.scenario;
  const activeTab = appState.ui.activeTab;
  const selectedCareerId = appState.ui.selectedCareerId || scenario.careerPlan.entries[0]?.id || '';
  const currentAge = resolveCurrentAge(scenario);
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
      retirementYears: scenario.profile.retirementYears
    }
  };
  const futureProjection = projectScenario(futureScenario);
  const hasEnabledCareers = futureScenario.careerPlan.entries.some((entry) => entry.enabled);
  const projection = activeTab === 'careers' ? futureProjection : retirementProjection;
  const graphProjection = projection;
  const displayedGraphYears = activeTab === 'careers' && !hasEnabledCareers ? [] : graphProjection.years;
  const activeProjectionYear =
    displayedGraphYears.find((year) => year.age === currentAge) ?? displayedGraphYears[0] ?? undefined;
  const displayedGraphEndingBalance =
    displayedGraphYears.length > 0 ? displayedGraphYears[displayedGraphYears.length - 1].endBalance : 0;
  const displayedGraphEndAge = displayedGraphYears.length > 0 ? displayedGraphYears[displayedGraphYears.length - 1].age : currentAge;
  const displayedGraphDepleted = displayedGraphYears.some((year) => year.depleted);
  const displayedGraphSummary =
    activeTab === 'careers' && !hasEnabledCareers
      ? 'No careers are selected for estimation. Enable at least one career to display projections.'
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

  const updateScenario = (nextScenario: Scenario) => {
    const resolvedAge = resolveCurrentAge(nextScenario);
    const equityAllocation = Math.min(Math.max(nextScenario.portfolio.equityAllocation, 0), 100);
    const fixedIncomeAllocation = 100 - equityAllocation;
    const normalizedCareerEntries = normalizeCareerEntries(nextScenario.careerPlan.entries);
    const normalizedNetWorth = {
      ...nextScenario.netWorth,
      accountBalances: {
        emergencyFund: Math.max(0, toNumberOrFallback(nextScenario.netWorth.accountBalances.emergencyFund, 0)),
        hsa: Math.max(0, toNumberOrFallback(nextScenario.netWorth.accountBalances.hsa, 0)),
        investments: Math.max(0, toNumberOrFallback(nextScenario.netWorth.accountBalances.investments, 0)),
        retirement401k: Math.max(0, toNumberOrFallback(nextScenario.netWorth.accountBalances.retirement401k, 0))
      },
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
      age: Math.floor(Math.max(resolvedAge, toNumberOrFallback(purchase.age, resolvedAge))),
      amount: Math.max(0, toNumberOrFallback(purchase.amount, 0)),
      sourceAmounts: {
        emergencyFund: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.emergencyFund, 0)),
        hsa: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.hsa, 0)),
        investments: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.investments, 0)),
        retirement401k: Math.max(0, toNumberOrFallback(purchase.sourceAmounts?.retirement401k, 0))
      }
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
          firstYearAmount: sumAccountBalances(normalizedWithdrawalAccounts),
          firstYearAccountWithdrawals: normalizedWithdrawalAccounts,
          firstYearAccountUseFourPercent: normalizedWithdrawalFourPercentFlags
        },
        largePurchases: normalizedLargePurchases,
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
        activeTab: nextTab
      }
    }));
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
    const entry = createDefaultLargePurchase(currentAge);

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

  const renderRetirementTab = ({ forCareerRetirementItem = false }: { forCareerRetirementItem?: boolean } = {}) => (
    <>
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
          onChange={(value) =>
            updateScenario({
              ...scenario,
              manualReturns: { ...scenario.manualReturns, inflationRate: value }
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
      </Panel>
    </>
  );

  const renderCareersTab = () => (
    <>
      <Panel title="Career Timeline" className="panel-wide">
        <CareerPlanEditor
          value={scenario.careerPlan}
          selectedCareerId={selectedCareerId}
          isRetirementSelected={selectedCareerId === RETIREMENT_CAREER_ITEM_ID}
          onSelectRetirementItem={() => updateSelectedCareerId(RETIREMENT_CAREER_ITEM_ID)}
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
        previewYear={futureProjection.years.find((year) => year.age === currentAge) ?? futureProjection.years[0]}
        savingsAnnualRates={scenario.savingsTracker.annualInterestRates}
        netWorthBalances={scenario.netWorth.accountBalances}
      />
      </Panel>
      {renderPurchasesTab()}
      {selectedCareerId === RETIREMENT_CAREER_ITEM_ID ? (
        <>
          {renderRetirementTab({ forCareerRetirementItem: true })}
        </>
      ) : null}
    </>
  );

  const renderPurchasesTab = () => (
    <Panel title="Large Purchases Table" className="panel-wide">
      <div className="career-actions">
        <button type="button" className="secondary-button" onClick={addLargePurchase}>
          + Purchase
        </button>
      </div>
      {scenario.largePurchases.length === 0 ? (
        <p className="subtle">Add a purchase with age, value, and source amounts per account.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Enabled</th>
                <th>Name</th>
                <th>Age</th>
                <th>Value</th>
                <th>Emergency Fund</th>
                <th>HSA</th>
                <th>Investments</th>
                <th>401K</th>
                <th>Difference</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {scenario.largePurchases.map((purchase) => {
                const totalSources = sumPurchaseSources(purchase.sourceAmounts);
                const difference = purchase.amount - totalSources;

                return (
                  <tr key={purchase.id}>
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
                      <BufferedNumberInput
                        value={purchase.age}
                        min={currentAge}
                        max={futureEndAge}
                        onCommit={(next) => updateLargePurchase(purchase.id, { ...purchase, age: next })}
                      />
                    </td>
                    <td>
                      <BufferedNumberInput
                        value={purchase.amount}
                        min={0}
                        max={50000000}
                        step={100}
                        onCommit={(next) => updateLargePurchase(purchase.id, { ...purchase, amount: next })}
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
      <p className="subtle">Difference = Purchase Value - Sum of source account amounts.</p>
    </Panel>
  );

  const renderFutureTab = () => (
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
        </div>
      </Panel>

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

  const renderNetWorthTab = () => (
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
              updateScenario({
                ...scenario,
                netWorth: {
                  ...scenario.netWorth,
                  accountBalances: {
                    ...scenario.netWorth.accountBalances,
                    emergencyFund: next
                  },
                  asOfDate: getTodayIsoDate()
                }
              })
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
              updateScenario({
                ...scenario,
                netWorth: {
                  ...scenario.netWorth,
                  accountBalances: {
                    ...scenario.netWorth.accountBalances,
                    hsa: next
                  },
                  asOfDate: getTodayIsoDate()
                }
              })
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
              updateScenario({
                ...scenario,
                netWorth: {
                  ...scenario.netWorth,
                  accountBalances: {
                    ...scenario.netWorth.accountBalances,
                    investments: next
                  },
                  asOfDate: getTodayIsoDate()
                }
              })
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
              updateScenario({
                ...scenario,
                netWorth: {
                  ...scenario.netWorth,
                  accountBalances: {
                    ...scenario.netWorth.accountBalances,
                    retirement401k: next
                  },
                  asOfDate: getTodayIsoDate()
                }
              })
            }
          />
        </label>
      </div>
      <div className="career-summary">
        <p>
          Total tracked balances:{' '}
          <strong>
            {formatCurrency(
              scenario.netWorth.accountBalances.emergencyFund +
                scenario.netWorth.accountBalances.hsa +
                scenario.netWorth.accountBalances.investments +
                scenario.netWorth.accountBalances.retirement401k
            )}
          </strong>
        </p>
        <p>
          Last updated: <strong>{formatShortDate(scenario.netWorth.asOfDate)}</strong>
        </p>
        <p>Balances are stored in local storage with the save date.</p>
      </div>
    </Panel>
  );

  const renderTabBody = () => {
    switch (activeTab) {
      case 'retirement':
        return renderRetirementTab();
      case 'options':
        return renderOptionsTab();
      case 'careers':
        return renderCareersTab();
      case 'netWorth':
        return renderNetWorthTab();
      default:
        return null;
    }
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div>Plan your retirement with a local-first finance planner.</div>
      </header>

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

      <div className="app-grid">
        <aside className="sidebar">{renderTabBody()}</aside>

        <section className="results">
          <div className="results-sticky">
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
              {graphMode === 'portfolio' ? <ChartPanel years={displayedGraphYears} /> : <SavingsStackedChart years={displayedGraphYears} />}
              <div className={displayedGraphDepleted || (activeTab === 'careers' && !hasEnabledCareers) ? 'summary warning' : 'summary success'}>
                <p>{displayedGraphSummary}</p>
                {activeTab === 'careers' ? (
                  <p>
                    Career estimate: <strong>{formatCurrency(activeProjectionYear?.salary ?? 0)}</strong> salary with{' '}
                    <strong>{formatCurrency(activeProjectionYear?.careerContribution ?? 0)}</strong> of modeled savings.
                  </p>
                ) : null}
                <p>
                  Ending balance at age <strong>{displayedGraphEndAge}</strong>: <strong>{formatCurrency(displayedGraphEndingBalance)}</strong>
                </p>
              </div>
            </div>

            <div className="results-card table-card">
              <ResultsTable years={projection.years} />
            </div>
          </div>

          <div className="footnote">
            <p>Scenario-based data model is already in place so career income plans and major life events can layer on next.</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setAppState({
                  scenario: defaultScenario,
                  ui: { activeTab: 'retirement', selectedCareerId: defaultScenario.careerPlan.entries[0]?.id ?? '' }
                })
              }
            >
              Reset Scenario
            </button>
          </div>
        </section>
      </div>
    </main>
  );
};

export default App;
