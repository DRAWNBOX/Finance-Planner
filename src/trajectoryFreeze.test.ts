import { describe, expect, it } from 'vitest';

import { createDefaultUiState, decodeAppState, encodeAppState } from './codec';
import { createDefaultScenario } from './defaultScenario';
import type { ProjectionRunMetadata } from './engine/projection';
import {
  areTrajectoriesComparable,
  compareTrajectoryContexts,
  compareTrajectorySnapshots,
  createCanonicalTrajectorySnapshot,
  createFrozenTrajectorySnapshot,
  frozenContextFromRunMetadata,
  hasCompleteTrajectoryContext,
  isCanonical,
  isLegacyTrajectoryContext,
  isLegacyTrajectorySnapshot,
  type CanonicalTrajectorySeed,
  type FrozenTrajectorySeed
} from './trajectoryFreeze';
import type { CanonicalTrajectorySnapshot, ResultContextMetadata, TrajectorySnapshot, TrajectoryYear } from './types';

/**
 * P4.6 (S) focused tests (D20). Cover the frozen trajectory factory (immutable,
 * deep clone, byte-stable), legacy/uncomparable handling, the comparison
 * compatibility predicate and valid 0 / false / null preservation.
 */

const REFERENCE_DATE = new Date('2026-01-15');

const runMetadata = (overrides: Partial<ProjectionRunMetadata> = {}): ProjectionRunMetadata => ({
  engineRevision: 'p2.7-kernel-1',
  contextSchemaVersion: 1,
  contextId: 'ctx-1',
  timelineId: null,
  timelineLabel: 'Base',
  // A canonical run's result values are signed net worth; a real run never
  // reports `assetOnly` here (that basis stays on the observed opening).
  measurement: 'assetsMinusLiabilities',
  startDate: '2026-01-15',
  endDate: '2046-01-15',
  startYearMonth: '2026-01',
  endYearMonth: '2046-01',
  horizonMonths: 240,
  hasOpeningSnapshot: false,
  sourceSnapshotId: null,
  ...overrides
});

const trajectoryYear = (overrides: Partial<TrajectoryYear> = {}): TrajectoryYear => ({
  age: 45,
  calendarYear: 2026,
  isBaselineNow: true,
  startBalance: 1000,
  endBalance: 1100,
  salary: 0,
  netIncome: 0,
  careerContribution: 0,
  contribution: 0,
  withdrawal: 0,
  taxesPaid: 0,
  penaltiesPaid: 0,
  annualReturnRate: 0,
  inflationRate: 0,
  depleted: false,
  savingsBalances: {},
  accountBalancesById: {},
  creditCardBalancesById: {},
  totalCreditCardDebt: 0,
  ...overrides
});

const seed = (overrides: Partial<FrozenTrajectorySeed> = {}): FrozenTrajectorySeed => ({
  id: 'traj-1',
  label: 'Trajectory 1',
  years: [trajectoryYear()],
  survivesToEnd: true,
  depletedAge: null,
  endAge: 90,
  endingBalance: 1234,
  summary: 'ok',
  ...overrides
});

const contextBase = (overrides: Partial<ResultContextMetadata> = {}): ResultContextMetadata => ({
  measurement: 'assetOnly',
  startDate: '2026-01-01',
  endDate: '2046-01-01',
  schemaVersion: 1,
  engineRevision: 'p2.7-kernel-1',
  ...overrides
});

// ---------------------------------------------------------------------------
// Frozen factory
// ---------------------------------------------------------------------------

