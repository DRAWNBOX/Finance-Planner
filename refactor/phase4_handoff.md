# Phase 4 Handoff — Authoritative Audit, Reports and Display Adapters

Status: **Phase 4 is implemented only to its scoped exit criteria (ADR-022, intermediate
breakage authorized). It is not a runnable release.** The authoritative audit/reporting
stack, the display-dollars adapter, the trajectory-freeze layer and the migrated
chart/table/history components exist and pass their focused suites; the App still does not
compile and is **not** wired to them. `App.tsx`, the old `CareerPlanEditor.tsx`,
`financeModel.ts` and `src/utils/dateMarkers.test.ts` remain the **unrewired** legacy
surfaces and stay **broken**; `App.test.tsx` and `dateMarkers.test.ts` stay **red**. The
App/build/full suite are recorded, never treated as passing. This document records the
actual state and the owning later tasks (P5.2/P5.4, P6, P7) — it does **not** assert full
App/GUI acceptance (GUI-A08/A10), a passing whole suite or build, or performance evidence.

Authority: `phase4_plan.md` (P4.1–P4.7, D15–D20), builds on `frozen_contracts.md`
(P0.3.1 item 11 audit rows, P0.3.2 event/posting phases, P0.3.3 funding/partial policy,
P0.3.4 cents/rounding, P0.5.1–P0.5.5), ADR-021/ADR-022, `phase1_handoff.md`
(codec/commands/history), `phase2_handoff.md` (kernel + `ProjectionRun`) and
`phase3_handoff.md` (feature streams + `projectFeatureScenario`). Coverage rows are updated
in `coverage_register.md`.

> **Count provenance.** The engine figure below (**517/517**, 19 files; `reporting` 26)
> and the UI/adapter/history figure (**67/67**) are the **post-hardening final verifier
> gates**; they are **not** a whole-suite or build claim. The final verifier also recorded the
> selected extra subset (**`viewAdapters` 38 + `trajectoryFreeze` 14 + `codec` 55 + `storage`
> 12 = 119/119**, 4 files), the whole suite **759 pass / 91 fail (850 total)** — failures only
> in `App.test.tsx` (81) and `dateMarkers.test.ts` (10) — and the build **182 TS errors** (none
> in any Phase-4 source). No full end-to-end per-posting **deficit** tally was produced — the
> focused reporting suite asserts reconciliation and join integrity on its fixtures only
> (see §4.3), and no broader audit-deficit inventory is claimed.

---

## 1. Scoped exit criteria vs. actual state

| `phase4_plan.md` exit criterion | Actual state |
|---|---|
| 1. Focused reporting/adapter/component suites pass in isolation (`reporting`, `viewAdapters`, the three migrated chart/table components). | Met at the focused level: engine directory **517/517** across 19 files (`reporting` 26) and the P4 UI/adapter/history suites **67/67** (§4). No App/build/full-suite claim. |
| 2. One complete, non-truncated audit: every committed posting appears exactly once and joins to its funding plan; `closing = opening + Σ postings`; assets − liabilities = signed net worth each month. | Met by construction and tested on the reporting fixtures: `PostingJournal` is append-only; `reporting.ts` scans `run.postings` once and joins committed plans by `occurrenceId`; a rejected commit journals nothing; each month replays committed deltas onto the opening observation. |
| 3. Warning language is exact (D16); shortfall, eligible-exhaustion and fallback are distinct selectors. | Met: `reporting.test.ts` pins the exact shortfall prefix/phrase, the exhaustion phrase, and fallback as a separate low-severity signal. |
| 4. All previews expose the same context/units/date/actual-funded result; no double-counting; current-dollar factor consistent across table/chart/tooltip. | Met at the **selector/adapter/component** level (`ReportPreviews`, `viewAdapters`, migrated components + focused tests). App-mounted CA12/GUI-A08/A10 remain **P5.4** — not claimed. |
| 5. Removed/impaired consumers and restoring owners recorded, never treated as passing. | Met: §10. |

