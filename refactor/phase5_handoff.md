# Phase 5 Handoff — Integrated Candidate (P5.1–P5.5)

Status: **Phase 5 is a runnable integrated candidate for Phase-6 measurement, not a release.**
P5.1–P5.3 integration, save cutover and autosave are implemented. P5.4 real-render App
tests and P5.5 headless cross-feature tests pass. The complete local suite and build pass;
an independent final invariant review subsequently **passed**. An earlier verifier
attempt failed for Insufficient Balance; the later independent review ran normally.
A bounded Chromium browser gate (33 tests) now passes as well (§13), but it is
slice-level, not CI-wired, and does not certify the matrix. The per-G01–G40
browser ledger is `refactor/gui_browser_coverage.md`.
The GUI-A01–A10/G01–G40 matrix has not been certified row by row, and Phase-6 browser
measurements and Phase-8 release gates remain open, per ADR-022.

Authority: `refactor/phase5_plan.md` (P5.1–P5.5, D21–D26), builds on `phase1_handoff.md`
(codec/commands/hydration), `phase2_handoff.md` (kernel + `projectScenario` facade),
`phase3_handoff.md` (feature streams + standalone editors), `phase4_handoff.md`
(reporting/adapters, D15–D20), `frozen_contracts.md`, ADR-021/ADR-022 and the accepted
registers `refactor/gui_compatibility_audit.md` (GUI-A01–A10 / G01–G40) and
`refactor/testing_correctness_audit.md` (CA01–CA13 / TC01–TC13). Coverage rows are updated in
`refactor/coverage_register.md`. The B01–B09 target table is `refactor/phase5_before_after.md`
(original fixture untouched — §9).

> **Latest independently reproduced gates (October 15, 2026).** `npm run test -- --run --reporter=default`:
> **55 files / 1073 tests passed, 0 failed** (including `src/App.test.tsx` **43/43**;
> `HousingEditor.test.tsx` **8/8**, `HousingResults.test.tsx` **1/1**, `phase5Acceptance.test.ts` **6/6** and
> `phase5CrossFeature.test.ts` **27/27**). `npm run build`: TypeScript and Vite pass,
> 100 modules transformed; one non-fatal 624.57 kB JS chunk-size advisory (175.06 kB gzip JS / 84.04 kB CSS).
> `git diff --check` passes. A separate bounded Chromium browser gate
> (`npm run test:e2e -- --project=chromium`) now passes **33/33** (42.7s) — see §13.
> The per-G01–G40 browser ledger is `refactor/gui_browser_coverage.md`.
> The Phase-4 baseline (759 pass / 91 fail; 182 TS errors)
> and earlier 981/1011/1016/1030/1043/1051/1062/1064/1067-test Phase-5 tallies are **superseded**. The independent verifier
> ran these gates (43.94s suite) and reviewed nullable `sourceSign` round trips,
> source/import provenance and earlier CA06/planner/D16/CA01/D26/cap invariants;
> an earlier verifier also checked the preserved fixture SHA-256. This is **not**
> a production-browser measurement or row-by-row GUI/CA matrix sign-off.

---

## 1. Scoped exit criteria vs. actual state

| `phase5_plan.md` exit criterion | Actual state at write time |
|---|---|
| 1. One integrated candidate: App routes through canonical commands and one `projectFeatureScenario`; no independent preview loop or mixed old/new math displayed. | **Met in local tests.** `App.tsx` routes mutations through commands and one selected `projectFeatureScenario`; `App.test.tsx` passes 43/43. |
| 2. Coverage flags truthful (D23): `processors`/`reporting` true, deferred empty, `complete` true only when fully covered. | **Met at the engine level** (`phase5Acceptance.test.ts`): raw facade stays `false`/deferred; composed call site is `true`/`[]`/`complete`; a partial window stays incomplete. |
| 3. Save cutover (D24): prune approved obsolete fields (incl. `paycheckInfo`) across all plans; hydration/recovery/reset/autosave/flush and diagnostics correct; no live audit/cache/calculated-balance persisted. | **Met in local tests:** schema version **3**, autosave controller, save/reload/reset/blocked-write/pagehide App slices and grouped housing policy round trips. |
| 4. GUI-A01–A10 and G01–G40 pass; CA01–CA13 and the B01–B09 before/after table documented with preserved snapshots. | **Partially evidenced:** `phase5CrossFeature` 27/27; App 43/43; career overlap/cap/duplicate, CA06 adaptive 0% payoff, D26 posting reconciliation, planner weekly outcomes/monthly close, partial PI, three-view current dollars, purchase funding and marker precision; B01–B09 table and hash verified independently (§9). GUI/CA gap audits identified unasserted branches; the verifier confirmed invariants but **did not** certify every row. |
| 5. Remaining whole-suite/build failures and owners recorded honestly; runnable candidate for Phase 6. | **Local and independent gates pass** (1073/1073, build, diff check) and a bounded Chromium gate passes 33/33 (§13); Phase-6 browser/performance measurement and Phase-8 release gates remain. |

