/**
 * P2.4 — focused tests for ordered partial funding and atomic commit.
 *
 * Covers CA03 (primary/fallback/dedupe/eligibility/replenishment, partial/zero/
 * invalid/stale atomic no-op), the corrected D5 partial (maximum-net feasibility,
 * not `net(balance)`), gross = net + tax + penalty, held-deposit actual amount,
 * per-source quota, retirement pinned order, and explicit unsupported-range
 * diagnostics. Quoting is pure; committing mutates only through
 * `state.commitChanges`.
 */

import { describe, expect, it } from 'vitest';

import type { AccountDefinition } from '../types';
import type { FundingRequest } from './contracts';
import type { PostingContext } from './journal';
import type { OpeningAccountState, OpeningLiabilityState, OpeningPropertyState, ResolvedOpening } from './opening';
import { buildState } from './state';
import type { StateChangeSet } from './state';
import {
  RETIREMENT_FUNDING_PURPOSE,
  commitFunding,
  quoteFunding,
  validateFundingPlan
} from './funding';

const POLICY = {
  allowAutomaticFallback: true,
  withdrawalTaxRate: 0,
  penaltyRate: 0,
  restrictionNote: ''
};

/**
 * Explicit D15 posting provenance: no production default is ever fabricated.
 * The occurrence id is normalized to the actually executed plan occurrence.
 */
const POSTING: PostingContext = {
  occurrenceId: 'occ',
  definitionId: 'def:req',
  purpose: 'purchase',
  date: '2026-01-01',
  phase: 'mandatory'
};

const config = (id: string, over: Partial<AccountDefinition> = {}): AccountDefinition => ({
  id,
  label: id,
  accountType: 'checking',
  openingBalance: 0,
  annualReturnRate: 0,
  retirementAnnualReturnRate: null,
  displayOrder: 0,
  withdrawalPolicy: { ...POLICY },
  ...over
});

const openingAccount = (accountId: string, dollars: number): OpeningAccountState => ({
  accountId,
  label: accountId,
  accountType: 'checking',
  openingBalance: dollars,
  annualReturnRate: 0,
  retirementAnnualReturnRate: null,
  withdrawalPolicy: { ...POLICY },
  displayOrder: 0,
  source: 'configured'
});

const openingLiability = (liabilityId: string, dollars: number): OpeningLiabilityState => ({
  liabilityId,
  kind: 'loan',
  openingBalance: dollars,
  source: 'configured'
});

const openingProperty = (propertyId: string, over: Partial<OpeningPropertyState> = {}): OpeningPropertyState => ({
  propertyId,
  value: 0,
  status: 'pending',
  requiredDownPayment: 0,
  source: 'configured',
  fundingEventAccountIds: [],
  ...over
});

const opening = (
  dollarsById: Record<string, number>,
  over: Partial<ResolvedOpening> = {}
): ResolvedOpening => ({
  date: '2026-01-01',
  measurement: 'assetOnly',
  hasSnapshot: false,
  sourceSnapshotId: null,
  accounts: Object.entries(dollarsById).map(([id, dollars]) => openingAccount(id, dollars)),
  liabilities: [],
  properties: [],
  history: [],
  diagnostics: [],
  ...over
});

const request = (over: Partial<FundingRequest> = {}): FundingRequest => ({
  id: 'req',
  occurrenceId: 'occ',
  date: '2026-01-01',
  requestedCents: 10000,
  primaryAccountId: null,
  fallbackAccountIds: [],
  purpose: 'purchase',
  ...over
});

/**
 * Revision-bump helper. Uses its own occurrence so a bump row never collides
 * with a request occurrence in the journal indexes.
 */
const apply = (state: ReturnType<typeof buildState>, changeSet: Omit<StateChangeSet, 'revision'>) =>
  state.commitChanges({
    posting: { ...POSTING, occurrenceId: 'occ:apply-bump' },
    ...changeSet,
    revision: state.getRevision()
  });

/** Journal rows appended by the last commit for the request occurrence. */
const journalRows = (state: ReturnType<typeof buildState>, occurrenceId: string) =>
  state.getPostingsByOccurrence(occurrenceId);