Phase 4 exit does **not** assert a runnable App, full suite, build, GUI-A08/A10, or combined
cross-feature behavior (P5) — ADR-022.

---

## 2. Locked decisions (D15–D20), accepted rules

- **D15 — Complete posting journal at the sole mutation point.** Implemented in
  `src/engine/journal.ts`. `EngineState.commitChanges` is the only balance mutation entry
  point; on every **nonempty** successful commit it appends one `PostingRecord`
  (`revision`, stable 0-based `sequence`, the `PostingContext`, sparse account/liability/
  property deltas, `expectedNetWorthDeltaCents`) and exposes `getPostings()`
  (`getPostingsByMonth`/occurrence/definition/account indexes too). A meaningful commit
  missing its posting is rejected with a `missing-posting` error, **no mutation and no
  journal row**; an empty/zero-delta set journals nothing. `PostingContext` =
  `{ occurrenceId?, definitionId?, purpose, date, phase }` with `phase` from
  `POSTING_PHASES` (`accrual`/`income`/`cap`/`mandatory`/`discretionary`/`close`/`opening`).
  Records and nested arrays are deep-frozen so a caller cannot rewrite the audit. The
  facade copies `state.getPostings()` into the frozen `ProjectionRun.postings`.
- **D15 — Payroll facts.** Payroll is the one mixed commit whose legs cannot be recovered
  from net account deltas. Its `PostingContext.facts` (`PostingFlowFacts`) carries the
  executed `grossEarningsCents`, `netPayCents`, `payrollTaxCents`, `otherDeductionsCents`,
  employee retirement/HSA deposits, employer retirement/HSA deposits,
  `unresolvedEmployeeCents` (employee deduction retained in the remainder because its
  destination was missing — never relabeled net pay) and per-line requested/executed
  allocations. `postingFactsProblem` enforces gross conservation
  `gross = netPay + payrollTax + otherDeductions + employeeDeposited + unresolvedEmployee`
  and bounds the executed allocation total to net pay. Funding/accrual/valuation postings
  carry no facts. Withdrawal tax/penalty are sourced **only** from committed
  `FundingAllocation`, never payroll tax.
- **D16 — Shortfall vs eligible-exhaustion predicate.**
  - Completeness shortfall: any funding outcome with `shortfallCents > 0`; exact language
    `"Some scheduled payments could not be fully funded, beginning in [YYYY-MM]."`
    (`ReportShortfall`).
  - Eligible exhaustion: a month whose short requests are **all** pure (not quota-limited,
    at least one eligible source, every eligible source observed at balance `0`, and the
    only skip reason `zero-balance`). Phrase `"eligible funding accounts exhausted"`
    (`ReportExhaustion`). A policy/ineligible/quota shortfall is never exhaustion.
  - Fallback (a source beyond the configured primary was used) is a separate low-severity
    signal (`"funding fell back to a secondary source"`, `ReportFallback`), never conflated
    with shortfall or exhaustion.
- **D17 — Reporting modules and adapter layout.** One file per responsibility, same-named
  `.test.ts`; runtime reporting is integer cents; dollars/deflation are UI-only (see the
  module table in §3).
- **D18 — One date-based current-dollar deflation factor.** `viewAdapters.ts`:
  `factor(t) = (1 + annualInflationRatePercent/100)^(t/12)`, where `t` is the date-only
  calendar-month coverage from the opening observation to the closing observation including
  the clipped partial first/last month. `0`/disabled ⇒ identity; a full calendar year
  compounds to exactly the stated rate. One factor per observation date; nominal run is
  immutable and the adapter returns a parallel deflated view.
- **D19 — Component migration scope (App wiring deferred).** `ChartPanel`,
  `SavingsStackedChart` and `ResultsTable` now import `ProjectionReport` from
  `engine/reporting` and `displayObservedCents` from `utils/viewAdapters` — **no legacy
  `ProjectionResult`/pool types**. `App.tsx` still passes legacy props and is **P5.2/P5.4**.
