import { memo } from 'react';
import { formatCurrency } from '../engine/projection';
import type { MeasurementBasis, NetWorthHistoryEntry } from '../types';
import { useRenderCount } from '../utils/perfTools';

interface NetWorthHistoryChartProps {
  entries: NetWorthHistoryEntry[];
  /** Optional selector. Legacy entries always retain their asset-only meaning. */
  measurement?: MeasurementBasis;
}

const formatShort = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const NetWorthHistoryChart = memo(({ entries, measurement }: NetWorthHistoryChartProps) => {
  useRenderCount('NetWorthHistoryChart');
  if (entries.length === 0) return <p className="subtle">No balance history yet. Update balances to start tracking.</p>;

  const series = [...new Set(entries.map((entry) => entry.measurement ?? 'assetOnly'))];
  // Never put asset-only and signed net worth on a shared scale. The parent may
  // select a basis; otherwise prefer signed net worth when it exists.
  const defaultBasis = series.includes('assetsMinusLiabilities') ? 'assetsMinusLiabilities' : series[0];
  const selected = [measurement && series.includes(measurement) ? measurement : defaultBasis];
  const titles: Record<MeasurementBasis, string> = {
    assetOnly: 'Account/assets history', assetsMinusLiabilities: 'Net worth history', accountAssets: 'Account assets history'
  };
  const width = 760, height = 320, padding = { top: 24, right: 24, bottom: 46, left: 92 };
  const plotWidth = width - padding.left - padding.right, plotHeight = height - padding.top - padding.bottom;
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const values = sorted.filter((e) => selected.includes(e.measurement ?? 'assetOnly')).map((e) => e.totalNetWorth);
  const min = Math.min(0, ...values), max = Math.max(0, ...values);
  const span = max - min || 1;
  const step = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const tickStep = Math.max(1, Math.ceil(span / 4 / step) * step);
  const low = Math.floor(min / tickStep) * tickStep, high = Math.ceil(max / tickStep) * tickStep;
  const y = (v: number) => padding.top + ((high - v) / Math.max(high - low, 1)) * plotHeight;
  const x = (i: number) => padding.left + (i / Math.max(sorted.length - 1, 1)) * plotWidth;
  const zeroY = y(0);
  return <div className="chart-shell" style={{ overflowX: 'auto' }}>
    <p className="subtle" aria-live="polite">{selected.map((s) => titles[s]).join(' · ')}</p>
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label={`${selected.map((s) => titles[s]).join(' and ')} over time`}>
      {Array.from({ length: Math.round((high - low) / tickStep) + 1 }, (_, i) => low + i * tickStep).map((tick) => <g key={tick}>
        <line x1={padding.left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} className="chart-grid-line" />
        <text x={padding.left - 10} y={y(tick) + 4} textAnchor="end" className="chart-axis-label">{formatCurrency(tick)}</text>
      </g>)}
      <line x1={padding.left} x2={width - padding.right} y1={zeroY} y2={zeroY} stroke="currentColor" strokeDasharray="4 3" />
      {selected.map((basis) => {
        const points = sorted.map((entry, i) => ({ entry, i })).filter(({ entry }) => (entry.measurement ?? 'assetOnly') === basis);
        const path = points.map(({ entry, i }, n) => `${n ? 'L' : 'M'} ${x(i)} ${y(entry.totalNetWorth)}`).join(' ');
        return <g key={basis}>
          {points.length > 1 && <path d={path} className="chart-line" />}
          {points.map(({ entry, i }) => <circle key={entry.id} cx={x(i)} cy={y(entry.totalNetWorth)} r={4} className="chart-point" tabIndex={0}>
            <title>{`${titles[basis]} — ${formatShort(entry.date)}: ${formatCurrency(entry.totalNetWorth)}`}</title>
          </circle>)}
        </g>;
      })}
      {sorted.map((entry, i) => <text key={`date-${entry.id}`} x={x(i)} y={height - padding.bottom + 18} textAnchor="middle" className="chart-axis-label">{formatShort(entry.date)}</text>)}
      <text x={width / 2} y={height - 8} textAnchor="middle" className="chart-title">Date</text>
      <text x={18} y={height / 2} textAnchor="middle" className="chart-title" transform={`rotate(-90, 18, ${height / 2})`}>Value ($)</text>
    </svg>
  </div>;
});
