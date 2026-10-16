import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { FundingAllocation, FundingPlan } from '../engine/contracts';
import type { ReportFallbackOccurrence, ReportOutcomeRow } from '../engine/reporting';
import type { AccountDefinition } from '../types';
import { PurchaseFundingResults } from './PurchaseFundingResults';

const accounts = [
  {
    id: 'emergency',
    label: 'Emergency Fund',
    accountType: 'savings',
    openingBalance: 0,
    annualReturnRate: 0,
    retirementAnnualReturnRate: null,
    displayOrder: 0,
    withdrawalPolicy: { allowAutomaticFallback: true, withdrawalTaxRate: 0, penaltyRate: 0 }
  }
] as AccountDefinition[];

const allocation = (overrides: Partial<FundingAllocation> = {}): FundingAllocation => ({
  accountId: 'emergency',
  grossDebitCents: 10000,
  netFundedCents: 10000,
  withheldTaxCents: 0,
  penaltyCents: 0,
  ...overrides
});

const plan = (overrides: Partial<FundingPlan> = {}): FundingPlan => ({
  stateRevision: 1,
  request: {
    id: 'req-1',
    occurrenceId: 'occ-1',
    date: '2026-07-01',
    requestedCents: 10000,
    // Configured primary is unknown/ineligible; the only eligible source is a fallback.
    primaryAccountId: 'ghost',
    fallbackAccountIds: ['emergency'],
    purpose: 'purchase'
  },
  allocations: [allocation()],
  eligibleAccountIds: ['emergency'],
  // Configured primary 'ghost' is skipped; the resolved order keeps it first,
  // so the drawn 'emergency' source is correctly treated as a fallback.
  resolvedSourceOrder: ['ghost', 'emergency'],
  skippedSources: [],
  quotaLimited: false,
  feasibleCents: 10000,
  executedCents: 10000,
  shortfallCents: 0,
  status: 'funded',
  ...overrides
});

const outcome = (overrides: Partial<ReportOutcomeRow> & { plan: FundingPlan }): ReportOutcomeRow => ({
  occurrenceId: 'occ-1',
  definitionId: 'spending:purchase:p1',
  handlerId: null,
  yearMonth: '2026-07',
  date: '2026-07-01',
  phase: 'discretionary',
  purpose: 'purchase',
  committed: true,
  requestedCents: 10000,
  executedCents: 10000,
  shortfallCents: 0,
  status: 'funded',
  quotaLimited: false,
  eligibleSources: [],
  skippedSources: [],
  row: null,
  ...overrides
});

const fallbackOccurrence = (overrides: Partial<ReportFallbackOccurrence> = {}): ReportFallbackOccurrence => ({
  occurrenceId: 'occ-1',
  definitionId: 'spending:purchase:p1',
  purpose: 'purchase',
  yearMonth: '2026-07',
  date: '2026-07-01',
  committed: true,
  primaryAccountId: 'ghost',
  fallbackAccountIds: ['emergency'],
  requestedCents: 10000,
  executedCents: 10000,
  ...overrides
});

const openSummary = (details: Element) => fireEvent.click(details.querySelector('summary')!);

afterEach(() => cleanup());

describe('PurchaseFundingResults fallback selection', () => {
  it('badges an eligible fallback used when the configured primary is skipped', () => {
    // request primary 'ghost' is skipped and eligible is only ['emergency']; the
    // report selector lists emergency as the drawn fallback. The old index/primary
    // inference derived eligible[0] ('emergency') as the "primary" and missed the badge.
    render(
      <PurchaseFundingResults
        outcomes={[outcome({ plan: plan() })]}
        accounts={accounts}
        fallbackOccurrences={[fallbackOccurrence()]}
      />
    );
    const details = screen.getByRole('region', { name: 'Observed purchase funding' }).querySelector('details')!;
    openSummary(details);
    expect(details.querySelector('.purchase-funding__fallback')).not.toBeNull();
    expect(within(details).getAllByText('Fallback used')).toHaveLength(1);
    expect(details.textContent).toContain('Emergency Fund');
  });

  it('does not badge a fallback that the report selector did not draw from', () => {
    render(
      <PurchaseFundingResults
        outcomes={[outcome({ plan: plan({ request: { id: 'req-1', occurrenceId: 'occ-1', date: '2026-07-01', requestedCents: 10000, primaryAccountId: 'emergency', fallbackAccountIds: [], purpose: 'purchase' } }) })]}
        accounts={accounts}
        fallbackOccurrences={[]}
      />
    );
    const details = screen.getByRole('region', { name: 'Observed purchase funding' }).querySelector('details')!;
    openSummary(details);
    expect(within(details).queryByText('Fallback used')).not.toBeInTheDocument();
    expect(details.querySelector('.purchase-funding__fallback')).toBeNull();
  });
});

describe('PurchaseFundingResults uncommitted quote honesty', () => {
  it('says no debit posted and never presents a positive quote as actual executed money', () => {
    render(
      <PurchaseFundingResults
        outcomes={[
          outcome({
            committed: false,
            executedCents: 10000,
            shortfallCents: 0,
            status: 'funded',
            plan: plan()
          })
        ]}
        accounts={accounts}
        fallbackOccurrences={[]}
      />
    );
    const details = screen.getByRole('region', { name: 'Observed purchase funding' }).querySelector('details')!;
    openSummary(details);
    expect(within(details).getByText(/no debit posted/)).toBeInTheDocument();
    expect(details.textContent).not.toContain('executed');
    expect(details.textContent).not.toContain('net $');
    expect(details.querySelectorAll('li')).toHaveLength(0);
    expect(details.textContent).toContain('No account debit was committed');
  });
});