- **D20 — Trajectory/history freeze metadata.** `trajectoryFreeze.ts` +
  `types.ts` `ResultContextMetadata`/`MeasurementBasis`. `netWorth.history` entries keep
  their explicit `measurement` (legacy ⇒ `assetOnly`); a signed net-worth series is
  distinct; comparison is gated on matching `measurement`/`engineRevision`/`schemaVersion`
  and refuses legacy/incomplete contexts. Old asset-only history is never reinterpreted as
  signed net worth.

---

## 3. Completed task IDs, modules and focused counts

| Task | Module | Test | Owns |
|---|---|---|---|
| P4.1 | `src/engine/journal.ts` | (covered by `state.test.ts` / `reporting.test.ts` / `projection.test.ts`) | immutable `PostingJournal`, `PostingContext`/`PostingRecord`/`PostingFlowFacts`, append-only indexes; `commitChanges` posting contract; `ProjectionRun.postings` |
| P4.1 | `src/engine/reporting.ts` | `reporting.test.ts` | read-only audit join (plans + postings), stable indexes, query methods |
| P4.2 | `src/engine/reporting.ts` | `reporting.test.ts` | monthly/annual closes, per-entity reconciliation, signed net worth, run totals |
| P4.3 | `src/engine/reporting.ts` | `reporting.test.ts` | shortfall / exhaustion / fallback, budgets, occurrences, careers, retirement, schedules, previews |
| P4.4 | `src/utils/viewAdapters.ts` | `viewAdapters.test.ts` | cents→dollars, D18 deflation factor, signed-series/re measurement helpers, named-context metadata |
| P4.5 | `src/components/ChartPanel.tsx` | `ChartPanel.test.tsx` | migrate to `ProjectionReport` selectors + adapters |
| P4.5 | `src/components/SavingsStackedChart.tsx` | `SavingsStackedChart.test.tsx` | migrate to `ProjectionReport` selectors + adapters |
| P4.5 | `src/components/ResultsTable.tsx` | `ResultsTable.test.tsx` | migrate to `ProjectionReport` yearly/monthly selectors + adapters |
| P4.6 | `src/trajectoryFreeze.ts` (S) | `trajectoryFreeze.test.ts` | D20 freeze metadata factory + comparison gate |
| P4.6 | `src/components/NetWorthHistoryChart.tsx` | `NetWorthHistoryChart.test.tsx` | signed history vs labeled legacy asset-only |
| P4.6 | `src/components/TrajectoryComparisonChart.tsx` | `TrajectoryComparisonChart.test.tsx` | frozen trajectory comparison gated by `compareTrajectoryContexts` |
| P4.6 | `src/types.ts` / `src/codec.ts` | `codec.test.ts` | `MeasurementBasis`, `ResultContextMetadata`, `NetWorthHistoryEntry.measurement`, `TrajectorySnapshot.context`; load-time context normalization |

`journal.ts` has no dedicated `.test.ts`; its D15 contract is pinned by
`state.test.ts` (posting-journal contract block), `reporting.test.ts` and
`projection.test.ts`.

---

## 4. Focused evidence

### 4.1 Engine focused suite (19 files) — **517/517**

Command: `npx vitest run src/engine`

`it()` counts by file: `state` 51, `income` 45, `funding` 40, `configuration` 39,
`housing` 37, `loans` 33, `projection` 33, `spending` 30, `retirement` 28, `taxes` 27,
`valuation` 23, `dates` 21, `reporting` 26, `planner` 20, `cards` 17, `money` 17,
`scheduler` 17, `opening` 7, `featureHandlers` 6 = **517**.

Phase 3's total was 397/397 (18 files); Phase 4 adds `reporting` (now 26 after oracle
hardening), grows `state` (posting journal) and `projection` (postings/funding-outcome
capture).

