import { memo, useEffect, useMemo, useState } from 'react';
import { BufferedNumberInput } from './BufferedNumberInput';
import { YearMonthInput } from './YearMonthInput';
import { DateOrMarkerInput } from './DateOrMarkerInput';
import { PaycheckEditorModal } from './PaycheckEditorModal';
import type { BankAccountDefinition, CareerEntry, CareerPayPlan, CareerPlan, CareerSourceLine, DateMarker, Paycheck, PaycheckInfo, PoolDefinition, ProjectionYear } from '../types';
import { addMonthsToYearMonth, ageFromYearMonth, formatYearMonthFromAge } from '../utils/ageDate';
import { useRenderCount } from '../utils/perfTools';
import { PAY_FREQUENCY_LABELS, compilePaycheck, createCareerPayPlan, getPaycheckTotals, paycheckFromPaycheckInfo, resolvePaycheckInfo } from '../paycheck';

interface CareerPlanEditorProps {
  value: CareerPlan;
  selectedCareerId: string;
  onSelectCareer: (careerId: string) => void;
  onChangeCareer: (career: CareerEntry) => void;
  onDuplicateCareer: (careerId: string) => void;
  onReorderCareers: (fromCareerId: string, toCareerId: string) => void;
  onAddCareer: () => void;
  onRemoveCareer: (careerId: string) => void;
  previewYear?: ProjectionYear;
  bankAccounts: BankAccountDefinition[];
  pools: PoolDefinition[];
  birthdayBasedCareerStartAge: number;
  dateOfBirth: string;
  currentAge: number;
  incomeFallbackAccountId: string | null | undefined;
  incomeFallbackAccountId2: string | null | undefined;
  onChangeIncomeFallbackAccount1: (accountId: string | null) => void;
  onChangeIncomeFallbackAccount2: (accountId: string | null) => void;
  incomeFallbackNotice?: string | null;
  onDismissIncomeFallbackNotice?: () => void;
  withdrawalShortfalls?: Record<string, number>;
  dateMarkers?: DateMarker[];
  allowReordering?: boolean;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

const careerAnnualNetIncome = (career: CareerEntry | undefined): number => {
  const info = resolvePaycheckInfo(career);
  if (!info) {
    return 0;
  }

  const gross = info.grossSalary ?? 0;
  const retirement = info.retirementMode === 'percentOfSalary' ? gross * (info.retirement ?? 0) / 100 : (info.retirement ?? 0);
  const hsa = info.hsaContributionMode === 'percentOfSalary' ? gross * (info.hsaContribution ?? 0) / 100 : (info.hsaContribution ?? 0);

  return Math.max(
    0,
    gross - (info.taxes ?? 0) - (info.healthBenefits ?? 0) - (info.otherBenefits ?? 0) - retirement - hsa - (info.livingExpenses ?? 0)
  );
};

const resolveCareerLineForAccount = (
  career: CareerEntry | undefined,
  account: BankAccountDefinition
): CareerSourceLine => {
  const existingLines = career?.sourceLines ?? [];
  const accountLine = existingLines.find((line) => line.sourceType === 'account' && line.sourceId === account.id);
  if (accountLine) {
    return accountLine;
  }

  const poolLine = existingLines.find((line) => line.sourceType === 'pool' && line.sourceId === account.poolId);
  if (poolLine) {
    return {
      ...poolLine,
      sourceType: 'account',
      sourceId: account.id
    };
  }

  return {
    id: `career-source-${account.id}`,
    enabled: true,
    sourceType: 'account',
    sourceId: account.id,
    contributionRate: 0,
    savingsMonthly: false,
    monthlyWithdrawal: 0,
    maxBalance: 0,
    overflowFallbackAccountId: null,
    mode: 'percentOfSalary',
    fixedAmount: 0,
    increaseWithPaycheck: false,
    increaseWithdrawalWithPaycheck: false
  };
};

export const CareerPlanEditor = memo(({
  value,
  selectedCareerId,
  onSelectCareer,
  onChangeCareer,
  onDuplicateCareer,
  onReorderCareers,
  onAddCareer,
  onRemoveCareer,
  previewYear,
  bankAccounts,
  pools,
  birthdayBasedCareerStartAge,
  dateOfBirth,
  currentAge,
  incomeFallbackAccountId,
  incomeFallbackAccountId2,
  onChangeIncomeFallbackAccount1,
  onChangeIncomeFallbackAccount2,
  incomeFallbackNotice,
  onDismissIncomeFallbackNotice,
  withdrawalShortfalls,
  dateMarkers = [],
  allowReordering = true
}: CareerPlanEditorProps) => {
  useRenderCount('CareerPlanEditor');
  const selectedCareer = value.entries.find((career) => career.id === selectedCareerId) ?? value.entries[0];
  const [dragCareerId, setDragCareerId] = useState<string | null>(null);
  const [showPaycheckModal, setShowPaycheckModal] = useState(false);
  const [selectedPayPlanId, setSelectedPayPlanId] = useState('initial');
  const payPlans = useMemo(() => selectedCareer?.payPlans ?? [], [selectedCareer]);
  const activePlan = selectedPayPlanId === 'initial' ? undefined : payPlans.find((plan) => plan.id === selectedPayPlanId);
  const activePaycheck = (activePlan?.paycheck ?? selectedCareer?.paycheck)
    ?? (selectedCareer ? paycheckFromPaycheckInfo(selectedCareer.paycheckInfo) : undefined);
  const activeSourceLines = activePlan?.sourceLines ?? selectedCareer?.sourceLines ?? [];
  const lineCareer = selectedCareer ? { ...selectedCareer, sourceLines: activeSourceLines } : undefined;
  const activePaycheckTotals = activePaycheck ? getPaycheckTotals(activePaycheck) : undefined;
  const paycheckDeductionsExceedGross = Boolean(activePaycheckTotals)
    && activePaycheckTotals!.grossAnnual <
      activePaycheckTotals!.taxAnnual + activePaycheckTotals!.pretaxAnnual + activePaycheckTotals!.posttaxAnnual - 0.01;

    useEffect(() => {
    setSelectedPayPlanId('initial');
  }, [selectedCareer?.id]);

  const writeActiveSourceLines = (nextSourceLines: CareerSourceLine[]) => {
    if (!selectedCareer) {
      return;
    }
    if (activePlan) {
      onChangeCareer({
        ...selectedCareer,
        payPlans: payPlans.map((plan) => (plan.id === activePlan.id ? { ...plan, sourceLines: nextSourceLines } : plan))
      });
    } else {
      onChangeCareer({ ...selectedCareer, sourceLines: nextSourceLines });
    }
  };

  const updateActivePaycheck = (nextPaycheck: Paycheck) => {
    if (!selectedCareer) {
      return;
    }
    if (activePlan) {
      onChangeCareer({
        ...selectedCareer,
        payPlans: payPlans.map((plan) => (plan.id === activePlan.id ? { ...plan, paycheck: nextPaycheck } : plan))
      });
    } else {
      onChangeCareer({ ...selectedCareer, paycheck: nextPaycheck, paycheckInfo: compilePaycheck(nextPaycheck) });
    }
  };

  const handleAddPayPlan = () => {
    if (!selectedCareer || !activePaycheck) {
      return;
    }
    const careerStartMonth = selectedCareer.startYearMonth || formatYearMonthFromAge(selectedCareer.startAge, dateOfBirth, currentAge);
    const lastPlanMonth = payPlans.length > 0 ? payPlans[payPlans.length - 1].effectiveYearMonth : '';
    const defaultMonth = addMonthsToYearMonth(lastPlanMonth || careerStartMonth, 12);
    const plan = createCareerPayPlan(`Plan ${payPlans.length + 2}`, defaultMonth, activePaycheck, activeSourceLines);
    onChangeCareer({ ...selectedCareer, payPlans: [...payPlans, plan] });
    setSelectedPayPlanId(plan.id);
  };

  const handleRemovePayPlan = (planId: string) => {
    if (!selectedCareer) {
      return;
    }
    onChangeCareer({ ...selectedCareer, payPlans: payPlans.filter((plan) => plan.id !== planId) });
    if (selectedPayPlanId === planId) {
      setSelectedPayPlanId('initial');
    }
  };

  const handleUpdatePayPlan = (planId: string, patch: Partial<CareerPayPlan>) => {
    if (!selectedCareer) {
      return;
    }
    onChangeCareer({ ...selectedCareer, payPlans: payPlans.map((plan) => (plan.id === planId ? { ...plan, ...patch } : plan)) });
  };


  const selectedCareerIndex = selectedCareer ? value.entries.findIndex((career) => career.id === selectedCareer.id) : -1;
  const previousCareer = selectedCareerIndex > 0 ? value.entries[selectedCareerIndex - 1] : undefined;
  const previousCareerEndYearMonth = previousCareer
    ? previousCareer.endYearMonth || formatYearMonthFromAge(previousCareer.endAge, dateOfBirth, currentAge)
    : '';
  const previousCareerStartYearMonth = previousCareerEndYearMonth
    ? addMonthsToYearMonth(previousCareerEndYearMonth, 1)
    : '';
  const previousCareerStartAge = previousCareer
    ? previousCareerStartYearMonth
      ? ageFromYearMonth(previousCareerStartYearMonth, dateOfBirth, currentAge, 18, 110) ?? previousCareer.endAge
      : previousCareer.endAge
    : undefined;
  const selectedStartAge = selectedCareer
    ? selectedCareer.useBirthdayBasedStartAge
      ? birthdayBasedCareerStartAge
      : selectedCareer.usePreviousCareerStartAge && previousCareer
        ? previousCareerStartAge
        : selectedCareer.startAge
    : undefined;

  const orderedBankAccounts = useMemo(
    () => [...bankAccounts].sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label)),
    [bankAccounts]
  );