Phase 5 exit does **not** assert a release (ADR-022).

---

## 2. Locked engineering decisions (D21–D26)

- **D21 — `App.tsx` becomes commands + named contexts + rendering.** Implemented: every
  scenario mutation routes through `createConfigurationCommands()`; exactly one
  `projectFeatureScenario` call selects one named timeline; views read the shared
  `ProjectionReport` selectors. No independent payoff/amortization/balance preview loops
  survive. Removed-symbol imports (`calculateAgeFromBirthDate` / `describeIncomeValidationGroup` /
  `resolveCurrentAge`) are gone.
- **D22 — Editor mounting and empty/no-career states.** Implemented: the P3 standalone editors
  mount at their tab placements, bound to canonical commands; a no-career plan renders its
  chart/table/warnings and an explicit empty state. Selected timeline/pay-plan, markers,
  deletion cleanup and stale modal state resolve from the canonical registry.
- **D23 — Truthful coverage flip.** Implemented via `ProjectionCoverageClaim`
  (`src/engine/projection.ts`): the raw facade never invents coverage; a composed call site
  supplies `{ processors: true, reporting: true, deferred: [] }` and the facade honours it only
  when the run covers the full requested horizon and nothing was blocked. A partial
  `scheduleWindow` or a dropped handler keeps the run honestly incomplete. Details in §3.
- **D24 — Save-format cutover and pruning.** Implemented: `CURRENT_SCHEMA_VERSION = 3` prunes
  the derived flat `CareerEntry.paycheckInfo` (granular `paycheck` is authority, re-derived on
  load) across base + timelines + pay plans + import + UI; canvas caches/expanded recurrences/
  calculated balances are never persisted; autosave coalesces writes and flushes on `pagehide`.
  Details in §5.
- **D25 — Warning rendering (reuses D16).** Implemented: the Warnings tab and row indicators
  render the D16 selectors verbatim (`report.shortfall.warning`, `report.exhaustion`,
  `report.fallback.occurrences`); fallback (yellow) is never reported as shortfall (red) or
  exhaustion.
- **D26 — Cross-feature contention fixture.** Implemented in
  `src/engine/phase5Acceptance.test.ts`: one fixed-date scenario where payroll, an ordinary
  card, a rent group, a loan installment, retirement spending, a planner recurrence and a
  discretionary purchase compete for the same account in the same month, with hand-computed
  expected shortfalls (never read back from output). Details in §3.

---

## 3. P5.1 — single integrated orchestration (K + integration owner)

`projectFeatureScenario` (`src/engine/featureHandlers.ts`) is the one projection path. It
selects exactly one named timeline, compiles one canonical context, assembles all four streams'
definitions + handlers, delegates to `projectScenario` with the call-site coverage claim, and
builds **exactly one** immutable `buildProjectionReport(run)` attached as
`FeatureProjectionRun.report` (never a second projection). It returns a superset of
`ProjectionRun`, so existing call sites keep working.

Truthful coverage (verified by `phase5Acceptance.test.ts`):

| Call site | `complete` | `processors` | `reporting` | `deferred` |
|---|---|---|---|---|
| raw `projectScenario(scenario, …)` | `false` | `false` | `false` | `DEFERRED_FEATURE_DOMAINS` (non-empty) |
| composed `projectFeatureScenario(scenario, { horizonMonths })` — full horizon, nothing blocked | `true` | `true` | `true` | `[]` |
| composed with a partial `scheduleWindow` | `false` | `true` | `true` | contains `partialScheduleWindow` |

Additional pins: the one report reconciles with the frozen run
(`report.postingCount === run.postings.length`, `planCount`, `outcomeCount`), and a rebuilt run
produces a **byte-identical** report (`JSON.stringify` equality). A blocked execution adds
`blockedExecution`; a dropped handler adds `featureProcessors` (pinned in `projection.test.ts`).

### D26 hand-computed contention fixture (`phase5Acceptance.test.ts`, "D26 cross-feature contention")

One month, one account starting at `$0`; payroll net posts first; obligations draw in the frozen
mandatory band order (`loan/mortgage → housing → cards → planner/living → retirement`), then the
discretionary purchase. Every expected cent is computed from the configuration (`$ × 100`), never
from the run.