describe('createFrozenTrajectorySnapshot (P4.6 / D20)', () => {
  it('captures schemaVersion/engineRevision/measurement/dates and freeze date from run metadata', () => {
    const snapshot = createFrozenTrajectorySnapshot(seed(), runMetadata());

    expect(snapshot.createdAt).toBe('2026-01-15');
    expect(snapshot.context).toEqual({
      measurement: 'assetsMinusLiabilities',
      startDate: '2026-01-15',
      endDate: '2046-01-15',
      schemaVersion: 1,
      engineRevision: 'p2.7-kernel-1',
      contextId: 'ctx-1'
    });
    expect(frozenContextFromRunMetadata(runMetadata({ measurement: 'assetsMinusLiabilities' })).measurement).toBe(
      'assetsMinusLiabilities'
    );
  });

  it('uses an explicit frozen date when supplied', () => {
    const snapshot = createFrozenTrajectorySnapshot(seed({ frozenDate: '2030-06-30' }), runMetadata());
    expect(snapshot.createdAt).toBe('2030-06-30');
  });

  it('is deeply immutable and never aliases the seed years', () => {
    const sourceYears = [trajectoryYear()];
    const snapshot = createFrozenTrajectorySnapshot(seed({ years: sourceYears }), runMetadata());

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.context)).toBe(true);
    expect(Object.isFrozen(snapshot.years)).toBe(true);
    expect(Object.isFrozen(snapshot.years[0])).toBe(true);
    expect(Object.isFrozen(snapshot.years[0].savingsBalances)).toBe(true);

    // Mutating the seed after freezing must not touch the snapshot.
    sourceYears[0].endBalance = 999999;
    expect(snapshot.years[0].endBalance).toBe(1100);
    expect(snapshot.years[0]).not.toBe(sourceYears[0]);
  });

  it('is byte-stable across save/load and deep-clones equal years', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const snapshot = createFrozenTrajectorySnapshot(seed(), runMetadata());
    scenario.trajectorySnapshots = [snapshot];

    const encoded = encodeAppState({ scenario, ui: createDefaultUiState() }, REFERENCE_DATE).json;
    const decoded = decodeAppState(encoded, REFERENCE_DATE);
    const reencoded = encodeAppState({ scenario: decoded.scenario, ui: decoded.ui }, REFERENCE_DATE).json;

    expect(reencoded).toBe(encoded);
    const roundTripped = decoded.scenario.trajectorySnapshots[0] as TrajectorySnapshot;
    expect(roundTripped.years).toEqual(snapshot.years);
    expect(roundTripped.context).toEqual(snapshot.context);
  });
});

// ---------------------------------------------------------------------------
// Comparison compatibility
// ---------------------------------------------------------------------------

describe('trajectory comparison compatibility (P4.6 / D20)', () => {
  it('accepts matching measurement/engineRevision/schemaVersion', () => {
    const verdict = compareTrajectoryContexts(
      frozenContextFromRunMetadata(runMetadata()),
      frozenContextFromRunMetadata(runMetadata({ contextId: 'ctx-2' }))
    );
    expect(verdict).toEqual({ comparable: true, reasons: [] });
  });

  it('refuses a signed-vs-asset-only measurement mismatch', () => {
    const signed = contextBase({ measurement: 'assetsMinusLiabilities' });
    const assetOnly = contextBase({ measurement: 'assetOnly' });

    const verdict = compareTrajectoryContexts(signed, assetOnly);
    expect(verdict.comparable).toBe(false);
    expect(verdict.reasons).toContain('measurement-mismatch');
  });

  it('refuses engineRevision and schemaVersion mismatches', () => {
    const base = contextBase();
    expect(compareTrajectoryContexts(base, contextBase({ engineRevision: 'p2.8-kernel-2' })).reasons).toEqual([
      'engine-revision-mismatch'
    ]);
    expect(compareTrajectoryContexts(base, contextBase({ schemaVersion: 2 })).reasons).toEqual(['schema-version-mismatch']);
  });

  it('refuses a legacy snapshot instead of treating it as modern', () => {
    const frozen = createFrozenTrajectorySnapshot(seed(), runMetadata());
    const legacySnapshot = { ...createFrozenTrajectorySnapshot(seed({ id: 'legacy' }), runMetadata()), context: undefined };

    expect(isLegacyTrajectorySnapshot(legacySnapshot)).toBe(true);
    expect(isLegacyTrajectorySnapshot(frozen)).toBe(false);
    expect(areTrajectoriesComparable(frozen, legacySnapshot)).toBe(false);
    expect(compareTrajectoryContexts(frozen.context, undefined)).toEqual({
      comparable: false,
      reasons: ['missing-context']
    });
  });

  it('refuses a partial context and preserves valid 0 / empty values', () => {
    const partial = contextBase();
    delete partial.schemaVersion;
    delete partial.engineRevision;
    expect(hasCompleteTrajectoryContext(partial)).toBe(false);
    expect(compareTrajectoryContexts(partial, contextBase())).toEqual({
      comparable: false,
      reasons: ['missing-context']
    });

    const zero = contextBase({ schemaVersion: 0, engineRevision: 'rev', contextId: '' });
    expect(hasCompleteTrajectoryContext(zero)).toBe(true);
    expect(compareTrajectoryContexts(zero, { ...zero })).toEqual({ comparable: true, reasons: [] });
  });
});

