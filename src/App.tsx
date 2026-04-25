import { type ReactNode, useEffect, useState } from 'react';
import { ChartPanel } from './components/ChartPanel';
import { CashflowItemEditor } from './components/CashflowItemEditor';
import { ResultsTable } from './components/ResultsTable';
import { createDefaultCashflowItem, defaultScenario } from './defaultScenario';
import { formatCurrency } from './engine/projection';
import { projectScenario } from './engine/projection';
import { loadScenario, saveScenario } from './storage';
import type { CashflowCategory, Scenario } from './types';

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

const ControlRow = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (nextValue: number) => void;
}) => (
  <label className="control-row">
    <span>{label}</span>
    <div className="control-inputs">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(numberFromInput(event.target.value))}
      />
      <input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(numberFromInput(event.target.value))} />
    </div>
  </label>
);

const Panel = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="panel">
    <div className="panel-title">{title}</div>
    <div className="panel-body">{children}</div>
  </section>
);

const App = () => {
  const [scenario, setScenario] = useState<Scenario>(() => loadScenario());
  const [activeTab, setActiveTab] = useState<'graph' | 'table'>('graph');
  const projection = projectScenario(scenario);
  const retirementEndAge = scenario.profile.retirementAge + scenario.profile.retirementYears;

  useEffect(() => {
    saveScenario(scenario);
  }, [scenario]);

  const updateScenario = (nextScenario: Scenario) => {
    const equityAllocation = Math.min(Math.max(nextScenario.portfolio.equityAllocation, 0), 100);
    const fixedIncomeAllocation = 100 - equityAllocation;

    setScenario({
      ...nextScenario,
      profile: {
        ...nextScenario.profile,
        retirementAge: Math.max(nextScenario.profile.retirementAge, nextScenario.profile.currentAge)
      },
      portfolio: {
        ...nextScenario.portfolio,
        equityAllocation,
        fixedIncomeAllocation
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
          createDefaultCashflowItem(category, scenario.profile.currentAge, scenario.profile.retirementAge, scenario.profile.retirementYears)
        ]
      });
      return;
    }

    updateScenario({
      ...scenario,
      cashflowItems: scenario.cashflowItems.filter((item) => item.category !== category)
    });
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <div>Plan your retirement with a local-first finance planner.</div>
      </header>

      <div className="app-grid">
        <aside className="sidebar">
          <Panel title="Retirement Calculator">
            <ControlRow
              label="Current Age"
              value={scenario.profile.currentAge}
              min={18}
              max={85}
              onChange={(value) =>
                updateScenario({
                  ...scenario,
                  profile: { ...scenario.profile, currentAge: value }
                })
              }
            />
            <ControlRow
              label="Retirement Age"
              value={scenario.profile.retirementAge}
              min={scenario.profile.currentAge}
              max={90}
              onChange={(value) =>
                updateScenario({
                  ...scenario,
                  profile: { ...scenario.profile, retirementAge: value }
                })
              }
            />
            <ControlRow
              label="Current Assets"
              value={scenario.portfolio.currentAssets}
              min={0}
              max={5000000}
              step={5000}
              onChange={(value) =>
                updateScenario({
                  ...scenario,
                  portfolio: { ...scenario.portfolio, currentAssets: value }
                })
              }
            />
          </Panel>

          <Panel title="Add">
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

          <Panel title="# of Retirement Years">
            <ControlRow
              label="Retirement Years"
              value={scenario.profile.retirementYears}
              min={1}
              max={50}
              onChange={(value) =>
                updateScenario({
                  ...scenario,
                  profile: { ...scenario.profile, retirementYears: value }
                })
              }
            />
          </Panel>

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

          <Panel title="Portfolio Returns">
            <div className="radio-row">
              <label className="checkbox-row">
                <input
                  type="radio"
                  name="return-mode"
                  checked={scenario.returnMode === 'manual'}
                  onChange={() => updateScenario({ ...scenario, returnMode: 'manual' })}
                />
                <span>Manual Returns/Inflation</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="radio"
                  name="return-mode"
                  checked={scenario.returnMode === 'historical'}
                  onChange={() => updateScenario({ ...scenario, returnMode: 'historical' })}
                />
                <span>Historical Returns since 1871</span>
              </label>
            </div>
            <ControlRow
              label="Inflation"
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
            <ControlRow
              label="Pre-Retirement % Return"
              value={scenario.manualReturns.preRetirementEquityReturn}
              min={-20}
              max={20}
              step={0.1}
              onChange={(value) =>
                updateScenario({
                  ...scenario,
                  manualReturns: { ...scenario.manualReturns, preRetirementEquityReturn: value }
                })
              }
            />
            <ControlRow
              label="Post-Retirement % Return"
              value={scenario.manualReturns.postRetirementEquityReturn}
              min={-20}
              max={20}
              step={0.1}
              onChange={(value) =>
                updateScenario({
                  ...scenario,
                  manualReturns: { ...scenario.manualReturns, postRetirementEquityReturn: value }
                })
              }
            />
            <ControlRow
              label="Fixed % Return"
              value={scenario.manualReturns.fixedIncomeReturn}
              min={-10}
              max={15}
              step={0.1}
              onChange={(value) =>
                updateScenario({
                  ...scenario,
                  manualReturns: { ...scenario.manualReturns, fixedIncomeReturn: value }
                })
              }
            />
            {scenario.returnMode === 'historical' ? (
              <p className="subtle">Using bundled offline placeholder history for {projection.historicalWindowLabel}.</p>
            ) : null}
          </Panel>

          <Panel title="Portfolio Allocation">
            <ControlRow
              label="% in Equities"
              value={scenario.portfolio.equityAllocation}
              min={0}
              max={100}
              onChange={(value) =>
                updateScenario({
                  ...scenario,
                  portfolio: {
                    ...scenario.portfolio,
                    equityAllocation: value,
                    fixedIncomeAllocation: 100 - value
                  }
                })
              }
            />
            <div className="allocation-value">Fixed Income: {scenario.portfolio.fixedIncomeAllocation}%</div>
            <div className="radio-row">
              <span className="subtle">Calculate fixed-income using:</span>
              <label className="checkbox-row">
                <input
                  type="radio"
                  name="fixed-income-duration"
                  checked={scenario.portfolio.fixedIncomeDuration === 'one_year'}
                  onChange={() =>
                    updateScenario({
                      ...scenario,
                      portfolio: { ...scenario.portfolio, fixedIncomeDuration: 'one_year' }
                    })
                  }
                />
                <span>1 yr Interest Rate</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="radio"
                  name="fixed-income-duration"
                  checked={scenario.portfolio.fixedIncomeDuration === 'ten_year'}
                  onChange={() =>
                    updateScenario({
                      ...scenario,
                      portfolio: { ...scenario.portfolio, fixedIncomeDuration: 'ten_year' }
                    })
                  }
                />
                <span>10 yr Interest Rate</span>
              </label>
            </div>
          </Panel>

          <Panel title="Retirement Spending">
            <div className="radio-row">
              <label className="checkbox-row">
                <input
                  type="radio"
                  name="withdrawal-mode"
                  checked={scenario.withdrawal.mode === 'four_percent'}
                  onChange={() =>
                    updateScenario({
                      ...scenario,
                      withdrawal: { ...scenario.withdrawal, mode: 'four_percent' }
                    })
                  }
                />
                <span>Using 4% Rule</span>
              </label>
              <label className="checkbox-row">
                <input
                  type="radio"
                  name="withdrawal-mode"
                  checked={scenario.withdrawal.mode === 'specified'}
                  onChange={() =>
                    updateScenario({
                      ...scenario,
                      withdrawal: { ...scenario.withdrawal, mode: 'specified' }
                    })
                  }
                />
                <span>Using Specified Withdrawal</span>
              </label>
            </div>
            <ControlRow
              label="First Year Expenses"
              value={scenario.withdrawal.firstYearAmount}
              min={0}
              max={250000}
              step={500}
              onChange={(value) =>
                updateScenario({
                  ...scenario,
                  withdrawal: { ...scenario.withdrawal, firstYearAmount: value }
                })
              }
            />
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
        </aside>

        <section className="results">
          <div className="results-card">
            <div className="tabs">
              <button type="button" className={activeTab === 'graph' ? 'tab active' : 'tab'} onClick={() => setActiveTab('graph')}>
                Graph
              </button>
              <button type="button" className={activeTab === 'table' ? 'tab active' : 'tab'} onClick={() => setActiveTab('table')}>
                Table
              </button>
            </div>

            {activeTab === 'graph' ? <ChartPanel years={projection.years} /> : <ResultsTable years={projection.years} />}

            <div className={projection.survivesToEnd ? 'summary success' : 'summary warning'}>
              <p>{projection.summary}</p>
              <p>
                Ending balance: <strong>{formatCurrency(projection.endingBalance)}</strong>
              </p>
            </div>
          </div>

          <div className="footnote">
            <p>Scenario-based data model is already in place so career income plans and major life events can layer on next.</p>
            <button type="button" className="secondary-button" onClick={() => updateScenario(defaultScenario)}>
              Reset Scenario
            </button>
          </div>
        </section>
      </div>
    </main>
  );
};

export default App;
