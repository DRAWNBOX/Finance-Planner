import { useState } from 'react';
import { BufferedNumberInput } from './BufferedNumberInput';
import type { CareerEntry, CareerPlan, ProjectionYear, SavingsBalances } from '../types';

interface CareerPlanEditorProps {
  value: CareerPlan;
  selectedCareerId: string;
  isRetirementSelected: boolean;
  onSelectRetirementItem: () => void;
  onSelectCareer: (careerId: string) => void;
  onChangeCareer: (career: CareerEntry) => void;
  onDuplicateCareer: (careerId: string) => void;
  onReorderCareers: (fromCareerId: string, toCareerId: string) => void;
  onChangeSavingsReturn: (account: keyof SavingsBalances, rate: number) => void;
  onAddCareer: () => void;
  onRemoveCareer: (careerId: string) => void;
  previewYear?: ProjectionYear;
  savingsAnnualRates: SavingsBalances;
  netWorthBalances: SavingsBalances;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

export const CareerPlanEditor = ({
  value,
  selectedCareerId,
  isRetirementSelected,
  onSelectRetirementItem,
  onSelectCareer,
  onChangeCareer,
  onDuplicateCareer,
  onReorderCareers,
  onChangeSavingsReturn,
  onAddCareer,
  onRemoveCareer,
  previewYear,
  savingsAnnualRates,
  netWorthBalances
}: CareerPlanEditorProps) => {
  const selectedCareer = value.entries.find((career) => career.id === selectedCareerId) ?? value.entries[0];
  const [dragCareerId, setDragCareerId] = useState<string | null>(null);
  const selectedCareerIndex = selectedCareer ? value.entries.findIndex((career) => career.id === selectedCareer.id) : -1;
  const previousCareer = selectedCareerIndex > 0 ? value.entries[selectedCareerIndex - 1] : undefined;
  const selectedStartAge =
    selectedCareer && selectedCareer.usePreviousCareerStartAge && previousCareer ? previousCareer.endAge : selectedCareer?.startAge;

  const handleRemoveCareer = (careerId: string) => {
    if (window.confirm('Remove this career from the timeline?')) {
      onRemoveCareer(careerId);
    }
  };
  const previewSalary = selectedCareer.startingSalary;
  const activeStartAge = selectedStartAge ?? selectedCareer.startAge;
  const periodYears = Math.max(0, selectedCareer.endAge - activeStartAge + 1);
  const periodMonths = periodYears * 12;

  const roundCurrency = (value: number) => Math.round(value * 100) / 100;

  const annualSavingsFromPercentage = (percentage: number, salary = previewSalary) => roundCurrency(salary * (percentage / 100));
  const calculatedTotalSavingsRate = roundCurrency(
    selectedCareer.emergencyFundContributionRate +
      selectedCareer.hsaContributionRate +
      selectedCareer.investmentsContributionRate +
      selectedCareer.retirement401kContributionRate
  );

  const calculateEndOfPeriodBalanceForAccount = (
    key: keyof SavingsBalances,
    startingBalance: number,
    annualSavings: number,
    annualReturnPercent: number
  ) => {
    if (periodMonths <= 0) {
      return roundCurrency(startingBalance);
    }

    const monthlyContribution = annualSavings / 12;
    const monthlyRate = annualReturnPercent / 100 / 12;
    const monthlyWithdrawal = Math.max(0, getMonthlyWithdrawal(key));

    if (monthlyRate === 0) {
      let running = startingBalance;

      for (let month = 0; month < periodMonths; month += 1) {
        running = Math.max(0, running + monthlyContribution - monthlyWithdrawal);
      }

      return roundCurrency(running);
    }

    let running = startingBalance;

    for (let month = 0; month < periodMonths; month += 1) {
      running = Math.max(0, (running + monthlyContribution - monthlyWithdrawal) * (1 + monthlyRate));
    }

    return roundCurrency(running);
  };

  const getCareerPercentage = (key: keyof SavingsBalances) => {
    if (key === 'emergencyFund') {
      return selectedCareer.emergencyFundContributionRate;
    }

    if (key === 'hsa') {
      return selectedCareer.hsaContributionRate;
    }

    if (key === 'investments') {
      return selectedCareer.investmentsContributionRate;
    }

    return selectedCareer.retirement401kContributionRate;
  };

  const setCareerPercentage = (key: keyof SavingsBalances, nextPercentage: number) =>
    onChangeCareer({
      ...selectedCareer,
      emergencyFundContributionRate: key === 'emergencyFund' ? nextPercentage : selectedCareer.emergencyFundContributionRate,
      hsaContributionRate: key === 'hsa' ? nextPercentage : selectedCareer.hsaContributionRate,
      investmentsContributionRate: key === 'investments' ? nextPercentage : selectedCareer.investmentsContributionRate,
      retirement401kContributionRate: key === 'retirement401k' ? nextPercentage : selectedCareer.retirement401kContributionRate
    });

  const isSavingsMonthly = (key: keyof SavingsBalances) => {
    if (key === 'emergencyFund') {
      return selectedCareer.emergencyFundSavingsMonthly;
    }

    if (key === 'hsa') {
      return selectedCareer.hsaSavingsMonthly;
    }

    if (key === 'investments') {
      return selectedCareer.investmentsSavingsMonthly;
    }

    return selectedCareer.retirement401kSavingsMonthly;
  };

  const setSavingsMonthly = (key: keyof SavingsBalances, next: boolean) =>
    onChangeCareer({
      ...selectedCareer,
      emergencyFundSavingsMonthly: key === 'emergencyFund' ? next : selectedCareer.emergencyFundSavingsMonthly,
      hsaSavingsMonthly: key === 'hsa' ? next : selectedCareer.hsaSavingsMonthly,
      investmentsSavingsMonthly: key === 'investments' ? next : selectedCareer.investmentsSavingsMonthly,
      retirement401kSavingsMonthly: key === 'retirement401k' ? next : selectedCareer.retirement401kSavingsMonthly
    });

  const savingsInputAmountFromPercentage = (key: keyof SavingsBalances) => {
    const annualSavings = annualSavingsFromPercentage(getCareerPercentage(key));

    return isSavingsMonthly(key) ? roundCurrency(annualSavings / 12) : annualSavings;
  };

  const annualSavingsFromInputAmount = (key: keyof SavingsBalances, inputAmount: number) =>
    roundCurrency(isSavingsMonthly(key) ? inputAmount * 12 : inputAmount);

  const getMonthlyWithdrawal = (key: keyof SavingsBalances) => {
    if (key === 'emergencyFund') {
      return selectedCareer.emergencyFundMonthlyWithdrawal ?? 0;
    }

    if (key === 'hsa') {
      return selectedCareer.hsaMonthlyWithdrawal ?? 0;
    }

    if (key === 'investments') {
      return selectedCareer.investmentsMonthlyWithdrawal ?? 0;
    }

    return selectedCareer.retirement401kMonthlyWithdrawal ?? 0;
  };

  const setMonthlyWithdrawal = (key: keyof SavingsBalances, next: number) =>
    onChangeCareer({
      ...selectedCareer,
      emergencyFundMonthlyWithdrawal: key === 'emergencyFund' ? next : selectedCareer.emergencyFundMonthlyWithdrawal ?? 0,
      hsaMonthlyWithdrawal: key === 'hsa' ? next : selectedCareer.hsaMonthlyWithdrawal ?? 0,
      investmentsMonthlyWithdrawal: key === 'investments' ? next : selectedCareer.investmentsMonthlyWithdrawal ?? 0,
      retirement401kMonthlyWithdrawal: key === 'retirement401k' ? next : selectedCareer.retirement401kMonthlyWithdrawal ?? 0
    });

  const getStartBalanceMode = (career: CareerEntry, key: keyof SavingsBalances) => {
    if (key === 'emergencyFund') {
      return career.emergencyFundStartBalanceMode;
    }

    if (key === 'hsa') {
      return career.hsaStartBalanceMode;
    }

    if (key === 'investments') {
      return career.investmentsStartBalanceMode;
    }

    return career.retirement401kStartBalanceMode;
  };

  const getManualStartBalance = (career: CareerEntry, key: keyof SavingsBalances) => {
    if (key === 'emergencyFund') {
      return career.emergencyFundManualStartBalance;
    }

    if (key === 'hsa') {
      return career.hsaManualStartBalance;
    }

    if (key === 'investments') {
      return career.investmentsManualStartBalance;
    }

    return career.retirement401kManualStartBalance;
  };

  const setRowStartBalanceMode = (key: keyof SavingsBalances, mode: 'auto' | 'manual') =>
    onChangeCareer({
      ...selectedCareer,
      emergencyFundStartBalanceMode: key === 'emergencyFund' ? mode : selectedCareer.emergencyFundStartBalanceMode,
      hsaStartBalanceMode: key === 'hsa' ? mode : selectedCareer.hsaStartBalanceMode,
      investmentsStartBalanceMode: key === 'investments' ? mode : selectedCareer.investmentsStartBalanceMode,
      retirement401kStartBalanceMode: key === 'retirement401k' ? mode : selectedCareer.retirement401kStartBalanceMode
    });

  const setRowManualStartBalance = (key: keyof SavingsBalances, balance: number) =>
    onChangeCareer({
      ...selectedCareer,
      emergencyFundManualStartBalance:
        key === 'emergencyFund' ? balance : selectedCareer.emergencyFundManualStartBalance,
      hsaManualStartBalance: key === 'hsa' ? balance : selectedCareer.hsaManualStartBalance,
      investmentsManualStartBalance: key === 'investments' ? balance : selectedCareer.investmentsManualStartBalance,
      retirement401kManualStartBalance:
        key === 'retirement401k' ? balance : selectedCareer.retirement401kManualStartBalance
    });

  const getSalaryForCareer = (career: CareerEntry) => career.startingSalary;
  const getCareerPeriodMonths = (career: CareerEntry) => Math.max(0, career.endAge - career.startAge + 1) * 12;

  const calculateCareerEndBalancesThroughIndex = (targetIndex: number): SavingsBalances => {
    let balances: SavingsBalances = {
      emergencyFund: netWorthBalances.emergencyFund,
      hsa: netWorthBalances.hsa,
      investments: netWorthBalances.investments,
      retirement401k: netWorthBalances.retirement401k
    };

    for (let index = 0; index <= targetIndex; index += 1) {
      const career = value.entries[index];
      const months = getCareerPeriodMonths(career);
      const salary = getSalaryForCareer(career);
      const nextBalances: SavingsBalances = { ...balances };

      (['emergencyFund', 'hsa', 'investments', 'retirement401k'] as Array<keyof SavingsBalances>).forEach((key) => {
        const startBalance =
          getStartBalanceMode(career, key) === 'manual' ? getManualStartBalance(career, key) : balances[key];
        const annualSavings = annualSavingsFromPercentage(
          key === 'emergencyFund'
            ? career.emergencyFundContributionRate
            : key === 'hsa'
              ? career.hsaContributionRate
              : key === 'investments'
                ? career.investmentsContributionRate
                : career.retirement401kContributionRate,
          salary
        );
        const monthlyWithdrawal =
          key === 'emergencyFund'
            ? Math.max(0, career.emergencyFundMonthlyWithdrawal ?? 0)
            : key === 'hsa'
              ? Math.max(0, career.hsaMonthlyWithdrawal ?? 0)
              : key === 'investments'
                ? Math.max(0, career.investmentsMonthlyWithdrawal ?? 0)
                : Math.max(0, career.retirement401kMonthlyWithdrawal ?? 0);
        const monthlyContribution = annualSavings / 12;
        const monthlyRate = savingsAnnualRates[key] / 100 / 12;

        if (months <= 0 || (startBalance <= 0 && annualSavings <= 0)) {
          nextBalances[key] = roundCurrency(startBalance);
        } else {
          let running = startBalance;

          for (let month = 0; month < months; month += 1) {
            if (monthlyRate === 0) {
              running = Math.max(0, running + monthlyContribution - monthlyWithdrawal);
            } else {
              running = Math.max(0, (running + monthlyContribution - monthlyWithdrawal) * (1 + monthlyRate));
            }
          }

          nextBalances[key] = roundCurrency(running);
        }
      });

      balances = nextBalances;
    }

    return balances;
  };

  const previousCareerEndingBalances =
    selectedCareerIndex > 0 ? calculateCareerEndBalancesThroughIndex(selectedCareerIndex - 1) : netWorthBalances;

  const getAutoStartBalance = (key: keyof SavingsBalances) =>
    selectedCareerIndex > 0 ? previousCareerEndingBalances[key] : netWorthBalances[key];

  const getDisplayedStartBalance = (key: keyof SavingsBalances) =>
    getStartBalanceMode(selectedCareer, key) === 'manual' ? getManualStartBalance(selectedCareer, key) : getAutoStartBalance(key);

  const savingsRows = [
    {
      key: 'emergencyFund' as const,
      label: 'Emergency Fund'
    },
    {
      key: 'hsa' as const,
      label: 'HSA'
    },
    {
      key: 'investments' as const,
      label: 'Investments'
    },
    {
      key: 'retirement401k' as const,
      label: '401K'
    }
  ];

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
        <button
          type="button"
          className={isRetirementSelected ? 'career-tab retirement-item active' : 'career-tab retirement-item'}
          onClick={onSelectRetirementItem}
        >
          Retirement
        </button>
        <button type="button" className="career-tab add" onClick={onAddCareer}>
          + Career
        </button>
      </div>

      {!isRetirementSelected ? (
        <label className="checkbox-row career-enable">
          <input
            type="checkbox"
            checked={selectedCareer?.enabled ?? false}
            onChange={(event) => selectedCareer && onChangeCareer({ ...selectedCareer, enabled: event.target.checked })}
          />
          <span>Estimate income from this career</span>
        </label>
      ) : (
        <div className="career-summary">
          <p>
            <strong>Retirement</strong> is a fixed, non-removable career item.
          </p>
          <p>Select it to manage all retirement-specific settings and events.</p>
        </div>
      )}

      {!isRetirementSelected && selectedCareer ? (
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
                min={18}
                max={110}
                disabled={selectedCareer.usePreviousCareerStartAge && Boolean(previousCareer)}
                onCommit={(next) => onChangeCareer({ ...selectedCareer, startAge: next })}
              />
            </label>
            <label>
              <span>End Age</span>
              <BufferedNumberInput
                value={selectedCareer.endAge}
                min={selectedStartAge ?? selectedCareer.startAge}
                max={110}
                onCommit={(next) => onChangeCareer({ ...selectedCareer, endAge: next })}
              />
            </label>
            <label className="full-span checkbox-row">
              <input
                type="checkbox"
                checked={selectedCareer.usePreviousCareerStartAge}
                disabled={!previousCareer}
                onChange={(event) =>
                  onChangeCareer({
                    ...selectedCareer,
                    usePreviousCareerStartAge: event.target.checked,
                    startAge: event.target.checked && previousCareer ? previousCareer.endAge : selectedCareer.startAge
                  })
                }
              />
              <span>Use previous career end age as this start age</span>
            </label>
            <label>
              <span>Starting Salary</span>
              <BufferedNumberInput
                value={selectedCareer.startingSalary}
                min={0}
                max={2000000}
                step={1000}
                onCommit={(next) => onChangeCareer({ ...selectedCareer, startingSalary: next })}
              />
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
              <BufferedNumberInput
                value={calculatedTotalSavingsRate}
                min={0}
                max={100}
                step={0.1}
                disabled
                onCommit={() => {}}
              />
            </label>
            <label>
              <span>Employer Match %</span>
              <BufferedNumberInput
                value={selectedCareer.employerMatchRate}
                min={0}
                max={20}
                step={0.1}
                onCommit={(next) => onChangeCareer({ ...selectedCareer, employerMatchRate: next })}
              />
            </label>
            <label>
              <span>Bonus %</span>
              <BufferedNumberInput
                value={selectedCareer.bonusRate}
                min={0}
                max={50}
                step={0.1}
                onCommit={(next) => onChangeCareer({ ...selectedCareer, bonusRate: next })}
              />
            </label>
            <label>
              <span>Bonus Saved %</span>
              <BufferedNumberInput
                value={selectedCareer.bonusSavingsRate}
                min={0}
                max={100}
                step={1}
                onCommit={(next) => onChangeCareer({ ...selectedCareer, bonusSavingsRate: next })}
              />
            </label>
          </div>

          <div className="career-savings-grid">
            <div className="career-savings-row career-savings-header">
              <div className="career-savings-cell">Starting Balance</div>
              <div className="career-savings-cell">Monthly</div>
              <div className="career-savings-cell">Account</div>
              <div className="career-savings-cell">Percentage</div>
              <div className="career-savings-cell">Savings</div>
              <div className="career-savings-cell">Return (APY)</div>
              <div className="career-savings-cell">Balance at end of period</div>
            </div>
            {savingsRows.map((row) => (
              <div key={row.key} className="career-savings-row">
                <div className="career-savings-cell">
                  <div className="start-balance-cell">
                    <select
                      value={getStartBalanceMode(selectedCareer, row.key)}
                      onChange={(event) => setRowStartBalanceMode(row.key, event.target.value === 'manual' ? 'manual' : 'auto')}
                    >
                      <option value="auto">Auto</option>
                      <option value="manual">Manual</option>
                    </select>
                    <BufferedNumberInput
                      value={getDisplayedStartBalance(row.key)}
                      min={0}
                      max={50000000}
                      step={100}
                      disabled={getStartBalanceMode(selectedCareer, row.key) !== 'manual'}
                      onCommit={(next) => setRowManualStartBalance(row.key, next)}
                    />
                    {getStartBalanceMode(selectedCareer, row.key) === 'auto' ? (
                      <span className="start-source">
                        {selectedCareerIndex > 0 ? 'From previous career' : 'From Net Worth'}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="career-savings-cell">
                  <input type="checkbox" checked={isSavingsMonthly(row.key)} onChange={(event) => setSavingsMonthly(row.key, event.target.checked)} />
                </div>
                <div className="career-savings-cell career-savings-label">{row.label}</div>
                <div className="career-savings-cell">
                  <BufferedNumberInput
                    value={getCareerPercentage(row.key)}
                    min={0}
                    max={100}
                    step={0.1}
                    onCommit={(next) => setCareerPercentage(row.key, next)}
                  />
                </div>
                <div className="career-savings-cell">
                  <BufferedNumberInput
                    value={savingsInputAmountFromPercentage(row.key)}
                    min={0}
                    max={2000000}
                    step={100}
                    onCommit={(next) => {
                      const annualSavings = annualSavingsFromInputAmount(row.key, next);
                      const derivedPercentage = previewSalary > 0 ? roundCurrency((annualSavings / previewSalary) * 100) : 0;
                      setCareerPercentage(row.key, derivedPercentage);
                    }}
                  />
                </div>
                <div className="career-savings-cell">
                  <BufferedNumberInput
                    value={savingsAnnualRates[row.key]}
                    min={-20}
                    max={25}
                    step={0.1}
                    onCommit={(next) => onChangeSavingsReturn(row.key, next)}
                  />
                </div>
                <div className="career-savings-cell">
                  {formatCurrency(
                    calculateEndOfPeriodBalanceForAccount(
                      row.key,
                      getDisplayedStartBalance(row.key),
                      annualSavingsFromInputAmount(row.key, savingsInputAmountFromPercentage(row.key)),
                      savingsAnnualRates[row.key]
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
            {savingsRows.map((row) => (
              <label key={`expense-${row.key}`}>
                <span>{row.label} Monthly Withdrawal</span>
                <BufferedNumberInput
                  value={getMonthlyWithdrawal(row.key)}
                  min={0}
                  max={1000000}
                  step={50}
                  onCommit={(next) => setMonthlyWithdrawal(row.key, next)}
                />
              </label>
            ))}
          </div>

          <div className="career-summary">
            <p>
              Selected timeline: <strong>{selectedStartAge ?? selectedCareer.startAge}</strong> to <strong>{selectedCareer.endAge}</strong>
            </p>
            <p>
              Starting salary: <strong>{formatCurrency(selectedCareer.startingSalary)}</strong>
            </p>
            <p>
              Preview salary: <strong>{previewYear ? formatCurrency(previewYear.salary) : '$0'}</strong>
            </p>
            <p>Preview savings from career income: <strong>{previewYear ? formatCurrency(previewYear.careerContribution) : '$0'}</strong></p>
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
};
