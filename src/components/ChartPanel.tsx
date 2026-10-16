import { memo, useMemo, useState } from 'react';
import type { ProjectionReport } from '../engine/reporting';
import { displayObservedCents } from '../utils/viewAdapters';
import type { DisplayContext } from '../utils/viewAdapters';
import './ChartPanel.css';

export interface ChartEventFlag {
  readonly id: string;
  readonly date: string;
  readonly label: string;
  readonly color: string;
}

export interface ChartPanelProps {
  report: ProjectionReport;
  displayContext: DisplayContext;
  realDollar?: boolean;
  inflationRatePercent?: number;
  measure?: 'netWorth' | 'accountAssets';
  flags?: readonly ChartEventFlag[];
  onFlagColorChange?: (flagId: string, color: string) => void;
  range?: readonly [string, string];
  onRangeChange?: (range: readonly [string, string]) => void;
}

const currency = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

export const ChartPanel = memo(function ChartPanel({
  report, displayContext, realDollar = false, inflationRatePercent = 0,
  measure = 'netWorth', flags = [], onFlagColorChange, range, onRangeChange
}: ChartPanelProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [editingFlag, setEditingFlag] = useState<string | null>(null);
  const months = useMemo(() => report.months.filter((month) =>
    (!range || (month.closingDate >= range[0] && month.closingDate <= range[1]))
  ).map((month) => {
    const selected = measure === 'accountAssets' ? month.closing.accountCents : month.closing.netWorthCents;
    const display = displayObservedCents({ date: month.closingDate, cents: selected }, displayContext.startDate, inflationRatePercent, realDollar);
    const debt = displayObservedCents({ date: month.closingDate, cents: month.closing.liabilityCents }, displayContext.startDate, inflationRatePercent, realDollar);
    return { date: month.closingDate, yearMonth: month.yearMonth, value: display.ok ? display.value.displayDollars : selected / 100,
      debt: debt.ok ? debt.value.displayDollars : month.closing.liabilityCents / 100 };
  }), [report, displayContext.startDate, inflationRatePercent, realDollar, measure, range]);

  const width = 760, height = 360;
  const pad = { left: 82, right: 22, top: 24, bottom: 48 };
  const plotW = width - pad.left - pad.right, plotH = height - pad.top - pad.bottom;
  const low = Math.min(0, ...months.map((m) => m.value), ...months.map((m) => m.debt));
  const high = Math.max(0, ...months.map((m) => m.value), ...months.map((m) => m.debt));
  const span = Math.max(high - low, 1);
  const x = (i: number) => pad.left + i / Math.max(months.length - 1, 1) * plotW;
  const y = (v: number) => pad.top + (high - v) / span * plotH;
  const pathFor = (key: 'value' | 'debt') => months.map((m, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(m[key])}`).join(' ');
  const zeroY = y(0);
  const active = hoverIndex === null ? null : months[hoverIndex] ?? null;
  const activeFlag = active && flags.find((flag) => flag.date.slice(0, 7) === active.yearMonth);
  const moveTo = (event: React.MouseEvent<SVGSVGElement> | React.KeyboardEvent<SVGSVGElement>) => {
    if (!months.length) return;
    if ('clientX' in event) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width) return;
      const target = ((event.clientX - rect.left) / rect.width) * width;
      setHoverIndex(months.reduce((best, _, i) => Math.abs(x(i) - target) < Math.abs(x(best) - target) ? i : best, 0));
    } else setHoverIndex(Math.min(months.length - 1, Math.max(0, (hoverIndex ?? 0) + (event.key === 'ArrowRight' ? 1 : -1))));
  };

  if (!months.length) return <div className="chart-empty" role="status">No monthly results to display yet.</div>;

  const flagMonthIndex = (date: string) => months.findIndex((month) => month.yearMonth === date.slice(0, 7));
  return <section className="report-chart" aria-label="Projection chart">
    <div className="report-chart__key"><span className="key-net" />{measure === 'netWorth' ? 'Net worth' : 'Account assets'}<span className="key-debt" />Total debt</div>
    <div className="report-chart__canvas">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${measure === 'netWorth' ? 'Net worth' : 'Account assets'} and total debt by month`} tabIndex={0}
        onMouseMove={moveTo} onMouseLeave={() => setHoverIndex(null)} onKeyDown={(event) => { if (event.key.startsWith('Arrow')) { event.preventDefault(); moveTo(event); } }}>
        {[low, low + span / 2, high].map((tick, i) => <g key={i}><line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className={tick === 0 ? 'zero-line' : 'grid-line'} />
          <text x={pad.left - 10} y={y(tick) + 4} textAnchor="end" className="axis-label">{currency(tick)}</text></g>)}
        <path d={pathFor('value')} className="net-line" />
        <path d={pathFor('debt')} className="debt-line" />
        <line x1={pad.left} x2={width - pad.right} y1={zeroY} y2={zeroY} className="zero-line" />
        {[0, months.length - 1].filter((i, n, all) => all.indexOf(i) === n).map((i) => <text key={i} x={x(i)} y={height - 15} textAnchor={i === 0 ? 'start' : 'end'} className="axis-label">{months[i].yearMonth}</text>)}
        {flags.map((flag) => { const index = flagMonthIndex(flag.date); return index < 0 ? null : <g key={flag.id}>
          <line x1={x(index)} x2={x(index)} y1={pad.top} y2={pad.top + 18} stroke={flag.color} strokeWidth="3" />
          <text x={x(index)} y={pad.top + 32} textAnchor="middle" fill={flag.color} className="flag-label" onDoubleClick={() => setEditingFlag(flag.id)}>{flag.label}</text>
        </g>; })}
        {active && <g pointerEvents="none"><line x1={x(hoverIndex!)} x2={x(hoverIndex!)} y1={pad.top} y2={height - pad.bottom} className="hover-rule" />
          <circle cx={x(hoverIndex!)} cy={y(active.value)} r="5" className="hover-dot" /></g>}
      </svg>
      {active && <div className="chart-tooltip" role="status"><strong>{active.date}</strong><span>{measure === 'netWorth' ? 'Net worth' : 'Account assets'}: {currency(active.value)}</span><span>Total debt: {currency(active.debt)}</span>
        {activeFlag && <span className="tooltip-event">{activeFlag.label}</span>}</div>}
    </div>
    {editingFlag && onFlagColorChange && <label className="flag-color">Event color <input aria-label="Event color" type="color" value={flags.find((f) => f.id === editingFlag)?.color ?? '#c46b3c'} onChange={(e) => { onFlagColorChange(editingFlag, e.target.value); setEditingFlag(null); }} /><button type="button" onClick={() => setEditingFlag(null)}>Cancel</button></label>}
    {onRangeChange && <div className="chart-range"><label>From <input aria-label="Range start" type="month" value={range?.[0]?.slice(0, 7) ?? months[0].yearMonth} onChange={(e) => onRangeChange([`${e.target.value}-01`, range?.[1] ?? months[months.length - 1].date])} /></label>
      <label>To <input aria-label="Range end" type="month" value={range?.[1]?.slice(0, 7) ?? months[months.length - 1].yearMonth} onChange={(e) => onRangeChange([range?.[0] ?? months[0].date, `${e.target.value}-31`])} /></label></div>}
  </section>;
});
