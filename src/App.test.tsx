import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

  it('does not show future retirement controls in the careers retirement item', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);

    fireEvent.click(screen.getAllByRole('button', { name: 'Retirement' })[1]);

    expect(screen.queryByText(/Career-derived retirement age:/i)).not.toBeInTheDocument();
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

});
