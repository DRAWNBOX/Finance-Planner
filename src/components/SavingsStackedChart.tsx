import { useEffect, useMemo, useState } from 'react';
import { formatCurrency } from '../engine/projection';
import type { BankAccountDefinition, PoolDefinition, ProjectionYear, PurchaseFlag } from '../types';
import { pickFlagColor } from '../utils/colorPalette';
import { layoutFlagCallouts } from './flagCalloutLayout';

interface SavingsStackedChartProps {
  years: ProjectionYear[];
  pools: PoolDefinition[];
  bankAccounts: BankAccountDefinition[];
  flags?: PurchaseFlag[];
  onFlagColorChange?: (flagId: string, color: string) => void;
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

export const SavingsStackedChart = ({ years, pools, bankAccounts, flags = [], onFlagColorChange }: SavingsStackedChartProps) => {
  const [colorPickerFlagId, setColorPickerFlagId] = useState<string | null>(null);
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
        legacyFallbackId: pool.legacyFallbackId,
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

  const stackedSeries = useMemo(() => {
    const visible = series.filter((entry) => visibleKeys[entry.key] ?? true);
    const resolvePoolValue = (year: ProjectionYear, poolId: string, legacyFallbackId?: PoolDefinition['legacyFallbackId']) => {
      const accountIds = accountIdsByPoolId.get(poolId) ?? [];
      if (accountIds.length > 0) {
        return accountIds.reduce((sum, accountId) => sum + Math.max(0, year.accountBalancesById[accountId] ?? 0), 0);
      }

      return legacyFallbackId ? Math.max(0, year.savingsBalances[legacyFallbackId] ?? 0) : 0;
    };
    const totals = years.map((year) =>
      visible.reduce((sum, entry) => sum + resolvePoolValue(year, entry.key, entry.legacyFallbackId), 0)
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
    const layers = visible.map((entry) => {
      const lower = [...running];
      const top = running.map((value, index) => value + resolvePoolValue(years[index], entry.key, entry.legacyFallbackId));
      running = top;

      return {
        ...entry,
        lower,
        top
      };
    });

    return { layers, maxValue: roundedMaxValue, yTicks, totals };
  }, [accountIdsByPoolId, series, visibleKeys, years]);

  if (years.length === 0) {
    return null;
  }

  const pointX = (index: number) => padding.left + (index / Math.max(years.length - 1, 1)) * plotWidth;
  const pointY = (value: number) => padding.top + plotHeight - (value / Math.max(stackedSeries.maxValue, 1)) * plotHeight;
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
  const xTickIndexes = years
    .map((_, index) => index)
    .filter((index) => {
      const age = years[index].age;
      const isFirst = index === 0;
      const isLast = index === years.length - 1;

      return isFirst || isLast || age % 5 === 0;
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
    getAnchorX: (age) => {
      const index = ageToIndex(age);
      return pointX(index);
    },
    getAnchorY: (age) => {
      const index = ageToIndex(age);
      const value = stackedSeries.totals[index] ?? 0;
      return pointY(value);
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
          <path key={layer.key} d={makeAreaPath(layer.top, layer.lower, pointX, pointY)} className="savings-area" style={{ fill: layer.color }} />
        ))}

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
};