describe('quoteFunding — primary-first ordered split', () => {
  it('splits primary-first and then the ordered fallback', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 15000, primaryAccountId: 'a', fallbackAccountIds: ['b'] }),
      [config('a'), config('b')],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations.map((a) => [a.accountId, a.netFundedCents])).toEqual([
      ['a', 10000],
      ['b', 5000]
    ]);
    expect(result.plan.executedCents).toBe(15000);
    expect(result.plan.shortfallCents).toBe(0);
    expect(result.plan.status).toBe('funded');
    expect(result.plan.feasibleCents).toBe(20000);
    expect(result.diagnostics).toEqual([]);
  });

  it('deduplicates IDs preserving first position', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 15000, primaryAccountId: 'a', fallbackAccountIds: ['a', 'b', 'b', ''] }),
      [config('a'), config('b')],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations.map((a) => a.accountId)).toEqual(['a', 'b']);
  });

  it('never sweeps accounts that are not in the configured order', () => {
    const state = buildState(opening({ a: 0, c: 500 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 15000, primaryAccountId: 'a', fallbackAccountIds: [] }),
      [config('a'), config('c')],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations).toEqual([]);
    expect(result.plan.executedCents).toBe(0);
    expect(result.plan.status).toBe('unfunded');
    expect(result.plan.feasibleCents).toBe(0);
    // The unlisted rich account is untouched.
    expect(state.getAccountBalanceCents('c')).toBe(50000);
  });

  it('applies a per-obligation override over the request order', () => {
    const state = buildState(opening({ a: 50, b: 100 }));
    const result = quoteFunding(
      state,
      request({ id: 'req-1', requestedCents: 8000, primaryAccountId: 'a' }),
      [config('a'), config('b')],
      null,
      { perObligationOverride: { 'req-1': { primaryAccountId: 'b', fallbackAccountIds: [] } } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations.map((a) => [a.accountId, a.netFundedCents])).toEqual([['b', 8000]]);
  });

  it('falls back to global defaults only when the request names no source', () => {
    const state = buildState(opening({ a: 100 }));
    const withDefaults = quoteFunding(state, request({ requestedCents: 5000 }), [config('a')], null, {
      globalDefaults: { primaryAccountId: 'a', fallbackAccountIds: [] }
    });
    expect(withDefaults.ok).toBe(true);
    if (!withDefaults.ok) return;
    expect(withDefaults.plan.allocations.map((a) => a.accountId)).toEqual(['a']);

    const without = quoteFunding(state, request({ requestedCents: 5000 }), [config('a')], null);
    expect(without.ok).toBe(true);
    if (!without.ok) return;
    expect(without.plan.status).toBe('unfunded');
    expect(without.diagnostics.some((d) => d.code === 'empty-source-order')).toBe(true);
  });

  it('records the authoritative resolved source order (request, global defaults, pinned retirement)', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const fromRequest = quoteFunding(
      state,
      request({ requestedCents: 15000, primaryAccountId: 'a', fallbackAccountIds: ['a', 'b', ''] }),
      [config('a'), config('b')],
      null
    );
    expect(fromRequest.ok).toBe(true);
    if (!fromRequest.ok) return;
    // Deduplicated preserving first position, matching the applied split order.
    expect(fromRequest.plan.resolvedSourceOrder).toEqual(['a', 'b']);

    const fromDefaults = quoteFunding(state, request({ requestedCents: 5000 }), [config('a')], null, {
      globalDefaults: { primaryAccountId: 'a', fallbackAccountIds: [] }
    });
    expect(fromDefaults.ok).toBe(true);
    if (!fromDefaults.ok) return;
    // The request names no source; the global defaults are authoritative.
    expect(fromDefaults.plan.request.primaryAccountId).toBeNull();
    expect(fromDefaults.plan.resolvedSourceOrder).toEqual(['a']);

    const pinned = quoteFunding(
      state,
      request({
        purpose: RETIREMENT_FUNDING_PURPOSE,
        requestedCents: 15000,
        primaryAccountId: 'a',
        fallbackAccountIds: ['b']
      }),
      [config('a'), config('b')],
      null,
      { retirementOrderedList: ['b', 'a'] }
    );
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) return;
    expect(pinned.plan.resolvedSourceOrder).toEqual(['b', 'a']);
  });

  it('uses the fully pinned retirement ordered list', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const result = quoteFunding(
      state,
      request({
        purpose: RETIREMENT_FUNDING_PURPOSE,
        requestedCents: 15000,
        primaryAccountId: 'a',
        fallbackAccountIds: ['b']
      }),
      [config('a'), config('b')],
      null,
      { retirementOrderedList: ['b', 'a'] }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations.map((a) => [a.accountId, a.netFundedCents])).toEqual([
      ['b', 10000],
      ['a', 5000]
    ]);
  });

  it('allows an explicitly pinned retirement source even as a 2nd+ position with allowAutomaticFallback false', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const locked = config('b', { withdrawalPolicy: { ...POLICY, allowAutomaticFallback: false } });
    const result = quoteFunding(
      state,
      request({
        purpose: RETIREMENT_FUNDING_PURPOSE,
        requestedCents: 15000,
        primaryAccountId: 'a',
        fallbackAccountIds: ['b']
      }),
      [config('a'), locked],
      null,
      { retirementOrderedList: ['a', 'b'] }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations.map((a) => [a.accountId, a.netFundedCents])).toEqual([
      ['a', 10000],
      ['b', 5000]
    ]);
    expect(result.plan.executedCents).toBe(15000);
    expect(result.plan.shortfallCents).toBe(0);
    expect(result.plan.status).toBe('funded');
  });

  it('treats an explicit empty retirement list as pinned (unresolved)', () => {
    const state = buildState(opening({ a: 100 }));
    const result = quoteFunding(
      state,
      request({ purpose: RETIREMENT_FUNDING_PURPOSE, requestedCents: 5000, primaryAccountId: 'a' }),
      [config('a')],
      null,
      { retirementOrderedList: [] }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.status).toBe('unfunded');
    expect(result.diagnostics.some((d) => d.code === 'empty-source-order')).toBe(true);
  });
});

