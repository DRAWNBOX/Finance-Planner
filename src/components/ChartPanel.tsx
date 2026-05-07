import { useState } from 'react';
import { formatCurrency } from '../engine/projection';
import type { ProjectionYear, PurchaseFlag } from '../types';
import { pickFlagColor } from '../utils/colorPalette';
import { layoutFlagCallouts } from './flagCalloutLayout';

interface ChartPanelProps {
  years: ProjectionYear[];
  flags?: PurchaseFlag[];
  onFlagColorChange?: (flagId: string, color: string) => void;
}

export const ChartPanel = ({ years, flags = [], onFlagColorChange }: ChartPanelProps) => {
  const [colorPickerFlagId, setColorPickerFlagId] = useState<string | null>(null);

  if (years.length === 0) {
    return null;
  }

  const width = 760;
  const height = 380;
  const padding = { top: 20, right: 24, bottom: 46, left: 80 };
  const values = years.map((year) => year.endBalance);
  const maxValue = Math.max(...values, 1);
  const minValue = 0;
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

  const pointFor = (index: number) => {
    const year = years[index];
    const x = padding.left + (index / Math.max(years.length - 1, 1)) * plotWidth;
    const y =
      padding.top + plotHeight - ((year.endBalance - minValue) / Math.max(roundedMaxValue - minValue, 1)) * plotHeight;

    return { x, y };
  };

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

  const linePath = years
    .map((_, index) => {
      const point = pointFor(index);
      return `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`;
    })
    .join(' ');
  const areaPath = `${linePath} L ${pointFor(years.length - 1).x} ${height - padding.bottom} L ${pointFor(0).x} ${
    height - padding.bottom
  } Z`;
  const yTicks = Array.from({ length: Math.floor(roundedMaxValue / yStep) + 1 }, (_, index) => index * yStep).reverse();
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
    getAnchorX: (age) => pointFor(ageToIndex(age)).x,
    getAnchorY: (age) => pointFor(ageToIndex(age)).y
  });

  return (
    <div className="chart-shell" style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Portfolio value over time">
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
        {years.map((year, index) => {
          const point = pointFor(index);

          return <circle key={`${year.age}-point`} cx={point.x} cy={point.y} r={3} className="chart-point" />;
        })}

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
};
