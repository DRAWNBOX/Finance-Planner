import { memo, useMemo, useState } from 'react';
import { BufferedNumberInput } from './BufferedNumberInput';
import { YearMonthInput } from './YearMonthInput';
import type { BankAccountDefinition, CareerEntry, CareerPlan, CareerSourceLine, PaycheckInfo, PoolDefinition, ProjectionYear } from '../types';
import { ageFromYearMonth, formatYearMonthFromAge } from '../utils/ageDate';
import { useRenderCount } from '../utils/perfTools';

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
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

const resolveCareerLineForAccount = (
  career: CareerEntry,
  account: BankAccountDefinition
): CareerSourceLine => {
  const existingLines = career.sourceLines ?? [];
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
    overflowFallbackAccountId: null
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
  onChangeIncomeFallbackAccount2
}: CareerPlanEditorProps) => {
  useRenderCount('CareerPlanEditor');
  const selectedCareer = value.entries.find((career) => career.id === selectedCareerId) ?? value.entries[0];
  const [dragCareerId, setDragCareerId] = useState<string | null>(null);
  const selectedCareerIndex = selectedCareer ? value.entries.findIndex((career) => career.id === selectedCareer.id) : -1;
  const previousCareer = selectedCareerIndex > 0 ? value.entries[selectedCareerIndex - 1] : undefined;
  const selectedStartAge = selectedCareer
    ? selectedCareer.useBirthdayBasedStartAge
      ? birthdayBasedCareerStartAge
      : selectedCareer.usePreviousCareerStartAge && previousCareer
        ? previousCareer.endAge
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
    onChangeCareer({
      ...selectedCareer,
      annualRaiseRate: previousCareer.annualRaiseRate,
      paycheckInfo: { ...(selectedCareer.paycheckInfo ?? {} as PaycheckInfo), ...partialPaycheck } as PaycheckInfo
    });
  };
  const previewSalary = selectedCareer.paycheckInfo?.grossSalary ?? 0;
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
        ? previousCareer.endYearMonth || formatYearMonthFromAge(previousCareer.endAge, dateOfBirth, currentAge)
        : selectedCareer.startYearMonth || formatYearMonthFromAge(selectedStartAge ?? selectedCareer.startAge, dateOfBirth, currentAge);
  const endYearMonthValue =
    selectedCareer.endYearMonth || formatYearMonthFromAge(selectedCareer.endAge, dateOfBirth, currentAge);

  const annualSavingsFromPercentage = (percentage: number, salary = previewSalary) => Math.round(salary * (percentage / 100));

  const getLineForAccount = (career: CareerEntry, account: BankAccountDefinition) =>
    resolveCareerLineForAccount(career, account);

  const updateLineForAccount = (
    account: BankAccountDefinition,
    updates: Partial<
      Pick<CareerSourceLine, 'contributionRate' | 'savingsMonthly' | 'monthlyWithdrawal' | 'enabled' | 'maxBalance' | 'overflowFallbackAccountId'>
    >
  ) => {
    const existingLine = getLineForAccount(selectedCareer, account);
    const nextLine: CareerSourceLine = {
      ...existingLine,
      ...updates,
      id: existingLine.id || `career-source-${account.id}`,
      enabled: updates.enabled ?? true,
      sourceType: 'account',
      sourceId: account.id,
      contributionRate: Math.max(0, updates.contributionRate ?? existingLine.contributionRate),
      monthlyWithdrawal: Math.max(0, updates.monthlyWithdrawal ?? existingLine.monthlyWithdrawal),
      maxBalance: Math.max(0, updates.maxBalance ?? existingLine.maxBalance ?? 0),
      overflowFallbackAccountId:
        updates.overflowFallbackAccountId === null
          ? null
          : typeof updates.overflowFallbackAccountId === 'string'
            ? updates.overflowFallbackAccountId
            : existingLine.overflowFallbackAccountId ?? null
    };
    const remainingLines = (selectedCareer.sourceLines ?? []).filter(
      (line) =>
        !(line.sourceType === 'account' && line.sourceId === account.id) &&
        !(line.sourceType === 'pool' && line.sourceId === account.poolId)
    );

    onChangeCareer({
      ...selectedCareer,
      sourceLines: [...remainingLines, nextLine]
    });
  };

  const getCareerPercentage = (account: BankAccountDefinition) => getLineForAccount(selectedCareer, account).contributionRate;

  const isSavingsMonthly = (account: BankAccountDefinition) => getLineForAccount(selectedCareer, account).savingsMonthly;

  const savingsInputAmountFromPercentage = (account: BankAccountDefinition) => {
    const annualSavings = annualSavingsFromPercentage(getCareerPercentage(account));
    return isSavingsMonthly(account) ? Math.round(annualSavings / 12) : annualSavings;
  };

  const annualSavingsFromInputAmount = (account: BankAccountDefinition, inputAmount: number) =>
    Math.round(isSavingsMonthly(account) ? inputAmount * 12 : inputAmount);

  const getMonthlyWithdrawal = (account: BankAccountDefinition) => getLineForAccount(selectedCareer, account).monthlyWithdrawal;
  const getMaxBalance = (account: BankAccountDefinition) => getLineForAccount(selectedCareer, account).maxBalance ?? 0;
  const getOverflowFallbackAccountId = (account: BankAccountDefinition) =>
    getLineForAccount(selectedCareer, account).overflowFallbackAccountId ?? null;

  const calculateCareerEndBalancesThroughIndex = (targetIndex: number): Record<string, number> => {
    let balances: Record<string, number> = Object.fromEntries(
      orderedBankAccounts.map((account) => [account.id, Math.max(0, account.balance)])
    );

    for (let index = 0; index <= targetIndex; index += 1) {
      const career = value.entries[index];
      const months = Math.max(0, career.endAge - career.startAge + 1) * 12;
      const salary = career.paycheckInfo?.grossSalary ?? 0;
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
            draggable
            onClick={() => onSelectCareer(career.id)}
            onDragStart={() => setDragCareerId(career.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragCareerId) {
                onReorderCareers(dragCareerId, career.id);
              }
            }}
            onDragEnd={() => setDragCareerId(null)}
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
              <YearMonthInput
                label="Start"
                value={startYearMonthValue}
                disabled={selectedCareer.useBirthdayBasedStartAge || (selectedCareer.usePreviousCareerStartAge && Boolean(previousCareer))}
                onChange={(event) => {
                  const derivedAge = ageFromYearMonth(event, dateOfBirth, currentAge, startAgeMin, startAgeMax);

                  if (derivedAge === null) {
                    return;
                  }

                  onChangeCareer({
                    ...selectedCareer,
                    startAge: derivedAge,
                    endAge: Math.max(selectedCareer.endAge, derivedAge),
                    startYearMonth: event
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
              <YearMonthInput
                label="End"
                value={endYearMonthValue}
                onChange={(nextValue) => {
                  const derivedAge = ageFromYearMonth(nextValue, dateOfBirth, currentAge, endAgeMin, endAgeMax);

                  if (derivedAge === null) {
                    return;
                  }

                  onChangeCareer({ ...selectedCareer, endAge: derivedAge, endYearMonth: nextValue });
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
                    startAge: event.target.checked && previousCareer ? previousCareer.endAge : selectedCareer.startAge,
                    startYearMonth:
                      event.target.checked && previousCareer
                        ? previousCareer.endYearMonth || formatYearMonthFromAge(previousCareer.endAge, dateOfBirth, currentAge)
                        : formatYearMonthFromAge(selectedCareer.startAge, dateOfBirth, currentAge)
                  })
                }
              />
              <span>Use previous career end age as this start age</span>
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

          <div className="career-grid">
            <label className="full-span">
              <span>Income &amp; Deductions</span>
            </label>
            {previousCareer && (
              <label className="full-span">
                <button type="button" className="secondary-button" onClick={handleCopyFromPrevious}>
                  Copy Pay from Previous
                </button>
              </label>
            )}
            {(() => {
              const pi = selectedCareer.paycheckInfo ?? { grossSalary: 0, taxes: 0, healthBenefits: 0, retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0, otherBenefits: 0, livingExpenses: 0 };
              const periodDefaults: Record<string, 'monthly' | 'yearly'> = { grossSalary: 'yearly', taxes: 'yearly', healthBenefits: 'yearly', retirement: 'yearly', retirementMatch: 'yearly', hsaContribution: 'yearly', hsaEmployerMatch: 'yearly', otherBenefits: 'yearly', livingExpenses: 'yearly' };
              const getPeriod = (field: string) => pi.period?.[field] ?? periodDefaults[field] ?? 'yearly';
              const isMonthly = (field: string) => getPeriod(field) === 'monthly';
              const displayVal = (field: string, val: number) => isMonthly(field) ? val / 12 : val;
              const commitVal = (field: string, input: number) => isMonthly(field) ? input * 12 : input;
              const annualEmployeeSavings = Math.round(pi.grossSalary * (calculatedTotalSavingsRate / 100));
              const monthlyGross = pi.grossSalary / 12;
              const monthlyTaxes = pi.taxes / 12;
              const monthlyHealth = pi.healthBenefits / 12;
              const monthlyOther = pi.otherBenefits / 12;
              const effRetirement = pi.retirementMode === 'percentOfSalary' ? pi.grossSalary * (pi.retirement ?? 0) / 100 : (pi.retirement ?? 0);
              const effRetirementMatch = pi.retirementMatchMode === 'percentOfRetirement' ? effRetirement * (pi.retirementMatch ?? 0) / 100 : (pi.retirementMatch ?? 0);
              const effHsa = pi.hsaContributionMode === 'percentOfSalary' ? pi.grossSalary * (pi.hsaContribution ?? 0) / 100 : (pi.hsaContribution ?? 0);
              const effHsaMatch = pi.hsaEmployerMatchMode === 'percentOfHsaContribution' ? effHsa * (pi.hsaEmployerMatch ?? 0) / 100 : (pi.hsaEmployerMatch ?? 0);
              const takeHome = Math.max(0, monthlyGross - monthlyTaxes - monthlyHealth - monthlyOther - (pi.livingExpenses ?? 0) / 12 - effRetirement / 12 - effHsa / 12);

              const updatePaycheck = (partial: Partial<typeof pi>) => {
                onChangeCareer({
                  ...selectedCareer,
                  paycheckInfo: { ...pi, ...partial }
                });
              };

              const renderField = (field: string, label: string, min: number, max: number, step: number, tooltip?: string) => {
                const val = (pi as unknown as Record<string, number>)[field] ?? 0;
                const period = getPeriod(field);
                return (
                  <label>
                    <span title={tooltip}>{label} ({period === 'monthly' ? 'Monthly' : 'Yearly'})</span>
                    <div className="tax-rate-row">
                      <BufferedNumberInput value={displayVal(field, val)} min={min} max={max} step={step} commitOnChange
                        onCommit={(next) => updatePaycheck({ [field]: commitVal(field, next) } as Partial<typeof pi>)} />
                      <button type="button" className={`lock-btn${period === 'monthly' ? ' locked' : ''}`}
                        onClick={() => updatePaycheck({ period: { ...pi.period, [field]: period === 'monthly' ? 'yearly' : 'monthly' } } as Partial<typeof pi>)}
                        title={`Display as ${period === 'monthly' ? 'Yearly' : 'Monthly'}`}
                      >
                        {period === 'monthly' ? 'M' : 'Y'}
                      </button>
                    </div>
                  </label>
                );
              };

              const renderModeField = (field: string, modeField: string, label: string, min: number, max: number, step: number, tooltip?: string, modeTooltip?: string) => {
                const val = (pi as unknown as Record<string, number>)[field] ?? 0;
                const mode = ((pi as unknown as Record<string, string>)[modeField]) || 'amount';
                const period = getPeriod(field);
                const isPercent = mode !== 'amount';
                return (
                  <label>
                    <span title={tooltip}>{label} ({isPercent ? '%' : period === 'monthly' ? 'Monthly' : 'Yearly'})</span>
                    <div className="tax-rate-row">
                      <BufferedNumberInput
                        value={isPercent ? val : displayVal(field, val)}
                        min={min} max={isPercent ? 100 : max} step={isPercent ? 0.1 : step} commitOnChange
                        onCommit={(next) => updatePaycheck({ [field]: isPercent ? next : commitVal(field, next) } as Partial<typeof pi>)}
                      />
                      <button type="button" className={`lock-btn${isPercent ? ' locked' : ''}`}
                        onClick={() => updatePaycheck({ [modeField]: isPercent ? 'amount' : (modeField.startsWith('retirement') && modeField.includes('Match') ? 'percentOfRetirement' : modeField.startsWith('hsa') && modeField.includes('Match') ? 'percentOfHsaContribution' : 'percentOfSalary') } as unknown as Partial<typeof pi>)}
                        title={modeTooltip ?? (isPercent ? 'Switch to dollar amount' : 'Switch to percentage')}
                      >
                        {isPercent ? '%' : '$'}
                      </button>
                      {!isPercent && (
                        <button type="button" className={`lock-btn${period === 'monthly' ? ' locked' : ''}`}
                          onClick={() => updatePaycheck({ period: { ...pi.period, [field]: period === 'monthly' ? 'yearly' : 'monthly' } } as Partial<typeof pi>)}
                          title={`Display as ${period === 'monthly' ? 'Yearly' : 'Monthly'}`}
                        >
                          {period === 'monthly' ? 'M' : 'Y'}
                        </button>
                      )}
                    </div>
                  </label>
                );
              };

              return (
                <>
            {renderField('grossSalary', 'Gross Salary', 0, 10000000, 1000)}
            {renderField('healthBenefits', 'Health Benefits', 0, 10000000, 100)}
            {renderField('taxes', 'Taxes', 0, 10000000, 100)}
            {renderField('otherBenefits', 'Other Benefits', 0, 10000000, 100)}
            {renderModeField('retirement', 'retirementMode', 'Retirement', 0, 10000000, 100, 'Monthly retirement deposit from income. Match added separately.')}
            {renderModeField('retirementMatch', 'retirementMatchMode', 'Retirement Match', 0, 10000000, 100, 'Employer contribution to retirement. Added on top of employee contribution.')}
            {renderField('employerMaxMatchPercent', 'Employer Max Match %', 0, 100, 0.5, 'Maximum % of gross salary your employer will match. Caps the Retirement Match amount.')}
            <label>
              <span>Retirement Account</span>
              <select
                value={pi.retirementAccountId ?? ''}
                onChange={(e) => updatePaycheck({ retirementAccountId: e.target.value || undefined })}
              >
                <option value="">-</option>
                {orderedBankAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>
            {renderModeField('hsaContribution', 'hsaContributionMode', 'HSA', 0, 10000000, 100, 'Monthly HSA deposit from income. Match added separately.')}
            {renderModeField('hsaEmployerMatch', 'hsaEmployerMatchMode', 'HSA Match', 0, 10000000, 100, 'Employer contribution to HSA. Added on top of employee contribution.')}
            {renderModeField('employerHsaDeposit', 'employerHsaDepositMode', 'Employer HSA Deposit', 0, 10000000, 100, 'Flat yearly employer contribution to HSA. Not tied to employee contribution or match.')}
            <label>
              <span>HSA Account</span>
              <select
                value={pi.hsaAccountId ?? ''}
                onChange={(e) => updatePaycheck({ hsaAccountId: e.target.value || undefined })}
              >
                <option value="">-</option>
                {orderedBankAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>
            {renderField('livingExpenses', 'Living Expenses', 0, 2000000, 100)}
            <label>
              <span>Take Home Pay (monthly)</span>
              <BufferedNumberInput value={takeHome} min={0} max={2000000} step={10} disabled onCommit={() => {}} />
            </label>
            <label>
              <span>Monthly Savings</span>
              <BufferedNumberInput value={annualEmployeeSavings / 12} min={0} max={2000000} step={10} disabled onCommit={() => {}} />
            </label>
                </>
              );
            })()}
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
                  <BufferedNumberInput
                    value={Math.round(getCareerPercentage(account) * 100) / 100}
                    min={0}
                    max={100}
                    step={0.1}
                    onCommit={(next) => updateLineForAccount(account, { contributionRate: next })}
                  />
                </div>
                <div className="career-savings-cell">
                  <BufferedNumberInput
                    value={savingsInputAmountFromPercentage(account)}
                    min={0}
                    max={2000000}
                    step={100}
                    onCommit={(next) => {
                      const annualSavings = annualSavingsFromInputAmount(account, next);
                      const derivedPercentage = previewSalary > 0 ? roundCurrency((annualSavings / previewSalary) * 100) : 0;
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
              <label key={`expense-${account.id}`}>
                <span>{account.label} Monthly Withdrawal</span>
                <BufferedNumberInput
                  value={getMonthlyWithdrawal(account)}
                  min={0}
                  max={1000000}
                  step={50}
                  onCommit={(next) => updateLineForAccount(account, { monthlyWithdrawal: next })}
                />
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

          <div className="career-summary">
            <p>
              Selected timeline: <strong>{selectedStartAge ?? selectedCareer.startAge}</strong> to <strong>{selectedCareer.endAge}</strong>
            </p>
            <p>
              Starting salary: <strong>{formatCurrency(selectedCareer.paycheckInfo?.grossSalary ?? 0)}</strong>
            </p>
            <p>
              Preview salary: <strong>{previewYear ? formatCurrency(previewYear.salary) : '$0'}</strong>
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
    </div>
  );
});