| Request | Requested | Executed | Shortfall | Running remainder |
|---|---|---|---|---|
| Payroll net (posts first) | — | +`80_000` | — | `80_000` |
| Loan installment | `30_000` | `30_000` | `0` | `50_000` |
| Rent (housing) | `20_000` | `20_000` | `0` | `30_000` |
| Ordinary card | `15_000` | `15_000` | `0` | `15_000` |
| Planner | `10_000` | `10_000` | `0` | `5_000` |
| Retirement | `10_000` | `5_000` | `5_000` | `0` |
| Discretionary purchase | `50_000` | `0` | `50_000` | `0` |

Plan order is asserted as `[loan, housing.rent, card:card-d26:expected, planner, retirement]`;
`totals.executedNetCents === 80_000`; the purchase is an **uncommitted** `fundingOutcome`
(`phase: 'discretionary'`, `committed: false`, no plan row) with the exact D16 diagnostics
(`buy-d26 … could not be funded … unpaid 50000`; `ret-d26 … partially funded … paid 5000¢ …
unpaid 5000¢`). Timeline isolation and a complete no-career/no-income run are also pinned.

---

## 4. P5.2 — App wiring to commands and named contexts (U + integration owner)

`src/App.tsx` is now a composition root: commands + one selected projection + rendering.

- **Single write path.** A module-level `createConfigurationCommands()`; every edit goes through
  `commands.applyToActiveTimeline` / `applyGlobal` / timeline / career / account / marker CRUD
  (`updateLocal`, `updateHousingProperty`, `resolveMarkerReferences`, `removeDateMarker`,
  `switchTimeline`, …). No local `updateScenario` rebuild.
- **One selected projection.** `useMemo(() => projectFeatureScenario(scenario, { timelineId }))`
  with `timelineId = scenario.activeTimelineId ?? null`; `report = context.report` is the single
  source consumed by `ChartPanel`, `SavingsStackedChart`, `ResultsTable`, `NetWorthHistoryChart`,
  `TrajectoryComparisonChart`, the card-plan results panel and the Warnings tab. No second
  projection call.
- **Standalone editors mounted:** `AccountManagementEditor`, `AccountCareerPlanEditor`,
  `AccountExpensesPlanner`, `RetirementSpendingEditor`, `PurchaseEditor`, `LoanEditor`,
  `HousingEditor`, `CardPlanEditor`, `CashflowItemEditor`, `TimelineManager`, `TrajectoryManager`,
  `DateMarkersEditor`.
- **No-career state.** The careers tab renders an explicit empty state plus the editor; chart,
  table and warnings render with no enabled career (App test slice present).
- **Timeline-local `cardPlans`.** `local = commands.getActiveTimelineData(scenario)`; `addCardPlan`
  (with a linked global `zeroInterestCard` liability) and `writeCardPlan` route through
  `applyToActiveTimeline`, so base-vs-timeline card plans are isolated (mirrors the codec
  `timeline.cardPlans` normalizer).
- **Timeline-local housing `fundingEvents`.** `propertyForHousing`/`updateHousingProperty` mirror a
  property's funding events into the timeline-local housing entry when one is active, and keep the
  base/global property events separate on the base plan; nothing is dropped.
- **Property-free rentals.** Adding a rental creates only a `HousingEntry` (no synthetic property or
   liability); adding a mortgage creates the linked `PropertyDefinition` + `LiabilityDefinition` and
   routes the housing entry through `applyToActiveTimeline`. Duplicating a rental deep-clones just
   the housing entry.
- **Observed housing results.** The selected housing entry now has a read-only
  `HousingResults` panel using the same `context.report`: requested/paid/unpaid schedules,
  pending/no-property-held close, held deposit, observed mortgage balance/payoff and retained
  sale-deficiency liability with signed closing net worth. Property-free rentals match the
  `housing:rental:<housingId>` definition namespace, not a fictional property. A completion
  followed by disposition is not mislabeled pending; this edge has a synthetic report unit test,
  not yet a single real-projection App assertion.
- **Observed purchase funding (GUI-A04/D16).** One-time and long-term purchase editors now
  mount a read-only `PurchaseFundingResults` disclosure from the selected report's matching
  outcome and fallback occurrence. It shows actual committed source net/gross/tax/penalty,
  quote-time eligible order, requested/paid/shortfall and an honest no-debit/unfunded state;
  explicit unresolved sources are never redirected to global funding. The App tests a
  $200 purchase funded $100+$60+$40, a $500 zero-fund skip and a separately explicit
  unresolved source. `FundingPlan.resolvedSourceOrder` records quote-time policy order at
  the funding owner, so `report.fallback.occurrences` only lists **committed actual secondary
  draws** (global primary-only is never incorrectly a fallback, even when raw request primary
  was null). This runtime audit metadata is not persisted configuration or a second quote.