// ---------------------------------------------------------------------------
// D20 date validation consistency (P4.6)
// ---------------------------------------------------------------------------

describe('trajectory context date validation (D20)', () => {
  it('classifies a nonempty-but-malformed date as legacy/incompatible, never modern', () => {
    const garbageStart = contextBase({ startDate: 'not-a-date' });
    const garbageEnd = contextBase({ endDate: '2026-13-45' });

    expect(hasCompleteTrajectoryContext(garbageStart)).toBe(false);
    expect(hasCompleteTrajectoryContext(garbageEnd)).toBe(false);
    expect(isLegacyTrajectorySnapshot({ context: garbageStart })).toBe(true);
    expect(compareTrajectoryContexts(contextBase(), garbageStart)).toEqual({
      comparable: false,
      reasons: ['missing-context']
    });
    // A valid signed trajectory must never be compared against the garbage side.
    const frozen = createFrozenTrajectorySnapshot(seed(), runMetadata());
    const garbageSnapshot = createFrozenTrajectorySnapshot(seed({ id: 'garbage' }), runMetadata());
    expect(areTrajectoriesComparable(frozen, { ...garbageSnapshot, context: garbageEnd })).toBe(false);
  });

  it('rejects a reversed date range', () => {
    const reversed = contextBase({ startDate: '2046-01-01', endDate: '2026-01-01' });
    expect(hasCompleteTrajectoryContext(reversed)).toBe(false);
    expect(compareTrajectoryContexts(contextBase(), reversed)).toEqual({
      comparable: false,
      reasons: ['missing-context']
    });
  });

  it('accepts a valid same-day range and an explicit intended range', () => {
    const sameDay = contextBase({ startDate: '2026-01-01', endDate: '2026-01-01' });
    expect(hasCompleteTrajectoryContext(sameDay)).toBe(true);
    expect(compareTrajectoryContexts(sameDay, { ...sameDay })).toEqual({ comparable: true, reasons: [] });

    const explicit = contextBase({ startDate: '2026-01-15', endDate: '2046-01-15' });
    expect(hasCompleteTrajectoryContext(explicit)).toBe(true);
    expect(compareTrajectoryContexts(explicit, contextBase({ startDate: '2026-01-15', endDate: '2046-01-15' }))).toEqual({
      comparable: true,
      reasons: []
    });
  });

  it('supports schemaVersion 0 per the frozen metadata rule but not a missing/non-finite one', () => {
    const zero = contextBase({ schemaVersion: 0 });
    expect(hasCompleteTrajectoryContext(zero)).toBe(true);
    expect(compareTrajectoryContexts(zero, contextBase({ schemaVersion: 0 }))).toEqual({
      comparable: true,
      reasons: []
    });

    const nonFinite = contextBase({ schemaVersion: Number.NaN });
    expect(hasCompleteTrajectoryContext(nonFinite)).toBe(false);

    const missing = contextBase();
    delete missing.schemaVersion;
    expect(hasCompleteTrajectoryContext(missing)).toBe(false);
  });

  it('does not alias or mutate a context it classifies', () => {
    const context = contextBase({ startDate: 'not-a-date' });
    const before = { ...context };
    expect(hasCompleteTrajectoryContext(context)).toBe(false);
    expect(isLegacyTrajectoryContext(context)).toBe(true);
    expect(context).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// D20 — canonical (versioned) trajectory snapshots
// ---------------------------------------------------------------------------

const reportSource = () => ({
  years: [
    {
      year: 2026,
      lastYearMonth: '2026-12',
      closing: { netWorthCents: 150000, accountCents: 200000, liabilityCents: 50000 }
    },
    {
      year: 2027,
      lastYearMonth: '2027-12',
      closing: { netWorthCents: -2500, accountCents: 175000, liabilityCents: 177500 }
    }
  ],
  months: [
    { yearMonth: '2026-12', closingDate: '2026-12-31' },
    { yearMonth: '2027-12', closingDate: '2027-12-31' }
  ]
});

const canonicalSeed = (overrides: Partial<CanonicalTrajectorySeed> = {}): CanonicalTrajectorySeed => ({
  id: 'canon-1',
  label: 'Canonical 1',
  report: reportSource(),
  ...overrides
});

describe('createCanonicalTrajectorySnapshot (P5 / D20)', () => {
  it('maps actual report year-close stocks to canonical points exactly', () => {
    const snapshot = createCanonicalTrajectorySnapshot(canonicalSeed(), runMetadata());

    expect(snapshot.formatVersion).toBe(2);
    expect(snapshot.id).toBe('canon-1');
    expect(snapshot.createdAt).toBe('2026-01-15');
    expect(snapshot.context).toEqual({
      measurement: 'assetsMinusLiabilities',
      startDate: '2026-01-15',
      endDate: '2046-01-15',
      schemaVersion: 1,
      engineRevision: 'p2.7-kernel-1',
      contextId: 'ctx-1'
    });
    expect(snapshot.annualPoints).toEqual([
      { calendarYear: 2026, closingDate: '2026-12-31', netWorthCents: 150000, accountAssetsCents: 200000, liabilityCents: 50000 },
      { calendarYear: 2027, closingDate: '2027-12-31', netWorthCents: -2500, accountAssetsCents: 175000, liabilityCents: 177500 }
    ]);
  });

  it('uses an explicit freeze date when supplied (never a wall clock)', () => {
    const snapshot = createCanonicalTrajectorySnapshot(canonicalSeed({ frozenDate: '2030-06-30' }), runMetadata());
    expect(snapshot.createdAt).toBe('2030-06-30');
  });

  it('copies a canonical signed run measurement and stays incompatible with a legacy sibling', () => {
    const snapshot = createCanonicalTrajectorySnapshot(canonicalSeed(), runMetadata());
    expect(snapshot.context.measurement).toBe('assetsMinusLiabilities');

    const legacy = createFrozenTrajectorySnapshot(seed({ id: 'legacy-1' }), runMetadata());
    expect(compareTrajectorySnapshots(snapshot, legacy)).toEqual({
      comparable: false,
      reasons: ['format-version-mismatch']
    });
    expect(areTrajectoriesComparable(legacy, snapshot)).toBe(false);
  });

  it('preserves signed negative net worth and keeps account assets and debt separate', () => {
    const snapshot = createCanonicalTrajectorySnapshot(canonicalSeed(), runMetadata());
    const second = snapshot.annualPoints[1];
    expect(second.netWorthCents).toBe(-2500);
    expect(second.accountAssetsCents).toBe(175000);
    expect(second.liabilityCents).toBe(177500);
    expect(second.netWorthCents).toBe(second.accountAssetsCents - second.liabilityCents);
  });

  it('is deeply immutable, never aliasing the report or metadata', () => {
    const report = reportSource();
    const metadata = runMetadata();
    const snapshot = createCanonicalTrajectorySnapshot(canonicalSeed({ report }), metadata);

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.context)).toBe(true);
    expect(Object.isFrozen(snapshot.annualPoints)).toBe(true);
    expect(Object.isFrozen(snapshot.annualPoints[0])).toBe(true);

    // Mutating the source after freezing must not touch the snapshot.
    report.years[0].closing.netWorthCents = 999999;
    report.months[0].closingDate = '1999-01-01';
    expect(snapshot.annualPoints[0].netWorthCents).toBe(150000);
    expect(snapshot.annualPoints[0].closingDate).toBe('2026-12-31');
  });

  it('is deterministic and does not mutate its inputs', () => {
    const report = reportSource();
    const metadata = runMetadata();
    const reportBefore = JSON.stringify(report);
    const metadataBefore = JSON.stringify(metadata);

    const first = createCanonicalTrajectorySnapshot(canonicalSeed({ report }), metadata);
    const second = createCanonicalTrajectorySnapshot(canonicalSeed({ report }), metadata);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(report)).toBe(reportBefore);
    expect(JSON.stringify(metadata)).toBe(metadataBefore);
  });

  it('omits a year whose closing date cannot be resolved instead of fabricating one', () => {
    const report = reportSource();
    report.months = [{ yearMonth: '2026-12', closingDate: '2026-12-31' }];
    const snapshot = createCanonicalTrajectorySnapshot(canonicalSeed({ report }), runMetadata());
    expect(snapshot.annualPoints.map((point) => point.calendarYear)).toEqual([2026]);
  });

  it('round-trips through the codec byte-stably with a legacy sibling untouched', () => {
    const scenario = createDefaultScenario(REFERENCE_DATE);
    const canonical = createCanonicalTrajectorySnapshot(canonicalSeed(), runMetadata());
    const legacy = createFrozenTrajectorySnapshot(seed({ id: 'legacy-1' }), runMetadata());
    scenario.trajectorySnapshots = [canonical, legacy];

    const encoded = encodeAppState({ scenario, ui: createDefaultUiState() }, REFERENCE_DATE).json;
    const decoded = decodeAppState(encoded, REFERENCE_DATE);
    const reencoded = encodeAppState({ scenario: decoded.scenario, ui: decoded.ui }, REFERENCE_DATE).json;

    expect(reencoded).toBe(encoded);
    expect(isCanonical(decoded.scenario.trajectorySnapshots[0])).toBe(true);
    expect(decoded.scenario.trajectorySnapshots[0].id).toBe('canon-1');
    expect(isCanonical(decoded.scenario.trajectorySnapshots[1])).toBe(false);
    expect(decoded.scenario.trajectorySnapshots[1]).not.toHaveProperty('formatVersion');
  });
});

describe('isCanonical type guard (P5 / D20)', () => {
  it('distinguishes canonical from legacy snapshots', () => {
    const canonical: CanonicalTrajectorySnapshot = createCanonicalTrajectorySnapshot(canonicalSeed(), runMetadata());
    const legacy: TrajectorySnapshot = createFrozenTrajectorySnapshot(seed(), runMetadata());

    expect(isCanonical(canonical)).toBe(true);
    expect(isCanonical(legacy)).toBe(false);
  });
});

describe('cross-format trajectory comparison (P5 / D20)', () => {
  it('accepts two canonical snapshots with matching measurement/engine/schema', () => {
    const left = createCanonicalTrajectorySnapshot(canonicalSeed(), runMetadata());
    const right = createCanonicalTrajectorySnapshot(canonicalSeed({ id: 'canon-2' }), runMetadata());
    expect(compareTrajectorySnapshots(left, right)).toEqual({ comparable: true, reasons: [] });
    expect(areTrajectoriesComparable(left, right)).toBe(true);
  });

  it('rejects a legacy/canonical pair with an explicit format-version-mismatch', () => {
    const canonical = createCanonicalTrajectorySnapshot(canonicalSeed(), runMetadata());
    const legacy = createFrozenTrajectorySnapshot(seed(), runMetadata());

    expect(compareTrajectorySnapshots(canonical, legacy)).toEqual({
      comparable: false,
      reasons: ['format-version-mismatch']
    });
    expect(areTrajectoriesComparable(legacy, canonical)).toBe(false);
  });

  it('still gates measurement/engine/schema within the canonical format', () => {
    const base = createCanonicalTrajectorySnapshot(
      canonicalSeed(),
      runMetadata({ measurement: 'assetsMinusLiabilities', engineRevision: 'rev-a', contextSchemaVersion: 2 })
    );
    const engineMismatch = createCanonicalTrajectorySnapshot(
      canonicalSeed({ id: 'canon-b' }),
      runMetadata({ measurement: 'assetsMinusLiabilities', engineRevision: 'rev-b', contextSchemaVersion: 2 })
    );
    expect(compareTrajectorySnapshots(base, engineMismatch).reasons).toEqual(['engine-revision-mismatch']);

    const measurementMismatch = createCanonicalTrajectorySnapshot(
      canonicalSeed({ id: 'canon-c' }),
      runMetadata({ measurement: 'assetOnly', engineRevision: 'rev-a', contextSchemaVersion: 2 })
    );
    expect(compareTrajectorySnapshots(base, measurementMismatch).reasons).toEqual(['measurement-mismatch']);

    const schemaMismatch = createCanonicalTrajectorySnapshot(
      canonicalSeed({ id: 'canon-d' }),
      runMetadata({ measurement: 'assetsMinusLiabilities', engineRevision: 'rev-a', contextSchemaVersion: 3 })
    );
    expect(compareTrajectorySnapshots(base, schemaMismatch).reasons).toEqual(['schema-version-mismatch']);
  });

  it('does not mutate the snapshots it compares', () => {
    const canonical = createCanonicalTrajectorySnapshot(canonicalSeed(), runMetadata());
    const legacy = createFrozenTrajectorySnapshot(seed(), runMetadata());
    const canonicalBefore = JSON.stringify(canonical);
    const legacyBefore = JSON.stringify(legacy);

    compareTrajectorySnapshots(canonical, legacy);
    compareTrajectorySnapshots(canonical, canonical);

    expect(JSON.stringify(canonical)).toBe(canonicalBefore);
    expect(JSON.stringify(legacy)).toBe(legacyBefore);
  });
});
