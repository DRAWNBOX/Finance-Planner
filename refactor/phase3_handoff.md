# Phase 3 Handoff — Parallel Financial Feature Streams and Paired Editors

Status: **Phase 3 is implemented only to its scoped exit criteria (ADR-022, intermediate
breakage authorized). It is not a runnable release.** The four financial feature streams exist as
headless `ProjectionEventHandler` modules on the P2 kernel and pass their focused suites; the
feature-handler composition seam (`featureHandlers.ts`) assembles them against one canonical
context. `App.tsx` and the old `CareerPlanEditor.tsx` remain the **unrewired** legacy surfaces and
stay **broken**; `ExpensesPlanner.tsx`, `PaycheckEditorModal.tsx` and `HousingEditor.tsx` have been
only **partially** migrated (pool-era references dropped / canonical controls started) and are still
not App-integrated, alongside `SavingsStackedChart.tsx`, `financeModel.ts` and `dateMarkers.test.ts`.
The App/build/full suite are recorded, never treated as passing. This document records the actual
state and the owning later tasks — it does **not** assert full feature, GUI, reporting, performance
or release acceptance.

Authority: `phase3_plan.md` (P3I.1–P3I.6 / P3S.1–P3S.5 / P3D.1–P3D.4 / P3H.1–P3H.5, D8–D14),
builds on `frozen_contracts.md` (P0.3.2 event phases, P0.3.3 funding/partial policy, P0.3.4 cents
rounding, P0.5.1–P0.5.5), ADR-021/ADR-022, `phase1_handoff.md` (canonical config/codec/commands)
and `phase2_handoff.md` (kernel: dates/money/state/taxes/funding/configuration/scheduler/
valuation/projection). Coverage rows are updated in `coverage_register.md`.

> **Count provenance.** The engine figure below (**397/397**, 18 files) and the paired-editor
> figure (**42/42**, 8 files) were independently re-run by the parent **after** the final
> H.3/retirement/projection source corrections; the codec/commands/storage/paycheck/expenseImport
> set stays **117/117**. These are focused-suite tallies, truthful at write time. The full-suite
> and build gate numbers (§12) are confirmed by the final verifier — not a release claim.

---

## 1. Scoped exit criteria vs. actual state

| `phase3_plan.md` exit criterion | Actual state |
|---|---|
| 1. Each stream's focused suite passes in isolation (`income`/`spending`/`retirement`/`planner`/`cards`/`loans`/`housing` + extended `valuation`/`featureHandlers`). | Met at the focused level: the engine directory is **397/397** across 18 files (§4). No App/build/full-suite claim. |
| 2. Every handler posts only through `commitChanges`/`quoteFunding`/`commitFunding`; no separate ledgers, no fabricated income, no negative cash, no future-income spending. | Met by construction and tested per stream: handlers post sparse account/liability/property deltas through the sole `state.commitChanges`; funding quotes are read-only; zero/unfunded targets are strict no-ops. Full-horizon composition enforcement is the integration owner's. |
| 3. CA01/CA05/CA06/CA07/CA09/CA10 focused acceptance passes with independently computed fixtures; CA09 demonstrates held-deposit completion without a second down-payment expense. | Met as **focused** stream evidence (§4). Not full end-to-end CA/GUI acceptance. |
| 4. D8–D14 are pinned in tests. | Met: D8 (`funding.test.ts`, `retirement.test.ts`), D9 (`income.test.ts`), D10 (`featureHandlers.test.ts`, `projection.test.ts`), D11/D13 (`valuation.test.ts`, `loans.test.ts`, `housing.test.ts`), D14 (month-scoped selection in `income.ts`/`configuration.ts`). |
| 5. Removed/impaired consumers, broken App/build/full-suite, restoring owners recorded, never treated as passing. | Met: §8/§9. |

Phase 3 exit does **not** assert a runnable App, full suite, build, combined cross-feature behavior
(P5) or reporting (P4) — ADR-022.

---

## 2. Locked decisions (D8–D14), accepted rules

