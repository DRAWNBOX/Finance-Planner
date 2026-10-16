# Session Changes — October 15, 2026

## Phase 5 — integrated candidate (P5.1–P5.5, local gates green)
- **P5.1 single orchestration (D23/D26).** `projectFeatureScenario` (`src/engine/featureHandlers.ts`) is the one projection path: one named timeline, one compiled context, all four streams, one immutable `buildProjectionReport(run)` attached as `FeatureProjectionRun.report`. Truthful coverage is call-site-scoped (`ProjectionCoverageClaim` in `src/engine/projection.ts`): the raw facade stays `complete:false`/`processors:false`/`reporting:false` with the full `DEFERRED_FEATURE_DOMAINS`; the composed call site becomes `true`/`true`/`[]` on a full horizon with nothing blocked; a partial `scheduleWindow` stays incomplete (`partialScheduleWindow`). New `src/engine/phase5Acceptance.test.ts` (5) pins all of this plus the **D26** contention fixture (payroll + loan + rent + card + planner + retirement + discretionary purchase competing for one account in one month; every expected cent hand-computed — loan `30_000`, rent `20_000`, card `15_000`, planner `10_000`, retirement `5_000/10_000` short, purchase `50_000` short, closing `0`).
- **P5.2 App wiring.** `src/App.tsx` is now commands + one selected projection + rendering: a module-level `createConfigurationCommands()` for every mutation, a single `useMemo(() => projectFeatureScenario(scenario, { timelineId }))`, and the migrated views reading `context.report`. All P3 standalone editors are mounted (`AccountManagementEditor`, `AccountCareerPlanEditor`, `AccountExpensesPlanner`, `RetirementSpendingEditor`, `PurchaseEditor`, `LoanEditor`, `HousingEditor`, `CardPlanEditor`, `CashflowItemEditor`, `TimelineManager`, `TrajectoryManager`, `DateMarkersEditor`); no-career plans render; **timeline-local `cardPlans`** and **timeline-local housing `fundingEvents`** route through `applyToActiveTimeline`; rentals are **property-free**; trajectories are saved/compared as canonical **cents** snapshots (`createCanonicalTrajectorySnapshot` + `canonicalContextFromRunMetadata`).
- **P5.3 save cutover.** `CURRENT_SCHEMA_VERSION = 3` (`src/codec.ts`; v2 flat-cache prune, v3 G20/G22 grouped housing policies): the derived flat `CareerEntry.paycheckInfo` is no longer persisted (granular `paycheck` authority, re-derived on load via `compilePaycheck`); a present-but-unusable flat payload blocks the write (`paycheck-info-unconvertible`) so bytes are preserved. Legacy `paycheckFromPaycheckInfo` keeps **full-precision** per-period amounts (unrounded `annual/12`) so the annual cents round-trip exactly. New `src/autosave.ts` coalesces edits and flushes on `pagehide`; the App wires it with a never-save-on-load guard and a visible save indicator. Grouped housing `FundingPolicy` persists independently per timeline, preserves explicit empty overrides and supports primary + ordered fallback funding; engine, editor, codec and App regressions cover it.
- **Early P7 removals + dateMarkers.** Deleted the now-unreferenced `src/financeModel.ts`, `src/components/CareerPlanEditor.tsx`, `src/components/ExpensesPlanner.tsx` and `src/engine/projection.characterization.test.ts`; `src/utils/dateMarkers.test.ts` updated and now passes 11/11.
- **P5.4/P5.5 acceptance and reproduced gates.** Real-render `App.test.tsx` **43/43** covers canonical saves/reset, ordinary/0% cards, housing property-free rentals/group funding/timeline isolation, pending acquisition/underwater sale/partial PI, dated pay-plan cap/overflow and career clone isolation, purchase funding detail, selected-week planner outcomes and signed-cents trajectory comparison; `HousingEditor.test.tsx` **8/8**, `HousingResults.test.tsx` **1/1**, `phase5Acceptance` **6/6**, `phase5CrossFeature` **27/27**. Latest independently rerun `npm run test -- --run --reporter=default`: **55 files / 1073 tests passed**; `npm run build` passes (100 modules; non-fatal **624.57 kB** JS chunk / **175.06 kB** gzip JS / **84.04 kB** CSS advisories); `git diff --check` passes. Verifier re-derived CA06 adaptive 0% residual and checked career clone isolation; earlier gates covered exact-week planner paid attribution, D16 source order, CA01/D26/cap/CA08/schema/fixture invariants. Earlier 981/1011/1016/1030/1043/1051/1062/1064-test tallies, in-flight 945/3 and Phase-4 759/91 + 182 TS errors are superseded. The complete GUI-A01–A10/G01–G40/CA01–CA13 matrix is not certified row by row, and Phase-6 browser/Phase-8 release gates remain open.
- **GUI-A03/G12–G13 and CA06 closing slices.** App duplicate-career flow deep-clones Initial and dated pay plans, edits clone cap/overflow/name without changing original, then pagehide/reloads both independently. A composed permanent-0% $100 card fixture funds 3_334¢ Jan, misses 3_333¢ Feb, then after explicit 6_666¢ March inflow pays the recalculated residual once, with no coincident payoff duplicate and principal 6_666→6_666→0¢. These are focused acceptance fixtures; browser and remaining GUI matrix proof is still pending.
- **GUI-A04/G16–G17/D16 purchase evidence.** Purchase editors now mount `PurchaseFundingResults` from the ONE selected report for each one-time/long-term definition; committed plans show actual requested/paid/unpaid and per-source net/gross/tax/penalty, quote-time eligible order, and report-selected actual fallback, while uncommitted/explicit unresolved show no fabricated debit. Real App fixtures pin a $200 purchase funded $100+$60+$40, a $500 zero-fund skip and an explicit `fundingSource:'income'` that cannot silently draw from the configured global policy. A discovered D16 bug was fixed at its owner: `FundingPlan.resolvedSourceOrder` retains the already-computed quote-time primary (raw null global requests remain unmodified), and `buildFallback` reports only committed actual secondary draws; global primary-only is not fallback, invalid primary + drawn secondary is. Funding/reporting/UI tests guard all cases; the earlier incorrect App badge 3 was corrected to 2. Runtime metadata is not persisted and schema v3 is unchanged.
- **GUI-A07/G26 weekly quoted outcomes without weekly balance invention.** `AccountExpensesPlanner` now joins the one report's exact-date `planner:`/`recurrence:` outcomes to planned selected-account records within the visible seven-day week, deduplicates occurrence ids, excludes occurred/imported siblings, and shows requested, committed paid across all accounts, and distinct committed net paid from the selected account. Weeks outside/crossing report horizon are labelled incomplete; local date-only formatting no longer mixes local week math with UTC slicing. Real App fixture pins $25 requested/$25 paid across emergency+checking/$15 paid from checking and October close $85, with an occurred $99 import excluded. The monthly funded-balance view remains monthly; no daily/weekly funded balance or per-card schedule-completeness claim is made.
- **GUI-A05/G18 partial PI, CA01 ordered exhaustion, GUI-A09/G38 marker registry.** New real-render App case pins a $1,438.92 mortgage request paid $1,000 interest-first, $438.92 short, untouched $240,000 principal and $671,000 360-month closing debt (signed net worth −$371,000), with requested/paid/unpaid and close shown from the one report. Composed CA01 fixture pins four ordered allocations requesting 105_000¢ from only 90_000¢ net as full/full/partial/skip with exact diagnostics and no borrowing or second posting. `commands.test.ts` adds six shared-marker tests across base and two inactive timelines (month/day precision, sibling preservation, no unrelated funding edits); new `DateMarkersEditor.test.tsx` passes 5/5 for labelled controls. These extend partial acceptance evidence, not full matrix certification.
- **Post-audit acceptance additions.** CA04: 3 independent custom HSA 10% penalty/age-60 waiver/gross-up tests (`taxes.test.ts` 30/30). CA02: 24-month composed payroll+planner annual Σ-months/opening/closing fixture and CA13: exact chronological phase-band order, not lexical IDs (`phase5CrossFeature` 26/26). CA08: clipped 5% retirement override (2_101¢ growth) and -100% percent-rate wipeout without phantom liability (`projection` 42/42). CA11/TC07: schema-v3 codec reports non-object entries in supported record collections as non-blocking `malformed-record-recovered` warnings (40 sites), keeps wrong-typed scalar defaults silent, preserves valid siblings and byte-stable saves; it now also preserves a missing career cap separately from explicit 0. GUI-A10/G40: new DateOrMarkerInput and BufferedNumberInput RTL suites (11/11, 10/10); Escape now cancels rather than commits an unsubmitted draft and Date/Marker toggles expose `aria-pressed`. GUI-A05: selected `HousingResults` reads the one report for rental payments, pending acquisition, mortgage close/payoff and underwater-sale retained debt/signed net worth; App asserts observed pending/sale/rental/partial PI cases; sold-after-acquired neutral status unit-tested with a synthetic report only. GUI/CA gap audits also corrected TC01 historical-only loan-row provenance and CA08/CA10 day-31 test attribution. Remaining GUI-A04 per-account detail and Phase-6 browser/benchmark work stay explicit.
- **GUI-A03/CA01, GUI-A07/G26 and D26/CA02 follow-up.** `AccountCareerPlanEditor` now exposes per-allocation optional cap and explicit overflow account with unresolved/self-source affordances; dated plan UI test covers $500, cleared/absent and explicit 0 round trips without changing Initial. Composed CA01 overlap picks most recent career once/month and a separate two-month cap fixture routes exactly 10_000¢ overflow at the 50_000¢ cap. Planner displays at most 12 actual selected-account monthly closes starting from its selected week alongside a clearly planned weekly grid; threshold coloring uses persisted display config, never a fabricated weekly funded curve. D26 asserts each posting's signed `Σaccounts + Σproperty/deposit − Σliabilities` equals its declared net-worth delta, with a live loan-principal/expense branch and zero month-close residual. Weekly requested-vs-paid totals and full nonzero property/interest posting audit inventory remain unclaimed.
- **GUI-A03/CA01 and GUI-A08/CA12 follow-up.** A composed five-month Initial→2026-04 pay-plan fixture independently pins employee 401k, a distinct employer-match destination, percent/fixed allocations, remainder and a 1_075_000¢ close; a real App edit/switch/pagehide/reload confirms plan-local fields without rewriting Initial. New `ReportDisplayConsistency.test.tsx` (3/3) and focused chart/table/stacked/adapters cases use 6% inflation at 2026-06-30 and 2027-03-31. `SavingsStackedChart` now deflates on each report `month.closingDate` (not the first of month): the month-end regression reproduced `$1,207.40` versus `$1,201.74` before the fix and passed after it. Nominal report values stay unchanged. This adds focused acceptance evidence, not full GUI/CA certification.
- **Browser end-to-end harness (Playwright/Chromium) + 33-pass gate.** Added a bounded browser gate over the real Vite dev server: `e2e/**` specs (seventeen files, **33 tests**) driven by `playwright test` through a new `test:e2e` script, with `playwright.config.ts` (Chromium only, strict port `4173`, fresh isolated context per test, 2 workers, `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`), `@playwright/test` 1.64.1 as a devDependency, `vite.config.ts` excluding `e2e/**` (Vitest defaults preserved) and `.gitignore` ignoring `test-results/`/`playwright-report/`/`.playwright/`. `e2e/fixtures.ts` seeds canonically through the codec-v3 save path (`seedScenario`, pinned clock) with per-test blank localStorage. Counts: smoke 3, accounts-careers 3, trajectory-accessibility 2, obligations-planner 3, cards-d16 2, display-consistency 2, housing-outcomes 2, markers-timelines 2, trajectory-legacy 2, account-reference-guards 2, cards-crud 1, networth-signed 1, purchases-partial 2, planner-editing 2, account-policy-order 1, career-payroll-destinations 1, housing-group-policy 2 = **33**. Financial assertions are hand-computed from fixed inputs (never read back): $200 purchase split $100+$60+$40 with two ordered fallbacks; planner week $25 requested/$25 paid-all/$15 paid-from-selected with October close $85 and the occurred $99 import excluded; $1,500 one-month rent funded; card July 334¢ shortfall ($3.34) rendered whole-dollar "$3" by the app's `maximumFractionDigits: 0` formatter with no fabricated fallback; pending acquisition at $0 and an underwater sale with a signed negative net worth; fixed 6% today's-dollars deflation; legacy-trajectory refusal; marker propagation base + cloned timeline; and `DateOrMarkerInput` `aria-pressed`/`BufferedNumberInput` keyboard. Latest `npm run test:e2e -- --project=chromium` = **33 passed** (42.7s). An earlier run was 20/21 because one spec's own locator regex was malformed (matching `paid $30` incorrectly); it was corrected to the literal `/\bpaid \$30\b/` — a test-only locator fix with **no product bug** — focused 2/2, then full 21/21. This is a bounded local gate: **no CI wiring** and **no Phase-6 PS/B-P browser benchmark**.
- **Browser expansion + provenance correction.** Added five isolated Chromium spec files (account-reference-guards, cards-crud, networth-signed, purchases-partial, planner-editing) with 8 browser flows: inactive-timeline account-reference cleanup and future-version write guard, ordinary-card CRUD, signed −$100 net worth vs $0 assets, zero-fund/long-term partial purchases, and keyboard planner move/copy with imported history view-only. An initial 27/29 run exposed a real codec bug: explicitly cleared planned-copy `sourceSign: null` became `'debit'` on save; `normalizeExpenseProvenance` now preserves null, absent and valid imported signs (codec/storage +5 tests, no schema bump). The other failure was a test-only exact-warning-count assumption: eligible exhaustion can coexist with the first shortfall. After correction, that expansion's focused 4/4 and full Chromium **29/29** passed. These are bounded local browser assertions, not GUI-A/G/CA certification or PS/B-P performance measurement.
- **Browser G01–G40 coverage expansion + a real account-reorder fix.** Added three isolated Chromium specs (4 tests): `account-policy-order.spec.ts` (account display colour / `allowAutomaticFallback` / display-order swap persist through `pagehide`+reload with the input-derived $300 close unchanged, and no pool controls in the Accounts region), `career-payroll-destinations.spec.ts` (one July-2026 payroll posts gross $2,000 − tax $200 − employee 401K $100 → net $1,700, then ordered 10%-of-net Emergency Fund $170 + fixed HSA $30 + remainder Checking $1,500 with a distinct employer-match $50), and `housing-group-policy.spec.ts` (a `$150` rent funded `$100` Checking + `$50` Emergency Fund via an explicit per-group override that beats the global default, plus clearing the override to explicit empty leaves the rent unpaid although the global default could pay and persists). New `refactor/gui_browser_coverage.md` records the full **40-row G01–G40** browser ledger grouped by GUI-A01–A10 with per-row spec evidence, status (`browser slice exercised` / `partial` / `unasserted` / `deferred by accepted monthly-resolution/placeholder`) and the exact remaining assertion. An initial focused `account-policy-order` run failed on a **real product bug**: `AccountManagementEditor` Move up/down issued multiple stale-render updates and lost the reorder; fixed at the owner (`src/components/AccountManagementEditor.tsx` + `src/App.tsx`) with **one immutable `onReorderAccounts`** routed through `applyGlobal`, with `AccountManagementEditor.test.tsx` +1. Focused retest 1/1, full browser **33/33** (42.7s). Still a bounded local gate — no CI wiring, no row-by-row GUI/CA certification, and no Phase-6 PS/B-P benchmark.
- **HousingEditor accessibility fix.** Nested-label handling in `src/components/HousingEditor.tsx` was corrected so the Start date-source controls keep exact accessible names and pressed state; `HousingEditor.test.tsx` now **8/8**.
- **Docs/evidence.** `refactor/phase5_handoff.md` and `refactor/coverage_register.md` record latest independently reproduced gates, schema v3, G20/G22 coverage and remaining GUI/CA/browser non-claims; the handoff now adds a separate browser-evidence section, and the register records the 33 local Chromium tests plus row-specific GUI-A evidence while keeping the matrix `partial`/not certified. New `refactor/gui_browser_coverage.md` is the authority for the per-G01–G40 browser ledger (17 specs / 33 tests; not row-by-row certified). `AGENTS.md` documents the account-only runtime (instead of the removed pool-era waterfall) and the `npm run test:e2e` browser harness; historical `docs/INDEX.md` and parts of `docs/` await P7 cleanup. `refactor/phase5_before_after.md` cites the B01–B09 table (original fixture `refactor/fixtures/projection.pre-refactor.snap` independently verified SHA-256 `98B57CECE90F7EA40E6E140DBE4C1C821FBD02FE01E60EE377162E501354747C`, 321548 bytes, untouched). Stale `App.test.tsx` header and removed `ExpensesPlanner` importer comment corrected. No commit or push requested.

