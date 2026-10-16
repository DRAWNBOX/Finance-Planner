import type { AccountDefinition } from '../types';
import type { ReportFallbackOccurrence, ReportOutcomeRow } from '../engine/reporting';
import './PurchaseFundingResults.css';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
export function PurchaseFundingResults({ outcomes, accounts, fallbackOccurrences = [] }: { outcomes: readonly ReportOutcomeRow[]; accounts: readonly AccountDefinition[]; fallbackOccurrences?: readonly ReportFallbackOccurrence[] }) {
  const labels = new Map(accounts.map(account => [account.id, account.label]));
  const fallbackAccountsByOccurrence = new Map(fallbackOccurrences.map(occurrence => [occurrence.occurrenceId, new Set(occurrence.fallbackAccountIds)]));
  return <section className="purchase-funding" aria-label="Observed purchase funding"><h3>Observed funding</h3>{!outcomes.length ? <p>No purchase funding appears in this projection window.</p> : outcomes.map(outcome => {
    const allocations = outcome.committed ? outcome.plan.allocations : [];
    const skipped = !outcome.committed || allocations.length === 0;
    const fallbackAccounts = fallbackAccountsByOccurrence.get(outcome.occurrenceId) ?? null;
    const shortfallCents = outcome.committed ? outcome.shortfallCents : outcome.requestedCents;
    return <details key={outcome.occurrenceId}><summary className={skipped || outcome.shortfallCents > 0 ? 'purchase-funding__shortfall' : ''}><span>{skipped ? 'Skipped · no funds debited' : outcome.shortfallCents ? 'Partly funded' : 'Funded'} · {outcome.yearMonth}</span><span>{outcome.committed ? `Requested ${money(outcome.requestedCents)} · executed ${money(outcome.executedCents)} · shortfall ${money(outcome.shortfallCents)}` : `Requested ${money(outcome.requestedCents)} · no debit posted · shortfall ${money(shortfallCents)}`}</span></summary><p>Eligible account order at quote: {outcome.plan.eligibleAccountIds.length ? outcome.plan.eligibleAccountIds.map(id => labels.get(id) ?? id).join(' → ') : 'No eligible accounts'}</p>{outcome.plan.skippedSources.length > 0 && <p>Unavailable sources: {outcome.plan.skippedSources.map(source => labels.get(source.accountId) ?? source.accountId).join(', ')}</p>}{allocations.length ? <><ul>{allocations.map(allocation => { const fallback = fallbackAccounts !== null && fallbackAccounts.has(allocation.accountId); return <li key={allocation.accountId} className={fallback ? 'purchase-funding__fallback' : ''}><strong>{labels.get(allocation.accountId) ?? allocation.accountId}</strong> · net {money(allocation.netFundedCents)} · gross {money(allocation.grossDebitCents)} · tax {money(allocation.withheldTaxCents)} · penalty {money(allocation.penaltyCents)}{fallback && <em>Fallback used</em>}</li>; })}</ul>{outcome.shortfallCents > 0 && <p className="purchase-funding__shortfall">Unfunded {money(outcome.shortfallCents)}; no further debit was made.</p>}</> : <p className="purchase-funding__shortfall">Skipped or unfunded ({outcome.status}). No account debit was committed.</p>}</details>;
  })}</section>;
}