  const handleRemoveCareer = (careerId: string) => {
    if (window.confirm('Remove this career from the timeline?')) {
      onRemoveCareer(careerId);
    }
  };

  const handleSavePaycheck = (nextPaycheck: Paycheck) => {
    updateActivePaycheck(nextPaycheck);
    setShowPaycheckModal(false);
  };

  const handleCopyFromPrevious = () => {
    if (!previousCareer || !selectedCareer) return;
    if (!window.confirm(`Copy pay settings from "${previousCareer.label}"? This will overwrite current pay settings.`)) return;
    const prev = previousCareer.paycheckInfo as Partial<PaycheckInfo> | undefined;
    if (!prev) return;
    const partialPaycheck: Partial<PaycheckInfo> = {
      grossSalary: prev.grossSalary,
      healthBenefits: prev.healthBenefits,
      taxes: prev.taxes,
      otherBenefits: prev.otherBenefits,
      retirement: prev.retirement,
      retirementMode: prev.retirementMode,
      retirementMatch: prev.retirementMatch,
      retirementMatchMode: prev.retirementMatchMode,
      employerMaxMatchPercent: prev.employerMaxMatchPercent,
      retirementAccountId: prev.retirementAccountId,
      hsaContribution: prev.hsaContribution,
      hsaContributionMode: prev.hsaContributionMode,
      hsaEmployerMatch: prev.hsaEmployerMatch,
      hsaEmployerMatchMode: prev.hsaEmployerMatchMode,
      employerHsaDeposit: prev.employerHsaDeposit,
      employerHsaDepositMode: prev.employerHsaDepositMode,
      hsaAccountId: prev.hsaAccountId,
      livingExpenses: prev.livingExpenses,
      period: prev.period
    };
    const nextPaycheckInfo = { ...(selectedCareer.paycheckInfo ?? {} as PaycheckInfo), ...partialPaycheck } as PaycheckInfo;
    const targetPaycheck = paycheckFromPaycheckInfo(nextPaycheckInfo);
    if (activePlan) {
      onChangeCareer({
        ...selectedCareer,
        annualRaiseRate: previousCareer.annualRaiseRate,
        payPlans: payPlans.map((plan) => (plan.id === activePlan.id ? { ...plan, paycheck: targetPaycheck } : plan))
      });
    } else {
      onChangeCareer({
        ...selectedCareer,
        annualRaiseRate: previousCareer.annualRaiseRate,
        paycheckInfo: nextPaycheckInfo,
        paycheck: targetPaycheck
      });
    }
  };
  const previewNetIncome = activePlan
    ? (activePaycheckTotals?.netAnnual ?? 0)
    : previewYear?.netIncome ?? careerAnnualNetIncome(selectedCareer);
  const activeStartAge = selectedStartAge ?? selectedCareer.startAge;
  const periodYears = Math.max(0, selectedCareer.endAge - activeStartAge + 1);
  const periodMonths = periodYears * 12;
  const startAgeMin = 18;
  const startAgeMax = 110;
  const endAgeMin = selectedStartAge ?? selectedCareer.startAge;
  const endAgeMax = 110;
  const startYearMonthValue =
    selectedCareer.useBirthdayBasedStartAge
      ? formatYearMonthFromAge(selectedStartAge ?? selectedCareer.startAge, dateOfBirth, currentAge)
      : selectedCareer.usePreviousCareerStartAge && previousCareer
        ? previousCareerStartYearMonth || formatYearMonthFromAge(previousCareer.endAge, dateOfBirth, currentAge)
        : selectedCareer.startYearMonth || formatYearMonthFromAge(selectedStartAge ?? selectedCareer.startAge, dateOfBirth, currentAge);
  const endYearMonthValue =
    selectedCareer.endYearMonth || formatYearMonthFromAge(selectedCareer.endAge, dateOfBirth, currentAge);

