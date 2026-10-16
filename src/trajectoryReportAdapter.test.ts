import { describe, expect, it } from 'vitest';

import type { ProjectionRunMetadata } from './engine/projection';
import {
  canonicalAnnualPointsFromReport,
  canonicalContextFromRunMetadata,
  type TrajectoryReportSource
} from './trajectoryReportAdapter';

/**
 * P5 / D20 focused tests for the canonical trajectory report adapter. Cover the
 * exact year-close stock mapping (account assets / liabilities separate, signed
 * net worth preserved), close-date resolution with no fabrication, context
 * verbatim copying and input immutability.
 */

const report = (overrides: Partial<TrajectoryReportSource> = {}): TrajectoryReportSource => ({
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
  ],
  ...overrides
});

const runMetadata = (overrides: Partial<ProjectionRunMetadata> = {}): ProjectionRunMetadata => ({
  engineRevision: 'p2.7-kernel-1',
  contextSchemaVersion: 2,
  contextId: 'ctx-1',
  timelineId: null,
  timelineLabel: 'Base',
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

describe('canonicalAnnualPointsFromReport (P5 / D20)', () => {
  it('maps each actual report year-close stock to an exact cents point', () => {
    expect(canonicalAnnualPointsFromReport(report())).toEqual([
      { calendarYear: 2026, closingDate: '2026-12-31', netWorthCents: 150000, accountAssetsCents: 200000, liabilityCents: 50000 },
      { calendarYear: 2027, closingDate: '2027-12-31', netWorthCents: -2500, accountAssetsCents: 175000, liabilityCents: 177500 }
    ]);
  });

  it('preserves signed negative net worth without clamping', () => {
    const points = canonicalAnnualPointsFromReport(report());
    expect(points[1].netWorthCents).toBe(-2500);
  });

  it('keeps account assets and liabilities separate (never collapsed into net worth)', () => {
    const [first] = canonicalAnnualPointsFromReport(report());
    expect(first.accountAssetsCents).toBe(200000);
    expect(first.liabilityCents).toBe(50000);
    expect(first.netWorthCents).toBe(first.accountAssetsCents - first.liabilityCents);
  });

  it('omits a year with no matching month close rather than fabricating a date', () => {
    const points = canonicalAnnualPointsFromReport(
      report({ months: [{ yearMonth: '2026-12', closingDate: '2026-12-31' }] })
    );
    expect(points.map((point) => point.calendarYear)).toEqual([2026]);
  });

  it('uses the actual month-close date for a partial final year', () => {
    const points = canonicalAnnualPointsFromReport(
      report({
        years: [{ year: 2026, lastYearMonth: '2026-06', closing: { netWorthCents: 1, accountCents: 2, liabilityCents: 1 } }],
        months: [{ yearMonth: '2026-06', closingDate: '2026-06-15' }]
      })
    );
    expect(points[0].closingDate).toBe('2026-06-15');
  });

  it('does not mutate its input', () => {
    const source = report();
    const before = JSON.stringify(source);
    canonicalAnnualPointsFromReport(source);
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe('canonicalContextFromRunMetadata (P5 / D20)', () => {
  it('copies every field verbatim from the run metadata', () => {
    expect(canonicalContextFromRunMetadata(runMetadata())).toEqual({
      measurement: 'assetsMinusLiabilities',
      startDate: '2026-01-15',
      endDate: '2046-01-15',
      schemaVersion: 2,
      engineRevision: 'p2.7-kernel-1',
      contextId: 'ctx-1'
    });
  });

  it('omits contextId when the run has none and never invents one', () => {
    const context = canonicalContextFromRunMetadata(runMetadata({ contextId: '' }));
    expect(context.contextId).toBe('');
    const metadata = runMetadata();
    // An absent contextId must not become a fabricated value.
    const absent = canonicalContextFromRunMetadata({ ...metadata, contextId: undefined as unknown as string });
    expect(absent).not.toHaveProperty('contextId');
  });

  it('preserves a valid 0 schema version', () => {
    expect(canonicalContextFromRunMetadata(runMetadata({ contextSchemaVersion: 0 })).schemaVersion).toBe(0);
  });

  it('does not mutate the metadata it reads', () => {
    const metadata = runMetadata();
    const before = JSON.stringify(metadata);
    canonicalContextFromRunMetadata(metadata);
    expect(JSON.stringify(metadata)).toBe(before);
  });
});
