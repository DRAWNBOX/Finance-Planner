import { useState } from 'react';
import type { ReportOutcomeRow } from '../engine/reporting';
import type { RetirementWithdrawalSourceLine } from '../types';
import './RetirementWithdrawalResults.css';

interface Props {
  outcomes: readonly ReportOutcomeRow[];
  sourceLines: readonly RetirementWithdrawalSourceLine[];
}

const dollars = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(cents / 100);

export function RetirementWithdrawalResults({ outcomes, sourceLines }: Props) {
  const sources = sourceLines.filter(source => source.enabled).slice(0, 40);
  const [selectedId, setSelectedId] = useState('');
  const selected = sources.find(source => source.id === selectedId) ?? sources[0];
  const observed = selected ? outcomes
    .filter(row => row.purpose === 'retirement' && row.definitionId === `retirement:${selected.id}`)
    .sort((a, b) => a.date.localeCompare(b.date)) : [];
  const shown = observed.slice(0, 12);
  const sourceLabel = selected?.label || selected?.accountId || 'Retirement source';

  return <section className="retirement-outcomes" aria-labelledby="retirement-outcomes-title" aria-label="Retirement withdrawals">
    <header className="retirement-outcomes__heading"><div><span className="retirement-outcomes__eyebrow">OBSERVED IN THIS PROJECTION</span><h2 id="retirement-outcomes-title">Retirement withdrawals</h2></div><span className="retirement-outcomes__count">{observed.length ? `${shown.length} of ${observed.length}` : 'No activity'}</span></header>
    {sources.length > 1 && <label className="retirement-outcomes__source">Show source<select aria-label="Retirement withdrawal source" value={selected?.id ?? ''} onChange={event => setSelectedId(event.target.value)}>{sources.map(source => <option key={source.id} value={source.id}>{source.label || source.accountId} · {source.accountId}</option>)}</select></label>}
    {observed.length === 0 ? <p className="retirement-outcomes__empty">No withdrawals were observed for {sourceLabel} in this projection window. Future activity may fall outside the dates shown.</p> : <>
      <p className="retirement-outcomes__note">Actual quoted monthly activity for {sourceLabel}, not a balance-based preview. {shown.length < observed.length && 'Showing the first 12 occurrences.'}</p>
      <div className="retirement-outcomes__scroll"><table><caption className="sr-only">Observed retirement withdrawal requests and committed payments for {sourceLabel}</caption><thead><tr><th scope="col">Date</th><th scope="col">Requested</th><th scope="col">Paid</th><th scope="col">Unpaid</th><th scope="col">Status</th></tr></thead><tbody>{shown.map(row => <tr key={row.occurrenceId}><td>{row.date}</td><td>{dollars(row.requestedCents)}</td><td>{dollars(row.committed ? row.executedCents : 0)}</td><td>{dollars(row.committed ? row.shortfallCents : row.requestedCents)}</td><td>{row.committed ? (row.shortfallCents > 0 ? 'Partially paid' : 'Paid') : 'No payment posted'}</td></tr>)}</tbody></table></div>
      {shown.some(row => row.committed && row.plan.allocations.length > 0) && <details className="retirement-outcomes__allocations"><summary>Committed account details</summary>{shown.filter(row => row.committed && row.plan.allocations.length > 0).map(row => <div className="retirement-outcomes__allocation" key={row.occurrenceId}><strong>{row.date} · {sourceLabel}</strong>{row.plan.allocations.map((allocation, index) => <p key={`${row.occurrenceId}-${index}`}>{allocation.accountId}: gross {dollars(allocation.grossDebitCents)}, net {dollars(allocation.netFundedCents)}, tax {dollars(allocation.withheldTaxCents)}, penalty {dollars(allocation.penaltyCents)}</p>)}</div>)}</details>}
    </>}
    <p className="retirement-outcomes__footnote">This view reports observed withdrawals only; it does not estimate assets at retirement.</p>
  </section>;
}