- **D8 — Retirement fallback flag policy.** A user-pinned `retirementOrderedList` is explicit
  consent: every listed position is eligible regardless of its `allowAutomaticFallback` flag. The
  flag gates only the **automatic** global fallback (`purpose !== 'retirement'`). Implemented in
  `funding.ts` `resolveSourceOrder`/`isExplicitlyPinned` and pinned by
  `funding.test.ts` ("allows an explicitly pinned retirement source even as a 2nd+ position with
  allowAutomaticFallback false"; explicit-empty list = pinned/unresolved) plus the retirement
  stream D8 block. Retirement never consults the ordinary global policy.
- **D9 — Single paycheck authority.** The granular `CareerEntry.paycheck` is the **sole engine
  authority**; `resolvePaycheckInfo`/`paycheckInfo` is never read by the engine. `paycheck.ts` is
  the shared compiler; `compilePaycheckLineAmounts` exposes per-line destination metadata
  (`bucket`/`accountId`) so each retirement/HSA deposit posts separately. `income.test.ts` asserts
  the compiler never reads a flat-only `paycheckInfo` (D9 granular authority). `paycheckInfo`
  remains a derived cache for the legacy editor until P5.2 removes it.
- **D10 — Handler-seam contract per stream.** Each stream exports both its recurring
  `EventDefinition`s and its `ProjectionEventHandler`s; handlers post only via `commitChanges`
  (through `quoteFunding`/`commitFunding`) and return `{ committed, plan?, diagnostics? }`. A
  zero/unfunded target never fabricates a plan row. Same-date `mandatory` order is
  `loan/mortgage → housing → cards → planner/living → retirement`. The composition seam is §5.
- **D11 — Single valuation owner.** `valuation.ts` is the sole owner of the non-payment postings:
  account APY (effective `(1+r)^(1/12)−1`), property appreciation (effective annual family), and
  debt-interest accrual (nominal, see D13). Streams call it; no stream duplicates the formula.
- **D13 — Debt accrual and required-installment formula.** Debt accrues monthly at **nominal
  `APR/12`** (distinct from the account effective-APY rule); the required amortized installment is
  `max(standard amortized payment over remaining term, configured minimumMonthlyPayment)`, capped
  at outstanding debt, no undocumented lower-rate clamp. A funded payment allocates **interest
  first, then principal**; unfunded amounts retain unpaid interest/principal; 0% cards accrue zero;
  no fabricated fees/proceeds/penalties. `valuation.test.ts` (D13 accrual), `loans.test.ts`
  (amortized quote + accrual), `housing.test.ts` (mortgage via the same helper).
- **D14 — Date-based careers reconciliation.** Career selection is month-scoped; no age-only
  fallback through an explicit date gap. Cashflow/life-event dates may still derive deterministically
  from configured ages and the opening/DOB anchor. Resolved by the P2.5 compiler and consumed by
  `income.ts` and `spending.ts`.

(D12 — module/test layout — is the file-per-responsibility table; it is followed but not a
financial rule.)

---

## 3. Completed task IDs, modules and focused counts

### New engine modules (runtime)

| Task | Module | Test | Owns | Lines (module/test) |
|---|---|---|---|---|
| P3I.1–P3I.5 | `src/engine/income.ts` | `income.test.ts` | month-scoped career/pay-plan selection, payroll compile+post, ordered net allocations/remainder, cap overflow, other income/cashflow/life-event inflows | 1075 / 760 |
| P3S.1 | `src/engine/spending.ts` | `spending.test.ts` | large/long-term purchases, career monthly-withdrawal expenses, cashflow/life-event outflows | 729 / 636 |
| P3S.2 | `src/engine/retirement.ts` | `retirement.test.ts` | retirement withdrawal source lines (amount / `percentOfInitialBalance`, D8 pinned fallback) | 628 / 365 |
| P3S.3 | `src/engine/planner.ts` | `planner.test.ts` | manual one-time/recurrence adapters, occurrence identity, occurred-import view-only | 396 / 361 |
| P3D.1/P3D.2 | `src/engine/cards.ts` | `cards.test.ts` | ordinary expected-payment schedule + permanent-0% payoff | 469 / 335 |
| P3D.3 | `src/engine/loans.ts` | `loans.test.ts` | loan/mortgage accrual, installment, extra/down payment | 863 / 589 |
| P3H.1–P3H.4 | `src/engine/housing.ts` | `housing.test.ts` | held-deposit acquisition, payment groups, sale/disposition, appreciation events | 1444 / 975 |
| D11/D13 | `src/engine/valuation.ts` (extended) | `valuation.test.ts` | account APY + debt accrual + property appreciation | 360 / 309 |
| D10 | `src/engine/featureHandlers.ts` | `featureHandlers.test.ts` | composition seam + coverage flags | 311 / 430 |

Stream I is **headless complete** for P3I.1–P3I.5; the paired editor (P3I.6) is standalone/partial
(§6). Streams S/D/H likewise ship their P3S.1–P3S.4 / P3D.1–P3D.3 / P3H.1–P3H.4 processors; their
paired editors (P3S.5/P3D.4/P3H.5) are standalone/partial.

---

## 4. Focused evidence

### 4.1 Engine focused suite (18 files) — **397/397**

Command:

```
npx vitest run src/engine
```

Result: **18 files, 397 tests passed / 0 failed.** `it()` counts by file:
`dates` 21, `money` 17, `state` 29, `taxes` 27, `funding` 26, `configuration` 39, `scheduler` 17,
`projection` 26, `valuation` 23, `opening` 7, `income` 33, `spending` 25, `retirement` 21,
`planner` 16, `cards` 11, `loans` 25, `housing` 28, `featureHandlers` 6 = **397**.

The Phase-2 kernel total was 191/191; Phase 3 adds the nine feature modules and expands
`valuation`/`projection` (`opening.test.ts` is the P1.5 opening lane).

### 4.2 Paired-editor focused suites (8 files) — **42/42**

Command: `npx vitest run src/components`

`AccountCareerPlanEditor` 12, `AccountExpensesPlanner` 8, `CardPlanEditor` 5, `FundingPolicyEditor`
4, `RetirementSpendingEditor` 4, `HousingEditor` 5, `LoanEditor` 2, `PurchaseEditor` 2 = **42**.
(These prove the standalone editors; they are **not** App/GUI acceptance — §6.)

### 4.3 Config/codec/command/importer focused suites (5 files) — **117/117**

`codec` 48, `commands` 35, `expenseImport` 14, `storage` 12, `paycheck` 8 = **117**.

### 4.4 CA focused subset (not full feature or GUI acceptance)

| CA | Task | Focused source of proof | Status |
|---|---|---|---|
| CA01 | P3I.2/P3I.3 | `income.test.ts` CA01 block: gross `$10,000`/mo, tax `$2,000`, employee retirement `$500` → net `$7,500`; 10%-of-net → retirement (`$750`), fixed `$100`/period → HSA, remainder → checking; gross posted once; no double count; D9 flat-only-paycheckInfo guard | **P3-scoped (partial)** |
| CA05 | P3D.3 | `loans.test.ts`: fixed-date loan full/partial/zero funding; D13 monthly accrual (nominal APR/12); funded principal reduces cash and debt equally; interest remains due; excess capped | **P3-scoped (partial)** |
| CA06 | P3D.1/P3D.2 | `cards.test.ts`: ordinary `start`…`start+11` = twelve expenses/no debt; `$100` 0% over three fully funded dates = `$33.34`/`$33.33`/`$33.33`; recompute after partial payment; residual payoff once; retained debt | **P3-scoped (partial)** |
| CA07 | P3S.2 | `retirement.test.ts`: per-source rate new-item 4%, editable 0/6%, `$100k` observed balance → `$4k`/`$6k` initial target; later-start source uses its own selected-date balance; min/max/inflation; D8 pinned fallback | **P3-scoped (partial)** |
| CA09 | P3H.2 | `housing.test.ts` CA09 block + `state.test.ts` (CA09 acquisition conservation) + `opening.test.ts` (pending acquisition, no opening debt): `$30k` held toward `$60k` → deposit, no home/mortgage/PMI/appreciation; later `$30k` → atomic completion to `$300k` property/`$240k` mortgage, deposit delta `−$30k`, net-worth delta `0`, no second down-payment expense | **P3-scoped (partial)** |
| CA10 | P3S.1/P3S.3 | `planner.test.ts`: one obligation per dated occurrence, stable keys `planner:<id>:<date>` / `recurrence:<id>:<date>`, inclusive day-31 clamp, partial unpaid, occurred imports view-only | **P3-scoped (partial)** |

CA03/CA04/CA08/CA13 remain P2-scoped (kernel) with no P3 feature-level completion claimed;
CA02/CA11/CA12 are reporting/App/P1 lanes (unchanged).

### 4.5 D-rule pinned tests

- **D8** — `funding.test.ts` (pinned retirement list, 2nd+ position with
  `allowAutomaticFallback === false` still funds, explicit empty list pinned; automatic global
  fallback still excluded); `retirement.test.ts` D8 block.
- **D9** — `income.test.ts` ("never reads a flat-only paycheckInfo"); `paycheck.test.ts`
  `compilePaycheckLineAmounts` annualization + destination metadata.
- **D10** — `featureHandlers.test.ts` (band order, id-collision diagnostic, timeline selection,
  tiny integrated run, contractual-liability mortgage window); `projection.test.ts` direct
  no-plan commits + state-aware target resolver + default composition seam.
- **D11/D13** — `valuation.test.ts` (debt APR/12, property appreciation, account APY unchanged);
  `loans.test.ts` (amortized quote/accrual); `housing.test.ts` (mortgage group accrual).
- **D14** — month-scoped selection in `income.ts` + `configuration.ts`; no age-only money in the
  engine.

### 4.6 High-risk corrections (final source fixes, each pinned)

| Correction | Fix | Pinned by |
|---|---|---|
| Missing employee destination money retained | An employee retirement/HSA deduction whose destination account is unresolved stays in the remainder rather than being vanished; a `no resolvable destination` diagnostic is recorded. | `income.test.ts` ("keeps an employee retirement deduction in the remainder when its destination is missing"; "keeps an employee HSA deduction in the remainder when its destination is missing"; "leaves a missing destination unresolved in the remainder") |
| Midyear plan share reset | A pay plan that starts midyear resets each percentage line's cumulative-share target to share `#1` from its effective month (no carry-over of the prior plan's numerator). | `income.test.ts` ("resets the cumulative-share target to share #1 at a midyear plan switch") |
| Housing funding overage capped | A property funding event's amount is a **ceiling**: only the outstanding down-payment remainder is debited (excess not silently consumed), with a separate tax withheld on a taxable overage. | `housing.test.ts` ("funding event target is capped to the outstanding down payment"; "caps a taxable overage to the net outstanding and withholds a separate tax") |
| Retirement 4% absent | An absent `initialWithdrawalRatePercent` now defaults to the contractual 4%; an explicit `0%` stays a zero withdrawal (not a 4% default). | `retirement.test.ts` ("defaults an absent rate to the contractual 4% (not 0)"; "honors an explicit 0% rate as a zero withdrawal (not a 4% default)") |
| Imported recurring occurred | An imported row is permanently `occurred`/view-only; re-enforced at execution time so a leaked definition can never debit an occurred observation. | `expenseImport.test.ts` (provenance); `planner.test.ts` ("refuses an occurred record at execution time even if a definition leaks in") |
| Loan `sourceConfigId` linkage | A liability links to its loan config via a **unique** `sourceConfigId` (own-id fallback); a duplicated `sourceConfigId` is an ambiguous link — reported deterministically and left unresolved with no money moved. | `loans.test.ts` ("sourceConfigId linkage"); `configuration.test.ts` (threads/resolves + duplicate diagnostic, observed-zero kept authoritative) |
| Legitimate direct commits (`plan: null`) | A committed direct state commit executes and is counted monthly **without** a funding plan, audit row or warning (no fabricated gross/net budget). | `projection.test.ts` ("counts a committed direct state commit (plan: null) as an executed occurrence without a plan, audit row or warning") |

