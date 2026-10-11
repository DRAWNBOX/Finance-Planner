import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { createDefaultCareerEntry } from './defaultScenario';
import { loadAppState } from './storage';

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

  it('shows net income as the results-table income column', () => {
    render(<App />);

    expect(screen.getByRole('columnheader', { name: 'Net income' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Salary' })).not.toBeInTheDocument();
  });

  it('shows the finances prediction graph, table, and summary on Options', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSummary = screen.getByText(/Ending balance at age/i).textContent;

    fireEvent.click(screen.getAllByRole('button', { name: 'Options' })[0]);

    expect(screen.getByRole('img', { name: /portfolio value over time/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Career' })).toBeInTheDocument();
    expect(screen.getByText(/Ending balance at age/i).textContent).toBe(financeSummary);
  });

  it('shows an inline editor when an add-on checkbox is enabled', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Retirement' }));

    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Social Security' })[0]);

    expect(screen.getAllByText('Social Security').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('24000')).toBeInTheDocument();
  });

  it('persists the global inflation toggle state', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Options' })[0]);

    const inflationToggle = screen.getByRole('checkbox', { name: 'Enable inflation' });
    expect(inflationToggle).toBeChecked();

    fireEvent.click(inflationToggle);
    expect(inflationToggle).not.toBeChecked();

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"inflationEnabled":false');
  });

  it('disables inflation-related controls when global inflation is off', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Options' })[0]);

    const inflationToggle = screen.getByRole('checkbox', { name: 'Enable inflation' });
    fireEvent.click(inflationToggle);

    const inflationControl = screen.getByText('Inflation Rate %').closest('label') as HTMLElement;
    const inflationRateInput = within(inflationControl).getByRole('spinbutton');

    expect(inflationRateInput).toBeDisabled();
  });

  it('re-enables inflation controls and preserves checked states', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Options' })[0]);

    const inflationToggle = screen.getByRole('checkbox', { name: 'Enable inflation' });
    const inflationRateInput = screen.getByRole('spinbutton');
    expect(inflationRateInput).toHaveValue(2.9);

    fireEvent.click(inflationToggle);
    fireEvent.click(inflationToggle);

    expect(inflationRateInput).toBeEnabled();
    expect(inflationRateInput).toHaveValue(2.9);
  });

  it('derives current age from date of birth and persists the option', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    fireEvent.click(screen.getByRole('checkbox', { name: /Use current age from birthday/i }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Options' })[0]);

    const dateInput = screen.getByLabelText('Date of Birth');
    fireEvent.change(dateInput, { target: { value: makeBirthDate(40) } });

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const currentAgeInput = within(screen.getByText('Start Age').closest('label')!).getByRole('spinbutton');

    expect(currentAgeInput).toHaveValue(40);
    expect(currentAgeInput).toBeDisabled();

    const stored = window.localStorage.getItem('finance-planner-state');

    expect(stored).toContain('"useBirthdayBasedStartAge":true');
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
    expect(screen.getByText('Career Timeline')).toBeInTheDocument();

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
    expect(screen.queryByText('Future Life Events')).not.toBeInTheDocument();
    expect(screen.queryByText('Future Retirement')).not.toBeInTheDocument();

    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Retirement' }));
    expect(screen.queryByText('Retirement Calculator')).not.toBeInTheDocument();
    expect(screen.getByText('Future Retirement')).toBeInTheDocument();
    expect(screen.getByText(/Current age from Options:/i)).toBeInTheDocument();
    expect(screen.getByText(/Career-derived retirement age:/i)).toBeInTheDocument();
    expect(screen.getByText(/Retirement horizon:/i)).toBeInTheDocument();
    expect(screen.getByText(/Retirement assets:/i)).toBeInTheDocument();

    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));
    expect(screen.getByText('Large Purchases Table')).toBeInTheDocument();
    expect(screen.getByText('Loans Table')).toBeInTheDocument();
  });

  it('shows graph and results table in purchases and expenses sub-tab', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    expect(screen.getByRole('img', { name: /portfolio value over time/i })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Career' })).toBeInTheDocument();

    const portfolioGraphBefore = screen.getByRole('img', { name: /portfolio value over time/i });
    const initialPortfolioFlagCount = portfolioGraphBefore.querySelectorAll('.chart-flag-stem').length;

    const addPurchaseButton = screen.getByRole('button', { name: '+ Purchase' });
    fireEvent.click(addPurchaseButton);
    fireEvent.click(within(document.querySelector('.expense-modal')!).getByText('Uncategorized'));
    fireEvent.click(addPurchaseButton);
    fireEvent.click(within(document.querySelector('.expense-modal')!).getByText('Uncategorized'));

    const portfolioGraph = screen.getByRole('img', { name: /portfolio value over time/i });
    const updatedPortfolioFlagCount = portfolioGraph.querySelectorAll('.chart-flag-stem').length;
    expect(updatedPortfolioFlagCount).toBeGreaterThan(initialPortfolioFlagCount);
    expect(portfolioGraph.querySelectorAll('.chart-flag-callout').length).toBe(updatedPortfolioFlagCount);

    fireEvent.click(screen.getByRole('radio', { name: 'Stacked Savings Graph' }));
    const stackedGraph = screen.getByRole('img', { name: /stacked savings balances over time/i });
    expect(stackedGraph.querySelectorAll('.chart-flag-stem').length).toBe(updatedPortfolioFlagCount);
    expect(stackedGraph.querySelectorAll('.chart-flag-callout').length).toBe(updatedPortfolioFlagCount);
  });

  it('renders expenses as a top-level tab to the right of net worth', () => {
    render(<App />);

    const topTabs = screen.getAllByRole('button').filter((button) =>
      ['Options', 'Finances Prediction', 'Net Worth', 'Expenses'].includes(button.textContent ?? '')
    );
    const labels = topTabs.map((button) => button.textContent);
    expect(labels).toEqual(['Options', 'Finances Prediction', 'Net Worth', 'Expenses']);
  });

  it('hides graph and results table in expenses tab and shows planner UI', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Expenses' })[0]);

    expect(screen.queryByRole('img', { name: /portfolio value over time/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Career' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Event' })).toBeInTheDocument();
    expect(screen.getByText('Import Sources (Audit + Rollback)')).toBeInTheDocument();
  });

  it('imports expense csv source and removes only entries from that source', async () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Expenses' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Add Event' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));

    const csv = ['Date,Description,Amount,Account', '2027-01-15,Movies,45.25,Checking'].join('\n');
    const file = new File([csv], 'expenses.csv', { type: 'text/csv' });
    const fileInput = document.querySelector('input[type="file"][accept=".csv,.pdf"]') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText(/expenses\.csv/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Remove Source \+ Imported Entries/i }));

    await waitFor(() => {
      const stored = window.localStorage.getItem('finance-planner-state') ?? '';
      expect(stored).toContain('"originType":"manual"');
      expect(stored).not.toContain('"fileName":"expenses.csv"');
    });
  });

  it('shows weekly planning matrix with per-account categories and chart controls', () => {
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Expenses' })[0]);

    expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    expect(screen.queryByText('Weekly Spend + Balance Overlay')).not.toBeInTheDocument();
    expect(screen.getAllByText('Balance').length).toBeGreaterThan(0);
    expect(screen.getByText(/Last updated account balance:/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('Subscription')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Gas')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Purchases')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Fun')).toBeInTheDocument();

    const addCategoryInput = screen.getByPlaceholderText('e.g. Groceries');
    fireEvent.change(addCategoryInput, { target: { value: 'Travel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Category' }));
    expect(screen.getByDisplayValue('Travel')).toBeInTheDocument();
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
    expect(screen.getByText('Start Age')).toBeInTheDocument();
  });

  it('shares minimum yearly withdrawal value between retirement tabs', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const initialFinanceSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(initialFinanceSubTabs).toBeTruthy();
    const initialFinanceSubTabsElement = initialFinanceSubTabs as HTMLElement;
    fireEvent.click(within(initialFinanceSubTabsElement).getByRole('button', { name: 'Retirement' }));

    const retirementMinimumControl = screen
      .getAllByText('Minimum Yearly Withdrawal')
      .map((element) => element.closest('label'))
      .filter(Boolean)[0] as HTMLElement;
    const retirementMinimumInput = within(retirementMinimumControl).getByRole('spinbutton') as HTMLInputElement;
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

  it('uses year-month inputs and funding source dropdown for purchases', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Purchase' }));
    fireEvent.click(within(document.querySelector('.expense-modal')!).getByText('Uncategorized'));

    expect(screen.getByLabelText('Purchase Year')).toBeInTheDocument();
    expect(screen.getByLabelText('Purchase Month')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Purchase Year Up' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Purchase Year Down' })).toBeInTheDocument();

    const purchaseYearInput = screen.getByLabelText('Purchase Year') as HTMLInputElement;
    const startingYear = Number(purchaseYearInput.value);
    fireEvent.click(screen.getByRole('button', { name: 'Purchase Year Up' }));
    expect(purchaseYearInput).toHaveValue(String(startingYear + 1));
    expect(screen.getByRole('columnheader', { name: 'Pay From' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Account Balance After Purchase' })).toBeInTheDocument();
    const fundingSource = screen.getByLabelText('Purchase Funding Source');
    expect(fundingSource).toBeInTheDocument();
    expect(within(fundingSource).getByRole('option', { name: 'Income' })).toBeInTheDocument();
  });

  it('shows account balance after purchase and N/A for income-funded large purchases', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Purchase' }));
    fireEvent.click(within(document.querySelector('.expense-modal')!).getByText('Uncategorized'));

    const row = screen.getByDisplayValue('Large Purchase').closest('tr') as HTMLTableRowElement;
    const fundingSource = within(row).getByLabelText('Purchase Funding Source') as HTMLSelectElement;
    const nonIncomeOption = within(fundingSource)
      .getAllByRole('option')
      .find((option) => (option as HTMLOptionElement).value.startsWith('account:')) as HTMLOptionElement | undefined;
    expect(nonIncomeOption).toBeDefined();

    fireEvent.change(fundingSource, { target: { value: nonIncomeOption!.value } });

    const accountCellText = within(row).getAllByRole('cell')[7].textContent ?? '';
    expect(accountCellText).toMatch(/^-?\$[0-9,]+$/);

    fireEvent.change(fundingSource, { target: { value: 'income' } });
    const incomeCellText = within(row).getAllByRole('cell')[7].textContent ?? '';
    expect(incomeCellText).toMatch(/^\$/);
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

  it('supports adding loans in the purchases and expenses tab', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

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

  it('marks loan rows red when the selected account cannot fund the loan', async () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Loan' }));

    const loanRow = screen.getByDisplayValue('Loan').closest('tr') as HTMLTableRowElement;
    const minimumPaymentInput = within(loanRow).getAllByRole('spinbutton')[4] as HTMLInputElement;
    fireEvent.change(minimumPaymentInput, { target: { value: '500000' } });
    fireEvent.blur(minimumPaymentInput);

    await waitFor(() => {
      expect(loanRow.className).toContain('invalid');
    });
    expect(loanRow.getAttribute('title') ?? '').toContain('selected payment source account cannot fund this loan');

    fireEvent.change(within(loanRow).getByLabelText('Loan Payment Source'), { target: { value: 'income' } });

    await waitFor(() => {
      expect(loanRow.className).toContain('invalid');
    });
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

  it('marks purchase rows red when selected pay-from account balance after purchase is negative', async () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Purchase' }));
    fireEvent.click(within(document.querySelector('.expense-modal')!).getByText('Uncategorized'));

    const purchaseNameInput = screen.getByDisplayValue('Large Purchase');
    const purchaseRow = purchaseNameInput.closest('tr') as HTMLTableRowElement;
    expect(purchaseRow.className).toContain('purchase-row');

    const fundingSource = within(purchaseRow).getByLabelText('Purchase Funding Source') as HTMLSelectElement;
    const accountOption = within(fundingSource)
      .getAllByRole('option')
      .find((option) => (option as HTMLOptionElement).value.startsWith('account:')) as HTMLOptionElement;
    fireEvent.change(fundingSource, { target: { value: accountOption.value } });

    const accountBalanceCellText = within(purchaseRow).getAllByRole('cell')[7].textContent ?? '';
    const isNegative = accountBalanceCellText.trim().startsWith('-$');
    if (isNegative) {
      expect(purchaseRow.className).toContain('invalid');
      expect(purchaseRow.getAttribute('title') ?? '').toContain('goes negative');
    } else {
      expect(purchaseRow.className).not.toContain('invalid');
    }

    fireEvent.change(fundingSource, { target: { value: 'income' } });
    await waitFor(() => {
      expect((within(purchaseRow).getByLabelText('Purchase Funding Source') as HTMLSelectElement).value).toBe('income');
    });
    const incomeRow = screen.getByDisplayValue('Large Purchase').closest('tr')!;
    if (isNegative) {
      expect(incomeRow.className).toContain('invalid');
      expect(incomeRow.getAttribute('title') ?? '').toContain('goes negative');
    }
  });

  it('updates account balance after purchase when amount changes and keeps income rows as N/A', async () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Purchase' }));
    fireEvent.click(within(document.querySelector('.expense-modal')!).getByText('Uncategorized'));

    const purchaseRow = screen.getByDisplayValue('Large Purchase').closest('tr') as HTMLTableRowElement;
    const fundingSource = within(purchaseRow).getByLabelText('Purchase Funding Source') as HTMLSelectElement;
    const accountOption = within(fundingSource)
      .getAllByRole('option')
      .find((option) => (option as HTMLOptionElement).value.startsWith('account:')) as HTMLOptionElement;
    fireEvent.change(fundingSource, { target: { value: accountOption.value } });
    await waitFor(() => {
      expect((within(purchaseRow).getByLabelText('Purchase Funding Source') as HTMLSelectElement).value).toBe(accountOption.value);
    });

    const balanceCell = within(purchaseRow).getAllByRole('cell')[7];
    const amountInput = purchaseRow.querySelector('input[type="number"]') as HTMLInputElement;
    expect(amountInput).toBeTruthy();
    fireEvent.change(amountInput, { target: { value: '2500' } });
    fireEvent.blur(amountInput);

    await waitFor(() => {
      expect((purchaseRow.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('2500');
      const afterText = within(purchaseRow).getAllByRole('cell')[7].textContent ?? '';
      expect(afterText).toMatch(/^-?\$[0-9,]+$/);
    });

    fireEvent.change(fundingSource, { target: { value: 'income' } });
    const incomeCellText2 = within(purchaseRow).getAllByRole('cell')[7].textContent ?? '';
    expect(incomeCellText2).toMatch(/^\$/);
  });

  it('adds a timeline that duplicates purchases and switches between them', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Purchase' }));
    fireEvent.click(within(document.querySelector('.expense-modal')!).getByText('Uncategorized'));
    expect(screen.getByDisplayValue('Large Purchase')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Add Timeline' }));

    const timelineChip = screen.getByRole('button', { name: 'Timeline 1' });
    expect(timelineChip).toBeInTheDocument();
    expect(timelineChip.className).toContain('active');
    expect(screen.getByRole('button', { name: 'Default' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Large Purchase')).toBeInTheDocument();
  });

  it('shows a chronological, non-draggable timeline with monthly leftover income', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Timeline Management' }));

    expect(screen.getByText('Career and Housing Timeline')).toBeInTheDocument();
    expect(document.querySelector('.timeline-chip')).not.toHaveAttribute('draggable');
    expect(screen.getByText('Monthly Income Waterfall')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Leftover' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show full range' })).toBeInTheDocument();
  });

  it('keeps timeline purchases independent from the default set', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Purchase' }));
    fireEvent.click(within(document.querySelector('.expense-modal')!).getByText('Uncategorized'));

    fireEvent.click(screen.getByRole('button', { name: 'Add Timeline' }));

    const nameInput = screen.getByDisplayValue('Large Purchase');
    fireEvent.change(nameInput, { target: { value: 'Timeline Purchase' } });

    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    expect(screen.getByDisplayValue('Large Purchase')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Timeline Purchase')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Timeline 1' }));
    expect(screen.getByDisplayValue('Timeline Purchase')).toBeInTheDocument();
  });

  it('copies an existing timeline from the manage modal', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Purchases and expenses' }));

    fireEvent.click(screen.getByRole('button', { name: 'Add Timeline' }));
    expect(screen.getByRole('button', { name: 'Timeline 1' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Timelines' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(screen.getByDisplayValue('Timeline 1 (copy)')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Timeline 1')).toBeInTheDocument();
  });

  it('keeps housing independent across timelines', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Housing Expenses' }));

    fireEvent.click(screen.getByRole('button', { name: 'Add Timeline' }));
    expect(screen.getByRole('button', { name: 'Timeline 1' }).className).toContain('active');

    fireEvent.click(screen.getByRole('button', { name: '+ Mortgage' }));
    expect(screen.getByDisplayValue('My Home')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    expect(screen.queryByDisplayValue('My Home')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Timeline 1' }));
    expect(screen.getByDisplayValue('My Home')).toBeInTheDocument();
  });

  it('shows per-expense payment source selectors in the housing editor', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Housing Expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Mortgage' }));

    expect(screen.getByLabelText('PMI Source')).toBeInTheDocument();
    expect(screen.getByLabelText('Taxes & Insurance Source')).toBeInTheDocument();
    expect(screen.getByLabelText('HOA & Maintenance Source')).toBeInTheDocument();
  });

  it('shows mortgages and rentals as chips and supports duplicate', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Housing Expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Mortgage' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Rental' }));

    expect(screen.getByRole('button', { name: 'My Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apartment' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate Housing' }));
    expect(screen.getByRole('button', { name: 'Apartment Copy' })).toBeInTheDocument();
  });

  it('disables use-previous-end when the previous housing has no end date', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    const financeSubTabsElement = financeSubTabs as HTMLElement;
    fireEvent.click(within(financeSubTabsElement).getByRole('button', { name: 'Housing Expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Mortgage' }));
    fireEvent.click(screen.getByRole('button', { name: '+ Rental' }));

    const usePrevious = screen.getByRole('checkbox', { name: 'Use the month after the previous housing end date as the start date' });
    expect(usePrevious).toBeInTheDocument();
    expect(usePrevious).toBeDisabled();
  });

  const openHousingSubTab = () => {
    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs') as HTMLElement;
    fireEvent.click(within(financeSubTabs).getByRole('button', { name: 'Housing Expenses' }));
    return financeSubTabs;
  };

  it('links a housing start date to a selected career', () => {
    render(<App />);
    openHousingSubTab();

    fireEvent.click(screen.getByRole('button', { name: '+ Mortgage' }));

    const startYear = screen.getByLabelText('Start Year') as HTMLInputElement;
    fireEvent.change(startYear, { target: { value: '2030' } });
    fireEvent.blur(startYear);
    expect((screen.getByLabelText('Start Year') as HTMLInputElement).value).toBe('2030');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Link start date to a career' }));

    const careerSelect = screen.getByLabelText('Start Career') as HTMLSelectElement;
    expect(within(careerSelect).getByRole('option', { name: 'Current Career' })).toBeInTheDocument();
    expect((screen.getByLabelText('Start Year') as HTMLInputElement).value).toBe('2025');
    expect(screen.getByLabelText('Start Year')).toBeDisabled();
    expect(screen.getByLabelText('Start Month')).toBeDisabled();
  });

  it('links a housing end date to a selected career', () => {
    render(<App />);
    openHousingSubTab();

    fireEvent.click(screen.getByRole('button', { name: '+ Rental' }));

    const endYear = screen.getByLabelText('End Year') as HTMLInputElement;
    fireEvent.change(endYear, { target: { value: '2035' } });
    fireEvent.blur(endYear);
    expect((screen.getByLabelText('End Year') as HTMLInputElement).value).toBe('2035');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Link end date to a career' }));

    expect(screen.getByLabelText('End Career')).toBeInTheDocument();
    expect((screen.getByLabelText('End Year') as HTMLInputElement).value).toBe('2045');
    expect(screen.getByLabelText('End Year')).toBeDisabled();
  });

  it('follows career date changes after linking a housing start date', () => {
    render(<App />);
    const financeSubTabs = openHousingSubTab();

    fireEvent.click(screen.getByRole('button', { name: '+ Mortgage' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Link start date to a career' }));
    expect((screen.getByLabelText('Start Year') as HTMLInputElement).value).toBe('2025');

    fireEvent.click(within(financeSubTabs).getByRole('button', { name: 'Careers' }));
    const careerStartYear = screen.getByLabelText('Start Year') as HTMLInputElement;
    fireEvent.change(careerStartYear, { target: { value: '2028' } });
    fireEvent.blur(careerStartYear);

    fireEvent.click(within(financeSubTabs).getByRole('button', { name: 'Housing Expenses' }));
    expect((screen.getByLabelText('Start Year') as HTMLInputElement).value).toBe('2028');
  });

  it('makes the career start link mutually exclusive with the previous-end chain', () => {
    render(<App />);
    openHousingSubTab();

    fireEvent.click(screen.getByRole('button', { name: '+ Mortgage' }));
    const sellYear = screen.getByLabelText('Sell Year') as HTMLInputElement;
    fireEvent.change(sellYear, { target: { value: '2030' } });
    fireEvent.blur(sellYear);

    fireEvent.click(screen.getByRole('button', { name: '+ Rental' }));

    const usePrevious = screen.getByRole('checkbox', { name: 'Use the month after the previous housing end date as the start date' });
    expect(usePrevious).not.toBeDisabled();
    fireEvent.click(usePrevious);
    expect((screen.getByLabelText('Start Year') as HTMLInputElement).value).toBe('2030');
    expect((screen.getByLabelText('Start Month') as HTMLSelectElement).value).toBe('02');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Link start date to a career' }));

    const usePreviousAfter = screen.getByRole('checkbox', { name: 'Use the month after the previous housing end date as the start date' });
    expect(usePreviousAfter).toBeDisabled();
    expect(usePreviousAfter).not.toBeChecked();
    expect((screen.getByLabelText('Start Year') as HTMLInputElement).value).toBe('2025');
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
                endAge: 65,                annualRaiseRate: 3.5,
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
          careersSubTab: 'retirement',
          selectedCareerId: ''
        }
      })
    );

    render(<App />);

    const controls = screen
      .getAllByText('Minimum Yearly Withdrawal')
      .map((element) => element.closest('label'))
      .filter(Boolean) as HTMLElement[];
    const hasZeroValue = controls.some((control) => {
      const input = within(control).getByRole('spinbutton') as HTMLInputElement;
      return input.value === '0';
    });

    expect(hasZeroValue).toBe(true);
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
                endAge: 45,                annualRaiseRate: 3.5,
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
    fireEvent.click(screen.getByRole('checkbox', { name: /Use the month after the previous career end/i }));

    const startAgeInput = within(screen.getByText('Start Age').closest('label')!).getByRole('spinbutton');

    expect(startAgeInput).toHaveValue(65);
    expect(startAgeInput).toBeDisabled();
  });

  it('uses the month after the previous career end when using previous career start age', () => {
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
    fireEvent.click(screen.getByRole('checkbox', { name: /Use the month after the previous career end/i }));

    const startYearInput = screen.getByLabelText('Start Year');
    const startMonthInput = screen.getByLabelText('Start Month');

    expect(startYearInput).toHaveValue('2030');
    expect(startMonthInput).toHaveValue('04');

    const startAgeInput = within(screen.getByText('Start Age').closest('label')!).getByRole('spinbutton');
    expect(startAgeInput).toHaveValue(49);
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

    const previousCareerCheckbox = screen.getByRole('checkbox', { name: /Use the month after the previous career end/i });
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
                endAge: 65,                annualRaiseRate: 3.5,
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
                endAge: 65,                annualRaiseRate: 3.5,
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

  it('honors an explicit id passed to createDefaultCareerEntry', () => {
    const entry = createDefaultCareerEntry(1, 45, 65, 'career-explicit-id');
    expect(entry.id).toBe('career-explicit-id');
    expect(createDefaultCareerEntry(1, 45, 65).id).toBe('career-2-default');
  });

  it('keeps career ids unique when re-adding after a removal', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: '+ Career' })[0]);

    fireEvent.click(screen.getByRole('button', { name: 'Current Career' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Career' }));

    fireEvent.click(screen.getAllByRole('button', { name: '+ Career' })[0]);

    const stored = JSON.parse(window.localStorage.getItem('finance-planner-state') ?? '{}');
    const ids = (stored.scenario?.careerPlan?.entries ?? []).map((entry: { id: string }) => entry.id) as string[];
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(new Set(ids).size).toBe(ids.length);

    fireEvent.click(screen.getAllByRole('button', { name: 'Career 2' })[0]);
    fireEvent.change(screen.getByDisplayValue('Career 2'), { target: { value: 'Alpha' } });

    expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Career 2' })).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it('repairs duplicate career ids when loading saved state', () => {
    window.localStorage.setItem(
      'finance-planner-state',
      JSON.stringify({
        scenario: {
          careerPlan: {
            enabled: true,
            entries: [
              { id: 'career-2-default', label: 'Career 2', enabled: true, startAge: 50, endAge: 54 },
              { id: 'career-2-default', label: 'Career 2', enabled: true, startAge: 55, endAge: 59 }
            ]
          }
        },
        ui: { activeTab: 'careers', selectedCareerId: 'career-2-default' }
      })
    );

    const state = loadAppState();
    const ids = state.scenario.careerPlan.entries.map((entry) => entry.id);
    expect(ids.length).toBe(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('configures paycheck line items in the paycheck modal', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Configure Paycheck' }));

    expect(screen.getByRole('heading', { name: 'Configure Paycheck' })).toBeInTheDocument();

    const statutory = screen.getByText('Statutory').closest('section') as HTMLElement;
    fireEvent.click(within(statutory).getByRole('button', { name: '+ Item' }));

    const row = within(statutory).getByLabelText(/Line label/).closest('.paycheck-line-row') as HTMLElement;
    fireEvent.change(within(row).getByLabelText(/Line label/), { target: { value: 'Federal Income Tax' } });
    fireEvent.change(within(row).getAllByRole('spinbutton')[0], { target: { value: '100' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save Paycheck' }));

    const stored = JSON.parse(window.localStorage.getItem('finance-planner-state') ?? '{}');
    const paycheck = stored.scenario.careerPlan.entries[0].paycheck;
    const statutoryCategory = paycheck.categories.find((category: { label: string }) => category.label === 'Statutory');
    expect(statutoryCategory.lines[0].label).toBe('Federal Income Tax');
    expect(statutoryCategory.lines[0].amount).toBe(100);
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

  it('shows per-career cap controls and persists max balance + overflow fallback', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);

    expect(screen.getByText('Max Balance')).toBeInTheDocument();
    expect(screen.getByText('Overflow Fallback')).toBeInTheDocument();

    const emergencyLabel = screen
      .getAllByText('Emergency Fund')
      .find((node) => node.classList.contains('career-savings-cell')) as HTMLElement;
    const emergencyRow = emergencyLabel.closest('.career-savings-row') as HTMLElement;
    const emergencyInputs = within(emergencyRow).getAllByRole('spinbutton');
    const maxBalanceInput = emergencyInputs[emergencyInputs.length - 1] as HTMLInputElement;
    fireEvent.change(maxBalanceInput, { target: { value: '12345' } });
    fireEvent.blur(maxBalanceInput);

    const fallbackSelect = within(emergencyRow).getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(fallbackSelect, { target: { value: 'hsa-account-default' } });

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"maxBalance":12345');
    expect(stored).toContain('"overflowFallbackAccountId":"hsa-account-default"');
  });

  it('toggles a fixed deposit to increase with the paycheck', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);

    const findEmergencyRow = () => {
      const label = screen
        .getAllByText('Emergency Fund')
        .find((node) => node.classList.contains('career-savings-cell')) as HTMLElement;
      return label.closest('.career-savings-row') as HTMLElement;
    };

    fireEvent.click(within(findEmergencyRow()).getByTitle('Percent of salary'));

    fireEvent.click(within(findEmergencyRow()).getByLabelText('Increase with paycheck Emergency Fund'));

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"mode":"fixedAmount"');
    expect(stored).toContain('"increaseWithPaycheck":true');
  });

  it('persists the expenses (monthly withdrawals by account) grid', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);

    const row = screen.getByText('Emergency Fund Monthly Withdrawal').closest('label') as HTMLElement;
    const input = within(row).getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.blur(input);

    fireEvent.click(within(row).getByLabelText('Increase withdrawal with paycheck Emergency Fund'));

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"monthlyWithdrawal":123');
    expect(stored).toContain('"increaseWithdrawalWithPaycheck":true');
  });

  it('persists the income fallback account selects', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);

    const primary = screen.getByText('Primary Fallback').closest('label') as HTMLElement;
    fireEvent.change(within(primary).getByRole('combobox'), { target: { value: 'investments-account-default' } });

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"incomeFallbackAccountId":"investments-account-default"');
  });

  it('clears an income fallback when its account is removed and shows a note', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const primary = screen.getByText('Primary Fallback').closest('label') as HTMLElement;
    fireEvent.change(within(primary).getByRole('combobox'), { target: { value: 'hsa-account-default' } });

    fireEvent.click(screen.getAllByRole('button', { name: 'Net Worth' })[0]);
    const bankTable = screen
      .getAllByRole('table')
      .find((table) => within(table).queryByRole('columnheader', { name: 'Type' })) as HTMLElement;
    const hsaRow = within(bankTable)
      .getAllByRole('row')
      .find((row) => (within(row).queryAllByRole('textbox') as HTMLInputElement[]).some((input) => input.value === 'HSA')) as HTMLElement;
    fireEvent.click(within(hsaRow).getByRole('button', { name: 'Remove' }));

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).not.toContain('"incomeFallbackAccountId":"hsa-account-default"');

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    expect(screen.getByText(/income fallback account no longer exists/i)).toBeInTheDocument();

    confirmSpy.mockRestore();
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
    const emergencyFund = parseCurrency(firstProjectedRowCells[6].textContent ?? '');
    const hsa = parseCurrency(firstProjectedRowCells[7].textContent ?? '');
    const investments = parseCurrency(firstProjectedRowCells[8].textContent ?? '');
    const retirement401k = parseCurrency(firstProjectedRowCells[9].textContent ?? '');
    const endBalance = parseCurrency(firstProjectedRowCells[14].textContent ?? '');
    const accountSum = emergencyFund + hsa + investments + retirement401k;

    expect(Math.abs(endBalance - accountSum)).toBeLessThanOrEqual(3);

    const summaryEndingText = screen.getByText(/Ending balance at age/i).textContent ?? '';
    const summaryEndingBalanceMatch = summaryEndingText.match(/\$[0-9,]+/g);
    const summaryEndingBalance = parseCurrency(summaryEndingBalanceMatch?.[summaryEndingBalanceMatch.length - 1] ?? '0');
    const lastRowCells = within(dataRows[dataRows.length - 1]).getAllByRole('cell');
    const lastTableEndBalance = parseCurrency(lastRowCells[14].textContent ?? '');

    expect(lastTableEndBalance).toBe(summaryEndingBalance);
  });

  it('stores net worth balances with an as-of date in local storage', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Net Worth' })[0]);

    const bankAccountHeader = screen.getByRole('columnheader', { name: 'Balance' });
    const bankAccountTable = bankAccountHeader.closest('table') as HTMLTableElement;
    const emergencyFundInput = bankAccountTable.querySelector(
      'tbody tr td input[type="text"][value="Emergency Fund"]'
    ) as HTMLInputElement;
    const emergencyFundRow = emergencyFundInput.closest('tr') as HTMLTableRowElement;
    const emergencyFundBalanceInput = within(emergencyFundRow).getAllByRole('spinbutton')[1];
    fireEvent.change(emergencyFundBalanceInput, { target: { value: '25000' } });
    fireEvent.blur(emergencyFundBalanceInput);

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';

    expect(stored).toContain('"id":"emergencyFund-account-default"');
    expect(stored).toContain('"balance":25000');
    expect(stored).toContain('"asOfDate"');
  });

  it('saves a dated net worth snapshot with current account balances', async () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Net Worth' })[0]);

    const bankAccountHeader = screen.getByRole('columnheader', { name: 'Balance' });
    const bankAccountTable = bankAccountHeader.closest('table') as HTMLTableElement;
    const emergencyFundInput = bankAccountTable.querySelector(
      'tbody tr td input[type="text"][value="Emergency Fund"]'
    ) as HTMLInputElement;
    const emergencyFundRow = emergencyFundInput.closest('tr') as HTMLTableRowElement;
    const emergencyFundBalanceInput = within(emergencyFundRow).getAllByRole('spinbutton')[1];
    fireEvent.change(emergencyFundBalanceInput, { target: { value: '25000' } });
    fireEvent.blur(emergencyFundBalanceInput);

    fireEvent.click(screen.getByRole('button', { name: 'Save Account Balance' }));

    const today = new Date().toISOString().slice(0, 10);
    await waitFor(() => {
      const parsed = JSON.parse(window.localStorage.getItem('finance-planner-state') ?? '{}');
      const netWorth = parsed?.scenario?.netWorth ?? {};
      expect(netWorth.asOfDate).toBe(today);
      const history = netWorth.history ?? [];
      expect(history.length).toBeGreaterThan(0);
      const latest = history[history.length - 1];
      expect(latest.date).toBe(today);
      const emergencyFund = (latest.accounts ?? []).find(
        (account: { id: string }) => account.id === 'emergencyFund-account-default'
      );
      expect(emergencyFund?.balance).toBe(25000);
      expect(latest.totalNetWorth).toBeGreaterThanOrEqual(25000);
    });
  });

  it('overwrites the same-day net worth snapshot instead of duplicating it', async () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Net Worth' })[0]);

    const saveButton = screen.getByRole('button', { name: 'Save Account Balance' });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    const today = new Date().toISOString().slice(0, 10);
    await waitFor(() => {
      const parsed = JSON.parse(window.localStorage.getItem('finance-planner-state') ?? '{}');
      const history = parsed?.scenario?.netWorth?.history ?? [];
      expect(history).toHaveLength(1);
      expect(history[0].date).toBe(today);
    });
  });

  it('hides the legacy add custom account control in net worth', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Net Worth' })[0]);
    expect(screen.queryByRole('button', { name: '+ Add Custom Account' })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('radio', { name: 'Portfolio Graph' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Stacked Savings Graph' })).not.toBeInTheDocument();
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

  it('renders Down Pay From dropdown in loans table and persists selection', async () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    const financeSubTabs = screen.getByRole('button', { name: 'Timeline Management' }).closest('.tabs');
    expect(financeSubTabs).toBeTruthy();
    fireEvent.click(within(financeSubTabs as HTMLElement).getByRole('button', { name: 'Purchases and expenses' }));

    fireEvent.click(screen.getByRole('button', { name: '+ Loan' }));

    const loanRow = screen.getByDisplayValue('Loan').closest('tr') as HTMLTableRowElement;
    const dpSelect = within(loanRow).getByLabelText('Loan Down Payment Source') as HTMLSelectElement;
    expect(dpSelect).toBeInTheDocument();

    expect(within(dpSelect).getByRole('option', { name: 'Income' })).toBeInTheDocument();
    const accountOptions = within(dpSelect)
      .getAllByRole('option')
      .filter((option) => (option as HTMLOptionElement).value.startsWith('account:'));
    expect(accountOptions.length).toBeGreaterThan(0);
  });

  it('shows enriched fallback tooltip on yellow loan row with income usage breakdown', async () => {
    window.localStorage.setItem(
      'finance-planner-state',
      JSON.stringify({
        scenario: {
          profile: { currentAge: 45, retirementAge: 65, retirementYears: 30 },
          options: { useDateBasedAge: false, dateOfBirth: '1980-10-01' },
          portfolio: { currentAssets: 500000, equityAllocation: 75, fixedIncomeAllocation: 25, fixedIncomeDuration: 'one_year' },
          contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
          careerPlan: {
            enabled: true,
            entries: [{
              id: 'career-1',
              label: 'Test Career',
              enabled: true,
              usePreviousCareerStartAge: false,
              useBirthdayBasedStartAge: false,
              startYearMonth: '',
              endYearMonth: '',
              startAge: 45,
              endAge: 65,              annualRaiseRate: 3.5,
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
              retirement401kManualStartBalance: 0,
              taxInfo: { untaxedBenefits: 0, leftoverIncome: 12000, taxRate: 25, lastEditedField: 'taxRate' }
            }]
          },
          futureRetirement: { useCareerEndAge: true, retirementAge: 65, retirementYears: 30 },
          withdrawal: { mode: 'specified', firstYearAmount: 40000, minimumYearlyWithdrawal: 0, maximumYearlyWithdrawal: 1000000, useRetirementAgeAsWithdrawalStartAge: true, firstYearAccountWithdrawals: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 40000 }, firstYearAccountUseFourPercent: { emergencyFund: false, hsa: false, investments: false, retirement401k: false }, sourceLines: [], inflationAdjusted: true },
          returnMode: 'manual',
          manualReturns: { inflationEnabled: true, inflationRate: 2.9, preRetirementEquityReturn: 5, postRetirementEquityReturn: 5, fixedIncomeReturn: 2.9 },
          largePurchases: [],
          longTermPurchases: [],
          loans: [{
            id: 'tooltip-loan',
            label: 'Test Loan',
            enabled: true,
            showOnGraph: true,
            startYearMonth: '2026-01',
            originalAmount: 20000,
            downPayment: 0,
            currentBalance: 20000,
            annualInterestRate: 0,
            minimumMonthlyPayment: 2000,
            extraMonthlyPayment: 0,
            paymentSourceAccount: 'income',
            paymentSource: 'income'
          }],
          cashflowItems: [],
          lifeEvents: [],
          incomeFallbackAccountId: 'emergencyFund-account-default',
          expenses: { entries: [], imports: [], categoriesByAccountId: {}, weeklyBalanceByAccountId: {}, maxBalanceByAccountId: {}, activePlanningAccountId: null, recurringEvents: [], ui: { groupingMode: 'account', zoomLevel: 1, rowHeight: 56, density: 'comfortable', snapToDay: true, scrubberDate: '2026-05-08', windowStartDate: '2026-05-08', windowEndDate: '2027-05-08', selectedAccountIds: [], selectedPoolIds: [], collapsedTrackIds: [], trackerVisibleAccountIds: [], planningWeekStartDay: 5 } },
          netWorth: { accountBalances: { emergencyFund: 50000, hsa: 0, investments: 0, retirement401k: 0 }, asOfDate: '', bankAccounts: [{ id: 'emergencyFund-account-default', label: 'Emergency Fund', poolId: 'emergencyFund', priority: 0, accountType: 'savings', balance: 50000 }] },
          savingsTracker: { annualInterestRates: { emergencyFund: 2.5, hsa: 5, investments: 6.5, retirement401k: 6 } }
        },
        ui: { activeTab: 'careers', selectedCareerId: 'career-1', careersSubTab: 'purchasesExpenses', expensesSubTab: 'planning' }
      })
    );

    render(<App />);

    const loanRow = screen.getByDisplayValue('Test Loan').closest('tr') as HTMLTableRowElement;
    await waitFor(() => {
      expect(loanRow.className).toBeTruthy();
    });

    const title = loanRow.getAttribute('title') ?? '';
    expect(title.length).toBeGreaterThan(0);
    expect(title).toContain('Using fallback');
    expect(title).toContain('Monthly income');
    expect(title).toContain('Test Loan');
  });

  it('shows an income usage warning banner when income-funded spending exceeds take-home', async () => {
    const now = new Date();
    const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    window.localStorage.setItem(
      'finance-planner-state',
      JSON.stringify({
        scenario: {
          profile: { currentAge: 45, retirementAge: 65, retirementYears: 30 },
          options: { useDateBasedAge: false, dateOfBirth: '1980-10-01' },
          portfolio: { currentAssets: 0, equityAllocation: 75, fixedIncomeAllocation: 25, fixedIncomeDuration: 'one_year' },
          contribution: { yearlyContribution: 0, yearlyIncreaseRate: 0 },
          careerPlan: {
            enabled: true,
            entries: [{
              id: 'career-1',
              label: 'Test Career',
              enabled: true,
              usePreviousCareerStartAge: false,
              useBirthdayBasedStartAge: false,
              startYearMonth: '',
              endYearMonth: '',
              startAge: 45,
              endAge: 65,
              annualRaiseRate: 0,
              savingsRate: 0,
              employerMatchRate: 0,
              bonusRate: 0,
              bonusSavingsRate: 0,
              emergencyFundContributionRate: 0,
              hsaContributionRate: 0,
              investmentsContributionRate: 0,
              retirement401kContributionRate: 0,
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
              retirement401kManualStartBalance: 0,
              sourceLines: [],
              paycheckInfo: {
                grossSalary: 12000, taxes: 0, healthBenefits: 0, otherBenefits: 0, livingExpenses: 0,
                retirement: 0, retirementMatch: 0, hsaContribution: 0, hsaEmployerMatch: 0
              },
              taxInfo: { untaxedBenefits: 0, leftoverIncome: 12000, taxRate: 25, lastEditedField: 'taxRate' }
            }]
          },
          futureRetirement: { useCareerEndAge: true, retirementAge: 65, retirementYears: 30 },
          withdrawal: { mode: 'specified', firstYearAmount: 0, minimumYearlyWithdrawal: 0, maximumYearlyWithdrawal: 1000000, useRetirementAgeAsWithdrawalStartAge: true, firstYearAccountWithdrawals: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 }, firstYearAccountUseFourPercent: { emergencyFund: false, hsa: false, investments: false, retirement401k: false }, sourceLines: [], inflationAdjusted: true },
          returnMode: 'manual',
          manualReturns: { inflationEnabled: true, inflationRate: 2.9, preRetirementEquityReturn: 5, postRetirementEquityReturn: 5, fixedIncomeReturn: 2.9 },
          largePurchases: [],
          longTermPurchases: [{
            id: 'banner-lt',
            label: 'Overspend Expense',
            enabled: true,
            showOnGraph: true,
            startYearMonth: currentYearMonth,
            endMode: 'duration',
            durationMonths: 6,
            endYearMonth: '',
            monthlyAmount: 3000,
            fundingSource: 'income'
          }],
          loans: [],
          cashflowItems: [],
          lifeEvents: [],
          incomeFallbackAccountId: null,
          expenses: { entries: [], imports: [], categoriesByAccountId: {}, weeklyBalanceByAccountId: {}, maxBalanceByAccountId: {}, activePlanningAccountId: null, recurringEvents: [], ui: { groupingMode: 'account', zoomLevel: 1, rowHeight: 56, density: 'comfortable', snapToDay: true, scrubberDate: '2026-05-08', windowStartDate: '2026-05-08', windowEndDate: '2027-05-08', selectedAccountIds: [], selectedPoolIds: [], collapsedTrackIds: [], trackerVisibleAccountIds: [], planningWeekStartDay: 5 } },
          netWorth: { accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 }, asOfDate: '', bankAccounts: [{ id: 'emergencyFund-account-default', label: 'Emergency Fund', poolId: 'emergencyFund', priority: 0, accountType: 'savings', balance: 0 }] },
          savingsTracker: { annualInterestRates: { emergencyFund: 2.5, hsa: 5, investments: 6.5, retirement401k: 6 } }
        },
        ui: { activeTab: 'careers', selectedCareerId: 'career-1', careersSubTab: 'purchasesExpenses', expensesSubTab: 'planning' }
      })
    );

    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Warnings' }));

    await waitFor(() => {
      expect(screen.getByText('Income usage warnings')).toBeInTheDocument();
    });
    expect(screen.getByText(/1 consolidated issue across 6 periods/)).toBeInTheDocument();
    expect(screen.getByText(/\(6 months\)/)).toBeInTheDocument();
    expect(screen.getByText(/Overspend Expense/)).toBeInTheDocument();
  });

  it('shows the Trajectory sub-tab, renders the overlay chart, and persists the sub-tab selection', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Trajectory' }));

    expect(screen.getByText('Trajectory Comparison')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Current Trajectory' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /trajectory comparison over time/i })).toBeInTheDocument();

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"careersSubTab":"trajectory"');

    cleanup();
    render(<App />);
    expect(screen.getByText('Trajectory Comparison')).toBeInTheDocument();
  });

  it('saves a named trajectory snapshot, compares metrics, and restores the selection', async () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Trajectory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Current Trajectory' }));

    await waitFor(() => {
      const parsed = JSON.parse(window.localStorage.getItem('finance-planner-state') ?? '{}');
      const snapshots = parsed?.scenario?.trajectorySnapshots ?? [];
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].label).toBe('Trajectory 1');
      expect(snapshots[0].years.length).toBeGreaterThan(0);
      expect(parsed?.ui?.compareTrajectoryId).toBe(snapshots[0].id);
    });

    expect(screen.getByText('Metrics vs Trajectory 1')).toBeInTheDocument();
    expect(screen.getByText('Ending balance')).toBeInTheDocument();
    expect(screen.getByText(/Account balances at age/)).toBeInTheDocument();

    cleanup();
    render(<App />);
    expect(screen.getByDisplayValue('Trajectory 1')).toBeInTheDocument();
    expect((screen.getByRole('radio', { name: 'Compare' }) as HTMLInputElement).checked).toBe(true);
  });

  it('removes a saved trajectory snapshot', async () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Finances Prediction' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Trajectory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Current Trajectory' }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('Trajectory 1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      const parsed = JSON.parse(window.localStorage.getItem('finance-planner-state') ?? '{}');
      expect(parsed?.scenario?.trajectorySnapshots ?? []).toHaveLength(0);
    });
    expect(screen.queryByDisplayValue('Trajectory 1')).not.toBeInTheDocument();
  });

  it('anchors the simulation to the last saved balance snapshot', () => {
    window.localStorage.setItem(
      'finance-planner-state',
      JSON.stringify({
        scenario: {
          netWorth: {
            accountBalances: { emergencyFund: 0, hsa: 0, investments: 0, retirement401k: 0 },
            bankAccounts: [
              { id: 'investments-account-default', label: 'Investments', poolId: 'investments', priority: 0, accountType: 'taxable', balance: 0 }
            ],
            asOfDate: '2026-01-15',
            history: [
              {
                id: 'h-1',
                date: '2026-01-15',
                accounts: [{ id: 'investments-account-default', label: 'Investments', balance: 123456 }],
                totalNetWorth: 123456
              }
            ]
          }
        },
        ui: { activeTab: 'careers', selectedCareerId: '', careersSubTab: 'careers', expensesSubTab: 'planning' }
      })
    );

    render(<App />);

    expect(screen.getByText(/Simulating from/i)).toBeInTheDocument();
    expect(screen.getByText(/January 15, 2026/i)).toBeInTheDocument();
    expect(screen.getAllByText('$123,456').length).toBeGreaterThan(0);
  });

  it('persists the current-dollars display toggle across reloads', () => {
    render(<App />);

    fireEvent.click(screen.getAllByRole('button', { name: 'Options' })[0]);
    const toggle = screen.getByRole('checkbox', { name: 'Display values in current dollars' });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    const stored = window.localStorage.getItem('finance-planner-state') ?? '';
    expect(stored).toContain('"showRealDollars":true');

    cleanup();
    render(<App />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Options' })[0]);
    expect(screen.getByRole('checkbox', { name: 'Display values in current dollars' })).toBeChecked();
  });
});

