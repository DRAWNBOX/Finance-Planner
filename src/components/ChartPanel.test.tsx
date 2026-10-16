import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { afterEach } from 'vitest';
import { ChartPanel } from './ChartPanel';
import type { ProjectionReport } from '../engine/reporting';
import { displayObservedCents } from '../utils/viewAdapters';
import type { DisplayContext } from '../utils/viewAdapters';

const context: DisplayContext = { measurement: 'assetsMinusLiabilities', startDate: '2025-01-01', endDate: '2026-03-31', engineRevision: 'test', schemaVersion: 1, contextId: 'test' };
const chartCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const report = (values: number[]): ProjectionReport => ({
  months: values.map((value, index) => ({ yearMonth: `2025-${String(index + 1).padStart(2, '0')}`, closingDate: `2025-${String(index + 1).padStart(2, '0')}-28`, closing: { netWorthCents: value, accountCents: 200000, liabilityCents: 50000 } })),
} as unknown as ProjectionReport);

afterEach(cleanup);

describe('ChartPanel', () => {
  it('survives empty, populated, and empty report transitions', () => {
    const view = render(<ChartPanel report={report([])} displayContext={context} />);
    expect(screen.getByRole('status').textContent).toMatch(/No monthly results/);
    view.rerender(<ChartPanel report={report([-100000, 300000])} displayContext={context} />);
    expect(view.container.querySelector('svg')?.getAttribute('aria-label')).toContain('total debt');
    view.rerender(<ChartPanel report={report([])} displayContext={context} />);
    expect(screen.getByRole('status').textContent).toMatch(/No monthly results/);
  });

  it('keeps signed net worth, date-aligned debt, and current-dollar tooltip values', () => {
    const view = render(<ChartPanel report={report([-100000, 300000])} displayContext={context} realDollar inflationRatePercent={12} />);
    const svg = view.container.querySelector('svg')!;
    fireEvent.keyDown(svg, { key: 'ArrowLeft' });
    expect(screen.getByText(/Net worth: -\$992/)).toBeTruthy();
    expect(screen.getByText(/Total debt: \$496/)).toBeTruthy();
    expect(view.container.querySelector('.zero-line')).toBeTruthy();
  });

  it('supports keyboard navigation and controlled event colors', () => {
    const onFlagColorChange = vi.fn();
    const view = render(<ChartPanel report={report([100000])} displayContext={context} flags={[{ id: 'career', date: '2025-01-03', label: 'Career start', color: '#cc6633' }]} onFlagColorChange={onFlagColorChange} />);
    const svg = view.container.querySelector('svg')!;
    svg.focus();
    fireEvent.keyDown(svg, { key: 'ArrowRight' });
    expect(screen.getByText('2025-01-28')).toBeTruthy();
    fireEvent.doubleClick(view.container.querySelector('.flag-label')!);
    fireEvent.change(screen.getByLabelText('Event color'), { target: { value: '#112233' } });
    expect(onFlagColorChange).toHaveBeenCalledWith('career', '#112233');
  });
});

describe('ChartPanel — fixed-date today’s-dollar factor across month/year (G34-G35)', () => {
  const fixedContext: DisplayContext = {
    measurement: 'assetsMinusLiabilities',
    startDate: '2026-01-15',
    endDate: '2027-03-01',
    engineRevision: 'test',
    schemaVersion: 1,
    contextId: 'fixed'
  };
  // closingDate === `${yearMonth}-01` so the chart's closing-date observation is
  // the same date a first-of-month series would use.
  const fixedReport = (): ProjectionReport =>
    ({
      metadata: { startDate: '2026-01-15', endDate: '2027-03-01' },
      months: [
        { yearMonth: '2026-06', closingDate: '2026-06-01', closing: { netWorthCents: 115_566, accountCents: 123_456, liabilityCents: 7_890 } },
        { yearMonth: '2027-03', closingDate: '2027-03-01', closing: { netWorthCents: -120_000, accountCents: 40_000, liabilityCents: 160_000 } }
      ]
    } as unknown as ProjectionReport);

  const tooltipText = (container: HTMLElement) => container.querySelector('.chart-tooltip')?.textContent ?? '';

  it('applies the date-based factor per closing date and leaves nominal values unchanged when off', () => {
    const june = displayObservedCents({ date: '2026-06-01', cents: 115_566 }, '2026-01-15', 6);
    const march = displayObservedCents({ date: '2027-03-01', cents: -120_000 }, '2026-01-15', 6);
    expect(june.ok && march.ok).toBe(true);
    if (!june.ok || !march.ok) {
      return;
    }

    const deflated = render(<ChartPanel report={fixedReport()} displayContext={fixedContext} realDollar inflationRatePercent={6} />);
    const svg = deflated.container.querySelector('svg')!;
    fireEvent.keyDown(svg, { key: 'ArrowLeft' }); // index 0 → 2026-06
    expect(tooltipText(deflated.container)).toContain(`Net worth: ${chartCurrency(june.value.displayDollars)}`);
    fireEvent.keyDown(svg, { key: 'ArrowRight' }); // index 1 → 2027-03, signed negative
    expect(tooltipText(deflated.container)).toContain(`Net worth: ${chartCurrency(march.value.displayDollars)}`);
    expect(march.value.displayDollars).toBeLessThan(0);

    const nominal = render(<ChartPanel report={fixedReport()} displayContext={fixedContext} inflationRatePercent={6} />);
    fireEvent.keyDown(nominal.container.querySelector('svg')!, { key: 'ArrowLeft' });
    expect(tooltipText(nominal.container)).toContain(`Net worth: ${chartCurrency(1155.66)}`);
  });

  it('uses closing account cents for the account-assets measure with the same date-based factor', () => {
    const juneAssets = displayObservedCents({ date: '2026-06-01', cents: 123_456 }, '2026-01-15', 6);
    expect(juneAssets.ok).toBe(true);
    if (!juneAssets.ok) {
      return;
    }
    const view = render(
      <ChartPanel report={fixedReport()} displayContext={fixedContext} realDollar inflationRatePercent={6} measure="accountAssets" />
    );
    fireEvent.keyDown(view.container.querySelector('svg')!, { key: 'ArrowLeft' });
    expect(tooltipText(view.container)).toContain(`Account assets: ${chartCurrency(juneAssets.value.displayDollars)}`);
  });
});
