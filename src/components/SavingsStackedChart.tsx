import { useMemo, useState } from 'react';
import { formatCurrency } from '../engine/projection';
import type { ProjectionYear } from '../types';

interface SavingsStackedChartProps {
  years: ProjectionYear[];
}

type SavingsKey = 'emergencyFund' | 'hsa' | 'investments' | 'retirement401k';

const SERIES: Array<{ key: SavingsKey; label: string; className: string }> = [
  { key: 'emergencyFund', label: 'Emergency Fund', className: 'savings-area emergency' },
  { key: 'hsa', label: 'HSA', className: 'savings-area hsa' },
  { key: 'investments', label: 'Investments', className: 'savings-area investments' },
  { key: 'retirement401k', label: '401K', className: 'savings-area k401' }
];

const makeAreaPath = (top: number[], bottom: number[], pointX: (index: number) => number, pointY: (value: number) => number) => {
  if (top.length === 0) {
    return '';
  }

  const topPath = top.map((value, index) => `${index === 0 ? 'M' : 'L'} ${pointX(index)} ${pointY(value)}`).join(' ');
  const bottomPath = bottom
    .map((value, index) => {
      const reverseIndex = bottom.length - 1 - index;
      return `L ${pointX(reverseIndex)} ${pointY(bottom[reverseIndex])}`;
    })
    .join(' ');

  return `${topPath} ${bottomPath} Z`;
};

export const SavingsStackedChart = ({ years }: SavingsStackedChartProps) => {
  const [visibleKeys, setVisibleKeys] = useState<Record<SavingsKey, boolean>>({
    emergencyFund: true,
    hsa: true,
    investments: true,
    retirement401k: true
  });

  const width = 760;
  const height = 380;
  const padding = { top: 20, right: 24, bottom: 46, left: 80 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const stackedSeries = useMemo(() => {
    const visible = SERIES.filter((series) => visibleKeys[series.key]);
    const totals = years.map((year) =>
      visible.reduce((sum, series) => sum + year.savingsBalances[series.key], 0)
    );
    const maxValue = Math.max(...totals, 1);
    const yStep =
      maxValue <= 1_000_000
        ? 50_000
        : maxValue <= 2_000_000
          ? 100_000
          : maxValue <= 10_000_000
            ? 500_000
            : 1_000_000;
    const roundedMaxValue = Math.max(yStep, Math.ceil(maxValue / yStep) * yStep);
    const yTicks = Array.from({ length: Math.floor(roundedMaxValue / yStep) + 1 }, (_, index) => index * yStep).reverse();

    let running = new Array(years.length).fill(0);
    const layers = visible.map((series) => {
      const lower = [...running];
      const top = running.map((value, index) => value + years[index].savingsBalances[series.key]);
      running = top;

      return {
        ...series,
        lower,
        top
      };
    });

    return { layers, maxValue: roundedMaxValue, yTicks };
  }, [visibleKeys, years]);

  if (years.length === 0) {
    return null;
  }

  const pointX = (index: number) => padding.left + (index / Math.max(years.length - 1, 1)) * plotWidth;
  const pointY = (value: number) => padding.top + plotHeight - (value / Math.max(stackedSeries.maxValue, 1)) * plotHeight;
  const xTickIndexes = years
    .map((_, index) => index)
    .filter((index) => {
      const age = years[index].age;
      const isFirst = index === 0;
      const isLast = index === years.length - 1;

      return isFirst || isLast || age % 5 === 0;
    });

  return (
    <div className="chart-shell">
      <div className="stacked-legend">
        <button
          type="button"
          className="text-button"
          onClick={() => setVisibleKeys({ emergencyFund: true, hsa: true, investments: true, retirement401k: true })}
        >
          Unfilter All
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() => setVisibleKeys({ emergencyFund: false, hsa: false, investments: false, retirement401k: false })}
        >
          Filter All
        </button>
        {SERIES.map((series) => (
          <label key={series.key} className="checkbox-row">
            <input
              type="checkbox"
              checked={visibleKeys[series.key]}
              onChange={(event) => setVisibleKeys((current) => ({ ...current, [series.key]: event.target.checked }))}
            />
            <span>{series.label}</span>
          </label>
        ))}
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Stacked savings balances over time">
        {stackedSeries.yTicks.map((tick) => {
          const y = pointY(tick);

          return (
            <g key={tick}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="chart-grid-line" />
              <text x={padding.left - 12} y={y + 4} textAnchor="end" className="chart-axis-label">
                {formatCurrency(tick)}
              </text>
            </g>
          );
        })}

        {xTickIndexes.map((index) => {
          const year = years[index];
          const x = pointX(index);

          return (
            <g key={`stacked-${year.age}`}>
              <line x1={x} x2={x} y1={padding.top} y2={height - padding.bottom} className="chart-grid-line faint" />
              <text x={x} y={height - padding.bottom + 18} textAnchor="middle" className="chart-axis-label">
                {year.age}
              </text>
            </g>
          );
        })}

        {stackedSeries.layers.map((layer) => (
          <path key={layer.key} d={makeAreaPath(layer.top, layer.lower, pointX, pointY)} className={layer.className} />
        ))}

        <text x={width / 2} y={height - 8} textAnchor="middle" className="chart-title">
          Age
        </text>
        <text
          x={18}
          y={height / 2}
          textAnchor="middle"
          className="chart-title"
          transform={`rotate(-90, 18, ${height / 2})`}
        >
          Savings Balance ($)
        </text>
      </svg>
    </div>
  );
};