describe('quoteFunding — eligible-source metadata and quota vs exhaustion (D16)', () => {
  it('records the ordered eligible account IDs and no skips for a clean split', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 15000, primaryAccountId: 'a', fallbackAccountIds: ['b'] }),
      [config('a'), config('b')],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.eligibleAccountIds).toEqual(['a', 'b']);
    expect(result.plan.skippedSources).toEqual([]);
    expect(result.plan.quotaLimited).toBe(false);
  });

  it('records an unknown source as skipped and excludes it from eligible sources', () => {
    const state = buildState(opening({ b: 100 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 5000, primaryAccountId: 'missing', fallbackAccountIds: ['b'] }),
      [config('b')],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.eligibleAccountIds).toEqual(['b']);
    expect(result.plan.skippedSources).toEqual([
      expect.objectContaining({ accountId: 'missing', reason: 'unknown-account' })
    ]);
  });

  it('records an ineligible account type as skipped and excludes it', () => {
    const state = buildState(opening({ b: 100 }));
    const ineligible = config('bad', {
      accountType: 'crypto' as unknown as AccountDefinition['accountType']
    });
    const result = quoteFunding(
      state,
      request({ requestedCents: 5000, primaryAccountId: 'bad', fallbackAccountIds: ['b'] }),
      [ineligible, config('b')],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.eligibleAccountIds).toEqual(['b']);
    expect(result.plan.skippedSources).toEqual([
      expect.objectContaining({ accountId: 'bad', reason: 'ineligible-account' })
    ]);
    expect(result.plan.allocations.map((a) => a.accountId)).toEqual(['b']);
  });

  it('records an automatic fallback excluded by policy and excludes it from eligible sources', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const lockedFallback = config('b', { withdrawalPolicy: { ...POLICY, allowAutomaticFallback: false } });
    const result = quoteFunding(
      state,
      request({ requestedCents: 15000, primaryAccountId: 'a', fallbackAccountIds: ['b'] }),
      [config('a'), lockedFallback],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.eligibleAccountIds).toEqual(['a']);
    expect(result.plan.skippedSources).toEqual([
      expect.objectContaining({ accountId: 'b', reason: 'automatic-fallback-disabled' })
    ]);
  });

  it('keeps a pinned retirement fallback eligible even when automatic fallback is disabled', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const locked = config('b', { withdrawalPolicy: { ...POLICY, allowAutomaticFallback: false } });
    const result = quoteFunding(
      state,
      request({ purpose: RETIREMENT_FUNDING_PURPOSE, requestedCents: 15000, primaryAccountId: 'a' }),
      [config('a'), locked],
      null,
      { retirementOrderedList: ['a', 'b'] }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.eligibleAccountIds).toEqual(['a', 'b']);
    expect(result.plan.skippedSources).toEqual([]);
    expect(result.plan.allocations.map((a) => a.accountId)).toEqual(['a', 'b']);
  });

  it('records an invalid per-source quota as skipped', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 5000, primaryAccountId: 'a', fallbackAccountIds: ['b'] }),
      [config('a'), config('b')],
      null,
      { perSourceNetQuotaCents: { a: -1 } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // A quota config error makes the source unusable: skipped, not eligible.
    expect(result.plan.eligibleAccountIds).toEqual(['b']);
    expect(result.plan.skippedSources).toEqual([
      expect.objectContaining({ accountId: 'a', reason: 'invalid-quota' })
    ]);
    expect(result.plan.allocations.map((x) => x.accountId)).toEqual(['b']);
  });

  it('records an unsupported tax range with its diagnostic and excludes it', () => {
    const state = buildState(opening({ bad: 100, good: 100 }));
    const bad = config('bad', {
      accountType: 'retirement401k',
      withdrawalPolicy: { ...POLICY, withdrawalTaxRate: 99.9, penaltyRate: 0 }
    });
    const result = quoteFunding(
      state,
      request({ requestedCents: 5000, primaryAccountId: 'bad', fallbackAccountIds: ['good'] }),
      [bad, config('good')],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.eligibleAccountIds).toEqual(['good']);
    expect(result.plan.skippedSources).toEqual([
      expect.objectContaining({
        accountId: 'bad',
        reason: 'unsupported-tax-range',
        taxDiagnosticCode: 'window-too-large'
      })
    ]);
  });

  it('records a zero-balance eligible source with reason zero-balance', () => {
    const state = buildState(opening({ a: 0, b: 100 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 5000, primaryAccountId: 'a', fallbackAccountIds: ['b'] }),
      [config('a'), config('b')],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Zero balance is not ineligibility: the source is still eligible evidence.
    expect(result.plan.eligibleAccountIds).toEqual(['a', 'b']);
    expect(result.plan.skippedSources).toEqual([
      expect.objectContaining({ accountId: 'a', reason: 'zero-balance' })
    ]);
  });

  it('sets quotaLimited when a quota caps a source and drives the shortfall', () => {
    const state = buildState(opening({ a: 100 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 12000, primaryAccountId: 'a' }),
      [config('a')],
      null,
      { perSourceNetQuotaCents: { a: 4000 } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.executedCents).toBe(4000);
    expect(result.plan.shortfallCents).toBe(8000);
    expect(result.plan.quotaLimited).toBe(true);
    expect(result.plan.eligibleAccountIds).toEqual(['a']);
  });

  it('does not mark quotaLimited when the quota is not binding', () => {
    const state = buildState(opening({ a: 100 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 3000, primaryAccountId: 'a' }),
      [config('a')],
      null,
      { perSourceNetQuotaCents: { a: 4000 } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.executedCents).toBe(3000);
    expect(result.plan.status).toBe('funded');
    expect(result.plan.quotaLimited).toBe(false);
  });

  it('records a zero quota as quota-limited policy, not exhaustion', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 5000, primaryAccountId: 'a', fallbackAccountIds: ['b'] }),
      [config('a'), config('b')],
      null,
      { perSourceNetQuotaCents: { a: 0 } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.quotaLimited).toBe(true);
    expect(result.plan.eligibleAccountIds).toEqual(['a', 'b']);
    expect(result.plan.skippedSources).toEqual([
      expect.objectContaining({ accountId: 'a', reason: 'quota-limited' })
    ]);
    // The fallback still funds the request.
    expect(result.plan.allocations.map((x) => x.accountId)).toEqual(['b']);
  });

  it('distinguishes a quota-policy shortfall from eligible balance exhaustion', () => {
    const quotaState = buildState(opening({ a: 30 }));
    const quota = quoteFunding(
      quotaState,
      request({ requestedCents: 10000, primaryAccountId: 'a' }),
      [config('a')],
      null,
      { perSourceNetQuotaCents: { a: 1000 } }
    );
    expect(quota.ok).toBe(true);
    if (!quota.ok) return;
    expect(quota.plan.shortfallCents).toBe(9000);
    // Limited by policy (quota), never reported as eligible exhaustion.
    expect(quota.plan.quotaLimited).toBe(true);

    const exhaustedState = buildState(opening({ a: 30 }));
    const exhausted = quoteFunding(
      exhaustedState,
      request({ requestedCents: 10000, primaryAccountId: 'a' }),
      [config('a')],
      null
    );
    expect(exhausted.ok).toBe(true);
    if (!exhausted.ok) return;
    expect(exhausted.plan.shortfallCents).toBe(7000);
    // Balance-limited, not a quota limit.
    expect(exhausted.plan.quotaLimited).toBe(false);
  });
});

