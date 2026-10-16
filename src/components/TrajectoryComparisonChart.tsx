import { memo } from 'react';
import { formatCurrency } from '../engine/projection';
import type { AnyTrajectorySnapshot, CanonicalTrajectorySnapshot, ResultContextMetadata } from '../types';
import type { ProjectionReport } from '../engine/reporting';
import { canonicalAnnualPointsFromReport } from '../trajectoryReportAdapter';
import { compareTrajectoryContexts, isCanonical } from '../trajectoryFreeze';
import { toDollars } from '../utils/viewAdapters';
import { useRenderCount } from '../utils/perfTools';

interface TrajectoryHistoryPoint { date: string; age: number; value: number }
interface TrajectoryComparisonChartProps {
  currentReport: ProjectionReport | null;
  selected: AnyTrajectorySnapshot | null;
  historyPoints: TrajectoryHistoryPoint[];
  currentContext?: ResultContextMetadata;
}
const CURRENT_COLOR = '#2b5fe2', SELECTED_COLOR = '#e67e22', HISTORY_COLOR = '#18a58b';
const formatPointValue = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);

export const TrajectoryComparisonChart = memo(({ currentReport, selected, historyPoints, currentContext }: TrajectoryComparisonChartProps) => {
  useRenderCount('TrajectoryComparisonChart');
  const compatibility = selected && isCanonical(selected) ? compareTrajectoryContexts(currentContext, selected.context) : null;
  const compatible: CanonicalTrajectorySnapshot | null = selected && isCanonical(selected) && compatibility?.comparable ? selected : null;
  const blocked = !!selected && !compatible;
  const current = currentReport ? canonicalAnnualPointsFromReport(currentReport).map(point => ({ age: point.calendarYear, value: toDollars(point.netWorthCents), date: point.closingDate })) : [];
  const saved = (compatible?.annualPoints ?? []).map(point => ({ age: point.calendarYear, value: toDollars(point.netWorthCents), date: point.closingDate }));
  const history = historyPoints.map(point => ({ age: point.age, value: point.value, date: point.date }));
  const all = [...current, ...saved, ...history];
  if (!all.length) return <div>{blocked && <p role="status" className="subtle">{selected && !isCanonical(selected) ? 'Legacy asset-only data is archived and never overlaid with signed net worth.' : `This saved trajectory cannot be compared: ${compatibility?.reasons.join(', ') ?? 'context unavailable'}.`}</p>}<p className="subtle">No projection data to compare yet. Save a trajectory to overlay it here.</p></div>;

  const width = 760, height = 380, padding = { top: 20, right: 24, bottom: 46, left: 80 };
  const plotWidth = width - padding.left - padding.right, plotHeight = height - padding.top - padding.bottom;
  const minAge = Math.min(...all.map(point => point.age)), maxAge = Math.max(...all.map(point => point.age));
  const minValue = Math.min(0, ...all.map(point => point.value)), maxValue = Math.max(0, ...all.map(point => point.value));
  const span = maxValue - minValue || 1, step = Math.pow(10, Math.floor(Math.log10(span / 4)));
  const yStep = Math.max(1, Math.ceil(span / 4 / step) * step);
  const low = Math.floor(minValue / yStep) * yStep, high = Math.ceil(maxValue / yStep) * yStep;
  const ageSpan = Math.max(maxAge - minAge, 1);
  const pointX = (age: number) => padding.left + ((age - minAge) / ageSpan) * plotWidth;
  const pointY = (value: number) => padding.top + ((high - value) / Math.max(high - low, 1)) * plotHeight;
  const pathFor = (points: Array<{age:number;value:number}>) => points.map((p,i) => `${i ? 'L' : 'M'} ${pointX(p.age)} ${pointY(p.value)}`).join(' ');
  const ticks = Array.from({length: Math.round((high-low)/yStep)+1},(_,i)=>high-i*yStep);
  const xTicks = [...new Set([minAge, ...Array.from({length:Math.min(6,Math.max(0,maxAge-minAge-1))},(_,i)=>Math.round(minAge+(i+1)*(maxAge-minAge)/7)), maxAge])];
  return <div className="chart-shell trajectory-chart-shell" style={{overflowX:'auto'}}>
    {blocked && <p className="subtle" role="status">{selected && !isCanonical(selected) ? 'Legacy asset-only data is archived and never overlaid with signed net worth.' : `This saved trajectory cannot be compared: ${compatibility?.reasons.join(', ') ?? 'context unavailable'}.`}</p>}
    <div className="trajectory-chart-legend">
      <span className="trajectory-legend-item"><span className="trajectory-legend-swatch" style={{background:CURRENT_COLOR}} />Current projection</span>
      <span className="trajectory-legend-item"><span className="trajectory-legend-swatch" style={{background:SELECTED_COLOR}} />{compatible?.label ?? (selected ? 'Saved trajectory (not shown)' : 'No trajectory selected')}</span>
      <span className="trajectory-legend-item"><span className="trajectory-legend-swatch" style={{background:HISTORY_COLOR}} />Actual history</span>
    </div>
    <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg" role="img" aria-label="Trajectory comparison over time">
      {ticks.map(t => <g key={t}><line x1={padding.left} x2={width-padding.right} y1={pointY(t)} y2={pointY(t)} className="chart-grid-line"/><text x={padding.left-12} y={pointY(t)+4} textAnchor="end" className="chart-axis-label">{formatCurrency(t)}</text></g>)}
      <line x1={padding.left} x2={width-padding.right} y1={pointY(0)} y2={pointY(0)} stroke="currentColor" strokeDasharray="4 3"/>
      {xTicks.map(a=><g key={a}><line x1={pointX(a)} x2={pointX(a)} y1={padding.top} y2={height-padding.bottom} className="chart-grid-line faint"/><text x={pointX(a)} y={height-padding.bottom+18} textAnchor="middle" className="chart-axis-label">{a}</text></g>)}
      {saved.length>0 && <path d={pathFor(saved)} className="trajectory-line-selected" stroke={SELECTED_COLOR} fill="none"/>}
      {current.length>0 && <path d={pathFor(current)} className="trajectory-line-current" stroke={CURRENT_COLOR} fill="none"/>}
      {history.length>1 && <path d={pathFor(history)} stroke={HISTORY_COLOR} fill="none" className="trajectory-line-history"/>}
      {history.map(p=><circle key={p.date} cx={pointX(p.age)} cy={pointY(p.value)} r={4} fill={HISTORY_COLOR} tabIndex={0}><title>{`${p.date}: ${formatCurrency(p.value)}`}</title></circle>)}
      {current.map(p=><circle key={p.date} cx={pointX(p.age)} cy={pointY(p.value)} r={3} fill={CURRENT_COLOR} tabIndex={0} aria-label={`${p.date}: ${formatPointValue(p.value)}`}><title>{`${p.date}: ${formatPointValue(p.value)}`}</title></circle>)}
      {saved.map(p=><circle key={p.date} cx={pointX(p.age)} cy={pointY(p.value)} r={4} fill={SELECTED_COLOR} tabIndex={0} aria-label={`${p.date}: ${formatPointValue(p.value)}`}><title>{`${p.date}: ${formatPointValue(p.value)}`}</title></circle>)}
      {current.map(p=><circle key={p.age} cx={pointX(p.age)} cy={pointY(p.value)} r={2.5} fill={CURRENT_COLOR}><title>{`Age ${p.age}: ${formatCurrency(p.value)}`}</title></circle>)}
      <text x={width/2} y={height-8} textAnchor="middle" className="chart-title">Age</text>
      <text x={18} y={height/2} textAnchor="middle" className="chart-title" transform={`rotate(-90, 18, ${height/2})`}>Value ($)</text>
    </svg>
  </div>;
});