---

## 5. Handler composition (D10) and the truthful `ProjectionRun` contract

`featureHandlers.ts` is the single composition seam:

- **`createFeatureEventDefinitions(scenario, context, diagnostics?)`** builds each stream's
  `build*EventDefinitions` against one canonical compiled context, applies the `mandatory` bands
  (`FEATURE_MANDATORY_BANDS`: loan `1000` → housing `2000` → cards `3000` → planner/living `4000`
  → retirement `5000`, preserving intra-stream priority), and de-duplicates by `definitionId`
  (first wins) with an explicit collision diagnostic. Global vs timeline-local scope is preserved
  by the streams reading `context.global` / `context.domains`; housing is built from the
  scenario's canonical properties + the selected timeline's housing + the compiled liabilities.
- **`createFeatureHandlerFactory(scenario?)`** composes the seven `create*Handlers` groups
  (income, spending, planner, loans, cards, retirement, housing) into one
  `ProjectionHandlerFactory`. Handlers post only through `state.commitChanges`; the factory never
  mutates state.
- **`projectFeatureScenario(scenario, options)`** selects exactly one named timeline, compiles one
  context, assembles definitions + handlers, delegates to `projectScenario`, and merges
  feature-layer diagnostics.

The wrapper **preserves the truthful P2.7 contract**: `ProjectionRun.complete` stays `false`,
`featureCoverage.processors` stays `false`, `featureCoverage.reporting` stays `false`, and
`DEFERRED_FEATURE_DOMAINS` is unchanged until P5. Within this phase only **actually executed
funding plans** carry audit rows; direct state commits execute and are counted per month but are
**not** recorded as funding-plan audit rows. `projection.ts` accepts a legitimate direct commit
with no plan (`{ committed: true, plan: null }`) — income/cap/other direct deposits, debt accrual,
property appreciation, sale, rental income — counting it as an executed occurrence without a
funding plan, audit row or warning (`projection.test.ts` D10 direct no-plan-commit block). A
**full ordered per-posting audit remains Phase 4 and is not claimed here.** A scheduled occurrence
with no registered handler is still reported by the facade.