describe('quoteFunding — eligibility, quota, partial and feasibility', () => {
  it('skips an unknown source and continues with the fallback', () => {
    const state = buildState(opening({ b: 100 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 5000, primaryAccountId: 'missing', fallbackAccountIds: ['b'] }),
      [config('b')],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations.map((a) => [a.accountId, a.netFundedCents])).toEqual([['b', 5000]]);
    expect(result.diagnostics.some((d) => d.code === 'unknown-account' && d.accountId === 'missing')).toBe(true);
  });

  it('excludes a fallback whose allowAutomaticFallback is false', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const lockedFallback = config('b', { withdrawalPolicy: { ...POLICY, allowAutomaticFallback: false } });
    const result = quoteFunding(
      state,
      request({ requestedCents: 15000, primaryAccountId: 'a', fallbackAccountIds: ['b'] }),
      [config('a'), lockedFallback],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations.map((a) => [a.accountId, a.netFundedCents])).toEqual([['a', 10000]]);
    expect(result.plan.status).toBe('partial');
    expect(result.plan.shortfallCents).toBe(5000);
    expect(result.plan.feasibleCents).toBe(10000);
  });

  it('still excludes an automatic global-defaults fallback whose allowAutomaticFallback is false', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const lockedFallback = config('b', { withdrawalPolicy: { ...POLICY, allowAutomaticFallback: false } });
    const result = quoteFunding(state, request({ requestedCents: 15000 }), [config('a'), lockedFallback], null, {
      globalDefaults: { primaryAccountId: 'a', fallbackAccountIds: ['b'] }
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations.map((a) => [a.accountId, a.netFundedCents])).toEqual([['a', 10000]]);
    expect(result.plan.status).toBe('partial');
    expect(result.plan.shortfallCents).toBe(5000);
  });

  it('caps a source at its per-source net quota', () => {
    const state = buildState(opening({ a: 100, b: 100 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 12000, primaryAccountId: 'a', fallbackAccountIds: ['b'] }),
      [config('a'), config('b')],
      null,
      { perSourceNetQuotaCents: { a: 4000 } }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.allocations.map((a) => [a.accountId, a.netFundedCents])).toEqual([
      ['a', 4000],
      ['b', 8000]
    ]);
    expect(result.plan.executedCents).toBe(12000);
    expect(result.plan.status).toBe('funded');
    expect(result.plan.feasibleCents).toBe(14000);
  });

  it('reports actual partial funding and unpaid shortfall', () => {
    const state = buildState(opening({ a: 30, b: 40 }));
    const result = quoteFunding(
      state,
      request({ requestedCents: 10000, primaryAccountId: 'a', fallbackAccountIds: ['b'] }),
      [config('a'), config('b')],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.executedCents).toBe(7000);
    expect(result.plan.shortfallCents).toBe(3000);
    expect(result.plan.status).toBe('partial');
    expect(result.plan.allocations.map((a) => [a.accountId, a.netFundedCents])).toEqual([
      ['a', 3000],
      ['b', 4000]
    ]);
  });

  it('computes feasibility from each source maximum net, not net(balance)', () => {
    // 25% tax + 25% penalty: net dips at 10 cents (net 4) below 9 cents (net 5).
    const state = buildState(opening({ r: 0.1 }));
    const retirement = config('r', {
      accountType: 'retirement401k',
      withdrawalPolicy: { ...POLICY, withdrawalTaxRate: 25, penaltyRate: 25 }
    });
    const result = quoteFunding(state, request({ requestedCents: 20, primaryAccountId: 'r' }), [retirement], null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.feasibleCents).toBe(5);
    expect(result.plan.executedCents).toBe(5);
    expect(result.plan.shortfallCents).toBe(15);
    expect(result.plan.status).toBe('partial');
    const allocation = result.plan.allocations[0];
    expect(allocation).toMatchObject({
      grossDebitCents: 9,
      netFundedCents: 5,
      withheldTaxCents: 2,
      penaltyCents: 2
    });
    expect(allocation.grossDebitCents).toBe(
      allocation.netFundedCents + allocation.withheldTaxCents + allocation.penaltyCents
    );
  });

  it('records an explicit unsupported-tax-range diagnostic and skips the source', () => {
    const state = buildState(opening({ bad: 100, good: 100 }));
    const bad = config('bad', {
      accountType: 'retirement401k',
      withdrawalPolicy: { ...POLICY, withdrawalTaxRate: 99.9, penaltyRate: 0 }
    });
    const result = quoteFunding(
      state,
      request({ requestedCents: 5000, primaryAccountId: 'bad', fallbackAccountIds: ['good'] }),
      [bad, config('good')],
      null
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const diagnostic = result.diagnostics.find((d) => d.code === 'unsupported-tax-range');
    expect(diagnostic).toMatchObject({ accountId: 'bad', taxDiagnosticCode: 'window-too-large' });
    expect(result.plan.allocations.map((a) => [a.accountId, a.netFundedCents])).toEqual([['good', 5000]]);
    expect(result.plan.feasibleCents).toBe(10000);
  });

  it('consumes the taxes lane: qualified HSA is tax-free, non-qualified is not', () => {
    const state = buildState(opening({ h: 1000 }));
    const hsa = config('h', {
      accountType: 'hsa',
      withdrawalPolicy: {
        ...POLICY,
        withdrawalTaxRate: 22,
        hsa: { nonQualifiedPenaltyRate: 20, nonQualifiedPenaltyWaiverAge: 65 }
      }
    });
    const dob = '1980-01-01';

    const qualified = quoteFunding(
      state,
      request({ requestedCents: 50000, primaryAccountId: 'h', hsaQualifiedMedical: true }),
      [hsa],
      dob
    );
    expect(qualified.ok).toBe(true);
    if (!qualified.ok) return;
    expect(qualified.plan.allocations[0]).toMatchObject({
      grossDebitCents: 50000,
      netFundedCents: 50000,
      withheldTaxCents: 0,
      penaltyCents: 0
    });

    const nonQualified = quoteFunding(
      state,
      request({ requestedCents: 50000, primaryAccountId: 'h', hsaQualifiedMedical: false }),
      [hsa],
      dob
    );
    expect(nonQualified.ok).toBe(true);
    if (!nonQualified.ok) return;
    expect(nonQualified.plan.allocations[0]).toMatchObject({
      grossDebitCents: 86206,
      netFundedCents: 50000,
      withheldTaxCents: 18965,
      penaltyCents: 17241
    });
  });

  it('does not mutate state while quoting', () => {
    const state = buildState(opening({ a: 100 }));
    const before = state.getRevision();
    quoteFunding(state, request({ requestedCents: 5000, primaryAccountId: 'a' }), [config('a')], null);
    expect(state.getRevision()).toBe(before);
    expect(state.getAccountBalanceCents('a')).toBe(10000);
  });
});

