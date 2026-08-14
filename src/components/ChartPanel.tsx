import { memo, useMemo, useState } from 'react';
import { formatCurrency } from '../engine/projection';
import type { MonthlySnapshot, ProjectionYear, PurchaseFlag } from '../types';
import { useRenderCount } from '../utils/perfTools';
import { pickFlagColor } from '../utils/colorPalette';
import { layoutFlagCallouts } from './flagCalloutLayout';

interface ChartPanelProps {
  years: ProjectionYear[];
  flags?: PurchaseFlag[];
  monthlySnapshots?: MonthlySnapshot[];
  onFlagColorChange?: (flagId: string, color: string) => void;
}

interface HoverPoint {
  x: number;
  y: number;
  value: number;
  yearMonth: string;
  age: number;
}

export const ChartPanel = memo(({ years, flags = [], monthlySnapshots, onFlagColorChange }: ChartPanelProps) => {
  useRenderCount('ChartPanel');
  const [colorPickerFlagId, setColorPickerFlagId] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (years.length === 0) {
    return null;
  }

  const width = 760;
  const height = 380;
  const padding = { top: 20, right: 24, bottom: 46, left: 80 };
  const minValue = 0;

  const filteredMonthlySnapshots = useMemo(() => {
    if (!monthlySnapshots || monthlySnapshots.length === 0 || years.length === 0) {
      return [];
    }
    const minAge = years[0].age;
    const maxAge = years[years.length - 1].age;
    return monthlySnapshots.filter((snap) => snap.age >= minAge && snap.age <= maxAge);
  }, [monthlySnapshots, years]);

  const useMonthly = filteredMonthlySnapshots.length > 0;

  const values = useMonthly
    ? filteredMonthlySnapshots.map((snap) => snap.endBalance)
    : years.map((year) => year.endBalance);
  const maxValue = Math.max(...values, 1);
  const yStep =
    maxValue <= 1_000_000
      ? 50_000
      : maxValue <= 2_000_000
        ? 100_000
        : maxValue <= 10_000_000
          ? 500_000
          : 1_000_000;
  const roundedMaxValue = Math.max(yStep, Math.ceil(maxValue / yStep) * yStep);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const pointY = (value: number) =>
    padding.top + plotHeight - ((value - minValue) / Math.max(roundedMaxValue - minValue, 1)) * plotHeight;

  const pointFor = (index: number) => {
    const year = years[index];
    const x = padding.left + (index / Math.max(years.length - 1, 1)) * plotWidth;
    const y = pointY(year.endBalance);

    return { x, y };
  };

  const monthlyPoints = useMemo<HoverPoint[]>(() => {
    if (!useMonthly) return [];
    return filteredMonthlySnapshots.map((snap, index) => ({
      x: padding.left + (index / Math.max(filteredMonthlySnapshots.length - 1, 1)) * plotWidth,
      y: pointY(snap.endBalance),
      value: snap.endBalance,
      yearMonth: `${snap.calendarYear}-${String(snap.calendarMonth).padStart(2, '0')}`,
      age: snap.age
    }));
  }, [useMonthly, filteredMonthlySnapshots, roundedMaxValue, minValue]);

  const monthlyIndexForAge = (age: number): number => {
    let closest = -1;
    let closestDist = Infinity;
    monthlyPoints.forEach((point, index) => {
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
      const exact = monthlyPoints.findIndex((point) => point.yearMonth === flag.yearMonth);
      if (exact >= 0) return exact;
    }
    return monthlyIndexForAge(flag.age);
  };

  const handleMouseMove = (event: React.MouseEvent<SVGSVGElement>) => {
    if (monthlyPoints.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const viewX = ((event.clientX - rect.left) / rect.width) * width;
    let closest = 0;
    let closestDist = Infinity;
    monthlyPoints.forEach((point, index) => {
      const dist = Math.abs(point.x - viewX);
      if (dist < closestDist) {
        closestDist = dist;
        closest = index;
      }
    });
    setHoverIndex(closest);
  };

  const hoverPoint = hoverIndex !== null ? monthlyPoints[hoverIndex] ?? null : null;

  const hoverTooltip = (() => {
    if (!hoverPoint) return null;
    const w = 140;
    const h = 46;
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

  const linePath = useMonthly
    ? monthlyPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
    : years
        .map((_, index) => {
          const point = pointFor(index);
          return `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`;
        })
        .join(' ');
  const areaPath = useMonthly
    ? `${linePath} L ${monthlyPoints[monthlyPoints.length - 1].x} ${height - padding.bottom} L ${
        monthlyPoints[0].x
      } ${height - padding.bottom} Z`
    : `${linePath} L ${pointFor(years.length - 1).x} ${height - padding.bottom} L ${pointFor(0).x} ${
        height - padding.bottom
      } Z`;
  const yTicks = Array.from({ length: Math.floor(roundedMaxValue / yStep) + 1 }, (_, index) => index * yStep).reverse();
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
    return {
      ...flag,
      color: flag.color || pickFlagColor(existingColors)
    };
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
        return idx >= 0 ? monthlyPoints[idx].x : pointFor(ageToIndex(flag.age)).x;
      }
      return pointFor(ageToIndex(flag.age)).x;
    },
    getAnchorY: (flag) => {
      if (useMonthly) {
        const idx = monthlyIndexForFlag(flag);
        return idx >= 0 ? monthlyPoints[idx].y : pointFor(ageToIndex(flag.age)).y;
      }
      return pointFor(ageToIndex(flag.age)).y;
    }
  });

  return (
    <div className="chart-shell" style={{ position: 'relative' }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label="Portfolio value over time"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {yTicks.map((tick) => {
          const y = padding.top + plotHeight - ((tick - minValue) / Math.max(roundedMaxValue - minValue, 1)) * plotHeight;

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

        {(() => {
          const maxDebt = Math.max(...years.map((y) => y.totalCreditCardDebt ?? 0));
          if (maxDebt <= 0) return null;
          const debtPath = years
            .map((year, index) => {
              const debt = year.totalCreditCardDebt ?? 0;
              const x = padding.left + (index / Math.max(years.length - 1, 1)) * plotWidth;
              const y2 = padding.top + plotHeight - ((debt - minValue) / Math.max(roundedMaxValue - minValue, 1)) * plotHeight;
              return `${index === 0 ? 'M' : 'L'} ${x} ${y2}`;
            })
            .join(' ');
          return <path d={debtPath} className="chart-debt-line" />;
        })()}

        {years.map((year, index) => {
          if (useMonthly) {
            const idx = monthlyIndexForAge(year.age);
            if (idx < 0) return null;
            const point = monthlyPoints[idx];
            return <circle key={`${year.age}-point`} cx={point.x} cy={point.y} r={3} className="chart-point" />;
          }
          const point = pointFor(index);
          return <circle key={`${year.age}-point`} cx={point.x} cy={point.y} r={3} className="chart-point" />;
        })}

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
            <text x={hoverTooltip.tx + 8} y={hoverTooltip.ty + 17} className="chart-hover-tooltip-label">
              {hoverPoint.yearMonth}
            </text>
            <text x={hoverTooltip.tx + 8} y={hoverTooltip.ty + 34} className="chart-hover-tooltip-value">
              {formatCurrency(hoverPoint.value)}
            </text>
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
          Portfolio Value ($)
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
