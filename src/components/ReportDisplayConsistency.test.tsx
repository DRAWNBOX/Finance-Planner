/**
 * GUI-A08 / CA12 / G34-G35 — cross-view today's-dollar regression.
 *
 * One fixed-date `ProjectionReport` fixture (different months AND years, nonzero
 * inflation) is fed to the chart, the summary/table and the stacked account
 * series. The invariant under test is the D18 "one factor per observation date":
 * every view deflates the exact nominal cents with the same date-based factor as
 * the shared `viewAdapters` boundary, and the nominal report values are left
 * untouched when today's-dollar display is off.
 *
 * Closing observations use realistic month-end dates, distinct from the first
 * of each month, so this catches views that infer a date from `yearMonth`.
 */

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartPanel } from './ChartPanel';
import { ResultsTable } from './ResultsTable';
import { SavingsStackedChart } from './SavingsStackedChart';
import type { ProjectionReport } from '../engine/reporting';
import { deflationFactor, displayObservedCents } from '../utils/viewAdapters';
import type { DisplayContext } from '../utils/viewAdapters';

afterEach(cleanup);

const OPENING = '2026-01-15';
const END = '2027-03-01';
const RATE = 6;

const tableCurrency = (value: number) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const chartCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const stackedCurrency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

const context: DisplayContext = {
  measurement: 'assetsMinusLiabilities',
  startDate: OPENING,
  endDate: END,
  engineRevision: 'test',
  schemaVersion: 1,
  contextId: 'report-display-consistency'
};

const JUNE = { yearMonth: '2026-06', closingDate: '2026-06-30', accountCents: 123_456, liabilityCents: 7_890, netWorthCents: 115_566 };
const MARCH = { yearMonth: '2027-03', closingDate: '2027-03-31', accountCents: 40_000, liabilityCents: 160_000, netWorthCents: -120_000 };

const monthOf = (point: typeof JUNE) => ({
  index: 0,
  yearMonth: point.yearMonth,
  closingDate: point.closingDate,
  partial: false,
  monthFraction: 1,
  openingCashCents: 0,
  closingCashCents: 0,
  growthCents: 0,
  opening: { accountCents: 0, propertyValueCents: 0, heldDepositCents: 0, assetsCents: 0, liabilityCents: 0, netWorthCents: 0 },
  closing: { accountCents: point.accountCents, propertyValueCents: 0, heldDepositCents: 0, assetsCents: point.accountCents, liabilityCents: point.liabilityCents, netWorthCents: point.netWorthCents },
  accounts: [{ accountId: 'cash', openingCents: 0, deltaCents: point.accountCents, closingCents: point.accountCents, reconciled: true }],
  liabilities: [],
  properties: [],
  totalsReconciled: true,
  reconciled: true,
  flow: {
    grossEarningsCents: 0, netPayCents: 0, payrollTaxCents: 0, otherDeductionsCents: 0, employeeRetirementCents: 0,
    employeeHsaCents: 0, employerRetirementCents: 0, employerHsaCents: 0, unresolvedEmployeeCents: 0, payrollAllocations: [],
    withdrawalTaxCents: 0, withdrawalPenaltyCents: 0, requestedSpendingCents: 0, executedSpendingCents: 0, shortfallCents: 0,
    debtPrincipalPaidCents: 0, debtInterestPaidCents: 0, debtInterestAccruedCents: 0, debtBorrowedCents: 0,
    propertyAppreciationCents: 0, accountGrowthCents: 0, netWorthDeltaCents: 0, postingCount: 0
  }
});

const report: ProjectionReport = {
  metadata: { startDate: OPENING, endDate: END },
  opening: { snapshot: { accounts: [{ accountId: 'cash' }] } },
  months: [monthOf(JUNE), monthOf(MARCH)],
  years: []
} as unknown as ProjectionReport;

const factorFor = (date: string): number => {
  const result = deflationFactor(OPENING, date as `${number}-${number}-${number}`, RATE);
  if (!result.ok) {
    throw new Error(`unexpected deflation diagnostic for ${date}`);
  }
  return result.value;
};

const displayDollars = (cents: number, date: string): number => {
  const result = displayObservedCents({ date: date as `${number}-${number}-${number}`, cents }, OPENING, RATE, true);
  if (!result.ok) {
    throw new Error(`unexpected view diagnostic for ${date}`);
  }
  return result.value.displayDollars;
};

/** jsdom reports a zero-size rect; give the stacked plot a real width so hover resolves. */
const hoverStacked = (svg: Element, clientX: number) => {
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 760, height: 360, left: 0, top: 0, right: 760, bottom: 360, x: 0, y: 0, toJSON: () => ({}) })
  });
  fireEvent.mouseMove(svg, { clientX, clientY: 180 });
};