**No App integration this phase** (`App.tsx` still imports the removed singleton/pool-era symbols)
and **no P4 reporting** (`reporting: false`; the legacy `years`/`summary`/`incomeUsageByMonth`/
`incomeValidation` result fields are intentionally absent).

---

## 6. Paired editors (P3I.6/P3S.5/P3D.4/P3H.5) — standalone or partial

The paired editors exist as **standalone** canonical-write components with their own focused
suites; none is wired into `App.tsx`, so **full GUI acceptance (GUI-A01–A10) is NOT claimed**.

| Editor | Task | State |
|---|---|---|
| `AccountCareerPlanEditor.tsx` (careers, pay plans, net-pay allocations + remainder, cap/overflow) | P3I.6 | Standalone; focused suite **12/12** (`AccountCareerPlanEditor.test.tsx`). Uses `deepClone`, `createCareerPayPlan`, `PaycheckEditorModal`; recompiles `paycheckInfo` only on the Initial plan. App-level integration pending P5.2. (Parent labeled this test lane "in-flight"; it is present and passing in the re-run.) |
| `AccountExpensesPlanner.tsx` (weekly account/category planner, drag/copy/move, import provenance) | P3S.5 | Standalone; **8/8** — including import-**source removal**, recurrence ("Edit a schedule": start/end/cadence/day-of-month) editing, and keyboard support (focus a cell/expense; `C` copy / `M` move / `Enter` paste, `Escape` cancel, `tabIndex`/aria labels). Occurred imports stay view-only. |
| `RetirementSpendingEditor.tsx` (per-source amount / `percentOfInitialBalance`, valuation date, payment day, min/max, per-source fallback) | P3S.5 | Standalone; **4/4**. |
| `PurchaseEditor.tsx` (large/long-term; source-line funding order) | P3S.5 | Standalone; **2/2**. |
| `CardPlanEditor.tsx` (two card types, markers, funding, residual payoff) | P3D.4 | Standalone; **5/5**. |
| `LoanEditor.tsx` (contract, opening liability, funding policies) | P3D.4 | Standalone; **2/2**. |
| `FundingPolicyEditor.tsx` (shared primary + ordered fallback control) | P3S.5/P3D.4/P3H.5 | Standalone; **4/4**. Used by card/retirement/loan/purchase editors. |
| `HousingEditor.tsx` (mixed mortgage/rental chips + **canonical property/debt** section) | P3H.5 | **Partial.** Canonical property/debt controls added (property status/value, required down payment, dated funding events with deterministic IDs, linked mortgage opening balance) and grouped funding sources are now **account-only** selectors (income shown only as disabled/unavailable; unresolved account/career references preserved, never dropped) with **5/5** focused tests. The property integration is partial, the full ordered per-group `FundingPolicy` schema is **not yet persisted**, and a **property correction remains pending** (App wiring / opening-observation editing) before GUI acceptance; owner P3H.5/P5.4. |