describe('commitFunding — atomic commit, related changes and conservation', () => {
  it('reduces debt by the executed net, never by the desired payment', () => {
    const state = buildState({
      ...opening({ checking: 60 }),
      liabilities: [openingLiability('loan', 1000)]
    });
    const accounts = [config('checking')];
    const quoted = quoteFunding(state, request({ requestedCents: 10000, primaryAccountId: 'checking' }), accounts, null);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    expect(quoted.plan.status).toBe('partial');
    expect(quoted.plan.executedCents).toBe(6000);

    const commit = commitFunding(state, quoted.plan, {
      posting: POSTING,
      prepareRelatedChanges: ({ executedNetCents }) => ({
        liabilityChanges: [{ liabilityId: 'loan', principalDeltaCents: -executedNetCents }],
        netWorthAdjustmentCents: executedNetCents
      })
    });

    expect(commit.committed).toBe(true);
    expect(state.getAccountBalanceCents('checking')).toBe(0);
    // 100000 − 6000 executed; never the 10000 desired payment.
    expect(state.getLiability('loan')?.principalCents).toBe(94000);
    // Exactly one journal row, stamped with the executed occurrence.
    expect(state.getPostings()).toHaveLength(1);
    expect(journalRows(state, 'occ')).toHaveLength(1);
    expect(state.getPostings()[0].posting.occurrenceId).toBe('occ');
  });

  it('holds the actual executed net as a deposit (gross = net + tax + penalty)', () => {
    const state = buildState({
      ...opening({ brokerage: 1000 }),
      properties: [openingProperty('home')]
    });
    const accounts = [config('brokerage', { accountType: 'taxable' })];
    const quoted = quoteFunding(
      state,
      request({ requestedCents: 100000, primaryAccountId: 'brokerage' }),
      accounts,
      null
    );
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    expect(quoted.plan.status).toBe('partial');
    expect(quoted.plan.executedCents).toBe(97000);

    const allocation = quoted.plan.allocations[0];
    expect(allocation.grossDebitCents).toBe(100000);
    expect(allocation.withheldTaxCents).toBe(3000);
    expect(allocation.penaltyCents).toBe(0);
    expect(allocation.netFundedCents).toBe(97000);
    expect(allocation.grossDebitCents).toBe(
      allocation.netFundedCents + allocation.withheldTaxCents + allocation.penaltyCents
    );

    const commit = commitFunding(state, quoted.plan, {
      posting: POSTING,
      prepareRelatedChanges: ({ executedNetCents }) => ({
        propertyChanges: [{ propertyId: 'home', acquisitionDepositDeltaCents: executedNetCents }],
        netWorthAdjustmentCents: executedNetCents
      })
    });

    expect(commit.committed).toBe(true);
    expect(state.getAccountBalanceCents('brokerage')).toBe(0);
    // Deposit is the executed net (97000), not the requested net (100000) or gross.
    expect(state.getProperty('home')?.acquisitionDepositCents).toBe(97000);
    expect(state.getPostings()).toHaveLength(1);
  });

  it('completes a held acquisition atomically from the executed net', () => {
    const state = buildState({
      ...opening({ checking: 60000 }),
      properties: [openingProperty('home')]
    });
    const accounts = [config('checking')];

    const partial = quoteFunding(
      state,
      request({ id: 'down', requestedCents: 3000000, primaryAccountId: 'checking' }),
      accounts,
      null
    );
    expect(partial.ok).toBe(true);
    if (!partial.ok) return;
    const partialCommit = commitFunding(state, partial.plan, {
      posting: POSTING,
      prepareRelatedChanges: ({ executedNetCents }) => ({
        propertyChanges: [{ propertyId: 'home', acquisitionDepositDeltaCents: executedNetCents }],
        netWorthAdjustmentCents: executedNetCents
      })
    });
    expect(partialCommit.committed).toBe(true);
    expect(state.getProperty('home')?.acquisitionDepositCents).toBe(3000000);
    expect(state.getAccountBalanceCents('checking')).toBe(3000000);

    const completion = quoteFunding(
      state,
      request({ id: 'down', requestedCents: 3000000, primaryAccountId: 'checking' }),
      accounts,
      null
    );
    expect(completion.ok).toBe(true);
    if (!completion.ok) return;
    const completionCommit = commitFunding(state, completion.plan, {
      posting: POSTING,
      prepareRelatedChanges: () => ({
        propertyChanges: [
          {
            propertyId: 'home',
            acquisitionDepositDeltaCents: -3000000,
            valueDeltaCents: 30000000,
            mortgageId: 'mort',
            status: 'owned'
          }
        ],
        liabilityChanges: [{ liabilityId: 'mort', create: true, kind: 'mortgage', principalDeltaCents: 24000000 }],
        netWorthAdjustmentCents: 3000000
      })
    });

    expect(completionCommit.committed).toBe(true);
    const totals = state.getTotals();
    expect(state.getProperty('home')?.status).toBe('owned');
    expect(totals.heldDepositCents).toBe(0);
    expect(totals.propertyValueCents).toBe(30000000);
    expect(totals.liabilityCents).toBe(24000000);
    expect(totals.netWorthCents).toBe(6000000);
  });

  it('rejects a stale plan without mutation, or re-quotes when a hook is provided', () => {
    const state = buildState(opening({ checking: 100 }));
    const accounts = [config('checking')];
    const req = request({ requestedCents: 5000, primaryAccountId: 'checking' });
    const quoted = quoteFunding(state, req, accounts, null);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;

    apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -100 }],
      expectedNetWorthDeltaCents: -100
    });

    const before = state.getPostings().length;
    const rejected = commitFunding(state, quoted.plan);
    expect(rejected.committed).toBe(false);
    expect(rejected.stale).toBe(true);
    expect(rejected.errors[0].code).toBe('stale-plan');
    expect(state.getAccountBalanceCents('checking')).toBe(9900);
    // A rejected stale plan journals nothing.
    expect(state.getPostings()).toHaveLength(before);

    const requoted = commitFunding(state, quoted.plan, {
      posting: POSTING,
      requote: (live) => quoteFunding(live, req, accounts, null)
    });
    expect(requoted.committed).toBe(true);
    expect(state.getAccountBalanceCents('checking')).toBe(4900);
    // One row for the actual execution, linked to the executed occurrence.
    expect(journalRows(state, 'occ')).toHaveLength(1);
  });

  it('stamps the actually executed occurrence when a stale plan is re-quoted', () => {
    const state = buildState(opening({ checking: 100 }));
    const accounts = [config('checking')];
    const req = request({ occurrenceId: 'occ:original', requestedCents: 5000, primaryAccountId: 'checking' });
    const quoted = quoteFunding(state, req, accounts, null);
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;

    // Bump the revision so the plan is stale, then re-quote against live state
    // but return a plan whose request carries a different executed occurrence.
    apply(state, {
      accountChanges: [{ accountId: 'checking', deltaCents: -100 }],
      expectedNetWorthDeltaCents: -100
    });

    const result = commitFunding(state, quoted.plan, {
      posting: { ...POSTING, occurrenceId: 'occ:stale-supplied' },
      requote: (live) => {
        const liveQuote = quoteFunding(live, req, accounts, null);
        if (!liveQuote.ok) return liveQuote;
        return {
          ...liveQuote,
          plan: {
            ...liveQuote.plan,
            request: { ...liveQuote.plan.request, occurrenceId: 'occ:executed' }
          }
        };
      }
    });

    expect(result.committed).toBe(true);
    const rows = state.getPostingsByOccurrence('occ:executed');
    expect(rows).toHaveLength(1);
    // The journal links to the actually executed occurrence, not the stale one.
    expect(state.getPostingsByOccurrence('occ:stale-supplied')).toHaveLength(0);
    // The supplied provenance beyond the occurrence is preserved.
    expect(rows[0].posting.purpose).toBe('purchase');
    expect(rows[0].posting.phase).toBe('mandatory');
  });

  it('debits nothing for a zero-fund plan', () => {
    const state = buildState(opening({ checking: 100 }));
    const quoted = quoteFunding(
      state,
      request({ requestedCents: 0, primaryAccountId: 'checking' }),
      [config('checking')],
      null
    );
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    expect(quoted.plan.executedCents).toBe(0);

    const commit = commitFunding(state, quoted.plan);
    expect(commit.committed).toBe(false);
    expect(commit.errors[0].code).toBe('zero-fund');
    expect(state.getAccountBalanceCents('checking')).toBe(10000);
    expect(state.getRevision()).toBe(0);
    // A zero-fund plan debits nothing and journals nothing.
    expect(state.getPostings()).toHaveLength(0);
  });

  it('rejects a nonzero plan with no posting stamp: missing-posting, no mutation, no journal row', () => {
    const state = buildState(opening({ checking: 100 }));
    const quoted = quoteFunding(
      state,
      request({ requestedCents: 5000, primaryAccountId: 'checking' }),
      [config('checking')],
      null
    );
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;
    expect(quoted.plan.executedCents).toBe(5000);

    const commit = commitFunding(state, quoted.plan);
    expect(commit.committed).toBe(false);
    expect(commit.errors[0].code).toBe('missing-posting');
    // The rejection originates in the state and no default was fabricated.
    expect(commit.errors[0].stateErrors?.some((e) => e.code === 'missing-posting')).toBe(true);
    expect(state.getAccountBalanceCents('checking')).toBe(10000);
    expect(state.getRevision()).toBe(0);
    expect(state.getPostings()).toHaveLength(0);
  });

  it('rejects an invalid request without a plan', () => {
    const state = buildState(opening({ checking: 100 }));
    const negative = quoteFunding(state, request({ requestedCents: -1 }), [config('checking')], null);
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.diagnostic.code).toBe('negative-request');

    const badDate = quoteFunding(
      state,
      request({ date: 'nope', primaryAccountId: 'checking' }),
      [config('checking')],
      null
    );
    expect(badDate.ok).toBe(false);
    if (!badDate.ok) expect(badDate.diagnostic.code).toBe('invalid-request');
  });

  it('applies no mutation when the prepared conservation declaration is wrong', () => {
    const state = buildState({ ...opening({ checking: 100 }), properties: [openingProperty('home')] });
    const quoted = quoteFunding(
      state,
      request({ requestedCents: 5000, primaryAccountId: 'checking' }),
      [config('checking')],
      null
    );
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;

    const commit = commitFunding(state, quoted.plan, {
      posting: POSTING,
      prepareRelatedChanges: () => ({
        propertyChanges: [{ propertyId: 'home', acquisitionDepositDeltaCents: 5000 }],
        netWorthAdjustmentCents: 0
      })
    });

    expect(commit.committed).toBe(false);
    expect(commit.errors[0].code).toBe('commit-rejected');
    expect(commit.errors[0].stateErrors?.some((e) => e.code === 'conservation-mismatch')).toBe(true);
    expect(state.getAccountBalanceCents('checking')).toBe(10000);
    expect(state.getProperty('home')?.acquisitionDepositCents).toBe(0);
    expect(state.getRevision()).toBe(0);
    // A rejected commit journals nothing.
    expect(state.getPostings()).toHaveLength(0);
  });

  it('rejects an internally inconsistent plan before mutation', () => {
    const state = buildState(opening({ checking: 100 }));
    const quoted = quoteFunding(
      state,
      request({ requestedCents: 5000, primaryAccountId: 'checking' }),
      [config('checking')],
      null
    );
    expect(quoted.ok).toBe(true);
    if (!quoted.ok) return;

    const tampered = { ...quoted.plan, executedCents: 9999 };
    expect(validateFundingPlan(tampered).ok).toBe(false);

    const commit = commitFunding(state, tampered);
    expect(commit.errors[0].code).toBe('invalid-plan');
    expect(state.getAccountBalanceCents('checking')).toBe(10000);
  });

  it('replenishes from the next source as balances change across revisions', () => {
    const state = buildState(opening({ a: 60, b: 60 }));
    const accounts = [config('a'), config('b')];

    const first = quoteFunding(
      state,
      request({ id: 'one', requestedCents: 6000, primaryAccountId: 'a' }),
      accounts,
      null
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const firstCommit = commitFunding(state, first.plan, { posting: POSTING });
    expect(firstCommit.committed).toBe(true);
    expect(state.getAccountBalanceCents('a')).toBe(0);

    const second = quoteFunding(
      state,
      request({ id: 'two', requestedCents: 4000, primaryAccountId: 'a', fallbackAccountIds: ['b'] }),
      accounts,
      null
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.plan.allocations.map((x) => [x.accountId, x.netFundedCents])).toEqual([['b', 4000]]);
    expect(second.plan.feasibleCents).toBe(6000);
  });
});
