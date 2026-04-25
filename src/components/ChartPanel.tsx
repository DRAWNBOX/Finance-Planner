import { formatCurrency } from '../engine/projection';
import type { ProjectionYear } from '../types';

interface ChartPanelProps {
  years: ProjectionYear[];
}

export const ChartPanel = ({ years }: ChartPanelProps) => {
  if (years.length === 0) {
    return null;
  }

  const width = 760;
  const height = 380;
  const padding = { top: 20, right: 24, bottom: 46, left: 80 };
  const values = years.map((year) => year.endBalance);
  const maxValue = Math.max(...values, 1);
  const minValue = 0;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const pointFor = (index: number) => {
    const year = years[index];
    const x = padding.left + (index / Math.max(years.length - 1, 1)) * plotWidth;
    const y =
      padding.top + plotHeight - ((year.endBalance - minValue) / Math.max(maxValue - minValue, 1)) * plotHeight;

    return { x, y };
  };

  const linePath = years
    .map((_, index) => {
      const point = pointFor(index);
      return `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`;
    })
    .join(' ');
  const areaPath = `${linePath} L ${pointFor(years.length - 1).x} ${height - padding.bottom} L ${pointFor(0).x} ${
    height - padding.bottom
  } Z`;
  const yTicks = Array.from({ length: 5 }, (_, index) => minValue + ((maxValue - minValue) / 4) * index).reverse();

  return (
    <div className="chart-shell">
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Portfolio value over time">
        {yTicks.map((tick) => {
          const y = padding.top + plotHeight - ((tick - minValue) / Math.max(maxValue - minValue, 1)) * plotHeight;

          return (
            <g key={tick}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="chart-grid-line" />
              <text x={padding.left - 12} y={y + 4} textAnchor="end" className="chart-axis-label">
                {formatCurrency(tick)}
              </text>
            </g>
          );
        })}

        {years.map((year, index) => {
          const point = pointFor(index);

          return (
            <g key={year.age}>
              <line x1={point.x} x2={point.x} y1={padding.top} y2={height - padding.bottom} className="chart-grid-line faint" />
              <text x={point.x} y={height - padding.bottom + 18} textAnchor="middle" className="chart-axis-label">
                {year.age}
              </text>
            </g>
          );
        })}

        <path d={areaPath} className="chart-area" />
        <path d={linePath} className="chart-line" />
        {years.map((year, index) => {
          const point = pointFor(index);

          return <circle key={`${year.age}-point`} cx={point.x} cy={point.y} r={3} className="chart-point" />;
        })}
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
          Portfolio Value ($)
        </text>
      </svg>
    </div>
  );
};