- **Monthly planner observation (G26).** `AccountExpensesPlanner` shows only the selected
  account's actual funded `report.months[].accounts[].closingCents` at the report's
  `closingDate`, in a maximum 12-month window starting with the planner's selected week.
  The weekly grid is explicitly a planned schedule, not a daily/weekly funded forecast;
  no second planner debit or interpolated balance is introduced. A supplied per-account
  display threshold highlights closes above it. A separate exact-date seven-day summary joins
  only **quoted planner outcomes** for the selected account's planned items: requested,
  committed paid across all sources, and committed net paid from that selected account are
  labeled separately. Occurred imports are excluded; weeks outside/crossing the report horizon
  are labeled incomplete. Local date-only formatting keeps the selected week aligned with
  report occurrence dates without changing projection inputs. This is not a weekly funded
  balance or per-card schedule-completeness claim.
- **Canonical-cents trajectory save/compare.** The Trajectory tab builds snapshots via
  `createCanonicalTrajectorySnapshot({ id, label, frozenDate, report }, context.metadata)`
  (`formatVersion: 2`, integer-cents annual points mapped from the report's reconciled year-close
  stocks) and compares them through `canonicalContextFromRunMetadata` +
  `TrajectoryComparisonChart`/`compareTrajectorySnapshots` (context/format gating).
- **D20 result-vs-opening measurement.** `trajectoryReportAdapter.canonicalAnnualPointsFromReport`
  maps each **actual report year**'s reconciled closing stocks (`netWorthCents`, `accountCents`,
  `liabilityCents`) and resolved month-close date; a year with no matching close is omitted, never
  given a fabricated date. The App's `signedHistoryPoints` only includes history entries whose
  `measurement === 'assetsMinusLiabilities'`; legacy `assetOnly` history is never reinterpreted as
  signed net worth. `CANONICAL_RUN_MEASUREMENT = 'assetsMinusLiabilities'`.

**Acceptance status:** the App compiles; `App.test.tsx` passes **43/43** with real-render
interaction, save/reload and report assertions (§7). This does not certify every GUI-A/G row.

---

## 5. P5.3 — Save lifecycle and cutover (S)

- **Schema v3.** `CURRENT_SCHEMA_VERSION = 3` (`src/codec.ts`). v2 completed the D9/D24 cutover; v3 adds persisted ordered per-group `HousingEntry.fundingPolicies` overrides (G20/G22). The
  derived flat `CareerEntry.paycheckInfo` is **no longer persisted** (the granular `paycheck` is
  authority; `paycheckInfo` is re-derived on load via `compilePaycheck`). Older v1/v2 payloads still
  load and are upgraded losslessly on the next save.
- **Prune across all plans.** `normalizeCareerEntry` omits `paycheckInfo` when `ctx.mode === 'save'`
  for base careers, timelines and pay plans; every record is rebuilt from an explicit allowlist, so
  obsolete keys are pruned by construction. A present-but-unusable flat payload on save emits the
  blocking `paycheck-info-unconvertible` diagnostic and `saveAppState` aborts the write (preserving
  bytes) so no edits are silently lost.
- **Legacy full-cent precision.** `paycheckFromPaycheckInfo` persists each reconstructed per-period
  amount at **full precision** (unrounded `annual / 12`, e.g. `100000 / 12`), so `compilePaycheck`
  recovers the exact annual cents (`(annual/12)*12` round-trips every cent) and the per-line
  cumulative integer-cent schedule drops no residual month and fabricates no cent (`src/paycheck.ts`;
  pinned in `paycheck.test.ts` "paycheckFromPaycheckInfo precision (P5.3 / D24)").
- **Autosave + guarded flush.** `src/autosave.ts` `createAutosaveController` coalesces rapid edits
  into one deferred write and funnels every write through the guarded `saveAppState`. The App
  schedules on state change, **skips the hydrated load** ("never save on load"), flushes from a
  `pagehide` handler, and exposes visible save diagnostics (blocked/corrupt/quota). A user reset is
  the only path allowed to replace newer-version/corrupt bytes (`{ reset: true,
  explicitCanonical: true }`).
- **Canonical trajectory format.** `CANONICAL_TRAJECTORY_FORMAT_VERSION = 2` marks a cents-only
  snapshot; a missing value is legacy and normalized through the legacy path; a higher value is
  refused rather than reinterpreted. Cross-format comparisons are refused with
  `format-version-mismatch`.