Oracle hardening added to `reporting.test.ts` (P4.3): the full-horizon posting-integrity
checks — `report.postingCount === run.postings.length` and
`reconciledPostingCount === postingCount` over the deterministic deep-frozen 960-month
fixture — plus a diagnostic test that the **summed monthly `netWorthDeltaCents` must equal
`closing − opening`** (never a silent pass); liability deltas are classified by **purpose**
(a same-phase sale/completion delta that raises debt is not treated as accrual interest); a
bad or reversed query window is **rejected with a diagnostic** rather than silently returning
`[]`; an irregular partial-boundary cadence is `unknown`/`unreliable`; and the D16 exhaustion
selector **stays conservative for any month mixed with a policy/ineligible shortfall** (an
all-short-pure month is required).

### 4.2 P4 UI / adapter / history focused suites — **67/67**

Command: `npx vitest run src/utils/viewAdapters.test.ts src/trajectoryFreeze.test.ts src/components`

- `viewAdapters.test.ts` 38, `trajectoryFreeze.test.ts` 14.
- Migrated components: `ChartPanel` 3, `SavingsStackedChart` 3, `ResultsTable` 4,
  `NetWorthHistoryChart` 2, `TrajectoryComparisonChart` 3 = 15.
- Total **67** (`38 + 14 + 15`). These tests render from a `ProjectionReport`/adapters and
  prove the components carry no local financial simulation and no legacy result types.
  (The 8 Phase-3 paired-editor suites — `42/42` — are unchanged; the whole
  `src/components` directory is **57/57** across 13 files.)

Hardening added here (P4.4/P4.6): `viewAdapters.test.ts` proves `elapsedMonthCoverage` is
**O(1) in horizon length** (a constant number of `daysInMonth` touches for a 1-month vs a
960-month span) and a **960-point × 100-account deflation regression** matches sampled
factors to independently computed references for every account (strictly increasing across
the horizon, identity when inflation is zero/disabled); `trajectoryFreeze.test.ts` adds
**D20 malformed freeze-date handling** — a nonempty-but-malformed date is classified
legacy/incompatible (never modern) and a reversed date range is refused.

### 4.3 CA02 / CA12 reporting subset (focused, not full acceptance)

| CA | Task | Focused source of proof | Status |
|---|---|---|---|
| CA02 | P4.2/P4.7 | `reporting.test.ts`: replays opening + committed deltas to each month close; a mismatch is a **diagnostic** (never clamped); property/held-deposit/debt reconcile exactly once; signed net worth stays negative; annual = Σ actual months (never last month × 12); age groups only with a reliable anchor; 960-month fixture builds a deterministic, deep-frozen report with stable O(1) indexes and full-horizon `postingCount`/`reconciledPostingCount` integrity; Σ monthly `netWorthDeltaCents` must equal `closing − opening`; debt interest classified by **purpose**; audit deltas exposed verbatim. | **P4-scoped (partial)** focused subset |
| CA12 | P4.4/P4.5/P4.7 | `viewAdapters.test.ts`: `(1+r)^(t/12)`, partial-month exponent, identity when disabled/0, negative preserved, one factor per observation date, annual row = monthly tooltip basis, `elapsedMonthCoverage` O(1) in horizon length, 960-point × 100-account deflation regression. `reporting.test.ts`: revision/date-keyed actual-funded previews with default **signed net worth** + account-assets view; exact shortfall-vs-exhaustion warnings; fallback separate; bad/reversed window rejection. `trajectoryFreeze.test.ts`: D20 malformed/reversed freeze-date handling. `ChartPanel`/`SavingsStackedChart`/`ResultsTable`/`NetWorthHistoryChart`/`TrajectoryComparisonChart` focused tests. | **P4-scoped (partial)** reporting subset only |

**App-mounted CA12 and GUI-A08/A10 are P5.4 and are NOT claimed here.**

### 4.4 P4 public API (frozen names)

- `engine/journal.ts`: `PostingJournal`, `PostingContext`, `PostingRecord`, `PostingDraft`,
  `PostingFlowFacts`, `PostingFlowAllocation`, `PostingPhase`, `POSTING_PHASES`,
  `postingContextProblem`, `postingFactsProblem`, `postingMonth`.
