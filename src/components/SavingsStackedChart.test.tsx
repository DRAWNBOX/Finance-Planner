import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SavingsStackedChart } from './SavingsStackedChart';
import type { ProjectionReport } from '../engine/reporting';
import { displayObservedCents } from '../utils/viewAdapters';

const stackedMoney = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

const report = (balances: Array<[string, number]> = []): ProjectionReport => ({
  schemaVersion: 1,
  metadata: { engineRevision: 'test', contextSchemaVersion: 1, contextId: 'x', timelineId: null, timelineLabel: 'Base', startDate: '2026-01-01', endDate: '2026-02-28', startYearMonth: '2026-01', endYearMonth: '2026-02', horizonMonths: 2 },
  opening: { date: '2026-01-01', totals: {} as never, snapshot: { accounts: balances.map(([accountId]) => ({ accountId, balanceCents: 0 })) } as never, diagnostics: [] },
  postingCount: 0, planCount: 0, outcomeCount: 0, audit: [], fundingRows: [], directRows: [], outcomes: [], years: [], totals: {} as never, diagnostics: [],
   months: balances.length ? [{ yearMonth: '2026-01', closingDate: '2026-01-31', accounts: balances.map(([accountId, closingCents]) => ({ accountId, closingCents, openingCents: 0, deltaCents: closingCents, reconciled: true })), flow: {} as never } as never] : [],
  byOccurrence: () => [], byDefinition: () => [], byPurpose: () => [], byAccount: () => [], byFundingSource: () => [], byMonth: () => [], byDateWindow: () => [], accountCloses: () => [], liabilityCloses: () => [], propertyCloses: () => [],
  unverifiable: {} as never, shortfall: {} as never, exhaustion: {} as never, fallback: {} as never, scheduled: {} as never, executed: {} as never, selectors: {} as never, byLiability: () => [], byProperty: () => [],
} as unknown as ProjectionReport);

describe('SavingsStackedChart', () => {
  it('transitions between empty and populated reports without breaking hooks', () => {
    const view = render(<SavingsStackedChart report={report()} />);
    expect(screen.getByText(/Account balances will appear/)).toBeTruthy();
    view.rerender(<SavingsStackedChart report={report([['cash', 12345]])} accounts={[{ id: 'cash', label: 'Everyday cash' }]} />);
    expect(screen.getByLabelText('Everyday cash')).toBeTruthy();
  });

  it('keeps account colors tied to ids when metadata order changes and toggles accounts', () => {
    const view = render(<SavingsStackedChart report={report([['a', 10000], ['b', 20000]])} accounts={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} />);
    const paths = () => [...view.container.querySelectorAll('svg path')].map((p) => p.getAttribute('fill'));
    const before = paths();
    view.rerender(<SavingsStackedChart report={report([['b', 20000], ['a', 10000]])} accounts={[{ id: 'b', label: 'B' }, { id: 'a', label: 'A' }]} />);
    expect(paths()).toEqual(before);
    fireEvent.click(screen.getByLabelText('A'));
    expect(paths()).toHaveLength(1);
  });

  it('shows exact account cents and deflates using the same observation date', () => {
    const view = render(<SavingsStackedChart report={report([['cash', 12345]])} accounts={[{ id: 'cash', label: 'Cash' }]} realDollars />);
    fireEvent.mouseMove(view.container.querySelector('svg')!, { clientX: 390, clientY: 150 });
    expect(screen.getByText('Cash')).toBeTruthy();
    expect(view.container.textContent).toContain('$123.45');
    expect(view.container.textContent).not.toMatch(/pool/i);
  });
});

describe('SavingsStackedChart — fixed-date today’s-dollar factor across month/year (G34-G35)', () => {
  const fixedReport = (): ProjectionReport =>
    ({
      metadata: { startDate: '2026-01-15', endDate: '2027-03-01' },
      opening: { snapshot: { accounts: [{ accountId: 'cash' }] } },
      months: [
        { yearMonth: '2026-06', closingDate: '2026-06-30', accounts: [{ accountId: 'cash', closingCents: 123_456 }] },
        { yearMonth: '2027-03', closingDate: '2027-03-31', accounts: [{ accountId: 'cash', closingCents: 40_000 }] }
      ]
    } as unknown as ProjectionReport);

  /** jsdom reports a zero-size rect; give the plot a real width so hover resolves. */
  const hover = (svg: Element, clientX: number) => {
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ width: 760, height: 360, left: 0, top: 0, right: 760, bottom: 360, x: 0, y: 0, toJSON: () => ({}) })
    });
    fireEvent.mouseMove(svg, { clientX, clientY: 180 });
  };

  it('deflates the stacked account series with the date-based factor for its observation date', () => {
    const june = displayObservedCents({ date: '2026-06-30', cents: 123_456 }, '2026-01-15', 6);
    const march = displayObservedCents({ date: '2027-03-31', cents: 40_000 }, '2026-01-15', 6);
    expect(june.ok && march.ok).toBe(true);
    if (!june.ok || !march.ok) {
      return;
    }
    const view = render(
      <SavingsStackedChart report={fixedReport()} accounts={[{ id: 'cash', label: 'Cash' }]} realDollars annualInflationRatePercent={6} />
    );
    const svg = view.container.querySelector('svg')!;
    hover(svg, 30); // index 0 → 2026-06
    const juneTooltip = view.container.querySelector('.savings-chart__tooltip')?.textContent ?? '';
    expect(juneTooltip).toContain(stackedMoney(june.value.displayDollars));
    hover(svg, 740); // index 1 → 2027-03
    const marchTooltip = view.container.querySelector('.savings-chart__tooltip')?.textContent ?? '';
    expect(marchTooltip).toContain(stackedMoney(march.value.displayDollars));
  });

  it('keeps nominal account cents when today’s dollars are off', () => {
    const view = render(
      <SavingsStackedChart report={fixedReport()} accounts={[{ id: 'cash', label: 'Cash' }]} annualInflationRatePercent={6} />
    );
    hover(view.container.querySelector('svg')!, 30);
    const tooltip = view.container.querySelector('.savings-chart__tooltip')?.textContent ?? '';
    expect(tooltip).toContain(stackedMoney(1234.56));
  });
});
