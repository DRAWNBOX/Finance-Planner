import { cleanup, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { describe, expect, it } from 'vitest';
import { TrajectoryComparisonChart } from './TrajectoryComparisonChart';
import type { CanonicalTrajectorySnapshot, TrajectorySnapshot } from '../types';
import type { ProjectionReport } from '../engine/reporting';

const context = { measurement: 'assetsMinusLiabilities' as const, startDate: '2025-01-01', endDate: '2060-12-31', schemaVersion: 1, engineRevision: 'r1' };
const canonical = (override: Partial<CanonicalTrajectorySnapshot> = {}): CanonicalTrajectorySnapshot => ({
  formatVersion: 2, id: 'saved', label: 'Saved plan', createdAt: '2025-01-01', context,
  annualPoints: [{ calendarYear: 2025, closingDate: '2025-12-31', netWorthCents: -12345, accountAssetsCents: 1000, liabilityCents: 13345 }], ...override
});
const legacy: TrajectorySnapshot = { id: 'legacy', label: 'Legacy plan', createdAt: '2025-01-01', survivesToEnd: true, depletedAge: null, endAge: 70, endingBalance: 50, summary: '', context: { ...context, measurement: 'assetOnly' }, years: [{ age: 60, calendarYear: 2025, isBaselineNow: false, startBalance: 0, endBalance: 50, salary: 0, netIncome: 0, careerContribution: 0, contribution: 0, withdrawal: 0, taxesPaid: 0, penaltiesPaid: 0, annualReturnRate: 0, inflationRate: 0, depleted: false, savingsBalances: {}, accountBalancesById: {}, creditCardBalancesById: {}, totalCreditCardDebt: 0 }] };
afterEach(cleanup);
const report = (netWorthCents = -12345, closingDate = '2025-06-30') => ({
  years: [{ year: 2025, lastYearMonth: closingDate.slice(0, 7), closing: { netWorthCents, accountCents: 200, liabilityCents: 12545 } }],
  months: [{ yearMonth: closingDate.slice(0, 7), closingDate }]
}) as unknown as ProjectionReport;

describe('TrajectoryComparisonChart', () => {
  it('plots canonical signed cents as dollars, preserving negative values and dated tooltips', () => {
    const source = canonical();
    render(<TrajectoryComparisonChart currentReport={report()} selected={source} historyPoints={[]} currentContext={context} />);
    expect(screen.getByText('Saved plan')).toBeTruthy();
    expect(document.querySelector('svg')?.textContent).toContain('-$123');
    expect(screen.getByLabelText('2025-06-30: -$123.45')).toBeTruthy();
    expect(source.annualPoints[0].netWorthCents).toBe(-12345);
  });
  it('never overlays a legacy asset-only trajectory with canonical signed net worth', () => {
    render(<TrajectoryComparisonChart currentReport={null} selected={legacy} historyPoints={[]} currentContext={context} />);
    expect(screen.getByRole('status').textContent).toMatch(/Legacy asset-only data is archived/);
    expect(document.querySelector('.trajectory-line-selected')).toBeNull();
  });
  it('blocks a canonical context mismatch and renders an empty state', () => {
    const { rerender } = render(<TrajectoryComparisonChart currentReport={report()} selected={canonical({ context: { ...context, engineRevision: 'other' } })} historyPoints={[]} currentContext={context} />);
    expect(screen.getAllByRole('status')[0].textContent).toContain('engine-revision-mismatch');
    rerender(<TrajectoryComparisonChart currentReport={null} selected={null} historyPoints={[]} />);
    expect(screen.getByText(/No projection data to compare yet/)).toBeTruthy();
  });
});
