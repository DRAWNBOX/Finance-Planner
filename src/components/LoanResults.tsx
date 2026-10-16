import type { Loan, LiabilityDefinition } from '../types';
import { loanDefinitionId, type LoanEventKind } from '../engine/loans';
import type { ProjectionReport } from '../engine/reporting';
import './LoanResults.css';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);

export function LoanResults({ loan, liability, report }: { loan: Loan; liability: LiabilityDefinition | null; report: ProjectionReport }) {
  const kinds: LoanEventKind[] = ['installment', 'extra', 'downPayment'];
  const ids = kinds.map(kind => loanDefinitionId(loan.id, kind));
  const schedules = report.schedules.filter(item => ids.includes(item.definitionId));
  const outcomes = report.outcomes.filter(item => ids.includes(item.definitionId));
  const lastMonth = report.months[report.months.length - 1];
  const close = liability ? lastMonth?.liabilities.find(item => item.liabilityId === liability.id) : undefined;
  const debtCents = close ? close.closingPrincipalCents + close.closingInterestCents + close.closingFeesCents : null;

  return <section className="loan-results" aria-label={`Observed results for ${loan.label}`}>
    <h3>Observed projection results</h3>
    {!schedules.length && !outcomes.length ? <p className="loan-results__empty">No observed loan activity in this projection window.</p> : <div className="loan-results__activity">
      {outcomes.map(outcome => {
        const schedule = schedules.find(item => item.definitionId === outcome.definitionId);
        const observedPayoff = outcome.committed && schedule?.payoffYearMonth === outcome.yearMonth ? schedule.payoffYearMonth : null;
        return <p key={outcome.occurrenceId}><strong>{outcome.purpose === 'loanInstallment' ? 'Installment' : outcome.purpose === 'loanExtraPayment' ? 'Extra payment' : 'Down payment'} · {outcome.yearMonth}</strong><span>{outcome.committed ? `Requested ${money(outcome.requestedCents)} · paid ${money(outcome.executedCents)} · unpaid ${money(outcome.shortfallCents)} · ${outcome.status}${observedPayoff ? ` · payoff ${observedPayoff}` : ''}` : `Requested ${money(outcome.requestedCents)} · No payment posted · quote not committed`}</span></p>;
      })}
    </div>}
    {debtCents !== null ? <p className="loan-results__balance"><span>Remaining debt at projection close</span><strong>{money(debtCents)}</strong><small>Principal {money(close!.closingPrincipalCents)} · interest {money(close!.closingInterestCents)} · fees {money(close!.closingFeesCents)}</small></p> : <p className="loan-results__note">{liability ? 'No closing debt observation is available for this liability.' : 'This loan has no linked debt record, so no remaining balance is reported.'}</p>}
  </section>;
}