---

# Session Changes — October 14, 2026

## Phase 4 — authoritative audit, reports and display adapters
- Reporting/audit stack added headless on the frozen `ProjectionRun`: `src/engine/journal.ts` (D15 complete posting journal at the sole `state.commitChanges` mutation point — `PostingContext`/`PostingRecord`/`PostingFlowFacts` + append-only indexes; a meaningful commit missing its posting, an invalid context, or an empty/zero-delta set journals nothing; payroll carries actual gross/net/tax/deduction facts with enforced gross conservation and is the only mixed commit with `facts`), and `src/engine/reporting.ts` (`buildProjectionReport`: one-scan join of committed postings ↔ funding plans/outcomes by `occurrenceId`, frozen query indexes by occurrence/definition/purpose/account/funding-source/month/window, monthly/annual closes with per-account, liability, property and held-deposit reconciliation, signed net worth, and per-entity `closing = opening + Σ committed deltas` where a mismatch is a **diagnostic**, never clamped).
- P4.3 selectors (pure selection over the frozen run): completeness shortfall vs eligible-funding exhaustion vs fallback with the exact D16 warning language, requested-vs-executed budgets by observed period kind, scheduled-vs-executed occurrence counts, observed career boundaries, retirement by funding-source account, obligation schedules/payoff from actually-posted evidence, and revision/date-keyed actual-funded previews with a default signed net-worth measurement plus an account-assets view. Fields the run cannot supply (recurrence specs, occurrence ids, configured career boundaries) are listed as `unverifiable`, never invented.
- Display adapters: `src/utils/viewAdapters.ts` (P4.4/D18) — exact cents→dollars (no pre-deflation rounding), the one date-based factor `(1 + annualInflationRatePercent/100)^(t/12)` per closing observation including clipped partial first/last months (`0`/disabled ⇒ identity), signed/unclamped observed-cents helpers, named-context metadata and measurement selection (`assetOnly`/`accountAssets`/signed `assetsMinusLiabilities`). Nominal results stay immutable; the deflated view is derived without re-running finance.
- Components migrated (P4.5/D19) to consume `ProjectionReport` selectors + adapters with **no legacy result/pool types**: `ChartPanel`, `SavingsStackedChart`, `ResultsTable`; plus `NetWorthHistoryChart` (signed net worth as a distinct series from labeled legacy `assetOnly` history) and `TrajectoryComparisonChart`. Frozen-trajectory gating (P4.6/D20): `src/trajectoryFreeze.ts` freezes `{schemaVersion, engineRevision, measurement, startDate, endDate, date}` from run metadata (never a wall clock), deep-freezes/deep-clones to be byte-stable across save/load, and refuses comparison on a `measurement`/`engineRevision`/`schemaVersion` mismatch or a legacy/incomplete context — old asset-only output is never reinterpreted as signed net worth. `types.ts`/`codec.ts` add `MeasurementBasis`, `ResultContextMetadata`, `NetWorthHistoryEntry.measurement` and `TrajectorySnapshot.context` with load-time normalization.
- Focused evidence — **post-hardening final verifier exact gates**: engine directory **517/517** (19 files; `reporting` **26**), `src/components` **57/57** (13 files), and the selected subset `viewAdapters` 38 + `trajectoryFreeze` 14 + `codec` 55 + `storage` 12 = **119/119** (4 files); whole suite **759 pass / 91 fail** (850 total, only `App.test.tsx` 81 + `dateMarkers.test.ts` 10) and build **182 TS errors** (`App` 168, `ExpensesPlanner` 7, `CareerPlanEditor` 5, `dateMarkers` 1, `financeModel` 1; none Phase-4 source). Hardening added: reporting full-horizon `postingCount`/`reconciledPostingCount` integrity and Σ `netWorthDeltaCents` = closing − opening over the 960-month fixture, debt interest classified by **purpose**, bad/reversed query-window rejection, conservative all-short-pure D16 exhaustion; `viewAdapters` O(1) `elapsedMonthCoverage` + 960-point × 100-account deflation regression; `trajectoryFreeze` D20 malformed/reversed freeze-date handling. CA02 and the **CA12 reporting subset** are P4-scoped-focused. No full end-to-end per-posting **audit-deficit** inventory was produced — the reporting suite asserts reconciliation/join integrity on its own fixtures only.
- Docs correction (this session): reconciled the stale Phase 4 focused counts in `refactor/phase4_handoff.md` (512→**517** engine, `reporting` 21→**26**, 53→**67** UI/adapter/history, `viewAdapters` 29→**38**, `trajectoryFreeze` 9→**14**) and the corresponding `refactor/coverage_register.md` P4-scoped legend/CA02/CA12 rows to the **post-hardening final verifier gates** — whole suite **759 pass / 91 fail** (850 total) and build **182 TS errors**. No App-mounted P5 GUI acceptance is claimed; P1/P2/P3 statuses and historical fixtures are preserved. Docs-only change; no runtime/test/plan edits.
- Reporting is implemented and tested but **not App-mounted**: `App.tsx` still passes legacy pool-era props (`years`/`pools`/`bankAccounts`/`monthlySnapshots`) to the migrated components and does not compile. Removed/impaired consumers (`App.tsx`, `CareerPlanEditor.tsx`, `financeModel.ts`, `dateMarkers.test.ts`) and restoring owners (P5.2/P5.4 UI acceptance, P7 removal) are recorded in `refactor/phase4_handoff.md`; audit/transport/warning benchmarking remains P6 (PS07/PS15/PS16).
- Intermediate breakage (ADR-022): `App.test.tsx` + `dateMarkers.test.ts` **3 pass / 91 fail** (94) and `npx tsc -b` **182 TS errors** (legacy consumers only; none in any Phase-4 engine/adapter/component module). **GUI-A08/A10 and the App-mounted CA12 subset are not claimed** (P5.4). `refactor/fixtures/projection.pre-refactor.snap` and the orphan Phase-2 characterization snapshot remain preserved.