  const annualSavingsFromPercentage = (percentage: number, income = previewNetIncome) => Math.round(income * (percentage / 100));

  const getLineForAccount = (career: CareerEntry | undefined, account: BankAccountDefinition) =>
    resolveCareerLineForAccount(career, account);

  const updateLineForAccount = (
    account: BankAccountDefinition,
    updates: Partial<
      Pick<CareerSourceLine, 'contributionRate' | 'savingsMonthly' | 'monthlyWithdrawal' | 'enabled' | 'maxBalance' | 'overflowFallbackAccountId' | 'mode' | 'fixedAmount' | 'increaseWithPaycheck' | 'increaseWithdrawalWithPaycheck'>
    >
  ) => {
    const existingLine = getLineForAccount(lineCareer, account);
    const nextLine: CareerSourceLine = {
      ...existingLine,
      ...updates,
      id: existingLine.id || `career-source-${account.id}`,
      enabled: updates.enabled ?? true,
      sourceType: 'account',
      sourceId: account.id,
      mode: updates.mode ?? existingLine.mode ?? 'percentOfSalary',
      contributionRate: Math.max(0, updates.contributionRate ?? existingLine.contributionRate),
      fixedAmount: Math.max(0, updates.fixedAmount ?? existingLine.fixedAmount ?? 0),
      increaseWithPaycheck: updates.increaseWithPaycheck ?? existingLine.increaseWithPaycheck ?? false,
      increaseWithdrawalWithPaycheck: updates.increaseWithdrawalWithPaycheck ?? existingLine.increaseWithdrawalWithPaycheck ?? false,
      monthlyWithdrawal: Math.max(0, updates.monthlyWithdrawal ?? existingLine.monthlyWithdrawal),
      maxBalance: Math.max(0, updates.maxBalance ?? existingLine.maxBalance ?? 0),
      overflowFallbackAccountId:
        updates.overflowFallbackAccountId === null
          ? null
          : typeof updates.overflowFallbackAccountId === 'string'
            ? updates.overflowFallbackAccountId
            : existingLine.overflowFallbackAccountId ?? null
    };
    const remainingLines = activeSourceLines.filter(
      (line) =>
        !(line.sourceType === 'account' && line.sourceId === account.id) &&
        !(line.sourceType === 'pool' && line.sourceId === account.poolId)
    );

    writeActiveSourceLines([...remainingLines, nextLine]);
  };

