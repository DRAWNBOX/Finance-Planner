/**
 * Phase 5 / D20 — canonical trajectory report adapter (pure, S-owned).
 *
 * The single deterministic boundary between the **cents-only** engine report and
 * the persisted {@link CanonicalTrajectorySnapshot} annual points. It owns:
 *
 * 1. **Year-close stock mapping** ({@link canonicalAnnualPointsFromReport}) —
 *    one point per actual report year, reading the reconciled closing stocks
 *    (`netWorthCents`, `accountCents`, `liabilityCents`) and the matching
 *    month-close date. Account assets and liabilities stay separate; a signed
 *    (possibly negative) net worth is never clamped or reinterpreted.
 * 2. **Context copying** ({@link canonicalContextFromRunMetadata}) — the
 *    `{ measurement, startDate, endDate, schemaVersion, engineRevision,
 *    contextId }` tuple copied verbatim from a run's metadata.
 *
 * Invariants:
 * - **Pure and deterministic**: no wall clock (`Date` is never constructed), no
 *   randomness, no I/O, no mutation of its input.
 * - **No fabrication**: a year whose closing date cannot be resolved from the
 *   report's month closes is omitted rather than given a synthetic date.
 * - **No pool maps / derived audit**: only the four scalar stocks are read.
 */

import type { ProjectionRunMetadata } from './engine/projection';
import type { CanonicalTrajectoryAnnualPoint, CanonicalTrajectoryContext } from './types';

/**
 * Minimal structural view of one report year the mapper reads. A real
 * `ReportYear` satisfies this; tests can build a small fixture.
 */
export interface TrajectoryReportYearSource {
  readonly year: number;
  readonly lastYearMonth: string;
  readonly closing: {
    readonly netWorthCents: number;
    readonly accountCents: number;
    readonly liabilityCents: number;
  };
}

/** Minimal structural view of one month close used to resolve a year-close date. */
export interface TrajectoryReportMonthSource {
  readonly yearMonth: string;
  readonly closingDate: string;
}

/**
 * Minimal structural view of the report the mapper consumes. A real
 * `ProjectionReport` is assignable to this shape.
 */
export interface TrajectoryReportSource {
  readonly years: readonly TrajectoryReportYearSource[];
  readonly months: readonly TrajectoryReportMonthSource[];
}

/**
 * Maps every actual report year's reconciled closing stocks to a canonical
 * annual point (integer cents). The `closingDate` is resolved from the month
 * close whose `yearMonth` equals the year's `lastYearMonth`; a year with no
 * matching month close is omitted (never given a fabricated date). The input is
 * never mutated.
 */
export const canonicalAnnualPointsFromReport = (
  report: TrajectoryReportSource
): CanonicalTrajectoryAnnualPoint[] => {
  const closingDateByYearMonth = new Map<string, string>();
  for (const month of report.months) {
    closingDateByYearMonth.set(month.yearMonth, month.closingDate);
  }

  const points: CanonicalTrajectoryAnnualPoint[] = [];
  for (const year of report.years) {
    const closingDate = closingDateByYearMonth.get(year.lastYearMonth);
    if (closingDate === undefined) continue;
    points.push({
      calendarYear: year.year,
      closingDate,
      netWorthCents: year.closing.netWorthCents,
      accountAssetsCents: year.closing.accountCents,
      liabilityCents: year.closing.liabilityCents
    });
  }
  return points;
};

/**
 * Copies a run's metadata into the required canonical context. Every field is
 * taken verbatim from {@link ProjectionRunMetadata}; nothing is inferred,
 * defaulted or invented.
 */
export const canonicalContextFromRunMetadata = (metadata: ProjectionRunMetadata): CanonicalTrajectoryContext => ({
  measurement: metadata.measurement,
  startDate: metadata.startDate,
  endDate: metadata.endDate,
  schemaVersion: metadata.contextSchemaVersion,
  engineRevision: metadata.engineRevision,
  ...(metadata.contextId === undefined ? {} : { contextId: metadata.contextId })
});
