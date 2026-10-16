import { compareDateOnly, isValidDateOnly } from './engine/dates';
import type { ProjectionRunMetadata } from './engine/projection';
import { CANONICAL_TRAJECTORY_FORMAT_VERSION } from './codec';
import {
  canonicalAnnualPointsFromReport,
  canonicalContextFromRunMetadata,
  type TrajectoryReportSource
} from './trajectoryReportAdapter';
import type {
  AnyTrajectorySnapshot,
  CanonicalTrajectorySnapshot,
  ResultContextMetadata,
  TrajectorySnapshot,
  TrajectoryYear
} from './types';

/**
 * P4.6 (S) — frozen trajectory freeze metadata (D20).
 *
 * A frozen trajectory is an immutable snapshot of a projection plus the exact
 * `{ schemaVersion, engineRevision, measurement, startDate, endDate, date }`
 * context it was produced under. Every value is taken from the `ProjectionRun`
 * metadata (never a wall clock), so the same run freezes to byte-identical
 * output.
 *
 * Invariants:
 * - The factory never mutates or aliases its input: years are deep-cloned and
 *   the whole result is deep-frozen (`frozen_contracts.md`: saved trajectory
 *   snapshots are deep-frozen and never alias engine state).
 * - A legacy snapshot with no (or an incomplete) context is **never** given
 *   invented modern metadata. It stays visibly legacy and is refused by the
 *   comparison predicate instead of being compared on mismatched assumptions.
 * - Old asset-only output is never reinterpreted as signed net worth.
 */

/** The display fields of a frozen snapshot; context comes from the run. */
export interface FrozenTrajectorySeed {
  readonly id: string;
  readonly label: string;
  readonly years: readonly TrajectoryYear[];
  readonly survivesToEnd: boolean;
  readonly depletedAge: number | null;
  readonly endAge: number;
  readonly endingBalance: number;
  readonly summary: string;
  /**
   * Date-only freeze date. Defaults to the run's observation start
   * (`metadata.startDate`), which is the deterministic "as of" date; a wall
   * clock is never read.
   */
  readonly frozenDate?: string;
}

/** Why two frozen trajectories cannot be compared. */
export type TrajectoryIncompatibilityReason =
  | 'missing-context'
  | 'measurement-mismatch'
  | 'engine-revision-mismatch'
  | 'schema-version-mismatch'
  /** One side is a legacy (unversioned) snapshot and the other a canonical one. */
  | 'format-version-mismatch';

export interface TrajectoryComparisonCompatibility {
  readonly comparable: boolean;
  readonly reasons: readonly TrajectoryIncompatibilityReason[];
}

const deepClone = <T>(value: T): T => {
  if (Array.isArray(value)) {
    return value.map((entry) => deepClone(entry)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const clone: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      clone[key] = deepClone(entry);
    });
    return clone as unknown as T;
  }
  return value;
};

const deepFreeze = <T>(value: T): T => {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    Object.freeze(value);
    return value;
  }
  if (value !== null && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((entry) => deepFreeze(entry));
    Object.freeze(value);
    return value;
  }
  return value;
};

/**
 * Freeze the run's context into the display metadata shape. Every field is
 * copied from `ProjectionRunMetadata` — nothing is inferred or defaulted with a
 * synthetic value.
 */
export const frozenContextFromRunMetadata = (metadata: ProjectionRunMetadata): ResultContextMetadata => ({
  measurement: metadata.measurement,
  startDate: metadata.startDate,
  endDate: metadata.endDate,
  schemaVersion: metadata.contextSchemaVersion,
  engineRevision: metadata.engineRevision,
  contextId: metadata.contextId
});

/**
 * Builds an immutable frozen trajectory from a seed and a `ProjectionRun`'s
 * metadata. The seed's years are deep-cloned; the returned snapshot and all its
 * nested values are deep-frozen.
 */
export const createFrozenTrajectorySnapshot = (
  seed: FrozenTrajectorySeed,
  metadata: ProjectionRunMetadata
): TrajectorySnapshot => {
  const snapshot: TrajectorySnapshot = {
    id: seed.id,
    label: seed.label,
    createdAt: seed.frozenDate ?? metadata.startDate,
    survivesToEnd: seed.survivesToEnd,
    depletedAge: seed.depletedAge,
    endAge: seed.endAge,
    endingBalance: seed.endingBalance,
    summary: seed.summary,
    years: seed.years.map((year) => deepClone(year)),
    context: frozenContextFromRunMetadata(metadata)
  };
  return deepFreeze(snapshot);
};

// ---------------------------------------------------------------------------
// D20 — canonical (versioned) trajectory snapshots
// ---------------------------------------------------------------------------

/** True when a persisted snapshot is the canonical `formatVersion: 2` shape. */
export const isCanonical = (snapshot: AnyTrajectorySnapshot): snapshot is CanonicalTrajectorySnapshot =>
  (snapshot as { formatVersion?: unknown }).formatVersion === CANONICAL_TRAJECTORY_FORMAT_VERSION;

/**
 * Display/identity fields for a canonical snapshot; the annual points are
 * derived from the actual report years and the context from the run metadata.
 */