- **Nullable planned-copy provenance.** `normalizeExpenseProvenance` preserves an explicit
  planned-copy `sourceSign: null` through save/load/save (never fabricates `'debit'`), keeps
  absent values absent and retains an imported sibling's real `debit`/`credit` sign. A
  browser planner-copy flow exposed the prior coercion; codec and storage tests pin the
  correction. The source sign is view-only and schema version remains 3.

---

## 6. Early P7 removals + dateMarkers

Executed ahead of the P7 sweep because the P5.2 rewiring made the old modules unreferenced:

- **Deleted** `src/financeModel.ts`, `src/components/CareerPlanEditor.tsx`,
  `src/components/ExpensesPlanner.tsx` and `src/engine/projection.characterization.test.ts`. No
  remaining importer of any of these was found (grep over `src/`).
- **`src/utils/dateMarkers.test.ts`** was updated in the working tree and now **passes 11/11** (it
  previously failed 10/11 against the removed `defaultScenario` singleton).
- The orphan snapshot
  `src/engine/__snapshots__/projection.characterization.test.ts.snap` remains present and unchanged
  (not claimed as removed).

## 7. P5.4 / P5.5 acceptance status (local gates)

- **P5.4 (`src/App.test.tsx`, Q + U).** **43/43 pass.** Real-render slices cover canonical
  mutations and save/reload/reset, named timelines, ordinary and 0% cards, housing/property-free
  rentals and timeline-local events, canonical signed-cents trajectory save/compare, exact D16
  shortfall/fallback wording, and ordered grouped housing funding (primary + fallback,
  explicit empty override, timeline isolation) and an observed pending acquisition and underwater
  sale deficiency/signed net worth, partial mortgage PI shown from a retained 360-month liability,
  a dated career pay-plan allocation edit/switch/reload and purchase primary+two fallbacks,
  skipped zero-fund and explicit-unresolved report outcomes, and real planner outcomes with
  $25 paid across sources/$15 paid from the selected account while occurred history is omitted.
  Career duplication preserves a distinct nested dated plan; editing the clone's cap and
  overflow does not modify its original, even across pagehide/reload.
  `HousingEditor.test.tsx` **8/8** covers the per-group control and the nested-label/Start date-source accessibility fix;
  `HousingResults.test.tsx` **1/1** covers sold-after-acquired neutral status and observed payoff.
  An App test is not a substitute for a complete browser GUI matrix.
- **P5.5 (`src/engine/phase5CrossFeature.test.ts`, Q).** **27/27 pass** — a headless cross-feature
  re-fixturing of CA01–CA13 over the single integrated path plus the pure kernel owners, with every
  expected cent hand-computed (never read back). It does not replace the P3 stream suites and is
  **not** App/GUI acceptance.
- **Post-audit focused additions.** CA02 now compares each of two composed years to its 12
  actual months and independently computed opening/closing stock; CA13 asserts concrete
  chronological mandatory/discretionary order rather than a lexicographic ID sort. CA04
  custom HSA penalty and birthday waiver tests pass; CA08 facade tests (projection 42/42) pin clipped retirement
  override and the -100% percent-rate boundary without phantom debt. CA11 warns non-blockingly on non-object
  collection entries while defaulting wrong-typed scalar fields silently, with valid siblings
  and canonical save preserved. Component tests cover Date/Marker pressed state and buffered
  number Escape-cancel/Enter-commit. These close slices, not whole matrices.
- **Dated career + shared-dollar basis.** CA01's new composed 5-month Initial→2026-04
  pay-plan fixture independently pins employee retirement vs distinct employer-match
  destination, ordered percent/fixed allocations, remainder and gross/posting conservation;
  the App tests pay-plan editing and reload without changing the Initial plan. Cross-view
  GUI-A08/CA12 tests use 6% inflation and real month-closing dates across `ChartPanel`,
  `SavingsStackedChart` and `ResultsTable`: the stacked chart now uses
  `month.closingDate` instead of `${month.yearMonth}-01`, so clipped/month-end observations
  share the same display-only factor; nominal report data is unchanged.
- **Ordered bounded payroll + marker registry.** A second composed CA01 fixture pins four
  fixed allocations requesting 105_000¢ from 90_000¢ net: full/full/partial/skip with no
  borrow/retry/negative cash. `commands.test.ts` exercises shared marker updates/removal
  through base + two inactive timelines with month/day precision and unrelated config intact;
  `DateMarkersEditor.test.tsx` 5/5 covers labelled add/edit/remove controls. These are focused
  acceptance slices, not complete GUI-A09/CA01 certification.