**Still broken / unrewired (P5):** `App.tsx` and the old `CareerPlanEditor.tsx` (plus
`SavingsStackedChart.tsx`, `financeModel.ts`) still import removed pool-era types
(`BankAccountDefinition`/`PoolDefinition`/`poolId`, legacy `ProjectionResult` aliases) and are not
App-integrated. `ExpensesPlanner.tsx`, `PaycheckEditorModal.tsx` and `HousingEditor.tsx` are only
**partially** migrated — `ExpensesPlanner.tsx` drops `poolId` writes, `PaycheckEditorModal.tsx`
moves to canonical `AccountDefinition` while preserving an unresolved account id, and
`HousingEditor.tsx` adds the canonical property/debt section + grouped account-only selectors — but
none is wired into `App.tsx`, so App UI acceptance stays **P5** and the full ordered per-group
`FundingPolicy` schema is **not yet persisted**. See §8/§9.

---

## 7. Schema/config alignment (D9 + provenance)

- **Paycheck flat-only normalization (D9).** `codec.ts` `normalizeCareerEntry` treats the granular
  `paycheck` as authority: a present granular paycheck recompiles `paycheckInfo` (derived cache); a
  legacy **flat-only** `paycheckInfo` is synthesized into a granular paycheck
  (`paycheckFromPaycheckInfo`) with an `info` diagnostic and the granular paycheck becomes the
  engine authority. `paycheck.ts` adds `compilePaycheckLineAmounts` (per-line **destination**
  metadata + annualized amounts) for the income stream. `storage.ts` is now a thin
  localStorage/reference-date boundary; all structural normalization lives in `codec.ts`.
