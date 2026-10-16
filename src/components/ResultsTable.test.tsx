import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ResultsTable } from './ResultsTable';
import type { ProjectionReport, ReportMonthClose, ReportYear } from '../engine/reporting';
import { displayObservedCents } from '../utils/viewAdapters';
import type { DisplayContext } from '../utils/viewAdapters';

const month = (yearMonth: string, netWorthCents: number, requested = 10000, paid = 7500): ReportMonthClose => ({
  index: 0, yearMonth: yearMonth as ReportMonthClose['yearMonth'], closingDate: `${yearMonth}-28` as ReportMonthClose['closingDate'], partial: false, monthFraction: 1,
  openingCashCents: 0, closingCashCents: 0, growthCents: 0,
  opening: { accountCents: 0, propertyValueCents: 0, heldDepositCents: 0, assetsCents: 0, liabilityCents: 0, netWorthCents: 0 },
  closing: { accountCents: 0, propertyValueCents: 0, heldDepositCents: 0, assetsCents: 5000, liabilityCents: 8000, netWorthCents },
  accounts: [{ accountId: 'cash', openingCents: 0, deltaCents: 5000, closingCents: 5000, reconciled: true }], liabilities: [], properties: [], totalsReconciled: true, reconciled: true,
  flow: { grossEarningsCents: 0, netPayCents: 20000, payrollTaxCents: 1000, otherDeductionsCents: 0, employeeRetirementCents: 0, employeeHsaCents: 0, employerRetirementCents: 0, employerHsaCents: 0, unresolvedEmployeeCents: 0, payrollAllocations: [], withdrawalTaxCents: 500, withdrawalPenaltyCents: 100, requestedSpendingCents: requested, executedSpendingCents: paid, shortfallCents: requested - paid, debtPrincipalPaidCents: 0, debtInterestPaidCents: 0, debtInterestAccruedCents: 0, debtBorrowedCents: 0, propertyAppreciationCents: 0, accountGrowthCents: 0, netWorthDeltaCents: 0, postingCount: 0 }
});
const reportFor = (months: ReportMonthClose[], years: ReportYear[] = []): ProjectionReport => ({
  metadata: { startDate: '2025-01-01' as ProjectionReport['metadata']['startDate'], endDate: '2025-12-31' as ProjectionReport['metadata']['endDate'] } as ProjectionReport['metadata'],
  opening: { snapshot: { accounts: [] } } as unknown as ProjectionReport['opening'], months, years
} as unknown as ProjectionReport);
const context = { measurement: 'assetsMinusLiabilities', startDate: '2025-01-01', endDate: '2025-12-31' } as DisplayContext;
const renderTable = (report: ProjectionReport, showMonths = true) => render(<ResultsTable report={report} displayContext={context} inflationRatePercent={0} inflationEnabled={false} showMonths={showMonths} />);
const tableCurrency = (value: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const fixedContext = { measurement: 'assetsMinusLiabilities', startDate: '2026-01-15', endDate: '2027-03-01' } as DisplayContext;
const fixedMonth = (yearMonth: string, closingDate: string, netWorthCents: number, accountCents: number, liabilityCents: number): ReportMonthClose => ({
  ...month(yearMonth, netWorthCents),
  closingDate: closingDate as ReportMonthClose['closingDate'],
  closing: { accountCents, propertyValueCents: 0, heldDepositCents: 0, assetsCents: accountCents, liabilityCents, netWorthCents },
  accounts: [{ accountId: 'cash', openingCents: 0, deltaCents: accountCents, closingCents: accountCents, reconciled: true }]
});
const fixedReportFor = (months: ReportMonthClose[]): ProjectionReport =>
  ({
    ...reportFor(months),
    metadata: { startDate: '2026-01-15', endDate: '2027-03-01' }
  } as unknown as ProjectionReport);
const fixedCells = (container: HTMLElement, rowIndex: number) =>
  container.querySelectorAll('tbody tr')[rowIndex].querySelectorAll('td');

describe('ResultsTable', () => {
  it('keeps signed equity and distinguishes debt, account assets, and actual funding', () => {
    renderTable(reportFor([month('2025-01', -3000)]));
    expect(screen.getByText('-$30.00')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Account asset: cash' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Liabilities' })).toBeTruthy();
    expect(screen.getByText('$75.00')).toBeTruthy();
  });
  it('shows an accessible empty state and transitions to populated rows', () => {
    const view = renderTable(reportFor([]));
    expect(screen.getByRole('status').textContent).toContain('No projection results');
    view.rerender(<ResultsTable report={reportFor([month('2025-01', -3000)])} displayContext={context} inflationRatePercent={0} inflationEnabled={false} showMonths />);
    expect(view.container.querySelector('tbody th')?.textContent).toBe('2025-01');
  });
  it('uses annual first/last stocks and the sum of actual partial-year monthly flows', () => {
    const jan = month('2025-01', 1000, 10000, 7000);
    const feb = month('2025-02', 9000, 20000, 15000);
    const annual = { kind: 'calendarYear', label: '2025', year: 2025, monthCount: 2, partial: true, firstYearMonth: '2025-01', lastYearMonth: '2025-02', opening: jan.opening, closing: feb.closing,
      flow: { ...jan.flow, netPayCents: jan.flow.netPayCents + feb.flow.netPayCents, requestedSpendingCents: 30000, executedSpendingCents: 22000, shortfallCents: 8000 } } as ReportYear;
    renderTable(reportFor([jan, feb], [annual]), false);
    expect(screen.getByText('$300.00')).toBeTruthy();
    expect(screen.getByText('$220.00')).toBeTruthy();
    expect(screen.getByText('$90.00')).toBeTruthy();
    expect(screen.getAllByText('$0.00').length).toBeGreaterThan(0);
  });
  it('applies the identical D18 closing-date conversion to annual/monthly cells and tooltip values', () => {
    const feb = { ...month('2025-02', -12345), closing: { ...month('2025-02', -12345).closing, assetsCents: 12345, liabilityCents: 24690 } };
    const annual = { kind: 'calendarYear', label: '2025', year: 2025, monthCount: 1, partial: true, firstYearMonth: '2025-02', lastYearMonth: '2025-02', opening: feb.opening, closing: feb.closing, flow: feb.flow } as ReportYear;
    const report = reportFor([feb], [annual]);
    const tooltip = (id: string) => id === 'closing-net-worth' ? '-$121.14' : undefined;
    const { rerender, container } = render(<ResultsTable report={report} displayContext={context} inflationRatePercent={12} inflationEnabled showMonths={false} cellTooltip={tooltip} />);
    const annualCell = container.querySelector('tbody tr td[title="-$121.14"]');
    expect(annualCell?.textContent).toBe('-$121.14');
    rerender(<ResultsTable report={report} displayContext={context} inflationRatePercent={12} inflationEnabled showMonths cellTooltip={tooltip} />);
    const monthlyCell = container.querySelector('tbody tr td[title="-$121.14"]');
    expect(monthlyCell?.textContent).toBe(annualCell?.textContent);
  });

  it('applies one date-based today’s-dollar factor per closing date and keeps nominal values unchanged (CA12/G34)', () => {
    const report = fixedReportFor([
      fixedMonth('2026-06', '2026-06-01', 115_566, 123_456, 7_890),
      fixedMonth('2027-03', '2027-03-01', -120_000, 40_000, 160_000)
    ]);
    const june = displayObservedCents({ date: '2026-06-01', cents: 115_566 }, '2026-01-15', 6);
    const march = displayObservedCents({ date: '2027-03-01', cents: -120_000 }, '2026-01-15', 6);
    expect(june.ok && march.ok).toBe(true);
    if (!june.ok || !march.ok) {
      return;
    }
    // The opening observation date is `report.metadata.startDate`, so a value at
    // the same closing date uses exactly the factor the chart/tooltip uses.
    expect(june.value.factor).not.toBe(march.value.factor);

    const deflated = render(
      <ResultsTable report={report} displayContext={fixedContext} inflationRatePercent={6} inflationEnabled showMonths />
    );
    const juneRow = fixedCells(deflated.container, 0);
    expect(juneRow[2].textContent).toBe(tableCurrency(june.value.displayDollars));
    expect(juneRow[3].textContent).toBe(tableCurrency(1234.56 / june.value.factor));
    expect(juneRow[5].textContent).toBe(tableCurrency(1234.56 / june.value.factor));
    const marchRow = fixedCells(deflated.container, 1);
    expect(marchRow[2].textContent).toBe(tableCurrency(march.value.displayDollars));
    expect(marchRow[2].textContent?.startsWith('-')).toBe(true);
    deflated.unmount();

    const nominal = render(
      <ResultsTable report={report} displayContext={fixedContext} inflationRatePercent={6} inflationEnabled={false} showMonths />
    );
    const nominalJune = fixedCells(nominal.container, 0);
    expect(nominalJune[2].textContent).toBe(tableCurrency(1155.66));
    expect(nominalJune[3].textContent).toBe(tableCurrency(1234.56));
  });

  it('exposes committed yearly flow facts as keyboard-focusable row activity in the selected display basis', () => {
    const base = fixedMonth('2026-06', '2026-06-30', 0, 500, 0);
    const flow = { ...base.flow, grossEarningsCents: 200_000, netPayCents: 170_000, payrollTaxCents: 20_000,
      employeeRetirementCents: 10_000, accountGrowthCents: 500 };
    const monthWithFlow = { ...base, flow, accounts: [{ accountId: 'cash', openingCents: 0, deltaCents: 170_500, closingCents: 170_500, reconciled: true }] };
    const annual = { kind: 'calendarYear', label: '2026', year: 2026, monthCount: 1, partial: true, firstYearMonth: '2026-06', lastYearMonth: '2026-06', opening: base.opening, closing: base.closing, flow } as ReportYear;
    const report = fixedReportFor([monthWithFlow]);
    const view = render(<ResultsTable report={{ ...report, years: [annual] }} displayContext={fixedContext} inflationRatePercent={6} inflationEnabled showMonths={false} />);
    const row = view.container.querySelector('tbody tr') as HTMLTableRowElement;
    expect(row.tabIndex).toBe(0);
    expect(row.title).toContain('Gross earnings: $');
    expect(row.title).toContain('Net pay: $');
    expect(row.title).toContain('Payroll tax: $');
    expect(row.title).toContain('Account growth: $');
    expect(row.title).not.toMatch(/401k|salary|federal/i);
    const gross = displayObservedCents({ date: '2026-06-30', cents: 200_000 }, '2026-01-15', 6, true);
    expect(gross.ok && row.title).toContain(gross.ok ? tableCurrency(gross.value.displayDollars) : '');
  });

  it('keeps a supplied row tooltip in sync with the accessible name, including an explicit opt-out', () => {
    const report = reportFor([month('2025-01', 0)]);
    const custom = render(<ResultsTable report={report} displayContext={context} inflationRatePercent={0} inflationEnabled={false} showMonths rowTooltip={() => 'Caller-provided detail'} />);
    const customRow = custom.container.querySelector('tbody tr') as HTMLTableRowElement;
    expect(customRow.title).toBe('Caller-provided detail');
    expect(customRow.getAttribute('aria-label')).toBe(customRow.title);

    custom.rerender(<ResultsTable report={report} displayContext={context} inflationRatePercent={0} inflationEnabled={false} showMonths rowTooltip={() => undefined} />);
    const optedOutRow = custom.container.querySelector('tbody tr') as HTMLTableRowElement;
    expect(optedOutRow.hasAttribute('title')).toBe(false);
    expect(optedOutRow.getAttribute('aria-label')).toBe('2025-01');
  });

  it('shows lazy per-account committed delta and separates funding gross/net/withholding from growth', () => {
    const base = fixedMonth('2026-06', '2026-06-30', 0, 0, 0);
    const audit = [
      { sequence: 1, date: '2026-06-10', yearMonth: '2026-06', purpose: 'retirement', kind: 'funding', accountChanges: [{ accountId: 'cash', deltaCents: -10_000 }], plan: { plan: { allocations: [{ accountId: 'cash', grossDebitCents: 10_000, netFundedCents: 9_600, withheldTaxCents: 300, penaltyCents: 100 }] } } },
      { sequence: 2, date: '2026-06-30', yearMonth: '2026-06', purpose: 'valuation', kind: 'direct', accountChanges: [{ accountId: 'cash', deltaCents: 500 }], plan: null }
    ];
    const report = { ...fixedReportFor([{ ...base, accounts: [{ accountId: 'cash', openingCents: 0, deltaCents: -9_500, closingCents: -9_500, reconciled: true }] }]), byAccount: () => audit } as unknown as ProjectionReport;
    const view = render(<ResultsTable report={report} displayContext={fixedContext} inflationRatePercent={0} inflationEnabled={false} showMonths />);
    const cell = view.container.querySelector('tbody tr td[tabindex="0"]') as HTMLTableCellElement;
    expect(cell.title).toBe('');
    fireEvent.focus(cell);
    expect(cell.title).toContain('Account change: -$95.00');
    expect(cell.title).toContain('retirement · funding');
    expect(cell.title).toContain('gross $100.00, net $96.00, tax $3.00, penalty $1.00');
    expect(cell.title).toContain('valuation · direct · $5.00');
    expect(cell.title).not.toContain('Payroll tax');
  });

  it('invalidates focused account detail immediately when the selected report changes', () => {
    const base = fixedMonth('2026-06', '2026-06-30', 0, 0, 0);
    const createReport = (delta: number) => ({
      ...fixedReportFor([{ ...base, accounts: [{ accountId: 'cash', openingCents: 0, deltaCents: delta, closingCents: delta, reconciled: true }] }]),
      byAccount: () => [{ sequence: 1, date: '2026-06-10', yearMonth: '2026-06', purpose: 'purchase', kind: 'direct', accountChanges: [{ accountId: 'cash', deltaCents: delta }], plan: null }]
    } as unknown as ProjectionReport);
    const originalReport = createReport(-10_000);
    const nextReport = createReport(-20_000);
    const props = { displayContext: fixedContext, inflationRatePercent: 0, inflationEnabled: false, showMonths: true };
    const view = render(<ResultsTable report={originalReport} {...props} />);
    let cell = view.container.querySelector('tbody tr td[tabindex="0"]') as HTMLTableCellElement;
    fireEvent.focus(cell);
    expect(cell.title).toContain('Account change: -$100.00');
    view.rerender(<ResultsTable report={nextReport} {...props} />);
    cell = view.container.querySelector('tbody tr td[tabindex="0"]') as HTMLTableCellElement;
    expect(cell.title).toBe('');
    expect(cell.textContent).toBe('-$200.00');
    fireEvent.focus(cell);
    expect(cell.title).toContain('Account change: -$200.00');
    expect(originalReport.byAccount('cash')[0].accountChanges[0].deltaCents).toBe(-10_000);
  });
});