describe('ReportDisplayConsistency — one date-based factor across views (GUI-A08/CA12/G34-G35)', () => {
  it('applies the identical today’s-dollar factor to chart, table and stacked account values', () => {
    // The stack must use the report's clipped closing observation, not a
    // synthetic first-of-month date.
    expect(`${JUNE.yearMonth}-01`).not.toBe(JUNE.closingDate);
    const factor = factorFor(JUNE.closingDate);
    expect(factor).toBeGreaterThan(1);
    expect(displayDollars(JUNE.netWorthCents, JUNE.closingDate)).toBeCloseTo(1155.66 / factor, 12);
    expect(displayDollars(JUNE.accountCents, JUNE.closingDate)).toBeCloseTo(1234.56 / factor, 12);

    const table = render(<ResultsTable report={report} displayContext={context} inflationRatePercent={RATE} inflationEnabled showMonths />);
    const tableNetWorth = table.container.querySelectorAll('tbody tr')[0].querySelectorAll('td')[2];
    const tableAccount = table.container.querySelectorAll('tbody tr')[0].querySelectorAll('td')[5];
    expect(tableNetWorth.textContent).toBe(tableCurrency(JUNE.netWorthCents / 100 / factor));
    expect(tableAccount.textContent).toBe(tableCurrency(JUNE.accountCents / 100 / factor));
    cleanup();

    const chart = render(<ChartPanel report={report} displayContext={context} realDollar inflationRatePercent={RATE} />);
    fireEvent.keyDown(chart.container.querySelector('svg')!, { key: 'ArrowLeft' }); // index 0
    const chartTooltip = chart.container.querySelector('.chart-tooltip')?.textContent ?? '';
    expect(chartTooltip).toContain(`Net worth: ${chartCurrency(JUNE.netWorthCents / 100 / factor)}`);
    cleanup();

    const stacked = render(
      <SavingsStackedChart report={report} accounts={[{ id: 'cash', label: 'Cash' }]} realDollars annualInflationRatePercent={RATE} />
    );
    hoverStacked(stacked.container.querySelector('svg')!, 30); // index 0
    const stackedTooltip = stacked.container.querySelector('.savings-chart__tooltip')?.textContent ?? '';
    expect(stackedTooltip).toContain(stackedCurrency(JUNE.accountCents / 100 / factor));
  });

  it('leaves nominal report values unchanged when today’s-dollar display is off', () => {
    const table = render(
      <ResultsTable report={report} displayContext={context} inflationRatePercent={RATE} inflationEnabled={false} showMonths />
    );
    expect(table.container.querySelectorAll('tbody tr')[0].querySelectorAll('td')[2].textContent).toBe(tableCurrency(1155.66));
    cleanup();

    const chart = render(<ChartPanel report={report} displayContext={context} inflationRatePercent={RATE} />);
    fireEvent.keyDown(chart.container.querySelector('svg')!, { key: 'ArrowLeft' });
    expect(chart.container.querySelector('.chart-tooltip')?.textContent ?? '').toContain(`Net worth: ${chartCurrency(1155.66)}`);
    cleanup();

    const stacked = render(
      <SavingsStackedChart report={report} accounts={[{ id: 'cash', label: 'Cash' }]} annualInflationRatePercent={RATE} />
    );
    hoverStacked(stacked.container.querySelector('svg')!, 30);
    expect(stacked.container.querySelector('.savings-chart__tooltip')?.textContent ?? '').toContain(stackedCurrency(1234.56));
  });

  it('keeps signed negative net worth and account assets distinct under the same factor', () => {
    const factor = factorFor(MARCH.closingDate);
    expect(MARCH.netWorthCents).toBeLessThan(0);
    expect(displayDollars(MARCH.netWorthCents, MARCH.closingDate)).toBeLessThan(0);

    const table = render(<ResultsTable report={report} displayContext={context} inflationRatePercent={RATE} inflationEnabled showMonths />);
    const marchRow = table.container.querySelectorAll('tbody tr')[1].querySelectorAll('td');
    expect(marchRow[2].textContent).toBe(tableCurrency(MARCH.netWorthCents / 100 / factor));
    expect(marchRow[2].textContent?.startsWith('-')).toBe(true);
    expect(marchRow[5].textContent).toBe(tableCurrency(MARCH.accountCents / 100 / factor));
    cleanup();

    const chart = render(<ChartPanel report={report} displayContext={context} realDollar inflationRatePercent={RATE} measure="accountAssets" />);
    fireEvent.keyDown(chart.container.querySelector('svg')!, { key: 'ArrowRight' }); // index 1 → 2027-03
    const chartTooltip = chart.container.querySelector('.chart-tooltip')?.textContent ?? '';
    // account-assets measure reads `closing.accountCents` (positive) with the
    // same date-based factor as the signed net-worth value above.
    expect(chartTooltip).toContain(`Account assets: ${chartCurrency(MARCH.accountCents / 100 / factor)}`);
  });
});