  const getCareerPercentage = (account: BankAccountDefinition) => getLineForAccount(lineCareer, account).contributionRate;

  const getSourceLineMode = (account: BankAccountDefinition): 'percentOfSalary' | 'fixedAmount' =>
    getLineForAccount(lineCareer, account).mode ?? 'percentOfSalary';

  const getSourceLineFixedAmount = (account: BankAccountDefinition) => getLineForAccount(lineCareer, account).fixedAmount ?? 0;

  const getSourceLineIncreasesWithPaycheck = (account: BankAccountDefinition) =>
    Boolean(getLineForAccount(lineCareer, account).increaseWithPaycheck);

  const getWithdrawalIncreasesWithPaycheck = (account: BankAccountDefinition) =>
    Boolean(getLineForAccount(lineCareer, account).increaseWithdrawalWithPaycheck);

  const getWithdrawalShortfall = (account: BankAccountDefinition) => {
    if (!withdrawalShortfalls) {
      return 0;
    }
    const line = getLineForAccount(lineCareer, account);
    return withdrawalShortfalls[line.sourceId ?? account.id] ?? 0;
  };

  const isSavingsMonthly = (account: BankAccountDefinition) => getLineForAccount(lineCareer, account).savingsMonthly;

  const savingsInputAmountFromPercentage = (account: BankAccountDefinition) => {
    const annualSavings = annualSavingsFromPercentage(getCareerPercentage(account));
    return isSavingsMonthly(account) ? Math.round(annualSavings / 12) : annualSavings;
  };

  const annualSavingsFromInputAmount = (account: BankAccountDefinition, inputAmount: number) =>
    Math.round(isSavingsMonthly(account) ? inputAmount * 12 : inputAmount);

  const getMonthlyWithdrawal = (account: BankAccountDefinition) => getLineForAccount(lineCareer, account).monthlyWithdrawal;
  const getMaxBalance = (account: BankAccountDefinition) => getLineForAccount(lineCareer, account).maxBalance ?? 0;
  const getOverflowFallbackAccountId = (account: BankAccountDefinition) =>
    getLineForAccount(lineCareer, account).overflowFallbackAccountId ?? null;

  const calculateCareerEndBalancesThroughIndex = (targetIndex: number): Record<string, number> => {
    let balances: Record<string, number> = Object.fromEntries(
      orderedBankAccounts.map((account) => [account.id, Math.max(0, account.balance)])
    );

    for (let index = 0; index <= targetIndex; index += 1) {
      const career = value.entries[index];
      const months = Math.max(0, career.endAge - career.startAge + 1) * 12;
      const salary = careerAnnualNetIncome(career);
      const nextBalances: Record<string, number> = { ...balances };

      orderedBankAccounts.forEach((account) => {
        const line = getLineForAccount(career, account);
        const startBalance = balances[account.id] ?? 0;
        const annualSavings = annualSavingsFromPercentage(line.contributionRate, salary);
        const monthlyWithdrawal = Math.max(0, line.monthlyWithdrawal);
        const monthlyContribution = annualSavings / 12;
        const pool = pools.find((p) => p.id === account.poolId);
        const monthlyRate = (pool?.preRetirementReturnRate ?? 0) / 100 / 12;

        if (months <= 0 || (startBalance <= 0 && annualSavings <= 0 && monthlyWithdrawal <= 0)) {
          nextBalances[account.id] = roundCurrency(startBalance);
          return;
        }

        let running = startBalance;
        for (let month = 0; month < months; month += 1) {
          if (monthlyRate === 0) {
            running = Math.max(0, running + monthlyContribution - monthlyWithdrawal);
          } else {
            running = Math.max(0, (running + monthlyContribution - monthlyWithdrawal) * (1 + monthlyRate));
          }
        }

        nextBalances[account.id] = roundCurrency(running);
      });

      balances = nextBalances;
    }

    return balances;
  };

  const previousCareerEndingBalances =
    selectedCareerIndex > 0 ? calculateCareerEndBalancesThroughIndex(selectedCareerIndex - 1) : null;

  const getDisplayedStartBalance = (account: BankAccountDefinition) =>
    previousCareerEndingBalances ? previousCareerEndingBalances[account.id] ?? 0 : Math.max(0, account.balance);

  const calculateEndOfPeriodBalanceForAccount = (
    account: BankAccountDefinition,
    startingBalance: number,
    annualSavings: number
  ) => {
    if (periodMonths <= 0) {
      return roundCurrency(startingBalance);
    }

    const monthlyContribution = annualSavings / 12;
    const pool = pools.find((p) => p.id === account.poolId);
    const monthlyRate = (pool?.preRetirementReturnRate ?? 0) / 100 / 12;
    const monthlyWithdrawal = Math.max(0, getMonthlyWithdrawal(account));
    let running = startingBalance;

    for (let month = 0; month < periodMonths; month += 1) {
      if (monthlyRate === 0) {
        running = Math.max(0, running + monthlyContribution - monthlyWithdrawal);
      } else {
        running = Math.max(0, (running + monthlyContribution - monthlyWithdrawal) * (1 + monthlyRate));
      }
    }

    return roundCurrency(running);
  };

