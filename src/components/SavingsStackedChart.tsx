import { memo, useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '../engine/projection';
import type { BankAccountDefinition, MonthlySnapshot, PoolDefinition, ProjectionYear, PurchaseFlag } from '../types';
import { useRenderCount } from '../utils/perfTools';
import { pickFlagColor } from '../utils/colorPalette';
import { layoutFlagCallouts } from './flagCalloutLayout';

interface SavingsStackedChartProps {
  years: ProjectionYear[];
  pools: PoolDefinition[];
  bankAccounts: BankAccountDefinition[];
  flags?: PurchaseFlag[];
  monthlySnapshots?: MonthlySnapshot[];
  onFlagColorChange?: (flagId: string, color: string) => void;
}

interface StackedHoverPoint {
  x: number;
  y: number;
  value: number;
  yearMonth: string;
  age: number;
  breakdown: Array<{ label: string; value: number }>;
}

const FALLBACK_COLORS = ['#4b87d9', '#32a884', '#f0a235', '#ca5d7b', '#7a75d8', '#3e9ab1', '#d0735a', '#6e9c4e'] as const;

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

export const SavingsStackedChart = memo(({ years, pools, bankAccounts, flags = [], monthlySnapshots, onFlagColorChange }: SavingsStackedChartProps) => {
  useRenderCount('SavingsStackedChart');
  const [colorPickerFlagId, setColorPickerFlagId] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const enabledPools = useMemo(() => pools.filter((pool) => pool.enabled), [pools]);
  const accountIdsByPoolId = useMemo(
    () =>
      new Map(
        enabledPools.map((pool) => [
          pool.id,
          bankAccounts.filter((account) => account.poolId === pool.id).map((account) => account.id)
        ])
      ),
    [bankAccounts, enabledPools]
  );
  const series = useMemo(
    () =>
      enabledPools.map((pool, index) => ({
        key: pool.id,
        label: pool.label,
        color: pool.color ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
      })),
    [enabledPools]
  );
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setVisibleKeys((current) => {
      const next: Record<string, boolean> = {};
      series.forEach((entry) => {
        next[entry.key] = current[entry.key] ?? true;
      });
      return next;
    });
  }, [series]);

  const width = 760;
  const height = 380;
  const padding = { top: 20, right: 24, bottom: 46, left: 80 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const filteredMonthlySnapshots = useMemo(() => {
    if (!monthlySnapshots || monthlySnapshots.length === 0 || years.length === 0) return [];
    const minAge = years[0].age;
    const maxAge = years[years.length - 1].age;
    return monthlySnapshots.filter((snap) => snap.age >= minAge && snap.age <= maxAge);
  }, [monthlySnapshots, years]);

  const useMonthly = filteredMonthlySnapshots.length > 0;

  const resolvePoolValue = (data: { accountBalancesById: Record<string, number> }, poolId: string) => {
    const accountIds = accountIdsByPoolId.get(poolId) ?? [];
    return accountIds.reduce((sum, accountId) => sum + Math.max(0, data.accountBalancesById[accountId] ?? 0), 0);
  };

  const stackedSeries = useMemo(() => {
    const visible = series.filter((entry) => visibleKeys[entry.key] ?? true);

    const monthlyTotals = useMonthly
      ? filteredMonthlySnapshots.map((snap) => visible.reduce((sum, entry) => sum + resolvePoolValue(snap, entry.key), 0))
      : [];
    const yearlyTotals = years.map((year) => visible.reduce((sum, entry) => sum + resolvePoolValue(year, entry.key), 0));
    const maxValue = Math.max(useMonthly ? Math.max(...monthlyTotals, 1) : Math.max(...yearlyTotals, 1), 1);
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

    let layers: Array<{ key: string; label: string; color: string; lower: number[]; top: number[] }> = [];
    if (useMonthly) {
      let running = new Array(filteredMonthlySnapshots.length).fill(0);
      layers = visible.map((entry) => {
        const lower = [...running];
        const top = running.map((value, index) => value + resolvePoolValue(filteredMonthlySnapshots[index], entry.key));
        running = top;
        return { ...entry, lower, top };
      });
    } else {
      let running = new Array(years.length).fill(0);
      layers = visible.map((entry) => {
        const lower = [...running];
        const top = running.map((value, index) => value + resolvePoolValue(years[index], entry.key));
        running = top;
        return { ...entry, lower, top };
      });
    }

    return {
      layers,
      maxValue: roundedMaxValue,
      yTicks,
      totals: useMonthly ? monthlyTotals : yearlyTotals,
      pointCount: useMonthly ? filteredMonthlySnapshots.length : years.length
    };
  }, [accountIdsByPoolId, series, visibleKeys, years, useMonthly, filteredMonthlySnapshots]);

  if (years.length === 0) {
    return null;
  }

  const pointX = (index: number) => padding.left + (index / Math.max(stackedSeries.pointCount - 1, 1)) * plotWidth;
  const yearX = (index: number) => padding.left + (index / Math.max(years.length - 1, 1)) * plotWidth;
  const pointY = (value: number) => padding.top + plotHeight - (value / Math.max(stackedSeries.maxValue, 1)) * plotHeight;

  const hoverPoints = useMemo<StackedHoverPoint[]>(() => {
    if (!useMonthly) return [];
    const visible = series.filter((entry) => visibleKeys[entry.key] ?? true);
    return filteredMonthlySnapshots.map((snap, index) => {
      const breakdown = visible.map((entry) => ({
        label: entry.label,
        value: resolvePoolValue(snap, entry.key)
      }));
      const total = breakdown.reduce((sum, entry) => sum + entry.value, 0);
      return {
        x: padding.left + (index / Math.max(filteredMonthlySnapshots.length - 1, 1)) * plotWidth,
        y: pointY(total),
        value: total,
        yearMonth: `${snap.calendarYear}-${String(snap.calendarMonth).padStart(2, '0')}`,
        age: snap.age,
        breakdown
      };
    });
  }, [useMonthly, filteredMonthlySnapshots, series, visibleKeys, accountIdsByPoolId, stackedSeries.maxValue]);

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (hoverPoints.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * width;
    let closest = 0;
    let closestDist = Infinity;
    hoverPoints.forEach((point, index) => {
      const dist = Math.abs(point.x - viewX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = index;
      }
    });
    setHoverIndex(closest);
  };

  const hoverPoint = hoverIndex !== null ? hoverPoints[hoverIndex] ?? null : null;

  const hoverTooltip = (() => {
    if (!hoverPoint) return null;
    const lineCount = 2 + hoverPoint.breakdown.length;
    const w = 160;
    const h = 16 + lineCount * 16;
    let tx = hoverPoint.x + 10;
    if (tx + w > width - padding.right) tx = hoverPoint.x - w - 10;
    if (tx < padding.left) tx = padding.left + 4;
    let ty = hoverPoint.y - h / 2;
    if (ty < padding.top) ty = padding.top + 4;
    if (ty + h > height - padding.bottom) ty = height - padding.bottom - h - 4;
    return { tx, ty, w, h };
  })();

  const ageToIndex = (age: number): number => {
    let closest = 0;
    let closestDist = Infinity;
    years.forEach((year, index) => {
      const dist = Math.abs(year.age - age);
      if (dist < closestDist) {
        closestDist = dist;
        closest = index;
      }
    });
    return closest;
  };

  const monthlyIndexForAge = (age: number): number => {
    let closest = -1;
    let closestDist = Infinity;
    hoverPoints.forEach((point, index) => {
      const dist = Math.abs(point.age - age);
      if (dist < closestDist) {
        closestDist = dist;
        closest = index;
      }
    });
    return closest;
  };

  const monthlyIndexForFlag = (flag: { age: number; yearMonth?: string }): number => {
    if (flag.yearMonth) {
      const exact = hoverPoints.findIndex((point) => point.yearMonth === flag.yearMonth);
      if (exact >= 0) return exact;
    }
    return monthlyIndexForAge(flag.age);
  };

  const yearCount = years.length;
  const tickStep = yearCount <= 5 ? 1 : yearCount <= 10 ? 2 : yearCount <= 20 ? 3 : yearCount <= 30 ? 4 : 5;
  const xTickIndexes = years
    .map((_, index) => index)
    .filter((index) => {
      const age = years[index].age;
      const isFirst = index === 0;
      const isLast = index === years.length - 1;
      const stepAge = years[0].age + Math.round((age - years[0].age) / tickStep) * tickStep;

      return isFirst || isLast || age === stepAge;
    });

  const flagsWithColor = flags.map((flag) => {
    const existingColors = flags.map((f) => f.color);
    return { ...flag, color: flag.color || pickFlagColor(existingColors) };
  });
  const flagCallouts = layoutFlagCallouts({
    flags: flagsWithColor,
    leftBound: padding.left,
    rightBound: width - padding.right,
    topY: padding.top,
    bottomBound: height - padding.bottom,
    getAnchorX: (flag) => {
      if (useMonthly) {
        const idx = monthlyIndexForFlag(flag);
        return idx >= 0 ? hoverPoints[idx].x : pointX(ageToIndex(flag.age));
      }
      return pointX(ageToIndex(flag.age));
    },
    getAnchorY: (flag) => {
      if (useMonthly) {
        const idx = monthlyIndexForFlag(flag);
        return idx >= 0 ? hoverPoints[idx].y : pointY(stackedSeries.totals[ageToIndex(flag.age)] ?? 0);
      }
      return pointY(stackedSeries.totals[ageToIndex(flag.age)] ?? 0);
    }
  });

  return (
    <div className="chart-shell" style={{ position: 'relative' }}>
      <div className="stacked-legend">
        <button
          type="button"
          className="text-button"
          onClick={() =>
            setVisibleKeys(
              Object.fromEntries(series.map((entry) => [entry.key, true]))
            )
          }
        >
          Unfilter All
        </button>
        <button
          type="button"
          className="text-button"
          onClick={() =>
            setVisibleKeys(
              Object.fromEntries(series.map((entry) => [entry.key, false]))
            )
          }
        >
          Filter All
        </button>
        {series.map((entry) => (
          <label key={entry.key} className="checkbox-row">
            <input
              type="checkbox"
              checked={visibleKeys[entry.key] ?? true}
              onChange={(event) => setVisibleKeys((current) => ({ ...current, [entry.key]: event.target.checked }))}
            />
            <span>{entry.label}</span>
          </label>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label="Stacked savings balances over time"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
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
          const x = yearX(index);

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
          <path key={layer.key} d={makeAreaPath(layer.top, layer.lower, pointX, pointY)} className="savings-area" style={{ fill: layer.color }} />
        ))}

        {hoverPoint && (
          <g className="chart-hover-group">
            <line
              x1={hoverPoint.x}
              x2={hoverPoint.x}
              y1={padding.top}
              y2={height - padding.bottom}
              className="chart-hover-line"
            />
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r={5} className="chart-hover-point" />
          </g>
        )}

        {hoverPoint && hoverTooltip && (
          <g className="chart-hover-tooltip" pointerEvents="none">
            <rect
              x={hoverTooltip.tx}
              y={hoverTooltip.ty}
              width={hoverTooltip.w}
              height={hoverTooltip.h}
              rx={5}
              ry={5}
            />
            <text x={hoverTooltip.tx + 8} y={hoverTooltip.ty + 16} className="chart-hover-tooltip-label">
              {hoverPoint.yearMonth}
            </text>
            <text x={hoverTooltip.tx + 8} y={hoverTooltip.ty + 32} className="chart-hover-tooltip-value">
              Total: {formatCurrency(hoverPoint.value)}
            </text>
            {hoverPoint.breakdown.map((entry, index) => (
              <text
                key={entry.label}
                x={hoverTooltip.tx + 8}
                y={hoverTooltip.ty + 48 + index * 16}
                className="chart-hover-tooltip-breakdown"
              >
                {entry.label}: {formatCurrency(entry.value)}
              </text>
            ))}
          </g>
        )}

        {flagCallouts.map((callout) => {
          const isOpen = colorPickerFlagId === callout.id;

          return (
            <g key={`flag-${callout.id}`}>
              <line
                x1={callout.anchorX}
                x2={callout.anchorX}
                y1={callout.stemTopY}
                y2={callout.stemBottomY}
                stroke={callout.color}
                strokeWidth={4}
                strokeLinecap="round"
                className="chart-flag-stem"
              />
              <rect
                x={callout.x}
                y={callout.y}
                width={callout.width}
                height={callout.height}
                rx={4}
                ry={4}
                fill="#ffffff"
                stroke={callout.color}
                strokeWidth={2}
                className="chart-flag-callout"
                style={{ cursor: 'pointer' }}
                onDoubleClick={() => setColorPickerFlagId(isOpen ? null : callout.id)}
              />
              <text
                x={callout.x + callout.width / 2}
                y={callout.y + callout.height / 2 + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#1f2937"
                fontSize={11}
                fontWeight={600}
                style={{ pointerEvents: 'none', userSelect: 'none' }}
              >
                {callout.label}
              </text>
            </g>
          );
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
          Savings Balance ($)
        </text>
      </svg>

      {colorPickerFlagId !== null && onFlagColorChange ? (
        <div
          style={{
            position: 'absolute',
            top: padding.top + 30,
            left: (() => {
              const callout = flagCallouts.find((item) => item.id === colorPickerFlagId);
              if (!callout) return 80;
              return Math.max(0, callout.anchorX - 50);
            })(),
            background: '#fff',
            border: '1px solid #ccc',
            borderRadius: '6px',
            padding: '6px',
            zIndex: 100,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
          }}
        >
          <input
            type="color"
            value={flagsWithColor.find((f) => f.id === colorPickerFlagId)?.color ?? '#e74c3c'}
            onChange={(e) => {
              onFlagColorChange(colorPickerFlagId, e.target.value);
              setColorPickerFlagId(null);
            }}
            style={{ width: '100px', height: '30px', border: 'none', cursor: 'pointer' }}
            autoFocus
          />
          <button
            type="button"
            className="text-button"
            onClick={() => setColorPickerFlagId(null)}
            style={{ display: 'block', marginTop: '4px', fontSize: '11px' }}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
});