- **Imported provenance (P3S.4).** `types.ts` adds `PlannerProvenance`/`PlannerSourceSign`/
  `PlanningStatus`/`PlannerProvenanceFields` on `ExpenseEntry`/`RecurringExpenseEvent`.
  `expenseImport.ts` marks imported rows `provenance: 'imported'`, `planningStatus: 'occurred'`
  and preserves original `sourceDate`/`sourceSign`/`asOf`/batch; occurred rows are permanently
  view-only (never promoted from a date, even a future-dated row), and source removal is covered.
  `planner.ts` re-enforces occurred-is-never-scheduled at execution time.
- **Retirement pinned flag (D8).** `RetirementWithdrawalSourceLine.fallbackAccountIds` +
  `WithdrawalPlan.fallbackAccountIds` compile into the pinned ordered list; a pinned position is
  eligible regardless of `allowAutomaticFallback`.
- **Pending property correction.** `PropertyDefinition`/`LiabilityDefinition`/`PropertyFundingEvent`
  are the canonical observed shapes (`status: pending|owned|sold`); `opening.ts` gives a `pending`
  property value `0` and defers a financing liability's debt until completion. The HousingEditor
  integration of these is partial and the property correction is not finished (§6).
- **D9 authority reached the types.** `Scenario` gains `fundingPolicy`, `liabilities`,
  `properties`, `cardPlans`; `CareerEntry`/`CareerPayPlan` gain `depositPlan`; withdrawal sources
  are `RetirementWithdrawalSourceLine`. `storage.test.ts` (12) + `codec.test.ts` (48) cover
  load-time normalization.

---

## 8. Removed/impaired consumers and restoring owners

None are treated as passing; each has an owning later task.