export interface CanonicalTrajectorySeed {
  readonly id: string;
  readonly label: string;
  /** Actual report whose year-close stocks become the annual points. */
  readonly report: TrajectoryReportSource;
  /**
   * Date-only freeze date. Defaults to the run's observation start
   * (`metadata.startDate`), the deterministic "as of" date; a wall clock is
   * never read.
   */
  readonly frozenDate?: string;
}

/**
 * Builds an immutable canonical (`formatVersion: 2`) trajectory from a report
 * and a `ProjectionRun`'s metadata. The points are mapped from the **actual**
 * report year-close stocks (signed net worth plus separate account-asset and
 * liability cents); no pool map, derived audit, or wall clock is persisted. The
 * points are deep-cloned and the whole snapshot is deep-frozen.
 */
export const createCanonicalTrajectorySnapshot = (
  seed: CanonicalTrajectorySeed,
  metadata: ProjectionRunMetadata
): CanonicalTrajectorySnapshot => {
  const snapshot: CanonicalTrajectorySnapshot = {
    formatVersion: CANONICAL_TRAJECTORY_FORMAT_VERSION,
    id: seed.id,
    label: seed.label,
    createdAt: seed.frozenDate ?? metadata.startDate,
    context: canonicalContextFromRunMetadata(metadata),
    annualPoints: canonicalAnnualPointsFromReport(seed.report).map((point) => deepClone(point))
  };
  return deepFreeze(snapshot);
};

/**
 * True only when a context carries the complete freeze tuple. A legacy or
 * partial context is *not* complete and must not be treated as modern metadata.
 *
 * `startDate`/`endDate` must be valid date-only values in non-decreasing order
 * (same-day is allowed). A nonempty-but-malformed date — which the display
 * adapter rejects — is classified legacy/incompatible here too, so it is never
 * plotted alongside a valid signed trajectory.
 */
export const hasCompleteTrajectoryContext = (
  context: ResultContextMetadata | undefined
): context is ResultContextMetadata & { schemaVersion: number; engineRevision: string } => {
  if (!context) return false;
  return (
    (context.measurement === 'assetOnly' ||
      context.measurement === 'assetsMinusLiabilities' ||
      context.measurement === 'accountAssets') &&
    typeof context.startDate === 'string' &&
    isValidDateOnly(context.startDate) &&
    typeof context.endDate === 'string' &&
    isValidDateOnly(context.endDate) &&
    compareDateOnly(context.endDate, context.startDate) >= 0 &&
    typeof context.schemaVersion === 'number' &&
    Number.isFinite(context.schemaVersion) &&
    typeof context.engineRevision === 'string' &&
    context.engineRevision.length > 0
  );
};

/** A context that is absent or incomplete: legacy/unsupported, never modern. */
export const isLegacyTrajectoryContext = (context: ResultContextMetadata | undefined): boolean =>
  !hasCompleteTrajectoryContext(context);

/** A snapshot without a complete freeze context is legacy and uncomparable. */
export const isLegacyTrajectorySnapshot = (snapshot: { context?: ResultContextMetadata }): boolean =>
  isLegacyTrajectoryContext(snapshot.context);

/**
 * Compatibility predicate for comparing two frozen trajectories. Refuses any
 * mismatch in `measurement`, `engineRevision` or `schemaVersion`, and refuses a
 * pair where either side lacks a complete context. It never reinterprets a
 * legacy asset-only snapshot as signed net worth.
 */
export const compareTrajectoryContexts = (
  left: ResultContextMetadata | undefined,
  right: ResultContextMetadata | undefined
): TrajectoryComparisonCompatibility => {
  if (!hasCompleteTrajectoryContext(left) || !hasCompleteTrajectoryContext(right)) {
    return { comparable: false, reasons: ['missing-context'] };
  }

  const reasons: TrajectoryIncompatibilityReason[] = [];
  if (left.measurement !== right.measurement) reasons.push('measurement-mismatch');
  if (left.engineRevision !== right.engineRevision) reasons.push('engine-revision-mismatch');
  if (left.schemaVersion !== right.schemaVersion) reasons.push('schema-version-mismatch');

  return { comparable: reasons.length === 0, reasons };
};

/**
 * Compatibility predicate for two persisted snapshots (legacy or canonical).
 *
 * A **cross-format** pair (one legacy, one canonical) is always refused with
 * `format-version-mismatch` — a versioned cents snapshot is never compared
 * against an unversioned derived one on assumed-equal semantics. Within the
 * same format the context gate applies unchanged: `measurement`,
 * `engineRevision` and `schemaVersion` must match, and both sides must carry a
 * complete, valid context (else `missing-context`).
 */
export const compareTrajectorySnapshots = (
  left: AnyTrajectorySnapshot,
  right: AnyTrajectorySnapshot
): TrajectoryComparisonCompatibility => {
  if (isCanonical(left) !== isCanonical(right)) {
    return { comparable: false, reasons: ['format-version-mismatch'] };
  }
  return compareTrajectoryContexts(left.context, right.context);
};

/** Convenience wrapper over `compareTrajectorySnapshots` for two snapshots. */
export const areTrajectoriesComparable = (
  left: AnyTrajectorySnapshot,
  right: AnyTrajectorySnapshot
): boolean => compareTrajectorySnapshots(left, right).comparable;