## Phase 3 — parallel financial feature streams and paired editors
- Engine streams added headless on the P2 kernel: `income.ts` (P3I.1–P3I.5: month-scoped career/pay-plan selection, payroll compile/post from the granular `paycheck` (D9), ordered net allocations + remainder, incoming cap policy, dated other income), `spending.ts` (P3S.1), `retirement.ts` (P3S.2, D8 fully-pinned fallback), `planner.ts` (P3S.3), `cards.ts` (P3D.1/P3D.2), `loans.ts` (P3D.3, D13 nominal-APR/12 accrual + amortized installment), `housing.ts` (P3H.1–P3H.4), plus extended `valuation.ts` (D11/D13 single valuation owner) and `opening.ts`. Each module exports both its recurring `EventDefinition`s and its `ProjectionEventHandler`s; handlers post only through `state.commitChanges` / `quoteFunding` / `commitFunding`.
- Integration (D10): `featureHandlers.ts` composes the seven stream handler groups, bands `mandatory` same-date order (`loan/mortgage → housing → cards → planner/living → retirement`, preserving intra-band order), and de-duplicates stable definition ids first-wins with a collision diagnostic. `projectFeatureScenario` keeps the truthful contract (`ProjectionRun.complete:false`, `featureCoverage.processors/reporting:false` until P5) and accepts legitimate direct no-plan commits (income/cap/accrual/appreciation/sale) without fabricating a funding plan.
- Focused evidence (independently re-run by the parent after the final source corrections): engine directory **397/397** (18 files; `income` 33, `retirement` 21, `housing` 28, rest prior); paired-editor suites **42/42** (8 files; `AccountExpensesPlanner` 8, `HousingEditor` 5, `AccountCareerPlanEditor` 12, rest prior); `codec`/`commands`/`storage`/`paycheck`/`expenseImport` **117/117** — including CA01/CA05/CA06/CA07/CA09/CA10 focused fixtures and D8–D14 pins. The full-suite/build gate counts remain the final verifier's.
- Post-verifier high-risk corrections (each pinned): a missing employee retirement/HSA destination keeps the deduction in the remainder (never vanished); a midyear pay-plan switch resets each percentage line's cumulative-share target to share #1; a property funding event's amount is a ceiling (overage over the outstanding down payment is not silently consumed); an absent retirement `initialWithdrawalRatePercent` defaults to the contractual 4% (explicit 0% stays zero); an imported row stays permanently `occurred`/view-only even at execution time; a liability links to its loan via a unique `sourceConfigId` (an ambiguous duplicate is left unresolved with no money moved); and a legitimate direct commit posts with `plan: null` (counted monthly, no fabricated funding plan or audit row).
- Paired editors (standalone or partial): `FundingPolicyEditor`, `CardPlanEditor`, `RetirementSpendingEditor`, `LoanEditor`, `PurchaseEditor`, `AccountExpensesPlanner` (adds import-source removal, recurrence "Edit a schedule" editing, and keyboard copy/move support), `AccountCareerPlanEditor`, and the `HousingEditor` canonical property/debt section + grouped **account-only** funding selectors (unresolved account/career references preserved). `PaycheckEditorModal` moves to canonical `AccountDefinition`. Full GUI acceptance is **not** claimed and none is wired into `App.tsx` (P5.2/P5.4); the housing property integration is partial and the full ordered per-group `FundingPolicy` schema is **not yet persisted**.
- Schema/codec: the granular `paycheck` is the engine authority with legacy flat-only `paycheckInfo` synthesized on load (D9); imported expense provenance is permanently view-only; retirement uses a pinned fallback list; new canonical `AccountDefinition`/`LiabilityDefinition`/`PropertyDefinition`/`FundingPolicy`/`CardPlan`/`CareerDepositPlan`/`RetirementWithdrawalSourceLine` types with load-time normalization in `codec.ts`.
- Not audited this phase: within Phase 3 only actually executed **funding plans** carry audit rows; direct state commits execute and are counted per month but are **not** audited as funding-plan rows. The full ordered per-posting audit and reporting remain Phase 4 and are **not** claimed here.
- Intermediate breakage (ADR-022): `App.tsx` and the old `CareerPlanEditor.tsx` remain **unrewired** and broken (`SavingsStackedChart.tsx`, `financeModel.ts`, `dateMarkers.test.ts` likewise); `ExpensesPlanner.tsx`/`PaycheckEditorModal.tsx`/`HousingEditor.tsx` are only **partially** migrated and not App-integrated. Final verifier: full suite **565 pass / 91 fail** (656; App/dateMarkers) and build **179 TS errors** (legacy consumers only; none in Phase 3 modules). `refactor/fixtures/projection.pre-refactor.snap` preserved; full state recorded in `refactor/phase3_handoff.md`.

