# Phase 5 — Complete Application Integration and Save-Format Cutover Candidate (authorized breakdown)

Implementation authorized by [ADR-022](architecture_decisions.md#adr-022--incremental-implementation-authorized-intermediate-breakage-permitted). Builds on `phase1_handoff.md` (codec/commands/hydration), `phase2_handoff.md` (kernel + `projectScenario` facade), `phase3_handoff.md` (feature streams + `projectFeatureScenario` + standalone editors) and the Phase-4 reporting/adapters plan. Scope: assemble one coherent engine/UI/schema candidate — wire the App to canonical commands and named contexts, integrate the single `projectFeatureScenario` projection, complete the save lifecycle, and execute the full CA01–CA13 and GUI-A01–A10 acceptance. Final full-suite/build/release verification stays **Phase 8**; this phase produces a sufficiently runnable integrated candidate for Phase-6 measurement.

Owner legend: S=Schema/config, K=Kernel, I=Income, O=Obligations, R=Reporting, U=UI, P=Performance, Q=Quality. The integration owner serializes `App.tsx` and the coverage-flag flip; S owns the codec/storage cutover.

Inputs (frozen): `frozen_contracts.md`, ADR-021/ADR-022, the P5 warning language (`implementation_plan.md` §Phase 5), D8–D20 from prior phases. Entry points: `projectFeatureScenario` (`src/engine/featureHandlers.ts`), `createConfigurationCommands` (`src/commands.ts`), `loadAppState`/`saveAppState`/`getStorageStatus` (`src/storage.ts`), reporting selectors + `viewAdapters` (P4).

---

## 0. Locked engineering decisions

### D21 — `App.tsx` becomes commands + named contexts + rendering

The composition root stops being a monolith with local rebuilds and dual `projectScenario(...)` calls (currently `retirementScenario`/`futureScenario` at `App.tsx:700/724`, importing removed symbols `calculateAgeFromBirthDate`/`describeIncomeValidationGroup`/`resolveCurrentAge`). **Adopted:** every scenario mutation routes through `createConfigurationCommands` (never a local `updateScenario` rebuild), and every projection routes through `projectFeatureScenario` with one selected named timeline/pay-plan. No independent preview loops (payoff/amortization/balance estimates) survive in a visible path — they read the shared reporting selectors instead.

### D22 — Editor mounting and empty/no-career states

The P3 standalone editors (`AccountCareerPlanEditor`, `AccountExpensesPlanner`, `RetirementSpendingEditor`, `PurchaseEditor`, `CardPlanEditor`, `LoanEditor`, `FundingPolicyEditor`, `HousingEditor`) mount into the App at their tab placements, bound to canonical commands. Valid **no-career** plans render (chart/table/warnings do not gate on an enabled career); selected timeline/pay-plan, markers, deletion cleanup, and stale modal/range state all resolve from the canonical registry.

### D23 — Truthful coverage flip (single projection)

Once the default handler factory composes all four streams and reporting selectors are consumed, the integration owner flips the facade's truthful flags: `featureCoverage.processors → true`, `featureCoverage.reporting → true`, `DEFERRED_FEATURE_DOMAINS` empties, and `ProjectionRun.complete` changes from the literal `false` to a runtime `boolean` that is `true` only when all domains are covered. No mixed old/new financial calculation is ever displayed.

### D24 — Save-format cutover and pruning

The codec already blocks future versions and prunes obsolete pool-era fields (P1.3); P5.3 completes the cutover: canonical save prunes approved obsolete fields **across all plans** (base + inactive timelines + pay plans + import + UI), including D9's flat `paycheckInfo` derived cache (the granular `paycheck` is authority; `paycheckInfo` is re-derived on load, not persisted). Live audits/caches/expanded recurrences/calculated balances are never persisted over openings. Autosave coalesces writes and flushes on unload; visible save diagnostics surface the storage status.

### D25 — Warning rendering (reuses D16)

The Warnings tab and row indicators render the D16 selectors verbatim: `"Some scheduled payments could not be fully funded, beginning in [month]."` and `"eligible funding accounts exhausted"` only when eligible sources actually hit zero; fallback (yellow) is never reported as shortfall (red) or exhaustion.

### D26 — Cross-feature contention fixture (P5.1/P5.5)

One fixed-date scenario where payroll allocation, an ordinary card, a rent/mortgage group, a loan installment, retirement spending, a planner recurrence, and a discretionary purchase compete for the same funds in the same month, with independently computed expected shortfalls (never back-derived). This drives P5.1 and the CA01–CA13 cross-feature acceptance.

---

## P5.1 (K + integration owner) — Single integrated orchestration

**Prereqs:** P3 streams/P4. **Deliverable:** `projectFeatureScenario` becomes the one projection path; the facade runs one dated ledger through all event phases and shared reports. Exercise D26 contention: income posts once, obligations draw in phase order, and shortfalls are attributable to the correct request. Flip the coverage flags (D23).

**Files:** `src/engine/featureHandlers.ts`, `src/engine/projection.ts`. **Acceptance:** D26 fixture produces independently-verified balances/shortfalls; `complete === true` only with full coverage.

## P5.2 (U + integration owner) — App wiring to commands and named contexts

**Prereqs:** P1.6/P3 editors/P4. **Deliverable:** rewrite `App.tsx` per D21/D22 — mount all editors, route every write through `createConfigurationCommands`, select one named context for every projection, render no-career plans, and remove independent preview loops. Selected timeline/pay-plan, markers, deletion cleanup, and stale modal/range state work.

**Files:** `src/App.tsx`, editor mounting, chart/table/summary consumption of P4 selectors. **Acceptance:** App typechecks and renders from the integrated engine; no legacy `ProjectionResult`/pool-era imports remain.

## P5.3 (S) — Save lifecycle and cutover

**Prereqs:** P1 codec/P3 shapes/P4.6. **Deliverable:** D24 — canonical save retains supported history/import/trajectory/UI/config and prunes approved obsolete fields (incl. `paycheckInfo`) across all plans; hydration/recovery/reset/autosave/final-flush and visible save diagnostics; never persist live audits/caches/expanded recurrences or calculated balances.

**Files:** `src/codec.ts`, `src/storage.ts`, `src/App.tsx` save effect. **Acceptance:** unrelated-edit/reload persistence (G01), clone isolation, corrupt/future-version guards honored end-to-end.

## P5.4 (Q + U) — GUI-A01–A10 acceptance

**Prereqs:** P5.1–P5.3. **Deliverable:** execute GUI-A01–A10 adapted to accepted rules (universal partial purchases, held deposits, view-only occurred imports). Verify every G01–G40 row: empty↔populated hooks, clone isolation, new-field unrelated-edit/reload persistence, signed net-worth chart, current-dollar tooltip consistency, warning boxes (D25), frozen trajectory labels.

**Files:** rebuilt `src/App.test.tsx` (+ component tests). **Acceptance:** GUI-A01–A10 and G01–G40 pass; any remaining row failures are recorded with owners, not skipped.

## P5.5 (Q) — CA01–CA13 cross-feature acceptance and before/after table

**Prereqs:** P5.1–P5.3. **Deliverable:** complete CA01–CA13 (CA03/04/08/13 already P2-scoped, CA01/05/06/07/09/10 P3-scoped; close the cross-feature gaps). Produce the target before/after table for B01–B09 from `refactor/fixtures/projection.pre-refactor.snap`, documenting authorized income/debt/annual/growth/card/planner corrections instead of blanket snapshot refreshes. The historical loan-row failure is resolved/classified in target behavior.

**Files:** `src/engine/projection.test.ts`, `src/App.test.tsx`, coverage register. **Acceptance:** CA01–CA13 and the B01–B09 table; original snapshots preserved.

---

## Exit criteria

1. One integrated candidate: App routes through canonical commands and one `projectFeatureScenario`; no independent preview loop or mixed old/new math is displayed.
2. Coverage flags truthful: `processors`/`reporting` true, deferred domains empty, `complete` true only when fully covered (D23).
3. Save cutover: prune approved obsolete fields (incl. `paycheckInfo`) across all plans; hydration/recovery/reset/autosave/flush and diagnostics correct; no live audit/cache/calculated-balance persisted (D24).
4. GUI-A01–A10 and G01–G40 pass; CA01–CA13 and the B01–B09 before/after table are documented with preserved snapshots.
5. Remaining whole-suite/build failures and their owners are recorded honestly; a runnable integrated candidate is available for Phase 6. Final full-suite/build/release verification remains Phase 8.

Phase 5 exit does **not** assert a release — it produces the integrated candidate and its focused CA/GUI evidence (ADR-022).

## Parallelism

P5.1 (orchestration + coverage flip) and P5.3 (save cutover) are independent and can run in parallel; P5.2 (App wiring) depends on both P5.1 and the P4 selectors. P5.4 and P5.5 are acceptance gates that run after P5.1–P5.3 and can proceed in parallel (separately owned `App.test.tsx` vs `projection.test.ts`/coverage). Shared edits to `App.tsx` serialize through the integration owner; `codec.ts`/`storage.ts` through S; the coverage register through Q.