- **Career cap controls and posting conservation.** The career editor exposes optional
  max-balance dollars and an overflow account per allocation for Initial and dated plans;
  App save/reload pins $500, cleared/absent and explicit zero without rewriting Initial.
  `normalizeCareerSourceLine` preserves an omitted `maxBalance` separately from 0 in base,
  dated and inactive-timeline records (both mean cap off to the engine). Composed CA01
  fixtures pin most-recent-started career selection without double payroll and one
  allocation filling a 50_000¢ cap with exactly 10_000¢ overflow. D26 now also pins
  each committed posting's `account + property/deposit − liabilities` declared net-worth
  delta, including live loan principal and spending changes; nonzero property/interest
  changes and a full audit inventory remain outside this fixture.
- **CA06 adaptive permanent-0% card.** A composed fixture independently pins a $100
  liability across Jan→Mar: 3_334¢ January funded, 3_333¢ February unfunded, 6_666¢
  residual March funded by an explicit dated cashflow inflow. The coincident payoff handler
  commits no duplicate principal; debt closes 6_666/6_666/0¢, and no account becomes negative.
- **Covered slices:** App-mounted frozen-cents trajectory comparison (GUI-A10/D20) and D16
  warning/report rendering (part of CA12) are tested. **Not claimed:** complete GUI-A01–A10 /
  G01–G40 or CA01–CA13 certification without a row-by-row independent review.

---

## 8. Full suite / build status (latest local run)

| Check | Result (this session) |
|---|---|
| `src/App.test.tsx` | **43 pass / 0 fail** (included in whole suite) |
| `src/components/HousingEditor.test.tsx` | **8 pass / 0 fail** (focused checkpoint; included in whole suite) |
| `src/components/HousingResults.test.tsx` / `src/engine/projection.test.ts` | **1/1** / **42/42** |
| `src/engine/phase5Acceptance.test.ts` / `phase5CrossFeature.test.ts` | **6/6** / **27/27** |
| `src/engine/taxes.test.ts` / `src/codec.test.ts` / `src/storage.test.ts` | **30/30** / codec and storage pass, including cap absence/zero round-trip (in whole suite) |
| `BufferedNumberInput.test.tsx` / `DateOrMarkerInput.test.tsx` | **10/10** / **11/11** (new files) |
| `src/components/ReportDisplayConsistency.test.tsx` | **3/3** (new cross-view month-close regression) |
| `src/components/AccountExpensesPlanner.test.tsx` | **11/11** (selected month, exact-date week, account/source paid distinction) |
| `src/components/PurchaseFundingResults.test.tsx` | **3/3** (fallback attribution and uncommitted quote regression) |
| `src/commands.test.ts` / `src/components/DateMarkersEditor.test.tsx` | **62/62** / **5/5** |
| `AccountExpensesPlanner.test.tsx` / `AccountCareerPlanEditor.test.tsx` | **9/9** / **13/13** |
| Whole suite (`npm run test -- --run --reporter=default`) | **55 files / 1073 pass / 0 fail** |
| Build (`npm run build`, `tsc -b` + `vite build`) | **passes** — 100 modules; one non-fatal 624.57 kB JS chunk advisory (175.06 kB gzip JS / 84.04 kB CSS) |
| `git diff --check` | **passes** (PowerShell displayed only CRLF conversion notices) |
| Browser gate (`npm run test:e2e -- --project=chromium`, Playwright 1.64.1 + Chromium) | **33 pass / 0 fail** (42.7s) — bounded local Chromium smoke/flow gate (§13); not CI-wired and not a PS/B-P browser benchmark |
| Independent `@verifier` invariant review | **PASS:** latest rerun 1073/1073, build and diff check; reviewed nullable planned-copy sign and imported sibling preservation; earlier passes checked CA06/planner/D16/CA01/D26/cap, CA08, v3 recovery and fixture hash. Full GUI/CA matrix and browser benchmarks explicitly out of scope |

Earlier Phase-4 failures and in-flight Phase-5 tallies are superseded, not evidence for the
current candidate. The bounded browser gate is not a production-browser performance benchmark
or release verification.

---

## 9. B01–B09 citation and fixture preservation

The B01–B09 target before/after table lives in `refactor/phase5_before_after.md`; this handoff
**cites it and does not duplicate or alter it**. The original evidence is preserved byte-for-byte:

- `refactor/fixtures/projection.pre-refactor.snap`
  - SHA-256 `98B57CECE90F7EA40E6E140DBE4C1C821FBD02FE01E60EE377162E501354747C`
  - size `321548` bytes
  - **re-verified unchanged this session** and **not in the working-tree diff**.