| Impaired surface | Remaining legacy consumer | Restoring owner |
|---|---|---|
| Legacy `ProjectionResult` aliases (`years`/`summary`/`incomeUsageByMonth`/`incomeValidation`/`accountBalances`) and dollar-shaped results | `src/App.tsx`, chart/table/summary components | P4 reporting + P5.2 UI |
| Pool/account/pool-era types (`BankAccountDefinition`/`PoolDefinition`/`poolId`) | `src/App.tsx`, `src/components/CareerPlanEditor.tsx` (both **unrewired**), `src/components/ExpensesPlanner.tsx` (partially migrated — `poolId` writes dropped), `src/components/SavingsStackedChart.tsx`, `src/financeModel.ts`; `src/importers/expenseImport.ts` migrated to canonical `ExpenseEntry` provenance | P5.2 (UI) with P3I/P3D/P3H/P3S; removal P7.1/P7.2 |
| Paired editors not wired into the App | standalone editor components (§6) | P5.2/P5.4 |
| Reporting (audit/monthly/annual/warnings) absent — `featureCoverage.reporting === false` | views | P4 |
| `src/utils/dateMarkers.test.ts` (imports removed `defaultScenario` singleton) | test + build gate | P5.5 (tests), P5.2/P7 (build) |

---

## 9. Full suite / build status (final verifier)

| Check | Result (re-observed) |
|---|---|
| Focused engine suite (18 files) | **397 pass / 0 fail** |
| Paired-editor suites (8 files) | **42 pass / 0 fail** |
| Codec/commands/storage/paycheck/expenseImport (5 files) | **117 pass / 0 fail** |
| `src/App.test.tsx` | **2 pass / 81 fail** (83 total) — legacy `ProjectionResult`/pool-era UI, removed `resolveCurrentAge` |
| `src/utils/dateMarkers.test.ts` | **1 pass / 10 fail** (11 total) — imports the removed `defaultScenario` singleton (stale) |
| Full `npm run test -- --run` | **565 pass / 91 fail (656 total; 2 failing files)** |
| `npx tsc -b` | **179 TS errors**, all in the legacy consumers (`App.tsx`, `CareerPlanEditor`, `ExpensesPlanner`, `SavingsStackedChart`, `financeModel`, `dateMarkers.test.ts`); **none in any Phase 3 engine/editor module** |

The focused rows were independently re-run by the parent after the final source corrections.
The final verifier confirmed the full-suite and build results above; App/dateMarkers and legacy
type consumers remain downstream P5/P7 work, not a passing release gate.

---

## 10. Preserved historical evidence and data

- `refactor/fixtures/projection.pre-refactor.snap` — present and untouched (not in the working-tree
  diff).
- `src/engine/__snapshots__/projection.characterization.test.ts.snap` — the orphan snapshot for the
  deleted Phase-2 characterization test remains **present and unchanged** (tracked, no diff).
- `netWorth.history` entries remain present and labeled `assetOnly` (P1.5); no reinterpretation as
  signed net worth.
- The engine suite is deterministic (CA13: byte-identical iterations; caller `Scenario` not
  mutated) and mutates only through `commitChanges`.

---

## 11. Non-claims

This handoff does **not** claim: a runnable App, a passing whole suite or build, full App/GUI
acceptance (GUI-A01–A10), Phase 4 reporting acceptance, combined cross-feature behavior (P5), or
any PS/B-P performance benchmark evidence. It claims only the focused Phase 3 stream/editor suites
and the D-rule pins recorded above. Phase 3 exit does not assert a runnable release (ADR-022).

---

## 12. Gate counts (final verifier and parent)

| Gate | Verified value | Owner |
|---|---|---|
| Engine focused suite | **397 / 397** (18 files) | parent (independently re-run) |
| Paired-editor focused suites | **42 / 42** (8 files) | parent (independently re-run) |
| Codec/commands/storage/paycheck/importer | **117 / 117** (5 files) | parent |
| Full suite | 565 pass / 91 fail (656) | final verifier |
| Build (`tsc -b`) | 179 errors, legacy consumers only | final verifier |
| CA01/CA05/CA06/CA07/CA09/CA10 | P3-scoped (partial) focused only | parent |
| GUI-A01–A10 | **not claimed** — App UI acceptance P5 | P5 |

> **Final P3 scoped exit.** Phase 3 exits only on the focused criteria above: the 18-file engine
> suite at **397/397**, the 8-file paired-editor suite at **42/42**, and the 5-file
> codec/commands/storage/paycheck/expenseImport set at **117/117**, plus the D8–D14 and §4.6
> high-risk pins. It does **not** assert a runnable App, a passing full suite or build, GUI-A01–A10,
> P4 reporting, or combined cross-feature behavior (P5). The failing full-suite/build gates above
> are recorded accurately and are not claimed as passing.