## Accepted account-only finance rules (planning only)
- Recorded the user's acceptance of a provably bounded minimal-gross quote, separately rounded gross-based tax and penalty, per-line cumulative allocation rounding, funded-only ceiling-cent 0% repayment, and the non-qualified HSA extra penalty waived at age 65 regardless of retirement.
- Specified a per-source user-configurable initial-balance withdrawal percentage (4% new-item default) and source-specific first-withdrawal valuation date; aligned ADR-021, review, frozen contracts, implementation/Phase-1 plans, architecture/save/account-only specs, and CA coverage targets.
- No finance code or test assertions changed in this documentation update; financial implementation and numeric validation remain pending.

## Phase 1+ implementation authorization and transition policy
- Recorded explicit permission in ADR-022/review.md to implement the account-only refactor and delete current consumers before their replacements are wired; intermediate App, build and existing tests may fail until all phases are completed. Final release still requires target behavior, tests/build, browser/80-year evidence and manual sign-off.
- Updated Phase 1/implementation/save/GUI/architecture plans: run focused checks on executable target modules, record exact intermediate failures and restoring owners, and make Phase 7 the final leftover-legacy sweep rather than the first removal point. Phase 1 can start with P1.1; no account-only runtime implementation is claimed by these documentation edits.
- Pre-commit verification: `npm run test -- --run` produced **207 passed / 1 failed** (unchanged `src/App.test.tsx:519` loan-row assertion); `npm run build` and `git diff --check` passed. The failing assertion remains tracked for the integrated account-only engine; no test was skipped or relabeled as passing.