- `engine/reporting.ts`: `buildProjectionReport(run, options?)`, `REPORTING_SCHEMA_VERSION`,
  `ProjectionReport` (+ `ReportAuditRow`, `ReportOutcomeRow`, `ReportMonthClose`,
  `ReportYear`, `ReportAgeGroup`, `ReportFlow`, `ReportStockTotals`, `ReportShortfall`,
  `ReportExhaustion`, `ReportFallback`, `ReportBudgets`, `ReportOccurrenceCounts`,
  `ReportCareerBoundary`, `ReportRetirement`, `ReportSchedule`, `ReportPreviews`, …).
- `utils/viewAdapters.ts`: `toDollars`, `tryToDollars`, `elapsedMonthCoverage`,
  `resolveDeflation`, `deflationFactor`, `deflateDollars`, `deflateCents`,
  `displayObservedCents`, `displayObservedCentsSeries`, `measurementValueCents`,
  `displayMeasurementCents`, `displayContextFromRunMetadata`,
  `displayContextFromResultContext`.
- `trajectoryFreeze.ts`: `createFrozenTrajectorySnapshot`, `hasCompleteTrajectoryContext`,
  `isLegacyTrajectoryContext`, `isLegacyTrajectorySnapshot`, `compareTrajectoryContexts`,
  `areTrajectoriesComparable`, `frozenContextFromRunMetadata`.

---

## 5. Complete postings, funding outcomes and payroll facts (P4.1)

- `reporting.ts` performs **one** scan of `run.postings` and builds the `audit` plus all
  indexes (`byOccurrence`, `byDefinition`, `byPurpose`, `byAccount`, `byFundingSource`,
  `byMonth`, `byDateWindow`); indexes are frozen and returned by reference — a query never
  clones the global posting list.
- **One committed funding plan ↔ one audit row**, joined by `occurrenceId`; a direct
  no-plan commit (income/cap/accrual/appreciation/sale/valuation) is a `kind: 'direct'`
  row with no plan. An **uncommitted** funding quote produces **no** audit row — it is
  recorded independently in `run.fundingOutcomes` and surfaced as a `ReportOutcomeRow`
  (requested/shortfall/eligible balances/skipped reasons), so unfunded demand is never
  lost or fabricated into a posting.
- Join-integrity diagnostics are recorded (a plan with no posting, a committed outcome
  with no posting, a posting whose outcome was uncommitted), never silently dropped.

## 6. Monthly/annual reconciliation and stock-flow (P4.2)

- Per month the report replays the sparse committed deltas onto the opening observation
  and requires `closing = opening + Σ committed deltas` for each **account**, **liability**
  (principal / accrued interest / fees), **property value** and **held acquisition
  deposit**; a mismatch is reported as a diagnostic. Aggregate totals are recomputed from
  the closing snapshot as `assets = account + property + held deposit` and
  `netWorth = assets − liabilities` (**signed**).
- Monthly flow facts use actual stamped data: payroll legs from `PostingFlowFacts`;
  withdrawal `taxesPaid`/`penaltiesPaid` only from committed `FundingAllocation` (payroll
  withholding is never double-counted); requested spend from `run.fundingOutcomes`
  (incl. zero-fund quotes); executed spend from committed plans only; debt
  principal/interest from committed liability deltas; appreciation from committed property
  deltas; account growth from the month-close valuation deltas.
- **Annual** groups are the actual calendar-year months: flow fields are the safe-cent sum
  of the months, stock fields are the **first opening / last closing** observation (never a
  sum). Optional age grouping is emitted only with a reliable `dateOfBirth` anchor and is
  labeled separately (`kind: 'age'`).

## 7. Selectors: shortfall / exhaustion / fallback (P4.3)

