import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createDefaultLoan, createDefaultScenario } from '../defaultScenario';
import { LoanResults } from './LoanResults';
import type { ProjectionReport } from '../engine/reporting';

describe('LoanResults', () => {
  it('states when there is no observed loan activity and does not invent a balance', () => {
    const scenario = createDefaultScenario(new Date('2026-06-15T12:00:00Z'));
    const loan = createDefaultLoan(45, scenario.options.dateOfBirth, new Date('2026-06-15T12:00:00Z'));
    const report = { schedules: [], outcomes: [], months: [] } as unknown as ProjectionReport;
    render(<LoanResults loan={loan} liability={null} report={report} />);
    expect(screen.getByText('No observed loan activity in this projection window.')).toBeInTheDocument();
    expect(screen.getByText('This loan has no linked debt record, so no remaining balance is reported.')).toBeInTheDocument();
  });

  it('does not present an uncommitted positive quote as paid or as a payoff', () => {
    const scenario = createDefaultScenario(new Date('2026-06-15T12:00:00Z'));
    const loan = { ...createDefaultLoan(45, scenario.options.dateOfBirth, new Date('2026-06-15T12:00:00Z')), id: 'uncommitted-loan', label: 'Uncommitted loan' };
    const outcome = {
      occurrenceId: 'loan:uncommitted-loan:installment@2026-07-01',
      definitionId: 'loan:uncommitted-loan:installment', handlerId: 'loanInstallment',
      yearMonth: '2026-07', date: '2026-07-01', phase: 'mandatory', purpose: 'loanInstallment',
      committed: false, requestedCents: 20_000, executedCents: 10_000, shortfallCents: 10_000,
      status: 'funded', quotaLimited: false, eligibleSources: [], skippedSources: [],
      plan: { allocations: [{ netFundedCents: 10_000 }] }, row: null
    };
    const schedule = {
      definitionId: outcome.definitionId, purpose: 'loanInstallment', kind: 'loan', periodKind: 'monthly',
      periodKindReliable: true, firstYearMonth: '2026-07', lastYearMonth: '2026-07', occurrenceCount: 1,
      months: ['2026-07'], requestedCents: 20_000, executedCents: 10_000, shortfallCents: 10_000,
      statuses: ['funded'], committedCount: 1, unfundedCount: 0, liabilityIds: ['liability-uncommitted'], payoffYearMonth: '2026-07'
    };
    const report = { schedules: [schedule], outcomes: [outcome], months: [] } as unknown as ProjectionReport;
    render(<LoanResults loan={loan} liability={null} report={report} />);

    expect(screen.getByText(/Requested \$200\.00 · No payment posted · quote not committed/)).toBeInTheDocument();
    expect(screen.queryByText(/paid \$100\.00|funded|payoff/i)).not.toBeInTheDocument();
  });
});