---

# Session Changes — October 13, 2026

## 1. README Architecture & Feature Inventory
- Added three Mermaid diagrams to `README.md`: **code architecture** (module dependencies),
  **money-flow architecture** (per-month engine flow), and **GUI architecture**
  (tabs/sub-tabs/components), each with a "reading the diagram" note.
- Added an **Existing Features** section (grouped by area) and a **Known Bugs & Issues**
  section (confirmed / suspected defects / documentation drift) with runtime file references,
  grounded in `src/` and the `refactor/` audits.
- Corrected the GUI diagram's Expense Tracking route to the placeholder view
  (`src/App.tsx:4768`), which does not use `ExpensesPlanner`.
- Verification: docs-only change; test suite unchanged at 207/208 (pre-existing loan-row
  failure recorded in `refactor/testing_correctness_audit.md`); build passed.

## 2. Refactor Phase 0 — Readiness, baseline triage, contract freeze
- Executed Phase 0 of `refactor/implementation_plan.md` (tasks P0.1–P0.7): baseline triage, contract freeze, coverage register. No financial math replaced.
- Reproduced the pre-existing App loan-row failure (App.test.tsx:519) with a fixed fixture: income-funded loan draws from the annual income reservoir (R01/ADR-001); requested 500000 capped to 25135.42, fully covered, shortfall 0. Left unresolved (Phase 5).
- P0.6 test edits in `src/engine/projection.test.ts`: "uses 4 percent" now genuinely executes the four_percent source-line branch (sentinel amount:999999, toBeCloseTo(4000,6)); minimum-warning test retitled and now asserts the exact warning ("...below the configured minimum yearly amount from age 65."). Engine/schema/storage math untouched.
- New `refactor/coverage_register.md` (167 rows across F/R/G/GUI-A/TC/CA/MD/PS/B-P with owner/task/evidence/status).
- New `refactor/frozen_contracts.md` (P0.3/P0.4/P0.5/P0.7 frozen contracts; 9 remaining blockers).
- Recorded Phase 0 authorization in `refactor/architecture_decisions.md` (Gate B) and `refactor/review.md`.
- Verification: `npm run test -- --run` → 207/208 (same pre-existing loan-row failure, reproduced not fixed); `npm run build` passes; `src/engine/projection.test.ts` 90/90.