Pure selection over the frozen run (no financial calculation): `shortfall`, `exhaustion`
and `fallback` per D16; `budgets` (requested-vs-executed by **observed** period kind and by
definition — ambiguous cadence is `unknown`/`reliable: false`, never guessed);
`occurrences` (scheduled-vs-executed counts); `careers` (observed from `income:*` payroll
postings only); `retirement` (per funding-source account); `schedules` (from actually
posted evidence with payoff from reconciled liability closes); `previews` (CA12 subset).
Fields the frozen run cannot supply (recurrence specs, scheduled occurrence ids, configured
career/pay-plan boundaries) are listed in `ProjectionReport.unverifiable`, never invented.

## 8. Display dollars (P4.4)

`viewAdapters.ts` is the single, pure boundary from cents-only engine output to display
dollars: exact `cents / 100` (no pre-deflation rounding), the one D18 factor per observation
date, signed/unclamped observed-cents helpers, named-context metadata, and measurement
selection (`assetOnly` / `accountAssets` / signed `assetsMinusLiabilities`). Nominal results
are immutable; the deflated view is derived without re-running finance. Invalid
dates/rates return explicit diagnostics rather than `NaN`/`Infinity`.

## 9. Migrated components and D20 freeze (P4.5/P4.6)

- `ChartPanel`, `SavingsStackedChart`, `ResultsTable` consume `ProjectionReport` +
  `viewAdapters`; each has a focused `.test.tsx` that builds a report from adapters (no
  legacy types, no local simulation).
- `NetWorthHistoryChart` renders the selected `MeasurementBasis` series (legacy
  `assetOnly` labeled separately from signed net worth; never shares a scale).
- `TrajectoryComparisonChart` gates the saved trajectory via `compareTrajectoryContexts`
  and shows a status message when a snapshot is legacy/incompatible.
- `trajectoryFreeze.ts` freezes `{ schemaVersion, engineRevision, measurement, startDate,
  endDate, date }` from the run metadata (no wall clock), deep-clones years and deep-freezes
  the snapshot; the factory output is byte-stable across save/load.

---

## 10. Removed/impaired consumers and restoring owners

None are treated as passing; each has an owning later task. Phase 4 **migrated**
`ChartPanel`/`SavingsStackedChart`/`ResultsTable`/`NetWorthHistoryChart`/
`TrajectoryComparisonChart`, so `SavingsStackedChart` is no longer a pool-era consumer.

| Impaired surface | Remaining legacy consumer | Restoring owner |
|---|---|---|
| Legacy `ProjectionResult` aliases / pool-era props (`years`/`summary`/`monthlySnapshots`/`pools`/`bankAccounts`) and dollar-shaped results | `src/App.tsx` (imports the migrated components but passes legacy props), `src/components/CareerPlanEditor.tsx` | P5.2 UI + P5.4 acceptance |
| Pool/account/pool-era types (`BankAccountDefinition`/`PoolDefinition`/`poolId`) | `src/App.tsx`, `src/components/CareerPlanEditor.tsx`, `src/financeModel.ts` | P5.2 UI; removal P7.1/P7.2 |
| Paired editors not wired into the App | standalone editor components | P5.2/P5.4 |
| `src/utils/dateMarkers.test.ts` (imports removed `defaultScenario` singleton) | test + build gate | P5.5 (tests), P5.2/P7 (build) |
| Reporting present but **not App-mounted** (`buildProjectionReport` unused by `App.tsx`) | views | P5.2/P5.4 |
| Audit/transport/warning performance evidence absent | — | **P6** (`PS07`/`PS15`/`PS16`, B-P2/B-P4/B-P7) |

The audit stack is complete (no truncation) by design; Phase 6 measures audit bytes (`PS07`)
but P4 keeps the trace complete.

## 11. Full suite / build status

