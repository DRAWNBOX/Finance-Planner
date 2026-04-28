import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const makeBirthDate = (yearsAgo: number) => {
  const date = new Date();
  date.setFullYear(date.getFullYear() - yearsAgo);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

const parseCurrency = (value: string) => Number(value.replace(/[^0-9.-]/g, ''));
const parseFirstNumber = (value: string) => Number((value.match(/\d+/) ?? ['0'])[0]);

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('keeps the graph visible and shows the results table', () => {
    render(<App />);

    expect(screen.getByRole('img', { name: /portfolio value over time/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Career' })).toBeInTheDocument();
  });

  it('shows an inline editor when an add-on checkbox is enabled', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Social Security' })[0]);

    expect(screen.getAllByText('Social Security').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('24000')).toBeInTheDocument();
  });

  it('persists the global inflation toggle state', () => {
    render(<App />);

    const inflationToggle = screen.getByRole('checkbox', { name: 'Enable inflation' });
    expect(inflationToggle).toBeChecked();

    fireEvent.click(inflationToggle);
    expect(inflationToggle).not.toBeChecked();

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"inflationEnabled":false');
  });

  it('disables inflation-related controls when global inflation is off', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Social Security' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Timeline Management' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Custom Expense' }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Retirement' })[0]);

    const inflationToggle = screen.getByRole('checkbox', { name: 'Enable inflation' });
    fireEvent.click(inflationToggle);

    const inflationControl = screen.getByText('Inflation %').closest('label') as HTMLElement;
    const inflationRateInput = within(inflationControl).getByRole('spinbutton');
    const withdrawalInflation = screen.getByRole('checkbox', { name: 'Adjust expenses for inflation' });
    const cashflowInflation = screen.getByRole('checkbox', { name: 'Adjust for inflation' });

    expect(inflationRateInput).toBeDisabled();
    expect(withdrawalInflation).toBeDisabled();
    expect(cashflowInflation).toBeDisabled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const refreshedFinanceSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(refreshedFinanceSubTabs).toBeTruthy();
    const refreshedFinanceSubTabsElement = refreshedFinanceSubTabs as HTMLElement;
    fireEvent.click(within(refreshedFinanceSubTabsElement).getByRole('button', { name: 'Timeline Management' }));
    const timelineInflation = screen.getByRole('checkbox', { name: 'Adjust for inflation' });
    expect(timelineInflation).toBeDisabled();
  });

  it('re-enables inflation controls and preserves checked states', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Social Security' })[0]);

    const inflationToggle = screen.getByRole('checkbox', { name: 'Enable inflation' });
    const withdrawalInflation = screen.getByRole('checkbox', { name: 'Adjust expenses for inflation' });
    const cashflowInflation = screen.getByRole('checkbox', { name: 'Adjust for inflation' });

    expect(withdrawalInflation).toBeChecked();
    expect(cashflowInflation).toBeChecked();

    fireEvent.click(inflationToggle);
    fireEvent.click(inflationToggle);

    const withdrawalInflationAfter = screen.getByRole('checkbox', { name: 'Adjust expenses for inflation' });
    const cashflowInflationAfter = screen.getByRole('checkbox', { name: 'Adjust for inflation' });

    expect(withdrawalInflationAfter).toBeEnabled();
    expect(cashflowInflationAfter).toBeEnabled();
    expect(withdrawalInflationAfter).toBeChecked();
    expect(cashflowInflationAfter).toBeChecked();
  });

  it('derives current age from date of birth and persists the option', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Retirement' })[0]);
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Make current age based on date of birth' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Options' })[0]);

    const dateInput = screen.getByLabelText('Date of Birth');
    fireEvent.change(dateInput, { target: { value: makeBirthDate(40) } });

    fireEvent.click(screen.getAllByRole('button', { name: 'Retirement' })[0]);

    const currentAgeInput = screen.getAllByRole('spinbutton')[0];

    expect(currentAgeInput).toHaveValue(40);
    expect(currentAgeInput).toBeDisabled();

    const stored = window.localStorage.getItem('finance-planner-state');

    expect(stored).toContain('"useDateBasedAge":true');
    expect(stored).toContain('"dateOfBirth"');
  });

  it('resets scenario from options tab only after confirmation', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Options' })[0]);
    expect(screen.getByLabelText('Date of Birth')).toBeInTheDocument();

    confirmSpy.mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Scenario' }));
    expect(confirmSpy).toHaveBeenCalled();
    expect(screen.getByLabelText('Date of Birth')).toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Scenario' }));
    expect(screen.getByText('Retirement Calculator')).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it('shows finances prediction sub-tabs and defaults to careers content', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);

    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');

    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    expect(within(financeSubTabsElement).getByRole('button', { name: 'Retirement' })).toBeInTheDocument();
    expect(within(financeSubTabsElement).getByRole('button', { name: 'Careers' })).toBeInTheDocument();
    expect(within(financeSubTabsElement).getByRole('button', { name: 'Timeline Management' })).toBeInTheDocument();
    expect(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' })).toBeInTheDocument();
    expect(within(financeSubTabsElement).getByRole('button', { name: 'Loans' })).toBeInTheDocument();
    expect(screen.getByText('Career Timeline')).toBeInTheDocument();
    expect(screen.queryByText('Large Purchases Table')).not.toBeInTheDocument();
  });

  it('switches finances prediction content by sub-tab', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);

    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;

    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));
    expect(screen.getByText('Large Purchases Table')).toBeInTheDocument();

    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Timeline Management' }));
    expect(screen.getByText('Future Life Events')).toBeInTheDocument();
    expect(screen.queryByText('Future Retirement')).not.toBeInTheDocument();

    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Retirement' }));
    expect(screen.queryByText('Retirement Calculator')).not.toBeInTheDocument();
    expect(screen.getByText('Future Retirement')).toBeInTheDocument();
    expect(screen.getByText(/Current age from Options:/i)).toBeInTheDocument();
    expect(screen.getByText(/Career-derived retirement age:/i)).toBeInTheDocument();
    expect(screen.getByText(/Retirement horizon:/i)).toBeInTheDocument();
    expect(screen.getByText(/Retirement assets:/i)).toBeInTheDocument();

    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Loans' }));
    expect(screen.getByText('Loans Table')).toBeInTheDocument();
  });

  it('hides graph and results table in purchases and expenses sub-tab', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    expect(screen.queryByRole('img', { name: /portfolio value over time/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Career' })).not.toBeInTheDocument();
  });

  it('updates retirement horizon when changing retirement years in finances prediction', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Retirement' }));

    const retirementAgeInput = within(screen.getByText('Retirement Age').closest('label')!).getByRole('spinbutton');
    const retirementYearsInput = within(screen.getByText('Retirement Years').closest('label')!).getByRole('spinbutton');

    fireEvent.change(retirementYearsInput, { target: { value: '12' } });
    fireEvent.blur(retirementYearsInput);

    const retirementAge = Number((retirementAgeInput as HTMLInputElement).value);
    const expectedHorizon = retirementAge + 12;
    const horizonText = screen.getByText(/Retirement horizon:/i).textContent ?? '';

    expect(parseFirstNumber(horizonText)).toBe(expectedHorizon);
  });

  it('shows minimum yearly withdrawal control in finances prediction retirement', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Retirement' }));

    expect(screen.getAllByText('Minimum Yearly Withdrawal').length).toBeGreaterThanOrEqual(1);
  });

  it('shares minimum yearly withdrawal value between retirement tabs', () => {
    render(<App />);

    const retirementMinimumControl = screen.getByText('Minimum Yearly Withdrawal').closest('label') as HTMLElement;
    const retirementMinimumInput = within(retirementMinimumControl).getByRole('spinbutton');
    fireEvent.change(retirementMinimumInput, { target: { value: '25000' } });
    fireEvent.blur(retirementMinimumInput);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Retirement' }));

    const futureRetirementMinimumControls = screen
      .getAllByText('Minimum Yearly Withdrawal')
      .map((element) => element.closest('label'))
      .filter(Boolean) as HTMLElement[];
    const hasSyncedValue = futureRetirementMinimumControls.some((control) => {
      const input = within(control).getByRole('spinbutton');
      return (input as HTMLInputElement).value === '25000';
    });

    expect(hasSyncedValue).toBe(true);
  });

  it('hides the retirement selector chip in the career editor', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);

    expect(document.querySelector('.career-tab.retirement-item')).toBeNull();
  });

  it('uses year-month inputs and shows projected balance columns for purchases', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Purchase' }));

    expect(screen.getByLabelText('Purchase Year')).toBeInTheDocument();
    expect(screen.getByLabelText('Purchase Month')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Purchase Year Up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Purchase Year Down' })).toBeInTheDocument();

    const purchaseYearInput = screen.getByLabelText('Purchase Year') as HTMLInputElement;
    const startingYear = Number(purchaseYearInput.value);
    fireEvent.click(screen.getByRole('button', { name: 'Purchase Year Up' }));
    expect(purchaseYearInput).toHaveValue(String(startingYear + 1));
    expect(screen.getByRole('columnheader', { name: 'Emergency Fund Balance' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'HSA Balance' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Investments Balance' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '401K Balance' })).toBeInTheDocument();
  });

  it('supports long-term monthly purchases with start date and duration/end-date scheduling', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    expect(screen.getByText('Long-Term Purchases (Monthly)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Long-Term Purchase' }));

    expect(screen.getByLabelText('Long-Term Start Year')).toBeInTheDocument();
    expect(screen.getByLabelText('Long-Term Start Month')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Long-Term End Mode' })).not.toBeInTheDocument();

    const longTermNameInput = screen.getByDisplayValue('Long-Term Purchase');
    const longTermRow = longTermNameInput.closest('tr') as HTMLTableRowElement;
    const endYearInput = within(longTermRow).getByLabelText('Long-Term End Year') as HTMLInputElement;
    fireEvent.change(endYearInput, { target: { value: '2032' } });
    fireEvent.blur(endYearInput);

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"longTermPurchases"');
    expect(stored).toContain('"endMode":"endDate"');
  });

  it('supports adding loans in the finances prediction loans tab', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Loans' }));

    expect(screen.getByText('Loans Table')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Loan' }));

    expect(screen.getByDisplayValue('Loan')).toBeInTheDocument();
    expect(screen.getByLabelText('Loan Start Year')).toBeInTheDocument();
    const paymentSource = screen.getByLabelText('Loan Payment Source');
    expect(paymentSource).toBeInTheDocument();
    fireEvent.change(paymentSource, { target: { value: 'income' } });
    expect((paymentSource as HTMLSelectElement).value).toBe('income');
    expect(within(paymentSource).getByRole('option', { name: 'Income' })).toBeInTheDocument();
    expect(screen.getByText(/^\d+\.\d yr$/)).toBeInTheDocument();

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"loans"');
    expect(stored).toContain('"paymentSourceAccount":"income"');
  });

  it('keeps long-term purchase duration and end date synchronized', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Long-Term Purchase' }));

    const row = screen.getByDisplayValue('Long-Term Purchase').closest('tr') as HTMLTableRowElement;
    const startYearInput = within(row).getByLabelText('Long-Term Start Year') as HTMLInputElement;
    const startMonthInput = within(row).getByLabelText('Long-Term Start Month') as HTMLSelectElement;
    const durationInput = within(row).getAllByRole('spinbutton')[0] as HTMLInputElement;
    const endYearInput = within(row).getByLabelText('Long-Term End Year') as HTMLInputElement;
    const endMonthInput = within(row).getByLabelText('Long-Term End Month') as HTMLSelectElement;

    fireEvent.change(durationInput, { target: { value: '6' } });
    fireEvent.blur(durationInput);

    const startYear = Number(startYearInput.value);
    const startMonth = Number(startMonthInput.value);
    const endSerialFromDuration = startYear * 12 + (startMonth - 1) + 6 - 1;
    const expectedEndYear = Math.floor(endSerialFromDuration / 12);
    const expectedEndMonth = (endSerialFromDuration % 12) + 1;

    expect(endYearInput).toHaveValue(String(expectedEndYear));
    expect(endMonthInput).toHaveValue(String(expectedEndMonth).padStart(2, '0'));

    fireEvent.change(endYearInput, { target: { value: String(expectedEndYear + 1) } });
    fireEvent.blur(endYearInput);

    const updatedEndSerial = (expectedEndYear + 1) * 12 + (expectedEndMonth - 1);
    const expectedDuration = Math.max(1, updatedEndSerial - (startYear * 12 + (startMonth - 1)) + 1);

    expect(durationInput).toHaveValue(expectedDuration);
  });

  it('marks purchase rows red when a purchase is not viable', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Purchase' }));

    const purchaseNameInput = screen.getByDisplayValue('Large Purchase');
    const purchaseRow = purchaseNameInput.closest('tr') as HTMLTableRowElement;
    expect(purchaseRow.className).toContain('purchase-row');

    const investmentsSourceInput = within(purchaseRow).getAllByRole('spinbutton')[3];
    fireEvent.change(investmentsSourceInput, { target: { value: '40000' } });
    fireEvent.blur(investmentsSourceInput);

    expect(purchaseRow.className).toContain('invalid');
    expect(purchaseRow.getAttribute('title') ?? '').toContain('Not viable: amount does not match source totals.');
  });

  it('shows negative post-purchase balances in the purchases table when requested sources exceed projected balances', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Purchase' }));

    const purchaseRow = screen.getByDisplayValue('Large Purchase').closest('tr') as HTMLTableRowElement;
    const sourceInputs = within(purchaseRow).getAllByRole('spinbutton');
    const investmentsSourceInput = sourceInputs[3];

    fireEvent.change(investmentsSourceInput, { target: { value: '50000000' } });
    fireEvent.blur(investmentsSourceInput);

    const cells = purchaseRow.querySelectorAll('td');
    const investmentsBalanceText = cells[10].textContent ?? '';
    expect(investmentsBalanceText).toContain('-$');
  });

  it('maps saved future retirement tab state into Careers', () => {
    window.localStorage.setItem(
      'finance-planner-state',
      JSON.stringify({
        scenario: {
          profile: { currentAge: 45, retirementAge: 65, retirementYears: 30 },
          options: { useDateBasedAge: false, dateOfBirth: '1980-10-01' },
          portfolio: {
            currentAssets: 500000,
            equityAllocation: 75,
            fixedIncomeAllocation: 25,
            fixedIncomeDuration: 'one_year'
          },
          contribution: {
            yearlyContribution: 17500,
            yearlyIncreaseRate: 2.9
          },
          careerPlan: {
            enabled: true,
            entries: [
              {
                id: 'career-1-default',
                label: 'Current Career',
                enabled: true,
                usePreviousCareerStartAge: false,
                startAge: 45,
                endAge: 65,
                startingSalary: 98000,
                annualRaiseRate: 3.5,
                savingsRate: 10,
                employerMatchRate: 3,
                bonusRate: 8,
                bonusSavingsRate: 50,
                emergencyFundContributionRate: 2,
                hsaContributionRate: 3,
                investmentsContributionRate: 6,
                retirement401kContributionRate: 6,
                emergencyFundSavingsMonthly: false,
                hsaSavingsMonthly: false,
                investmentsSavingsMonthly: false,
                retirement401kSavingsMonthly: false,
                emergencyFundStartBalanceMode: 'auto',
                hsaStartBalanceMode: 'auto',
                investmentsStartBalanceMode: 'auto',
                retirement401kStartBalanceMode: 'auto',
                emergencyFundManualStartBalance: 0,
                hsaManualStartBalance: 0,
                investmentsManualStartBalance: 0,
                retirement401kManualStartBalance: 0
              }
            ]
          },
          savingsTracker: {
            annualInterestRates: { emergencyFund: 2.5, hsa: 5, investments: 6.5, retirement401k: 6 }
          },
          netWorth: {
            accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
            asOfDate: ''
          },
          futureRetirement: {
            useCareerEndAge: true,
            retirementAge: 65,
            retirementYears: 30
          },
          withdrawal: {
            mode: 'specified',
            firstYearAmount: 40000,
            inflationAdjusted: true
          },
          returnMode: 'manual',
          manualReturns: {
            inflationRate: 2.9,
            preRetirementEquityReturn: 5,
            postRetirementEquityReturn: 5,
            fixedIncomeReturn: 2.9
          },
          cashflowItems: [],
          lifeEvents: []
        },
        ui: {
          activeTab: 'futureRetirement',
          selectedCareerId: 'career-1-default'
        }
      })
    );

    render(<App />);

    expect(screen.getAllByRole('button', { name: 'Finances Prediction' }).find((button) => button.classList.contains('active'))).toBeDefined();
  });

  it('defaults minimum yearly withdrawal to zero for older saved scenarios', () => {
    window.localStorage.setItem(
      'finance-planner-state',
      JSON.stringify({
        scenario: {
          profile: { currentAge: 45, retirementAge: 65, retirementYears: 30 },
          options: { useDateBasedAge: false, dateOfBirth: '1980-10-01' },
          portfolio: {
            currentAssets: 500000,
            equityAllocation: 75,
            fixedIncomeAllocation: 25,
            fixedIncomeDuration: 'one_year'
          },
          contribution: {
            yearlyContribution: 17500,
            yearlyIncreaseRate: 2.9
          },
          careerPlan: {
            enabled: true,
            entries: []
          },
          savingsTracker: {
            annualInterestRates: { emergencyFund: 2.5, hsa: 5, investments: 6.5, retirement401k: 6 }
          },
          netWorth: {
            accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
            asOfDate: ''
          },
          futureRetirement: {
            useCareerEndAge: true,
            retirementAge: 65,
            retirementYears: 30
          },
          withdrawal: {
            mode: 'specified',
            firstYearAmount: 40000,
            inflationAdjusted: true
          },
          returnMode: 'manual',
          manualReturns: {
            inflationRate: 2.9,
            preRetirementEquityReturn: 5,
            postRetirementEquityReturn: 5,
            fixedIncomeReturn: 2.9
          },
          cashflowItems: [],
          lifeEvents: []
        },
        ui: {
          activeTab: 'retirement',
          selectedCareerId: ''
        }
      })
    );

    render(<App />);

    const control = screen.getByText('Minimum Yearly Withdrawal').closest('label') as HTMLElement;
    const input = within(control).getByRole('spinbutton');
    expect(input).toHaveValue(0);
  });

  it('normalizes career timeline ages from saved state so start is always before end', () => {
    window.localStorage.setItem(
      'finance-planner-state',
      JSON.stringify({
        scenario: {
          profile: { currentAge: 45, retirementAge: 65, retirementYears: 30 },
          options: { useDateBasedAge: false, dateOfBirth: '1980-10-01' },
          portfolio: {
            currentAssets: 500000,
            equityAllocation: 75,
            fixedIncomeAllocation: 25,
            fixedIncomeDuration: 'one_year'
          },
          contribution: {
            yearlyContribution: 17500,
            yearlyIncreaseRate: 2.9
          },
          careerPlan: {
            enabled: true,
            entries: [
              {
                id: 'career-1-default',
                label: 'Current Career',
                enabled: true,
                usePreviousCareerStartAge: false,
                startAge: 65,
                endAge: 45,
                startingSalary: 98000,
                annualRaiseRate: 3.5,
                savingsRate: 10,
                employerMatchRate: 3,
                bonusRate: 8,
                bonusSavingsRate: 50,
                emergencyFundContributionRate: 2,
                hsaContributionRate: 3,
                investmentsContributionRate: 6,
                retirement401kContributionRate: 6,
                emergencyFundSavingsMonthly: false,
                hsaSavingsMonthly: false,
                investmentsSavingsMonthly: false,
                retirement401kSavingsMonthly: false,
                emergencyFundStartBalanceMode: 'auto',
                hsaStartBalanceMode: 'auto',
                investmentsStartBalanceMode: 'auto',
                retirement401kStartBalanceMode: 'auto',
                emergencyFundManualStartBalance: 0,
                hsaManualStartBalance: 0,
                investmentsManualStartBalance: 0,
                retirement401kManualStartBalance: 0
              }
            ]
          },
          savingsTracker: {
            annualInterestRates: { emergencyFund: 2.5, hsa: 5, investments: 6.5, retirement401k: 6 }
          },
          netWorth: {
            accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
            asOfDate: ''
          },
          futureRetirement: {
            useCareerEndAge: true,
            retirementAge: 65,
            retirementYears: 30
          },
          withdrawal: {
            mode: 'specified',
            firstYearAmount: 40000,
            inflationAdjusted: true
          },
          returnMode: 'manual',
          manualReturns: {
            inflationRate: 2.9,
            preRetirementEquityReturn: 5,
            postRetirementEquityReturn: 5,
            fixedIncomeReturn: 2.9
          },
          cashflowItems: [],
          lifeEvents: []
        },
        ui: {
          activeTab: 'careers',
          selectedCareerId: 'career-1-default'
        }
      })
    );

    render(<App />);

    expect(screen.getByText(/Selected timeline:/i)).toHaveTextContent('45');
    expect(screen.getByText(/Selected timeline:/i)).toHaveTextContent('65');
  });

  it('can derive a career start age from the previous career', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '+ Career' })[0]);
    fireEvent.click(screen.getByRole('checkbox', { name: /Use previous career end age as this start age/i }));

    const startAgeInput = within(screen.getByText('Start Age').closest('label')!).getByRole('spinbutton');

    expect(startAgeInput).toHaveValue(65);
    expect(startAgeInput).toBeDisabled();
  });

  it('copies previous career end year-month when using previous career start age', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '+ Career' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Current Career' }));

    const endYearInput = screen.getByLabelText('End Year');
    const endMonthInput = screen.getByLabelText('End Month');
    fireEvent.change(endYearInput, { target: { value: '2030' } });
    fireEvent.blur(endYearInput);
    fireEvent.change(endMonthInput, { target: { value: '03' } });

    fireEvent.click(screen.getByRole('button', { name: 'Career 2' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Use previous career end age as this start age/i }));

    const startYearInput = screen.getByLabelText('Start Year');
    const startMonthInput = screen.getByLabelText('Start Month');

    expect(startYearInput).toHaveValue('2030');
    expect(startMonthInput).toHaveValue('03');
  });

  it('can derive a career start age from birthday and lock the start age input', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Options' })[0]);

    const dateInput = screen.getByLabelText('Date of Birth');
    fireEvent.change(dateInput, { target: { value: makeBirthDate(30) } });

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    fireEvent.click(screen.getByRole('checkbox', { name: /Use current age from birthday/i }));

    const startAgeInput = within(screen.getByText('Start Age').closest('label')!).getByRole('spinbutton');

    expect(startAgeInput).toHaveValue(30);
    expect(startAgeInput).toBeDisabled();

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"useBirthdayBasedStartAge":true');
  });

  it('keeps birthday-based start age and previous-career start age mutually exclusive', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '+ Career' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Career 2' }));

    const previousCareerCheckbox = screen.getByRole('checkbox', { name: /Use previous career end age as this start age/i });
    const birthdayCheckbox = screen.getByRole('checkbox', { name: /Use current age from birthday/i });

    fireEvent.click(previousCareerCheckbox);
    expect(previousCareerCheckbox).toBeChecked();

    fireEvent.click(birthdayCheckbox);

    expect(birthdayCheckbox).toBeChecked();
    expect(previousCareerCheckbox).not.toBeChecked();
    expect(previousCareerCheckbox).toBeDisabled();
  });

  it('normalizes legacy saved careers without birthday-based start age to false', () => {
    window.localStorage.setItem(
      'finance-planner-state',
      JSON.stringify({
        scenario: {
          profile: { currentAge: 45, retirementAge: 65, retirementYears: 30 },
          options: { useDateBasedAge: false, dateOfBirth: '1980-10-01' },
          portfolio: {
            currentAssets: 500000,
            equityAllocation: 75,
            fixedIncomeAllocation: 25,
            fixedIncomeDuration: 'one_year'
          },
          contribution: {
            yearlyContribution: 17500,
            yearlyIncreaseRate: 2.9
          },
          careerPlan: {
            enabled: true,
            entries: [
              {
                id: 'career-1-default',
                label: 'Current Career',
                enabled: true,
                usePreviousCareerStartAge: false,
                startAge: 45,
                endAge: 65,
                startingSalary: 98000,
                annualRaiseRate: 3.5,
                savingsRate: 10,
                employerMatchRate: 3,
                bonusRate: 8,
                bonusSavingsRate: 50,
                emergencyFundContributionRate: 2,
                hsaContributionRate: 3,
                investmentsContributionRate: 6,
                retirement401kContributionRate: 6,
                emergencyFundSavingsMonthly: false,
                hsaSavingsMonthly: false,
                investmentsSavingsMonthly: false,
                retirement401kSavingsMonthly: false,
                emergencyFundStartBalanceMode: 'auto',
                hsaStartBalanceMode: 'auto',
                investmentsStartBalanceMode: 'auto',
                retirement401kStartBalanceMode: 'auto',
                emergencyFundManualStartBalance: 0,
                hsaManualStartBalance: 0,
                investmentsManualStartBalance: 0,
                retirement401kManualStartBalance: 0
              }
            ]
          },
          savingsTracker: {
            annualInterestRates: { emergencyFund: 2.5, hsa: 5, investments: 6.5, retirement401k: 6 }
          },
          netWorth: {
            accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
            asOfDate: ''
          },
          futureRetirement: {
            useCareerEndAge: true,
            retirementAge: 65,
            retirementYears: 30
          },
          withdrawal: {
            mode: 'specified',
            firstYearAmount: 40000,
            inflationAdjusted: true
          },
          returnMode: 'manual',
          manualReturns: {
            inflationRate: 2.9,
            preRetirementEquityReturn: 5,
            postRetirementEquityReturn: 5,
            fixedIncomeReturn: 2.9
          },
          cashflowItems: [],
          lifeEvents: []
        },
        ui: {
          activeTab: 'careers',
          selectedCareerId: 'career-1-default'
        }
      })
    );

    render(<App />);

    const birthdayCheckbox = screen.getByRole('checkbox', { name: /Use current age from birthday/i });
    expect(birthdayCheckbox).not.toBeChecked();

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"useBirthdayBasedStartAge":false');
  });

  it('falls back to resolved current age when birthday-based start age is enabled with an invalid birth date', () => {
    window.localStorage.setItem(
      'finance-planner-state',
      JSON.stringify({
        scenario: {
          profile: { currentAge: 47, retirementAge: 65, retirementYears: 30 },
          options: { useDateBasedAge: true, dateOfBirth: 'invalid-date' },
          portfolio: {
            currentAssets: 500000,
            equityAllocation: 75,
            fixedIncomeAllocation: 25,
            fixedIncomeDuration: 'one_year'
          },
          contribution: {
            yearlyContribution: 17500,
            yearlyIncreaseRate: 2.9
          },
          careerPlan: {
            enabled: true,
            entries: [
              {
                id: 'career-1-default',
                label: 'Current Career',
                enabled: true,
                usePreviousCareerStartAge: false,
                useBirthdayBasedStartAge: true,
                startAge: 35,
                endAge: 65,
                startingSalary: 98000,
                annualRaiseRate: 3.5,
                savingsRate: 10,
                employerMatchRate: 3,
                bonusRate: 8,
                bonusSavingsRate: 50,
                emergencyFundContributionRate: 2,
                hsaContributionRate: 3,
                investmentsContributionRate: 6,
                retirement401kContributionRate: 6,
                emergencyFundSavingsMonthly: false,
                hsaSavingsMonthly: false,
                investmentsSavingsMonthly: false,
                retirement401kSavingsMonthly: false,
                emergencyFundStartBalanceMode: 'auto',
                hsaStartBalanceMode: 'auto',
                investmentsStartBalanceMode: 'auto',
                retirement401kStartBalanceMode: 'auto',
                emergencyFundManualStartBalance: 0,
                hsaManualStartBalance: 0,
                investmentsManualStartBalance: 0,
                retirement401kManualStartBalance: 0
              }
            ]
          },
          savingsTracker: {
            annualInterestRates: { emergencyFund: 2.5, hsa: 5, investments: 6.5, retirement401k: 6 }
          },
          netWorth: {
            accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
            asOfDate: ''
          },
          futureRetirement: {
            useCareerEndAge: true,
            retirementAge: 65,
            retirementYears: 30
          },
          withdrawal: {
            mode: 'specified',
            firstYearAmount: 40000,
            inflationAdjusted: true
          },
          returnMode: 'manual',
          manualReturns: {
            inflationRate: 2.9,
            preRetirementEquityReturn: 5,
            postRetirementEquityReturn: 5,
            fixedIncomeReturn: 2.9
          },
          cashflowItems: [],
          lifeEvents: []
        },
        ui: {
          activeTab: 'careers',
          selectedCareerId: 'career-1-default'
        }
      })
    );

    render(<App />);

    const startAgeInput = within(screen.getByText('Start Age').closest('label')!).getByRole('spinbutton');
    expect(startAgeInput).toHaveValue(47);
    expect(startAgeInput).toBeDisabled();
  });

  it('duplicates careers and confirms before removing careers', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Duplicate Career' })[0]);

    expect(screen.getByRole('button', { name: 'Current Career Copy' })).toBeInTheDocument();

    const removeButton = screen.getByRole('button', { name: 'Remove Career' });

    expect(removeButton.className).toContain('danger-button');

    fireEvent.click(removeButton);
    expect(confirmSpy).toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('shows savings tracker controls and can switch to the stacked savings graph', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);

    expect(screen.getAllByText('Emergency Fund').length).toBeGreaterThan(0);
    expect(screen.getByText('Balance at end of period')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('radio', { name: 'Stacked Savings Graph' }));

    expect(screen.getByRole('img', { name: /stacked savings balances over time/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unfilter All' })).toBeInTheDocument();
  });

  it('keeps careers table balances aligned with the portfolio graph totals', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);

    const resultsTable = screen.getAllByRole('table').find((table) =>
      within(table).queryByRole('columnheader', { name: 'Career' })
    );

    expect(resultsTable).toBeDefined();

    const dataRows = within(resultsTable!).getAllByRole('row').slice(1);
    const firstProjectedRowCells = within(dataRows[1]).getAllByRole('cell');
    const emergencyFund = parseCurrency(firstProjectedRowCells[5].textContent ?? '');
    const hsa = parseCurrency(firstProjectedRowCells[6].textContent ?? '');
    const investments = parseCurrency(firstProjectedRowCells[7].textContent ?? '');
    const retirement401k = parseCurrency(firstProjectedRowCells[8].textContent ?? '');
    const endBalance = parseCurrency(firstProjectedRowCells[12].textContent ?? '');
    const accountSum = emergencyFund + hsa + investments + retirement401k;

    expect(Math.abs(endBalance - accountSum)).toBeLessThanOrEqual(3);

    const summaryEndingText = screen.getByText(/Ending balance at age/i).textContent ?? '';
    const summaryEndingBalanceMatch = summaryEndingText.match(/\$[0-9,]+/g);
    const summaryEndingBalance = parseCurrency(summaryEndingBalanceMatch?.[summaryEndingBalanceMatch.length - 1] ?? '0');
    const lastRowCells = within(dataRows[dataRows.length - 1]).getAllByRole('cell');
    const lastTableEndBalance = parseCurrency(lastRowCells[12].textContent ?? '');

    expect(lastTableEndBalance).toBe(summaryEndingBalance);
  });

  it('stores net worth balances with an as-of date in local storage', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Net Worth' })[0]);

    const emergencyFundInput = within(screen.getByText('Emergency Fund Balance').closest('label')!).getByRole('spinbutton');
    fireEvent.change(emergencyFundInput, { target: { value: '25000' } });
    fireEvent.blur(emergencyFundInput);

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';

    expect(stored).toContain('"emergencyFund":25000');
    expect(stored).toContain('"asOfDate"');
  });

  it('allows adding and removing custom net worth accounts with confirmation', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Net Worth' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '+ Add Custom Account' }));

    const accountNameInput = screen.getByDisplayValue('Account 1');
    const accountRow = accountNameInput.closest('tr') as HTMLTableRowElement;
    const accountBalanceInput = within(accountRow).getByRole('spinbutton');
    fireEvent.change(accountBalanceInput, { target: { value: '5000' } });
    fireEvent.blur(accountBalanceInput);

    confirmSpy.mockReturnValue(false);
    fireEvent.click(within(accountRow).getByRole('button', { name: 'Remove' }));
    expect(screen.getByDisplayValue('Account 1')).toBeInTheDocument();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(within(accountRow).getByRole('button', { name: 'Remove' }));
    expect(screen.queryByDisplayValue('Account 1')).not.toBeInTheDocument();
    expect(confirmSpy).toHaveBeenCalled();

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"customAccounts":[]');

    confirmSpy.mockRestore();
  });

  it('imports a csv statement, supports account remap, and applies staged balance updates', async () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Net Worth' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '+ Add Custom Account' }));

    const accountNameInput = screen.getByDisplayValue('Account 1');
    fireEvent.change(accountNameInput, { target: { value: 'Checking Plus' } });

    const csv = [
      'Account Name,Ending Balance,Statement Date',
      'Brokerage Investments,25000.50,2026-03-31'
    ].join('\n');
    const file = new File([csv], 'brokerage.csv', { type: 'text/csv' });
    const filesInput = screen.getByTestId('networth-import-files-input') as HTMLInputElement;
    fireEvent.change(filesInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/brokerage\.csv/i)).toBeInTheDocument();
      expect(screen.getByText(/Statement Date:/i)).toBeInTheDocument();
    });

    const accountSelect = screen.getByDisplayValue('Investments') as HTMLSelectElement;
    const customAccountOption = within(accountSelect).getByRole('option', { name: 'Checking Plus' }) as HTMLOptionElement;
    fireEvent.change(accountSelect, { target: { value: customAccountOption.value } });
    expect(screen.getAllByDisplayValue('Checking Plus').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Apply Selected' }));

    await waitFor(() => {
      const netWorthStored = window.localStorage.getItem('finance-planner-state') ?? '';
      expect(netWorthStored).toContain('"balance":25000.5');
      expect(netWorthStored).toContain('"statementDate":"2026-03-31"');
      expect(netWorthStored).toContain('"status":"applied"');
      expect(netWorthStored).toContain('"history"');
    });

    const parsed = JSON.parse(window.localStorage.getItem('finance-planner-state') ?? '{}');
    const history = parsed?.scenario?.netWorth?.history ?? [];
    expect(history.length).toBeGreaterThan(0);
    expect(history[history.length - 1].accounts.length).toBeGreaterThanOrEqual(5);
  });

  it('shows net worth history chart and range radios up to available history span', () => {
    window.localStorage.setItem(
      'finance-planner-state',
      JSON.stringify({
        scenario: {
          netWorth: {
            accountBalances: { emergencyFund: 1000, hsa: 1000, investments: 1000, retirement401k: 1000 },
            customAccounts: [],
            imports: [],
            asOfDate: '2026-07-20',
            history: [
              {
                id: 'h-1',
                date: '2026-01-01',
                accounts: [
                  { id: 'emergencyFund', label: 'Emergency Fund', balance: 1000 },
                  { id: 'hsa', label: 'HSA', balance: 1000 },
                  { id: 'investments', label: 'Investments', balance: 1000 },
                  { id: 'retirement401k', label: '401K', balance: 1000 }
                ],
                totalNetWorth: 4000
              },
              {
                id: 'h-2',
                date: '2026-07-20',
                accounts: [
                  { id: 'emergencyFund', label: 'Emergency Fund', balance: 2000 },
                  { id: 'hsa', label: 'HSA', balance: 1500 },
                  { id: 'investments', label: 'Investments', balance: 5000 },
                  { id: 'retirement401k', label: '401K', balance: 3000 }
                ],
                totalNetWorth: 11500
              }
            ]
          }
        },
        ui: { activeTab: 'netWorth', selectedCareerId: '', careersSubTab: 'careers' }
      })
    );

    render(<App />);

    expect(screen.getByRole('img', { name: /net worth history over time/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '30 days' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '60 days' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '90 days' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '180 days' })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: '1 year' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All' })).toBeInTheDocument();
  });

  it('persists and restores finances prediction sub-tab selection', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"careersSubTab":"purchasesExpenses"');

    cleanup();
    render(<App />);

    expect(screen.getByText('Large Purchases Table')).toBeInTheDocument();
  });

  it('allows entering career start using year-month and converts it to age', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);

    const yearInput = screen.getByLabelText('Start Year');
    const monthInput = screen.getByLabelText('Start Month');
    fireEvent.change(yearInput, { target: { value: '2030' } });
    fireEvent.change(monthInput, { target: { value: '10' } });

    const startAgeInput = within(screen.getByText('Start Age').closest('label')!).getByRole('spinbutton');
    expect(startAgeInput).toHaveValue(50);
  });

});