---

# Session Changes — October 12, 2026

## Standalone Manual Contribution Removal (Approved)
- Removed Yearly Contribution / Yearly % Increase controls, `ContributionPlan`, `Scenario.contribution`, defaults, and the unposted annual contribution/scalar fallback calculation.
- Load/save prune obsolete standalone contribution configuration without converting it into income. Career savings allocations and cashflow/life-event income remain the contribution paths.
- Added storage/UI coverage for removal/pruning; updated current characterization expectations while archiving original Pre-Step 0 snapshots under `refactor/fixtures/projection.pre-refactor.snap`.
- ADR-005 and feature F21/R03 now record approved removal; remaining architecture proposals stay pending review.
- Verification: full suite 207/208 passed (same pre-existing loan-row highlighting failure); all new UI/storage/characterization tests passed, build and whitespace checks passed.

## 1. Money Flow Documentation
- New `docs/MONEY_FLOW.md`: a Mermaid block diagram of how money moves through the engine (sources → reservoirs → routing → destinations) with a blocks-to-code legend and notes on the two-reservoir model (income pools vs `ledgerAccounts`)
- Linked from `docs/INDEX.md` ("Start Here")

---

# Session Changes — October 11, 2026

## Date-Based Career Selection (Phase 1 of PLAN_DATE_BASED_CAREERS.md)
- `projection.ts` now selects the active career **per month by date** (`getCareerEntryForMonth` + `careerBoundarySerial`) instead of per age-year (`getCareerEntryForAge` stays only as the year-label/legacy fallback). Fixes overlapping careers at the same age but different months misattributing income, source-line deposits, and the monthly income budget.
- Month loop uses a per-month `monthCareer` for the paycheck, net-pay plan, source lines, raise base, salary, and negative-net-pay label; monthly snapshot/waterfall `careerLabel` follows the month.
- `careerEndSavingsBalances` now records at each career's **end month** (explicit `endYearMonth`, else the age-derived last month) rather than the year-scoped `age === endAge` check, so overlapping ages no longer misfire.
- Tests: engine test with two careers overlapping at age 27 but split across months asserts per-month net income/take-home and per-career end balances; existing tests unchanged.

## 8. Date Markers
- New `DateMarker` (`id`, `label`, `date`) on `Scenario.dateMarkers`; configured in a new "Date Markers" sub-tab to the right of Warnings
- Every editable year-month field gained an optional companion `*MarkerId` (`CareerEntry`, `LargePurchase`, `LongTermPurchase`, `Loan`, `CreditCard`, `HousingEntry`, `CashflowItem`, `LifeEvent`) and every editable full-date field on `ExpenseEntry` / `RecurringExpenseEvent`
- `src/utils/dateMarkers.ts`: `resolveDateMarkers` overwrites each literal from its marker (year-month fields use `date.slice(0,7)`, expense fields use the full date), derives age-coupled fields (careers/add-ons/life events) from the resolved month, and clears dangling references while keeping the last literal
- Resolution runs at the top of `updateScenario` (before career/housing chaining) and after load in `storage.ts`, so changing a marker moves every referencing field together
- Housing chaining honors markers with highest priority (`startMarkerId` > career link > previous-end; end markers > career end link)
- New `DateOrMarkerInput` (Date/Marker mode toggle) replaces all `YearMonthInput` call sites (App purchases/long-term/loan/credit-card, `CareerPlanEditor`, `CashflowItemEditor`, `HousingEditor`) and the expense entry/recurring/one-time date inputs; choosing a marker clears conflicting chain flags
- New `DateMarkersEditor` component + `renderDateMarkersTab`; deleting a referenced marker warns with the referencing fields and clears references on confirm
- Storage: `dateMarkers` normalizer (`DateMarker`), marker-id normalization for every collection, and post-load marker resolution; also fixed `normalizeExpensesSubTab` to accept `'creditCards'`
- Tests: `src/utils/dateMarkers.test.ts` (resolution, cascade, age coupling, dangling cleanup, no-op) + App tests for the tab and a housing start linked to a marker

## 1. Career Duplicate-ID Fix
- `createDefaultCareerEntry(index, currentAge, retirementAge, id?)` now accepts an explicit id (defaultScenario.ts)
- `addCareer` assigns a unique `makeCareerId()` so re-adding after a removal can no longer reuse an existing id (App.tsx)
- `ensureUniqueCareerIds` deterministic de-duplication applied in `normalizeCareerEntries` (App.tsx) and storage load (storage.ts)