  const calculatedTotalSavingsRate = roundCurrency(
    orderedBankAccounts.reduce((sum, account) => sum + Math.max(0, getCareerPercentage(account)), 0)
  );

  return (
    <div className="career-editor">
      <div className="career-tabs">
        {value.entries.map((career) => (
          <button
            key={career.id}
            type="button"
            className={`${career.id === selectedCareer?.id ? 'career-tab active' : 'career-tab'}${
              dragCareerId === career.id ? ' dragging' : ''
            }`}
            draggable={allowReordering}
            onClick={() => onSelectCareer(career.id)}
            onDragStart={() => allowReordering && setDragCareerId(career.id)}
            onDragOver={(event) => allowReordering && event.preventDefault()}
            onDrop={() => {
              if (allowReordering && dragCareerId) {
                onReorderCareers(dragCareerId, career.id);
              }
            }}
            onDragEnd={() => allowReordering && setDragCareerId(null)}
          >
            {career.label}
          </button>
        ))}
        <button type="button" className="career-tab add" onClick={onAddCareer}>
          + Career
        </button>
      </div>

      <label className="checkbox-row career-enable">
        <input
          type="checkbox"
          checked={selectedCareer?.enabled ?? false}
          onChange={(event) => selectedCareer && onChangeCareer({ ...selectedCareer, enabled: event.target.checked })}
        />
        <span>Estimate income from this career</span>
      </label>

      {selectedCareer && (
        <div className="pay-plan-bar">
          <div className="pay-plan-selector">
            <span>Net pay plan</span>
            <div className="pay-plan-chips" role="tablist" aria-label="Net pay plan">
              <button
                type="button"
                role="tab"
                aria-selected={selectedPayPlanId === 'initial'}
                className={`career-tab${selectedPayPlanId === 'initial' ? ' active' : ''}`}
                onClick={() => setSelectedPayPlanId('initial')}
              >
                Initial
              </button>
              {payPlans.map((plan) => {
                const isActive = selectedPayPlanId === plan.id;
                return (
                  <button
                    key={plan.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={`career-tab${isActive ? ' active' : ''}`}
                    onClick={() => setSelectedPayPlanId(plan.id)}
                  >
                    {plan.label}
                    {plan.effectiveYearMonth ? ` (${plan.effectiveYearMonth})` : ''}
                  </button>
                );
              })}
            </div>
          </div>
          <button type="button" className="secondary-button" onClick={handleAddPayPlan}>
            + Pay Plan
          </button>
          {activePlan && (
            <button type="button" className="text-button" onClick={() => handleRemovePayPlan(activePlan.id)}>
              Remove plan
            </button>
          )}
          {activePlan && (
            <label className="pay-plan-label">
              <span>Plan name</span>
              <input
                type="text"
                aria-label="Pay plan name"
                value={activePlan.label}
                onChange={(event) => handleUpdatePayPlan(activePlan.id, { label: event.target.value })}
              />
            </label>
          )}
          {activePlan && (
            <label className="pay-plan-date">
              <span>Effective from</span>
              <DateOrMarkerInput
                label="Effective"
                value={activePlan.effectiveYearMonth}
                markerId={activePlan.effectiveMarkerId}
                markers={dateMarkers}
                onChange={(value, markerId) =>
                  handleUpdatePayPlan(activePlan.id, { effectiveYearMonth: value, effectiveMarkerId: markerId })
                }
              />
            </label>
          )}
        </div>
      )}

      {selectedCareer ? (
        <>
          <div className="career-grid">
            <label className="full-span">
              <span>Career Label</span>
              <input type="text" value={selectedCareer.label} onChange={(event) => onChangeCareer({ ...selectedCareer, label: event.target.value })} />
            </label>
            <label>
              <span>Start Age</span>
              <BufferedNumberInput
                value={selectedStartAge ?? selectedCareer.startAge}
                min={startAgeMin}
                max={startAgeMax}
                disabled={selectedCareer.useBirthdayBasedStartAge || (selectedCareer.usePreviousCareerStartAge && Boolean(previousCareer))}
                onCommit={(next) =>
                  onChangeCareer({
                    ...selectedCareer,
                    startAge: next,
                    startYearMonth: formatYearMonthFromAge(next, dateOfBirth, currentAge)
                  })
                }
              />
            </label>
            <label>
              <span>Start (Year-Month)</span>
              <DateOrMarkerInput
                label="Start"
                value={startYearMonthValue}
                markerId={selectedCareer.startMarkerId}
                markers={dateMarkers}
                disabled={selectedCareer.useBirthdayBasedStartAge || (selectedCareer.usePreviousCareerStartAge && Boolean(previousCareer))}
                onChange={(next, markerId) => {
                  const derivedAge = ageFromYearMonth(next, dateOfBirth, currentAge, startAgeMin, startAgeMax);

                  if (derivedAge === null && !markerId) {
                    return;
                  }

                  onChangeCareer({
                    ...selectedCareer,
                    startAge: derivedAge ?? selectedCareer.startAge,
                    endAge: derivedAge === null ? selectedCareer.endAge : Math.max(selectedCareer.endAge, derivedAge),
                    startYearMonth: next,
                    startMarkerId: markerId,
                    useBirthdayBasedStartAge: markerId ? false : selectedCareer.useBirthdayBasedStartAge,
                    usePreviousCareerStartAge: markerId ? false : selectedCareer.usePreviousCareerStartAge
                  });
                }}
              />
            </label>
            <label>
              <span>End Age</span>
              <BufferedNumberInput
                value={selectedCareer.endAge}
                min={endAgeMin}
                max={endAgeMax}
                onCommit={(next) =>
                  onChangeCareer({
                    ...selectedCareer,
                    endAge: next,
                    endYearMonth: formatYearMonthFromAge(next, dateOfBirth, currentAge)
                  })
                }
              />
            </label>
            <label>
              <span>End (Year-Month)</span>
              <DateOrMarkerInput
                label="End"
                value={endYearMonthValue}
                markerId={selectedCareer.endMarkerId}
                markers={dateMarkers}
                onChange={(next, markerId) => {
                  const derivedAge = ageFromYearMonth(next, dateOfBirth, currentAge, endAgeMin, endAgeMax);

                  if (derivedAge === null && !markerId) {
                    return;
                  }

                  onChangeCareer({
                    ...selectedCareer,
                    endAge: derivedAge ?? selectedCareer.endAge,
                    endYearMonth: next,
                    endMarkerId: markerId
                  });
                }}
              />
            </label>
            <label className="full-span checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(selectedCareer.useBirthdayBasedStartAge)}
                onChange={(event) =>
                  onChangeCareer({
                    ...selectedCareer,
                    useBirthdayBasedStartAge: event.target.checked,
                    usePreviousCareerStartAge: event.target.checked ? false : selectedCareer.usePreviousCareerStartAge,
                    startMarkerId: event.target.checked ? null : selectedCareer.startMarkerId,
                    startAge: event.target.checked ? birthdayBasedCareerStartAge : selectedStartAge ?? selectedCareer.startAge,
                    startYearMonth: formatYearMonthFromAge(
                      event.target.checked ? birthdayBasedCareerStartAge : selectedStartAge ?? selectedCareer.startAge,
                      dateOfBirth,
                      currentAge
                    )
                  })
                }
              />
              <span>Use current age from birthday (this month/year aware)</span>
            </label>
            <label className="full-span checkbox-row">
              <input
                type="checkbox"
                checked={selectedCareer.usePreviousCareerStartAge}
                disabled={!previousCareer || Boolean(selectedCareer.useBirthdayBasedStartAge)}
                onChange={(event) =>
                  onChangeCareer({
                    ...selectedCareer,
                    usePreviousCareerStartAge: event.target.checked,
                    useBirthdayBasedStartAge: event.target.checked ? false : selectedCareer.useBirthdayBasedStartAge,
                    startMarkerId: event.target.checked ? null : selectedCareer.startMarkerId,
                    startAge: event.target.checked && previousCareer ? previousCareerStartAge ?? previousCareer.endAge : selectedCareer.startAge,
                    startYearMonth:
                      event.target.checked && previousCareer
                        ? previousCareerStartYearMonth || formatYearMonthFromAge(previousCareer.endAge, dateOfBirth, currentAge)
                        : formatYearMonthFromAge(selectedCareer.startAge, dateOfBirth, currentAge)
                  })
                }
              />
              <span>Use the month after the previous career end as this start</span>
            </label>
            <label>
              <span>Annual Raise %</span>
              <BufferedNumberInput
                value={selectedCareer.annualRaiseRate}
                min={0}
                max={20}
                step={0.1}
                onCommit={(next) => onChangeCareer({ ...selectedCareer, annualRaiseRate: next })}
              />
            </label>
            <label>
              <span>Total Savings Rate %</span>
              <BufferedNumberInput value={calculatedTotalSavingsRate} min={0} max={100} step={0.1} disabled onCommit={() => {}} />
            </label>
          </div>

          <div className="paycheck-summary">
            <div className="paycheck-summary-header">
              <strong>Paycheck</strong>
              <button type="button" className="secondary-button" onClick={() => setShowPaycheckModal(true)}>
                Configure Paycheck
              </button>
            </div>
            <div className="paycheck-summary-row">
              <span>Pay frequency</span>
              <span>{activePaycheckTotals ? `${PAY_FREQUENCY_LABELS[activePaycheck!.payFrequency]} (${activePaycheckTotals.periodsPerYear}/yr)` : '-'}</span>
            </div>
            <div className="paycheck-summary-row">
              <span>Gross / period</span>
              <span>{activePaycheckTotals ? formatCurrency(activePaycheckTotals.grossPerPeriod) : '-'}</span>
            </div>
            <div className="paycheck-summary-row">
              <span>Annual gross</span>
              <span>{activePaycheckTotals ? formatCurrency(activePaycheckTotals.grossAnnual) : '-'}</span>
            </div>
            <div className="paycheck-summary-row">
              <span>Taxes</span>
              <span>{activePaycheckTotals ? formatCurrency(activePaycheckTotals.taxAnnual) : '-'}</span>
            </div>
            <div className="paycheck-summary-row">
              <span>Deductions (pre + post tax)</span>
              <span>{activePaycheckTotals ? formatCurrency(activePaycheckTotals.pretaxAnnual + activePaycheckTotals.posttaxAnnual) : '-'}</span>
            </div>
            <div className="paycheck-summary-row">
              <span>Employer contributions</span>
              <span>{activePaycheckTotals ? formatCurrency(activePaycheckTotals.employerAnnual) : '-'}</span>
            </div>
            <div
              className={`paycheck-summary-row net${paycheckDeductionsExceedGross ? ' invalid' : ''}`}
              title={paycheckDeductionsExceedGross ? 'Deductions exceed gross pay; net pay is $0.' : undefined}
            >
              <span>Net pay / period</span>
              <span>
                {activePaycheckTotals ? formatCurrency(activePaycheckTotals.netPerPeriod) : '-'}
                {paycheckDeductionsExceedGross ? ' (deductions exceed gross)' : ''}
              </span>
            </div>
            {previousCareer && (
              <button type="button" className="secondary-button" onClick={handleCopyFromPrevious}>
                Copy Pay from Previous
              </button>
            )}
          </div>

          <div className="career-savings-grid">
            <div className="career-savings-row career-savings-header">
              <div className="career-savings-cell">Starting Balance</div>
              <div className="career-savings-cell">Monthly</div>
              <div className="career-savings-cell">Account</div>
              <div className="career-savings-cell">Percentage</div>
              <div className="career-savings-cell">Savings</div>
              <div className="career-savings-cell">Max Balance</div>
              <div className="career-savings-cell">Overflow Fallback</div>
              <div className="career-savings-cell">Balance at end of period</div>
            </div>
            {orderedBankAccounts.map((account) => (
              <div key={account.id} className="career-savings-row">
                <div className="career-savings-cell">
                  <div className="start-balance-cell">
                    <BufferedNumberInput value={getDisplayedStartBalance(account)} min={0} max={50000000} step={100} disabled onCommit={() => {}} />
                    <span className="start-source">{selectedCareerIndex > 0 ? 'From previous career' : 'From Net Worth'}</span>
                  </div>
                </div>
                <div className="career-savings-cell">
                  <input
                    type="checkbox"
                    checked={isSavingsMonthly(account)}
                    onChange={(event) => updateLineForAccount(account, { savingsMonthly: event.target.checked })}
                  />
                </div>
                <div className="career-savings-cell career-savings-label">{account.label}</div>
                <div className="career-savings-cell">
                  <div className="tax-rate-row">
                    {getSourceLineMode(account) === 'fixedAmount' ? (
                      <BufferedNumberInput
                        value={getSourceLineFixedAmount(account)}
                        min={0}
                        max={2000000}
                        step={25}
                        onCommit={(next) => updateLineForAccount(account, { fixedAmount: next })}
                      />
                    ) : (
                      <BufferedNumberInput
                        value={Math.round(getCareerPercentage(account) * 100) / 100}
                        min={0}
                        max={100}
                        step={0.1}
                        onCommit={(next) => updateLineForAccount(account, { contributionRate: next })}
                      />
                    )}
                    <button
                      type="button"
                      className={`lock-btn${getSourceLineMode(account) === 'fixedAmount' ? ' locked' : ''}`}
                      title={getSourceLineMode(account) === 'fixedAmount' ? 'Fixed amount per pay period' : 'Percent of salary'}
                      onClick={() =>
                        updateLineForAccount(account, {
                          mode: getSourceLineMode(account) === 'fixedAmount' ? 'percentOfSalary' : 'fixedAmount'
                        })
                      }
                    >
                      {getSourceLineMode(account) === 'fixedAmount' ? '$' : '%'}
                    </button>
                    {getSourceLineMode(account) === 'fixedAmount' && (
                      <button
                        type="button"
                        className={`lock-btn${getSourceLineIncreasesWithPaycheck(account) ? ' locked' : ''}`}
                        title={getSourceLineIncreasesWithPaycheck(account) ? 'Increases with the annual paycheck raise' : 'Fixed amount (does not increase with the raise)'}
                        aria-label={`Increase with paycheck ${account.label}`}
                        aria-pressed={getSourceLineIncreasesWithPaycheck(account)}
                        onClick={() => updateLineForAccount(account, { increaseWithPaycheck: !getSourceLineIncreasesWithPaycheck(account) })}
                      >
                        ↑
                      </button>
                    )}
                  </div>
                </div>
                <div className="career-savings-cell">
                  <BufferedNumberInput
                    value={savingsInputAmountFromPercentage(account)}
                    min={0}
                    max={2000000}
                    step={100}
                    onCommit={(next) => {
                      const annualSavings = annualSavingsFromInputAmount(account, next);
                      const derivedPercentage = previewNetIncome > 0 ? roundCurrency((annualSavings / previewNetIncome) * 100) : 0;
                      updateLineForAccount(account, { contributionRate: derivedPercentage });
                    }}
                  />
                </div>
                <div className="career-savings-cell">
                  <BufferedNumberInput
                    value={getMaxBalance(account)}
                    min={0}
                    max={50000000}
                    step={100}
                    onCommit={(next) => updateLineForAccount(account, { maxBalance: next })}
                  />
                </div>
                <div className="career-savings-cell">
                  <select
                    value={getOverflowFallbackAccountId(account) ?? ''}
                    onChange={(event) => updateLineForAccount(account, { overflowFallbackAccountId: event.target.value || null })}
                  >
                    <option value="">None</option>
                    {orderedBankAccounts
                      .filter((candidate) => candidate.id !== account.id)
                      .map((candidate) => (
                        <option key={`${account.id}-fallback-${candidate.id}`} value={candidate.id}>
                          {candidate.label}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="career-savings-cell">
                  {formatCurrency(
                    calculateEndOfPeriodBalanceForAccount(
                      account,
                      getDisplayedStartBalance(account),
                      annualSavingsFromInputAmount(account, savingsInputAmountFromPercentage(account))
                    )
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="career-grid">
            <label className="full-span">
              <span>Expenses (Monthly Withdrawals by Account)</span>
            </label>
            {orderedBankAccounts.map((account) => (
              <label
                key={`expense-${account.id}`}
                className={getWithdrawalShortfall(account) > 0.01 ? 'invalid' : undefined}
                title={
                  getWithdrawalShortfall(account) > 0.01
                    ? `This monthly withdrawal exceeds the account balance; ${formatCurrency(getWithdrawalShortfall(account))} was unfunded.`
                    : undefined
                }
              >
                <span>{account.label} Monthly Withdrawal</span>
                <div className="tax-rate-row">
                  <BufferedNumberInput
                    value={getMonthlyWithdrawal(account)}
                    min={0}
                    max={1000000}
                    step={50}
                    onCommit={(next) => updateLineForAccount(account, { monthlyWithdrawal: next })}
                  />
                  <button
                    type="button"
                    className={`lock-btn${getWithdrawalIncreasesWithPaycheck(account) ? ' locked' : ''}`}
                    title={getWithdrawalIncreasesWithPaycheck(account) ? 'Increases with the annual paycheck raise' : 'Fixed amount (does not increase with the raise)'}
                    aria-label={`Increase withdrawal with paycheck ${account.label}`}
                    aria-pressed={getWithdrawalIncreasesWithPaycheck(account)}
                    onClick={() => updateLineForAccount(account, { increaseWithdrawalWithPaycheck: !getWithdrawalIncreasesWithPaycheck(account) })}
                  >
                    ↑
                  </button>
                </div>
            </label>
            ))}
          </div>

          <div className="career-grid">
            <label className="full-span">
              <span>Income Fallback Accounts</span>
            </label>
            <label>
              <span>Primary Fallback</span>
              <select
                value={incomeFallbackAccountId ?? ''}
                onChange={(event) => onChangeIncomeFallbackAccount1(event.target.value || null)}
              >
                <option value="">None</option>
                {orderedBankAccounts.map((account) => (
                  <option key={`fallback1-${account.id}`} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Secondary Fallback</span>
              <select
                value={incomeFallbackAccountId2 ?? ''}
                onChange={(event) => onChangeIncomeFallbackAccount2(event.target.value || null)}
              >
                <option value="">None</option>
                {orderedBankAccounts.map((account) => (
                  <option key={`fallback2-${account.id}`} value={account.id}>
                    {account.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="subtle" style={{ gridColumn: '1 / -1', margin: '-0.2rem 0 0.5rem', fontSize: '0.78rem' }}>
            Used when income-funded purchases or loan payments exceed your available monthly income.
          </p>

          {incomeFallbackNotice && (
            <p className="fallback-notice" role="status">
              {incomeFallbackNotice}{' '}
              <button type="button" className="text-button" onClick={onDismissIncomeFallbackNotice}>
                Dismiss
              </button>
            </p>
          )}

          <div className="career-summary">
            <p>
              Selected timeline: <strong>{selectedStartAge ?? selectedCareer.startAge}</strong> to <strong>{selectedCareer.endAge}</strong>
            </p>
            <p>
              Starting net income: <strong>{formatCurrency(activePaycheckTotals?.netAnnual ?? careerAnnualNetIncome(selectedCareer))}</strong>
            </p>
            <p>
              Preview net income: <strong>{previewYear ? formatCurrency(previewYear.netIncome) : '$0'}</strong>
            </p>
            <p>
              Preview savings from career income: <strong>{previewYear ? formatCurrency(previewYear.careerContribution) : '$0'}</strong>
            </p>
          </div>

          <div className="career-actions">
            <button type="button" className="secondary-button" onClick={() => onDuplicateCareer(selectedCareer.id)}>
              Duplicate Career
            </button>
            <button type="button" className="secondary-button danger-button" onClick={() => handleRemoveCareer(selectedCareer.id)}>
              Remove Career
            </button>
          </div>
        </>
      ) : null}

      {showPaycheckModal && selectedCareer && activePaycheck && (
        <PaycheckEditorModal
          paycheck={activePaycheck}
          bankAccounts={bankAccounts}
          onClose={() => setShowPaycheckModal(false)}
          onSave={handleSavePaycheck}
        />
      )}
    </div>
  );
});