The B01–B09 rows classify non-equivalent old modes and give independently computed expectations for
the **new** analogous `phase5CrossFeature` fixtures (B01/CA06, B02/CA11 reference-only, B03/CA01-02,
B04/CA09, B05/CA08, B06/CA08, B07/CA01, B08/CA10+CA03, B09/CA04+CA03+CA07). No snapshot was
refreshed and the archived scenario was never replayed against the new engine.

---

## 10. Coverage register updates (P5-scoped)

`refactor/coverage_register.md` gains a **`P5-scoped (partial)`** legend and updates the
**F/G/CA/GUI** rows with the Phase-5 integrated-candidate evidence above. P1–P4 statuses are
preserved. Critically:

- No **GUI-A01–A10** or **CA01–CA13** row is blanket-marked complete from green tests alone;
  each retains its stated evidence and remaining acceptance scope.
- `P5-scoped (partial)` records the 1073-test independently reproduced gate, App slices, CA fixtures, the
   33-test local Chromium browser gate and v3 codec/autosave/housing checks without implying
  independent GUI-matrix certification.

---

## 11. Remaining acceptance gaps and Phase-6 needs

- **Independent invariant verification completed:** an earlier attempt failed for Insufficient
  Balance, but a subsequent `@verifier` reran and passed suite/build/diff/fixture-hash gates
  and reviewed account-led invariants. This does not close GUI/CA/browser acceptance.
- **GUI/CA gap audits completed; coverage remains partial:** App-mounted warning/report,
  dated career/cap editing, monthly planner closes, month-close cross-view dollars, partial PI
  and canonical trajectory slices pass. Purchase per-account outcome/fallback detail is
  now App-tested; broader long-term/partial-shortfall GUI-A04, full per-card weekly
  schedule parity (G26), and remaining per-card/browser matrix checks remain. The bounded
  Chromium gate (§13) now also covers account-reference cleanup/save guard, ordinary-card
  CRUD, signed-negative net worth, long-term partial purchase, planner move/copy provenance,
  marker propagation, keyboard/`aria-pressed` and legacy-trajectory refusal, but is not a
  full matrix. Phase-6 reference/optimized equivalence is also open. 1073 green tests do
  not certify every row.
- **Housing status coverage edge:** the selected panel displays an actual underwater sale
  deficiency in App; acquired-then-sold neutral status is currently pinned with a synthetic
  report unit fixture, not an end-to-end App projection. Do not certify all G18–G22 from that.