## 2. Paystub Paycheck Model + Modal Editor
- New `Paycheck` / `PaycheckCategory` / `PaycheckLine` on `CareerEntry.paycheck`: categories of lines by `kind` (earning/tax/pretax/posttax/employer), per-period amount or `percentOfGross`, optional deposit `accountId`/`bucket`, and YTD (types.ts)
- `src/paycheck.ts`: `compilePaycheck` (frequency 52/26/24/12), `getPaycheckTotals`, `resolvePaycheckInfo`, `createDefaultPaycheck`, `paycheckFromPaycheckInfo`
- `PaycheckEditorModal.tsx`: pay frequency, earnings (rate/hours/period/YTD), statutory taxes, other deductions, employer benefits; add/remove line items; live totals
- `CareerPlanEditor` shows a paycheck summary card + "Configure Paycheck" button (replaces the old Income & Deductions grid)
- Storage auto-migrates: a saved `paycheck` compiles into `paycheckInfo`; a legacy-only `paycheckInfo` synthesizes a `paycheck`

## 3. Paycheck Net Pay Drives Engine Income
- `monthlyTakeHome` is now the paycheck's net pay, with every paycheck amount scaled by `raiseFactor = (1 + annualRaiseRate)^(age − startAge)` (projection.ts)
- It drives the monthly income pool, the yearly budget, Timeline take-home, fallback thresholds, and income validation
- Source-line contributions are a percentage of **net income** (not gross)
- `netIncome` added to `ProjectionYear` / `MonthlySnapshot` / `TrajectoryYear`; results table "Salary" column replaced with "Net income"; career savings grid + summary compute against net income

## 4. Fixed-Deposit "Increase with Paycheck" Toggle
- `CareerSourceLine.increaseWithPaycheck` scales fixed `fixedAmount` deposits by the raise (projection.ts)
- Toggle added to the career savings grid; App + storage normalizers now preserve `mode` / `fixedAmount` / `increaseWithPaycheck` (previously stripped by the App normalizer)

## 5. Monthly-Withdrawal Shortfalls + Growth
- `ProjectionResult.careerWithdrawalShortfalls` tracks unfunded "Expenses (Monthly Withdrawals by Account)" withdrawals; aggregated engine warning + red row indicator with tooltip
- `CareerSourceLine.increaseWithdrawalWithPaycheck` optional growth toggle; monthly withdrawals remain account-funded

## 6. Runtime Income-Fallback Validation
- `updateScenario` re-validates `incomeFallbackAccountId` / `incomeFallbackAccountId2` against the current bank accounts and clears missing ones (App.tsx)
- Dismissible `incomeFallbackNotice` shown in the Income Fallback Accounts section

## 7. Paycheck Modal Polish
- Backdrop click no longer closes the paycheck modal
- Removed the category name input and the add-category controls

## 8. Net Pay Plans (per-career dated pay changes)
- New `CareerPayPlan` (`id`, `label`, `effectiveYearMonth`, `effectiveMarkerId`, full `paycheck` + `sourceLines`, optional `annualRaiseRate`) on `CareerEntry.payPlans`; the career's own paycheck/sourceLines are the Initial plan (types.ts)
- Editor: a "Net pay plan" **chip selector** below the "Estimate income from this career" checkbox with add/remove/rename and a `DateOrMarkerInput` effective date; the paycheck modal and the savings/expenses grids edit the selected plan (CareerPlanEditor.tsx)
- Engine resolves the active plan **per month** (`resolveActiveCareerPayPlan`) so income, deposits, and monthly withdrawals switch at the exact effective month; a plan's salary grows by the career raise from its effective date (projection.ts)
- `src/paycheck.ts`: `clonePaycheck`, `cloneSourceLines`, `createCareerPayPlan`
- Date markers: `resolveDateMarkers` resolves each plan's `effectiveMarkerId` → `effectiveYearMonth` (base + timelines); `describeMarkerReferences` lists plan references (utils/dateMarkers.ts, App.tsx)
- Storage normalizes `payPlans` (paycheck + sourceLines); `cloneCareer` and the App source-line normalizer handle plans (storage.ts, App.tsx)

## 9. Income Verification Warnings
- Engine warns when a paycheck/plan's deductions exceed its gross pay (net pay would be negative and is treated as `$0`) — per career/plan, surfaced in the Warnings tab (projection.ts)
- Housing chips now show yellow (fallback) / red (shortfall) income indicators with a tooltip (and a note in the editor), mirroring purchases/loans; income-funded housing usage was already recorded in `incomeValidation` (HousingEditor.tsx, App.tsx, styles.css)
- Career paycheck summary marks "Net pay / period" red with a hint when deductions exceed gross (CareerPlanEditor.tsx)
- Confirmed: income-funded purchases/housing draw from the active net-pay plan's monthly net pay, and the pool is clamped at 0 (never negative)

## 10. Credit Card Income Verification
- Autopay income-funded credit card payments now record `incomeFundedItemStatuses` (fallback/shortfall), matching the fixed/minimum/pay-in-full/fixedPlusLump modes (projection.ts)
- Credit-card list rows show a yellow (fallback) / red (shortfall) indicator with a tooltip, and account-funded cards surface `creditCardFundingShortfalls`; the Payment Schedule Projection shows a per-card income notice (App.tsx)
- Account-funded credit-card funding shortfalls now also emit an engine warning, so credit cards appear in the Warnings tab in every payment mode (projection.ts)
- Income-funded credit cards were already included in the income-usage warnings calculation (`incomeValidation`), which the Warnings tab renders

## 11. Credit Card Autopay End Date
- `CreditCard.autopayEndYearMonth` + `autopayEndMarkerId`: autopay now pays through and including the end month and stops after (types.ts, projection.ts)
- Storage normalizes the new fields; date markers resolve `autopayEndMarkerId` → `autopayEndYearMonth` and `describeMarkerReferences` lists it (storage.ts, utils/dateMarkers.ts, App.tsx)
- Editor: an "Autopay Ends" `DateOrMarkerInput` (required; auto-filled to current month + 12 when switching a card to autopay) and the card row shows `until YYYY-MM` (App.tsx)

