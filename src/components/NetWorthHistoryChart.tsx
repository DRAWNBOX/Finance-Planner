import { formatCurrency } from '../engine/projection';
import type { NetWorthHistoryEntry } from '../types';

interface NetWorthHistoryChartProps {
  entries: NetWorthHistoryEntry[];
}

const formatShort = (value: string) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
};

export const NetWorthHistoryChart = ({ entries }: NetWorthHistoryChartProps) => {
  if (entries.length === 0) {
    return <p className="subtle">No net worth history yet. Update balances or apply imports to start tracking.</p>;
  }

  const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const width = 760;
  const height = 320;
  const padding = { top: 20, right: 24, bottom: 46, left: 90 };
  const values = sortedEntries.map((entry) => Math.max(0, entry.totalNetWorth));
  const maxValue = Math.max(...values, 1);
  const yStep =
    maxValue <= 100_000
      ? 10_000
      : maxValue <= 1_000_000
        ? 50_000
        : maxValue <= 2_000_000
          ? 100_000
          : maxValue <= 10_000_000
            ? 500_000
            : 1_000_000;
  const roundedMaxValue = Math.max(yStep, Math.ceil(maxValue / yStep) * yStep);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const pointFor = (index: number) => {
    const x = padding.left + (index / Math.max(sortedEntries.length - 1, 1)) * plotWidth;
    const y = padding.top + plotHeight - (Math.max(0, sortedEntries[index].totalNetWorth) / Math.max(roundedMaxValue, 1)) * plotHeight;
    return { x, y };
  };

  const linePath = sortedEntries
    .map((_, index) => {
      const point = pointFor(index);
      return `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`;
    })
    .join(' ');
  const yTicks = Array.from({ length: Math.floor(roundedMaxValue / yStep) + 1 }, (_, index) => index * yStep).reverse();
  const xTickIndexes = sortedEntries
    .map((_, index) => index)
    .filter((index) => index === 0 || index === sortedEntries.length - 1 || index % Math.max(1, Math.floor(sortedEntries.length / 6)) === 0);

  return (
    <div className="chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Net worth history over time">
        {yTicks.map((tick) => {
          const y = padding.top + plotHeight - (tick / Math.max(roundedMaxValue, 1)) * plotHeight;
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
          const point = pointFor(index);
          return (
            <g key={`history-${sortedEntries[index].id}`}>
              <line x1={point.x} x2={point.x} y1={padding.top} y2={height - padding.bottom} className="chart-grid-line faint" />
              <text x={point.x} y={height - padding.bottom + 18} textAnchor="middle" className="chart-axis-label">
                {formatShort(sortedEntries[index].date)}
              </text>
            </g>
          );
        })}

        <path d={linePath} className="chart-line" />
        {sortedEntries.map((entry, index) => {
          const point = pointFor(index);
          return <circle key={entry.id} cx={point.x} cy={point.y} r={3} className="chart-point" />;
        })}
        <text x={width / 2} y={height - 8} textAnchor="middle" className="chart-title">
          Date
        </text>
        <text x={18} y={height / 2} textAnchor="middle" className="chart-title" transform={`rotate(-90, 18, ${height / 2})`}>
          Net Worth ($)
        </text>
      </svg>
    </div>
  );
};