- **Per-G browser coverage ledger:** `refactor/gui_browser_coverage.md` is the 40-row
  G01–G40 ledger (each row's Chromium evidence, status and exact remaining assertion).
  Its named pending branches are **G10/G19/G33** (`partial`), **G26** (accepted monthly
  resolution — no weekly funded curve) and **G28** (tracking placeholder); the browser
  suite is **not** row-by-row certified.
- **Phase 6 needs browser 960-month measurements** (PS01–PS20 / B-P1–B-P8): production-browser
  echo/result/paint latency, audit/transport bytes, worker/peak-heap, load/edit/save size/time and
  rapid-revision cancellation. No browser/transport/audit-deficit benchmark evidence was produced in
  P5.
- **No full end-to-end per-posting audit-deficit inventory** (the reporting suite asserts
  reconciliation/join integrity on its own fixtures only).
- **Remaining documentation drift:** `AGENTS.md` has been reconciled with the account-only
  runtime and local gates; `CODEMAP.md`, `docs/INDEX.md`, parts of `docs/` and `refactor/README.md` still
  describe historical or target modules. Follow runtime and this handoff until P7 docs cleanup.
- **Housing G20/G22 ordered per-group funding is now persisted and tested** (schema v3,
  `housing.test.ts`, `HousingEditor.test.tsx`, `App.test.tsx`); do not carry forward the old
  missing-schema caveat.

---

## 12. Non-claims

This handoff does **not** claim: a release, complete GUI-A01–A10/G01–G40 or CA01–CA13
certification, a full per-posting audit-deficit
inventory, or any PS/B-P production-browser benchmark. The Chromium gate in §13 is a
bounded local browser smoke/flow gate — it is **not** wired into any CI and does **not**
certify the GUI/CA matrices row by row. Phase 6 owns browser measurement;
Phase 8 owns release verification. Phase 5 exit does **not** assert a release (ADR-022).

---

## 13. Browser end-to-end evidence (Playwright/Chromium)

A bounded browser gate now drives the real app over the real Vite dev server. This is
**separate** from the Vitest per-item suites and does not replace them.

- **Harness.** `e2e/**` (seventeen `*.spec.ts` plus `e2e/fixtures.ts`) is driven by `playwright test`
  via the new `npm run test:e2e` script. `playwright.config.ts` uses Chromium only
  (`devices['Desktop Chrome']`), strict port `4173`, a fresh, isolated context per test,
  2 workers, `trace: 'on-first-retry'` and `screenshot: 'only-on-failure'`. `vite.config.ts`
  excludes `e2e/**` from Vitest (preserving Vitest's default excludes) and `.gitignore`
  ignores `test-results/`, `playwright-report/` and `.playwright/`. `e2e/fixtures.ts` seeds
  canonically through the codec-v3 save path with a pinned clock and per-test blank
  localStorage (no repeating `addInitScript`).
- **Result.** `npm run test:e2e -- --project=chromium` = **33 passed / 0 failed** (42.7s),
  with Playwright Test 1.64.1 and Chromium installed. Per-file counts: smoke 3,
  accounts-careers 3, trajectory-accessibility 2, obligations-planner 3, cards-d16 2,
  display-consistency 2, housing-outcomes 2, markers-timelines 2, trajectory-legacy 2,
  account-reference-guards 2, cards-crud 1, networth-signed 1, purchases-partial 2,
  planner-editing 2, account-policy-order 1, career-payroll-destinations 1,
  housing-group-policy 2. The per-G01–G40 ledger is `refactor/gui_browser_coverage.md`.
- **Coverage slices (hand-computed from fixed inputs, never read back).** A $200 purchase
  splits $100 + $60 + $40 across the global primary and two ordered fallbacks with no
  shortfall or phantom negative; the selected-account planner week shows $25 requested /
  $25 paid-all / $15 paid-from-selected with October close $85 and the occurred $99 import
  excluded; a $1,500 one-month property-free rent is funded from Checking; a permanent-0%
  card's July 334¢ shortfall ($3.34) surfaces as `$3` because the app renders money with
  `maximumFractionDigits: 0`, with no fabricated fallback banner; an unfunded pending
  mortgage acquisition stays pending at $0 and an underwater sale shows a signed negative
  net worth; a fixed 6% today's-dollars factor deflates table/chart/stacked note together;
  a legacy trajectory stays archived asset-only and is refused against the canonical run;
  a marker change propagates to the base plan and a cloned timeline; `DateOrMarkerInput`
  exposes `aria-pressed` and `BufferedNumberInput` commits/cancels by keyboard; and first
  launch renders with no console/page errors. Additional seeded cases assert global/inactive
  account-reference cleanup and future-version byte preservation; ordinary card
  add/duplicate/edit/remove with timeline isolation; −$100 signed net worth vs $0 assets;
  $500 zero-fund and $100→$50 long-term partial purchase; and keyboard planner move/copy
  changing occurrence identity without promoting imported history. Three newer specs add:
  account display colour / withdrawal-fallback policy / display-order swap persist through
  `pagehide`+reload while the input-derived $300 close and the absence of pool controls hold
  (`account-policy-order`); one July-2026 payroll posts gross $2,000 − tax $200 − employee
  401K $100 → net $1,700 then ordered 10%-of-net + fixed net allocations + remainder with a
  distinct employer-match destination (`career-payroll-destinations`); and an explicit
  per-group housing override beats the global default while clearing it to explicit empty
  leaves the rent unpaid and persists (`housing-group-policy`).
- **Fix note.** An earlier 21-test run was 20/21 because one spec's own locator regex was malformed
  (it matched `paid $30` incorrectly). It was corrected to the literal `/\bpaid \$30\b/` — a
  test-only locator fix with **no product bug**. The expanded run initially passed 27/29:
  one new test wrongly assumed a single warning (eligible exhaustion can coexist with
  shortfall), and a second exposed the real nullable-`sourceSign` codec bug above. After
  the narrow test correction and codec fix, that expansion's focused 4/4 and full 29/29 passed. The latest
  `account-policy-order` reorder flow initially failed on a **real product bug** —
  `AccountManagementEditor` Move up/down issued multiple stale-render updates and lost the
  reorder — fixed at the owner (`src/components/AccountManagementEditor.tsx` + `src/App.tsx`)
  with **one immutable `onReorderAccounts`** routed through `applyGlobal`
  (`AccountManagementEditor.test.tsx` +1). Focused retest 1/1, then the full gate **33/33**.
- **Non-claims.** This is a **bounded local gate**: **no CI wiring**, and **no** Phase-6
  PS/B-P production-browser latency/heap/bytes benchmark. It is **not** a row-by-row
  GUI-A01–A10/G01–G40 or CA01–CA13 certification; Vitest remains the per-item owner.
