import { memo, useMemo, useState } from 'react';
import type { ProjectionReport } from '../engine/reporting';
import { displayObservedCents } from '../utils/viewAdapters';
import './SavingsStackedChart.css';

export interface SavingsAccountMetadata {
  id: string;
  label: string;
  color?: string;
}

interface SavingsStackedChartProps {
  report: ProjectionReport;
  accounts?: readonly SavingsAccountMetadata[];
  realDollars?: boolean;
  annualInflationRatePercent?: number;
}

const COLORS = ['#187b72', '#d18b36', '#5976b8', '#c15d67', '#8066a5', '#4598a0', '#9a754d', '#647a50'];
const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const stableColor = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
};
const pathFor = (upper: number[], lower: number[], x: (i: number) => number, y: (v: number) => number) => {
  if (!upper.length) return '';
  return `${upper.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' ')} ${lower.map((_, i) => {
    const idx = lower.length - i - 1;
    return `L${x(idx)},${y(lower[idx])}`;
  }).join(' ')} Z`;
};

export const SavingsStackedChart = memo(({ report, accounts = [], realDollars = false, annualInflationRatePercent = 0 }: SavingsStackedChartProps) => {
  const [muted, setMuted] = useState<Record<string, boolean>>({});
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => {
    const known = new Map(accounts.map((account) => [account.id, account]));
    const ids = new Set<string>(report.opening.snapshot.accounts.map((account) => account.accountId));
    report.months.forEach((month) => month.accounts.forEach((account) => ids.add(account.accountId)));
    return [...ids].sort().map((id) => {
      const account = known.get(id);
      return { id, label: account?.label ?? id, color: account?.color ?? stableColor(id) };
    });
  }, [accounts, report]);
  const points = useMemo(() => {
    const dated = report.months.map((month) => ({
      date: month.closingDate,
      yearMonth: month.yearMonth,
      values: new Map(month.accounts.map((a) => [a.accountId, Math.max(0, a.closingCents)]))
    }));
    return dated.map((point) => {
      const factorResult = displayObservedCents({ date: point.date, cents: 100 }, report.metadata.startDate, annualInflationRatePercent, realDollars);
      const factor = factorResult.ok ? factorResult.value.factor : 1;
      const values = new Map(series.map((account) => [account.id, (point.values.get(account.id) ?? 0) / 100 / factor]));
      return { ...point, values, total: [...values.values()].reduce((sum, amount) => sum + amount, 0) };
    });
  }, [report, series, annualInflationRatePercent, realDollars]);
  const visible = series.filter((item) => !muted[item.id]);
  const totalValues = points.map((point) => visible.reduce((sum, item) => sum + (point.values.get(item.id) ?? 0), 0));
  const max = Math.max(1, ...totalValues);
  const width = 760, height = 360, pad = { top: 20, right: 22, bottom: 42, left: 78 };
  const x = (i: number) => pad.left + i / Math.max(1, points.length - 1) * (width - pad.left - pad.right);
  const y = (v: number) => height - pad.bottom - v / max * (height - pad.top - pad.bottom);
  let running = points.map(() => 0);
  const layers = visible.map((item) => {
    const lower = [...running];
    const upper = points.map((point, i) => lower[i] + (point.values.get(item.id) ?? 0));
    running = upper;
    return { ...item, lower, upper };
  });
  const current = hover === null ? null : points[hover];

  return <section className="savings-chart" aria-label="Account assets over time">
    <header className="savings-chart__header"><div><p className="savings-chart__eyebrow">ACCOUNT ASSETS</p><h2>Where your savings live</h2></div>
      {current && <div className="savings-chart__total"><span>Total account assets</span><strong>{money(visible.reduce((sum, item) => sum + (current.values.get(item.id) ?? 0), 0))}</strong><small>{current.yearMonth}</small></div>}
    </header>
    <div className="savings-chart__legend" aria-label="Show or hide accounts">
      {series.map((item) => <label key={item.id} className={muted[item.id] ? 'is-muted' : ''}><input type="checkbox" checked={!muted[item.id]} onChange={(e) => setMuted((old) => ({ ...old, [item.id]: !e.target.checked }))}/><i style={{ background: item.color }}/>{item.label}</label>)}
    </div>
    {points.length === 0 ? <p className="savings-chart__empty">Account balances will appear here once the projection has monthly results.</p> : <div className="savings-chart__plot">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Monthly stacked account balances" onMouseMove={(event) => { const rect = event.currentTarget.getBoundingClientRect(); if (rect.width) setHover(Math.max(0, Math.min(points.length - 1, Math.round(((event.clientX - rect.left) / rect.width * width - pad.left) / (width - pad.left - pad.right) * (points.length - 1))))); }} onMouseLeave={() => setHover(null)}>
        {[0, .25, .5, .75, 1].map((fraction) => <g key={fraction}><line x1={pad.left} x2={width - pad.right} y1={y(max * fraction)} y2={y(max * fraction)} className="savings-chart__grid"/><text x={pad.left - 10} y={y(max * fraction) + 4} textAnchor="end" className="savings-chart__axis">{money(max * fraction)}</text></g>)}
        {layers.map((layer) => <path key={layer.id} d={pathFor(layer.upper, layer.lower, x, y)} fill={layer.color} fillOpacity=".82"/>)}
        {points.length > 0 && <><line x1={x(0)} x2={x(points.length - 1)} y1={height - pad.bottom} y2={height - pad.bottom} className="savings-chart__baseline"/><text x={pad.left} y={height - 12} className="savings-chart__axis">{points[0].yearMonth}</text><text x={width - pad.right} y={height - 12} textAnchor="end" className="savings-chart__axis">{points[points.length - 1].yearMonth}</text></>}
        {current && <line x1={x(hover!)} x2={x(hover!)} y1={pad.top} y2={height - pad.bottom} className="savings-chart__cursor"/>}
      </svg>
      {current && <div className="savings-chart__tooltip" role="status"><strong>{current.yearMonth} · {money(visible.reduce((sum, item) => sum + (current.values.get(item.id) ?? 0), 0))}</strong>{visible.map((item) => <div key={item.id}><i style={{ background: item.color }}/><span>{item.label}</span><b>{money(current.values.get(item.id) ?? 0)}</b></div>)}</div>}
    </div>}
    {realDollars && <p className="savings-chart__note">Values shown in today’s dollars.</p>}
  </section>;
});
