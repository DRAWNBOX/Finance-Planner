import { memo, useMemo } from 'react';
import { formatCurrency } from '../engine/projection';
import type { ProjectionYear, TrajectorySnapshot } from '../types';
import { useRenderCount } from '../utils/perfTools';

interface TrajectoryHistoryPoint {
  date: string;
  age: number;
  value: number;
}

interface TrajectoryComparisonChartProps {
  currentYears: ProjectionYear[];
  selected: TrajectorySnapshot | null;
  historyPoints: TrajectoryHistoryPoint[];
}

const CURRENT_COLOR = '#2b5fe2';
const SELECTED_COLOR = '#e67e22';
const HISTORY_COLOR = '#18a58b';

export const TrajectoryComparisonChart = memo(({ currentYears, selected, historyPoints }: TrajectoryComparisonChartProps) => {
  useRenderCount('TrajectoryComparisonChart');

  const hasData = currentYears.length > 0 || (selected?.years.length ?? 0) > 0 || historyPoints.length > 0;

  const geometry = useMemo(() => {
    const width = 760;
    const height = 380;
    const padding = { top: 20, right: 24, bottom: 46, left: 80 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;

    const currentPoints = currentYears.map((year) => ({ age: year.age, value: year.endBalance }));
    const selectedPoints = (selected?.years ?? []).map((year) => ({ age: year.age, value: year.endBalance }));
    const history = historyPoints.map((point) => ({ age: point.age, value: point.value, date: point.date }));

    const ages = [
      ...currentPoints.map((point) => point.age),
      ...selectedPoints.map((point) => point.age),
      ...history.map((point) => point.age)
    ];
    if (ages.length === 0) {
      return null;
    }

    const minAge = Math.min(...ages);
    const maxAge = Math.max(...ages);
    const ageSpan = Math.max(maxAge - minAge, 1);
    const maxValue = Math.max(
      ...currentPoints.map((point) => point.value),
      ...selectedPoints.map((point) => point.value),
      ...history.map((point) => point.value),
      1
    );
    const yStep =
      maxValue <= 1_000_000
        ? 50_000
        : maxValue <= 2_000_000
          ? 100_000
          : maxValue <= 10_000_000
            ? 500_000
            : 1_000_000;
    const roundedMaxValue = Math.max(yStep, Math.ceil(maxValue / yStep) * yStep);

    const pointX = (age: number) => padding.left + ((age - minAge) / ageSpan) * plotWidth;
    const pointY = (value: number) => padding.top + plotHeight - (Math.max(0, value) / roundedMaxValue) * plotHeight;

    const pathFor = (points: Array<{ age: number; value: number }>) =>
      points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${pointX(point.age)} ${pointY(point.value)}`).join(' ');

    const yTicks = Array.from({ length: Math.floor(roundedMaxValue / yStep) + 1 }, (_, index) => index * yStep).reverse();
    const tickStep = ageSpan <= 6 ? 2 : ageSpan <= 15 ? 3 : ageSpan <= 30 ? 5 : 10;
    const xTicks: number[] = [];
    for (let age = minAge; age <= maxAge; age += tickStep) {
      xTicks.push(age);
    }
    if (xTicks[xTicks.length - 1] !== maxAge) {
      xTicks.push(maxAge);
    }

    return {
      width,
      height,
      padding,
      plotWidth,
      plotHeight,
      minAge,
      maxAge,
      roundedMaxValue,
      pointX,
      pointY,
      currentPath: pathFor(currentPoints),
      selectedPath: pathFor(selectedPoints),
      historyPath: history.length > 1 ? pathFor(history) : '',
      history,
      yTicks,
      yStep,
      xTicks
    };
  }, [currentYears, selected, historyPoints]);

  if (!hasData || !geometry) {
    return <p className="subtle">No projection data to compare yet. Save a trajectory to overlay it here.</p>;
  }

  return (
    <div className="chart-shell trajectory-chart-shell">
      <div className="trajectory-chart-legend">
        <span className="trajectory-legend-item">
          <span className="trajectory-legend-swatch" style={{ background: CURRENT_COLOR }} /> Current projection
        </span>
        <span className="trajectory-legend-item">
          <span className="trajectory-legend-swatch" style={{ background: SELECTED_COLOR }} />{' '}
          {selected ? selected.label : 'No trajectory selected'}
        </span>
        <span className="trajectory-legend-item">
          <span className="trajectory-legend-swatch" style={{ background: HISTORY_COLOR }} /> Actual history
        </span>
      </div>

      <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} className="chart-svg" role="img" aria-label="Trajectory comparison over time">
        {geometry.yTicks.map((tick) => {
          const y = geometry.pointY(tick);
          return (
            <g key={`trajectory-y-${tick}`}>
              <line x1={geometry.padding.left} x2={geometry.width - geometry.padding.right} y1={y} y2={y} className="chart-grid-line" />
              <text x={geometry.padding.left - 12} y={y + 4} textAnchor="end" className="chart-axis-label">
                {formatCurrency(tick)}
              </text>
            </g>
          );
        })}

        {geometry.xTicks.map((age) => {
          const x = geometry.pointX(age);
          return (
            <g key={`trajectory-x-${age}`}>
              <line x1={x} x2={x} y1={geometry.padding.top} y2={geometry.height - geometry.padding.bottom} className="chart-grid-line faint" />
              <text x={x} y={geometry.height - geometry.padding.bottom + 18} textAnchor="middle" className="chart-axis-label">
                {age}
              </text>
            </g>
          );
        })}

        {geometry.selectedPath && (
          <path d={geometry.selectedPath} className="trajectory-line-selected" stroke={SELECTED_COLOR} fill="none" />
        )}
        <path d={geometry.currentPath} className="trajectory-line-current" stroke={CURRENT_COLOR} fill="none" />

        {geometry.historyPath && <path d={geometry.historyPath} stroke={HISTORY_COLOR} fill="none" className="trajectory-line-history" />}
        {geometry.history.map((point) => (
          <circle
            key={`trajectory-history-${point.date}`}
            cx={geometry.pointX(point.age)}
            cy={geometry.pointY(point.value)}
            r={4}
            fill={HISTORY_COLOR}
            className="trajectory-history-point"
          >
            <title>{`${point.date}: ${formatCurrency(point.value)}`}</title>
          </circle>
        ))}

        {currentYears.map((year) => (
          <circle
            key={`trajectory-current-${year.age}`}
            cx={geometry.pointX(year.age)}
            cy={geometry.pointY(year.endBalance)}
            r={2.5}
            fill={CURRENT_COLOR}
          />
        ))}

        <text x={geometry.width / 2} y={geometry.height - 8} textAnchor="middle" className="chart-title">
          Age
        </text>
        <text
          x={18}
          y={geometry.height / 2}
          textAnchor="middle"
          className="chart-title"
          transform={`rotate(-90, 18, ${geometry.height / 2})`}
        >
          Portfolio Value ($)
        </text>
      </svg>
    </div>
  );
});