| Check | Result (post-hardening final verifier) |
|---|---|
| Focused engine suite (19 files) | **517 pass / 0 fail** |
| P4 UI/adapter/history suites | **67 pass / 0 fail** |
| Selected extra subset (`viewAdapters` + `trajectoryFreeze` + `codec` + `storage`) | **119 pass / 0 fail** (4 files; 38 + 14 + 55 + 12) |
| `src/App.test.tsx` + `src/utils/dateMarkers.test.ts` (isolated) | **3 pass / 91 fail** (94 total) — legacy `ProjectionResult`/pool-era UI + removed `defaultScenario` singleton |
| Whole suite (`npm run test -- --run`) | **759 pass / 91 fail** (850 total) — failures only `App.test.tsx` (81) + `dateMarkers.test.ts` (10) |
| `npm run build` | **182 TS errors** — `App.tsx` 168, `ExpensesPlanner` 7, `CareerPlanEditor` 5, `dateMarkers` 1, `financeModel` 1; **none in any Phase-4 engine/adapter/component module** |

The App/dateMarkers failures and the build breakage are downstream P5/P7 work (legacy P5
imports), recorded accurately and **not** claimed as fixed. The post-hardening whole suite
**759 pass / 91 fail (850)** and build **182 TS errors** are the final verifier's exact gates.
No App-mounted P5 GUI acceptance is claimed.

## 12. Preserved historical evidence and data

- `refactor/fixtures/projection.pre-refactor.snap` — present and untouched.
- `src/engine/__snapshots__/projection.characterization.test.ts.snap` — the orphan snapshot
  for the deleted Phase-2 characterization test remains present and unchanged.
- `netWorth.history` entries retain their explicit `measurement` (legacy ⇒ `assetOnly`);
  signed net worth is a distinct series and old asset-only history is never reinterpreted.
- Frozen trajectory snapshots are deep-frozen, byte-stable across save/load, and refuse
  comparison on a `measurement`/`engineRevision`/`schemaVersion` mismatch.

## 13. Non-claims

This handoff does **not** claim: a runnable App, a passing whole suite or build, full
App/GUI acceptance (GUI-A08/A10), the App-mounted CA12 subset, combined cross-feature
behavior (P5), or any PS/B-P performance benchmark evidence (P6). It claims only the focused
Phase 4 audit/adapter/component suites and the D15–D20 pins recorded above. Phase 4 exit
does not assert a runnable release (ADR-022).

## 14. Gate counts (post-hardening final verifier)

| Gate | Observed value | Owner |
|---|---|---|
| Engine focused suite | **517 / 517** (19 files; `reporting` 26) | final verifier (post-hardening) |
| P4 UI/adapter/history suites | **67 / 67** (38 + 14 + 15) | final verifier (post-hardening) |
| Selected extra subset | **119 / 119** (4 files; `viewAdapters` 38 + `trajectoryFreeze` 14 + `codec` 55 + `storage` 12) | final verifier (post-hardening) |
| Phase-3 paired editors (unchanged) | 42 / 42 (8 files) | parent |
| `App.test.tsx` + `dateMarkers.test.ts` (isolated) | 3 pass / 91 fail (94) | final verifier (post-hardening) |
| Whole suite (`npm run test -- --run`) | **759 pass / 91 fail** (850 total) — only `App.test.tsx` (81) + `dateMarkers.test.ts` (10) | final verifier (post-hardening) |
| Build (`npm run build`) | 182 errors (App 168, `ExpensesPlanner` 7, `CareerPlanEditor` 5, `dateMarkers` 1, `financeModel` 1); none Phase-4 source | final verifier (post-hardening) |
| CA02 | P4-scoped focused subset | parent |
| CA12 | P4-scoped reporting subset (App/GUI-A08/A10 = P5) | parent |
| GUI-A08 / GUI-A10 | **not claimed** — App UI acceptance P5.4 | P5 |

> **Final P4 scoped exit.** Phase 4 exits only on the focused criteria above: the 19-file
> engine suite, the 67-test P4 UI/adapter/history set, and the D15–D20 pins. It does
> **not** assert a runnable App, a passing full suite or build, GUI-A08/A10, the
> App-mounted CA12 subset, or combined cross-feature behavior (P5). The failing
> App/dateMarkers tests and build errors above are recorded accurately and are not claimed
> as passing.