## 12. Summed Housing Expense in Income Warnings
- Income-funded housing (down payment + P&I/rent, taxes & insurance, HOA/maintenance, PMI) is now drawn from income in a single `processIncomeWaterfall` call per housing entry per month, so the Warnings tab lists one summed "housing expense" line instead of each sub-item separately (projection.ts)

## 13. Depletion Detection Only on Actual $0
- Removed the hard-coded `$100k` net-worth floor heuristic; `depleted` is now `currentLedgerSum <= 0` only, so "runs out of money at age X" (and the ending balance) reflect the real ledger (projection.ts)
- `withdrawal < requiredMinimumWithdrawalForPeriod` is now a Warnings-tab entry instead of a depletion trigger (projection.ts)
- Fixes the reported case where the summary said "runs out at 54" while the graph/table still showed positive balances

---

# Session Changes — June 19, 2026

## 1. Taxes & Penalties Tracking in Results Table
- Added `taxesPaid` and `penaltiesPaid` fields to `ProjectionYear` (types.ts)
- Engine tracks tax/penalty amounts from ALL withdrawal types (retirement, purchases, loans, career monthly, housing)
- New "Taxes" and "Penalties" columns in ResultsTable after "Withdrawal"
- Tax/penalty split proportional to pool's `taxRate` / `penaltyRate`

## 2. Merged Extra Cashflow Column
- Removed "Extra Cashflow" column from ResultsTable
- Withdrawal column now shows `year.withdrawal + year.extraCashflow` combined

## 3. Display Values in Current Dollars
- Checkbox above ResultsTable toggles inflation-adjusted display
- All monetary columns deflated by cumulative inflation factor from baseline year
- No engine changes — pure display transformation via `adjustedTableYears`

## 4. Tax Rate Lock in Career Timeline
- Lock/unlock button on Tax Rate % input
- When locked: editing other fields recalculates leftoverIncome from locked rate
- `taxRateLocked: boolean` on TaxInfo type

## 5. Housing Expenses Feature
- New `HousingEntry` type supporting mortgages and rentals
- "Housing Expenses" sub-tab under Finances Prediction
- Engine processes: mortgage amortization, PMI auto-drop (80% LTV), property tax, insurance, HOA, maintenance
- Rental income deposits to specified account via reusable `applyAccountDeposit()`
- Sell proceeds at sell date with account selection
- Rental End Date field for apartment leases
- Split into separate Mortgage and Rental tables for cleaner UI

## 6. Inflation Simplification
- Removed `ReturnMode` (manual/historical) — manual is now the only mode
- Removed `HistoricalYear` type and `src/data/historicalReturns.ts`
- Removed `inflationAdjusted` from CashflowItem, LifeEvent, WithdrawalPlan
- Removed per-item "Adjust for inflation" checkboxes
- Inflation now controlled exclusively by global "Enable inflation" toggle
- "Inflation" panel moved to Options tab (after Age Options)
- Removed `equityAllocation`, `fixedIncomeAllocation`, `fixedIncomeDuration` from PortfolioConfig
- Portfolio return rate now balance-weighted average of pool rates
- Removed `fixedIncomeReturn`, `preRetirementEquityReturn`, `postRetirementEquityReturn` from ManualReturnModel
- PoolDefinition split into `preRetirementReturnRate` / `postRetirementReturnRate`
- Net Worth tab shows Pre-Ret %, Retirement Spending shows Post-Ret %
- Removed Portfolio Returns panel from Options tab

## 7. Retirement Withdrawal Pool Fallback
- When a retirement withdrawal source pool is exhausted, engine falls back to other pools in priority order
- Automatically covers gap from next available pool
- Prevents false "plan runs out of money" due to pool-level shortfall

## 8. Housing Income Status Tracking
- Added `incomeFundedItemStatuses[housing.id]` tracking for all housing income paths
- Housing rows now show yellow (fallback) / red (shortfall) highlighting
- Hover tooltip shows income usage breakdown and fallback account details

## 9. Funding Source Normalization Fix
- `fundingSource` now defaults to `'income'` instead of `undefined` in storage normalization
- Added missing `fundingSource` to long-term purchase normalization
- Engine added defensive `?? 'income'` on all purchase funding checks

## 10. Fallback Account Warning
- Engine emits warning when income-funded items exceed available income without fallback accounts configured
- Hint text added below Income Fallback Accounts dropdowns in Career Timeline

## 11. Monthly Income Processing for Purchases
- Income-funded and account-funded large purchases now processed per-month (not per-year)
- Each month gets its own `monthlyTakeHome` pool instead of annual pool
- Long-term income-funded purchases also processed monthly
- Fixes bug where $2,000 purchase appeared covered by $1,389/mo income (was using annual pool)
- Column shows per-month post-purchase account balances

## 12. Purchase Tooltip
- Rich tooltip on ALL purchase rows (not just non-viable ones)
- Shows: funding source breakdown, income vs fallback split, all items competing that month
- Arrow (→) marks current purchase in the items list

## 13. Removed Housing Costs & Leftover Income Fields
- Removed "Housing Costs (monthly)" input from Career Tax Info
- Removed "Leftover Income (monthly)" input — tax rate now drives leftover income exclusively
- Added "Monthly Savings" display field (dollar amount saved per month)
- Fixed AGENTS.md formula: `monthlyTakeHome = max(0, leftoverIncome/12 - otherExpenses)`

## 14. Null Check for Shortfall Test
- Fixed shortfall detection test to verify `fallbackDetails` array length instead of just status
- Added proper null-check assertions for fallback account balances

## 15. Correct Account Balance Column for Income Purchases
- Changed "Account Balance After Purchase" from text labels to dollar amounts
- Shows remaining monthly income from `incomeUsageByMonth` data
- Shows fallback account post-debit balance when fallback was used
