# Phase 2 Handoff — Deterministic Execution and Atomic Funding Kernel

Status: **Phase 2 is implemented only to its scoped exit criteria (ADR-022, intermediate
breakage authorized). It is not a runnable release.** The canonical kernel modules exist and pass
their focused suite (191/191 across 9 files); the App, whole suite and build are intentionally
broken because the pool-era engine and its consumers were removed before their Phase 3/4
replacements run. This document records the actual state and the owning later tasks — it does
**not** assert full feature, GUI, performance or release acceptance.

Authority: `implementation_plan.md` §Phase 2 and `phase2_plan.md` (P2.1–P2.7, D5–D7). Builds on
`frozen_contracts.md` (P0.3.1–P0.3.6), ADR-021, ADR-022 and `phase1_handoff.md` (P1.1 types, P1.4
commands, P1.5 opening). Coverage rows are updated in `coverage_register.md`.

---

## 1. Scoped exit criteria vs. actual state

| `phase2_plan.md` exit criterion | Actual state |
|---|---|
| 1. Focused kernel suites (`dates/money/state/taxes/funding/configuration/scheduler/projection`) pass in isolation. | Met: **191/191** across 9 files (adds `valuation.test.ts`). No App/build/full-suite claim. |
| 2. No negative cash, future-income spending, unsafe cents, or balance mutation outside `commitChanges`. | Met at kernel level: state rejects negative/unsafe/aggregate-overflow changes without mutation, funding quotes are read-only, and the facade mutates only through `state.commitChanges`. Full-horizon processor enforcement is P3. |
| 3. Every executed funding plan reconciles `gross = net + tax + penalty`; the bounded solver never exceeds 256 candidates without a diagnostic. | Met in kernel tests (`taxes.test.ts`, `funding.test.ts`, the CA04 block of `projection.test.ts`). |
| 4. Legacy pool-era engine removed (D6); removed consumers, broken App/build/full-suite and their restoring owners recorded, never treated as passing. | Met: `projection.ts` rebuilt, `projection.test.ts` rebased, `projection.characterization.test.ts` deleted; consumers/owners in §8. |

Phase 2 exit does **not** assert a runnable App, full suite, build, feature processors or reporting
(ADR-022).

---

## 2. Completed task IDs, files and contracts (P2.1–P2.7)

### New runtime files

| Module | Test | Owner | Owns | Lines |
|---|---|---|---|---|
| `src/engine/dates.ts` | `dates.test.ts` | K | date-only parse/format, month/day ordinals, leap/day-31 clamp, inclusive clip, 960-month horizon metadata | 398 |
| `src/engine/money.ts` | `money.test.ts` | K | dollars⇄cents HAFZ, cumulative per-line share rounding, safe-integer/overflow diagnostics | 413 |
| `src/engine/state.ts` | `state.test.ts` | K | private account/liability/property/deposit state; sole `commitChanges`; sparse overlays; conservation | 891 |
| `src/engine/taxes.ts` | `taxes.test.ts` | K | eligibility + D5 bounded minimal-gross solver, separately rounded tax/penalty, HSA age-65 waiver | 834 |
| `src/engine/funding.ts` | `funding.test.ts` | K | primary-first ordered split, dedupe, quotas, eligibility, partial/zero/stale, atomic change-set prep | 753 |
| `src/engine/configuration.ts` | `configuration.test.ts` | S+K | immutable named-context compiler (base + timeline, markers/chains, rates, funding orders) | 1052 |
| `src/engine/scheduler.ts` | `scheduler.test.ts` | K | month batches, recurrence cursors, stable date/phase/priority/occurrence order, dynamic targets | 830 |
| `src/engine/projection.ts` | `projection.test.ts` | K+Q | rebuilt `projectScenario` facade (kernel-only) | 742 |
| `src/engine/valuation.ts` | `valuation.test.ts` | K | exact-APY month-close posting + partial-month fraction (consumed by P2.7; CA08) | 178 |

`contracts.ts` (P1.1) and `opening.ts` (P1.5) were already present and are consumed by the kernel;
P2.3 added the explicit `hsaQualifiedMedical` request flag to `contracts.ts`.

### Modified / removed files (working tree)

| File | Change |
|---|---|
| `src/engine/projection.ts` | −1927/+647: obsolete pool-era engine replaced by the thin facade. |
| `src/engine/projection.test.ts` | −4486/+362: pool-era suite replaced by 17 focused kernel tests. |
| `src/engine/projection.characterization.test.ts` | **Deleted** (−132); could not compile against the P1 schema and no comparison harness was kept (D6). |
| `src/types.ts`, `src/defaultScenario.ts`, `src/storage.ts`, `src/storage.test.ts`, `src/App.tsx` | Phase-1 schema/codec/hydration surfaces (see `phase1_handoff.md`); `App.tsx` partially de-scaled (−710/+195) with pool-era UI still present and broken. |

`valuation.ts` is not in the `phase2_plan.md` D7 table; it is the P2.7 month-close APY helper
(CA08). Property appreciation and debt-interest accrual remain P3H/P3D and are **not** duplicated
here.

---

## 3. Kernel API surface (P2.1–P2.7)

- **P2.1 dates** — `DateOnly`/`YearMonth`/`MonthOrdinal`/`DayOrdinal`; `parseDateOnly`,
  `formatDateOnly`, `isValidDateOnly`, `parseYearMonth`, `addDays`, `addMonthsToDate`, `diffDays`,
  `compareDateOnly`, `toMonthOrdinal`/`fromMonthOrdinal`, `addMonths`, `endOfMonthDate`,
  `clipDateRange`, `createMonthHorizon`, `monthHorizonFromDate`, `clipMonthHorizon`, `listMonths`,
  `FULL_HORIZON_MONTHS = 960`. Never calls `Date`.
- **P2.1 money** — `Cents`/`Dollars`; `dollarsToCents`/`centsToDollars`/`tryDollarsToCents`;
  `roundHalfAwayFromZero`; `assertSafeCents`/`assertNonNegativeCents`; `safeMultiplyCents`/
  `safeSumCents` (+ `try*`); `createCumulativeShareSchedule`/`cumulativeThrough`/`shareAt`/
  `splitCumulative`/`retargetCumulativeShareSchedule`.
- **P2.2 state** — `buildState(opening)`; `EngineState.getRevision/getAccount(s)/getAccounts/
  getLiability/getLiabilities/getProperty/getProperties/getTotals/toSnapshot/getDiagnostics`;
  sole `commitChanges(StateChangeSet)` with `revision`, sparse `accountChanges`/`liabilityChanges`/
  `propertyChanges`, and `expectedNetWorthDeltaCents`; `StateValidationError`.
- **P2.3 taxes** — `buildWithholdingProfile`/`tryBuildWithholdingProfile`; `evaluateAccountEligibility`;
  `grossToNet`; `computeGrossNetBracket`; `solveGrossForNet`; `quoteWithdrawal`; `isHsaPenaltyWaived`;
  `createExactRate`/`exactRateFromPercent`; `MAX_SOLVER_CANDIDATES = 256`.
- **P2.4 funding** — `quoteFunding`; `validateFundingPlan`; `buildFundingChangeSet`; `commitFunding`;
  `RETIREMENT_FUNDING_PURPOSE`.
- **P2.5 configuration** — `compileScenarioContext`; `ContextValidationError`; `CompiledScenarioContext`
  (`getAccountRate`, `getActivePayPlan`, `opening`, `funding`, `diagnostics`, `metadata`); compiled
  account/liability/property/timeline/career/pay-plan/funding-source shapes.
- **P2.6 scheduler** — `EVENT_PHASES` (`accrual`→`income`→`cap`→`mandatory`→`discretionary`→`close`);
  `createScheduler` (`batchFor`, `resolveTarget`, `getDefinition`, `getActiveBoundaries`);
  `EventDefinition`/`ScheduledEvent`/`MonthBatch`/`RecurrenceCursor`; `nthOccurrence`/
  `occurrencesInWindow`/`createRecurrenceCursor`.
- **P2.7 projection** — `projectScenario(scenario, ProjectionOptions): ProjectionRun`;
  `PROJECTION_ENGINE_REVISION`; `DEFERRED_FEATURE_DOMAINS`; `ProjectionError`;
  handler seam `ProjectionHandlerFactory`/`ProjectionEventHandler`/`ProjectionHandlerDependencies`/
  `ProjectionHandlerInvocation`/`ProjectionExecutionResult`; result shapes `ProjectionRun`,
  `MonthlyClose`, `AccountMonthCloseRecord`, `ExecutedPlanAudit`, `ProjectionRunTotals`,
  `ProjectionFeatureCoverage`; `formatCurrency`/`formatPercent` (kept for existing views).

---

## 4. Focused evidence (parent-run)

Command (parent-run / docs-agent re-run):

```
npx vitest run src/engine/dates.test.ts src/engine/money.test.ts src/engine/state.test.ts \
  src/engine/taxes.test.ts src/engine/funding.test.ts src/engine/configuration.test.ts \
  src/engine/scheduler.test.ts src/engine/projection.test.ts src/engine/valuation.test.ts
```

Result: **9 files, 191 tests passed / 0 failed.** `it()` counts by file match the total:
`dates` 21, `money` 17, `state` 29, `taxes` 27, `funding` 24, `configuration` 31, `scheduler` 17,
`projection` 17, `valuation` 8 = **191**.

### CA03/CA04/CA08/CA13 focused subset (not full feature or performance acceptance)

| CA | P2 task | Focused source of proof | Status |
|---|---|---|---|
| CA03 | P2.2/P2.4/P2.7 | `funding.test.ts` (primary-first split, dedupe, per-obligation override, eligibility, per-source quota, partial/zero/invalid/stale, replenishment); `state.test.ts` (sparse commit, stale/negative/unsafe/duplicate rejection, conservation, no-op); `projection.test.ts` CA03 block (ordered split, partial, ineligible fallback, zero-fund no-op, zero target, same-month replenishment, stale) | **P2-scoped (partial)** — held-deposit CA09 and P3 obligation integration pending |
| CA04 | P2.3/P2.7 | `taxes.test.ts` ($1000 gross→$970, $1000 net→$1030.93, $0.17→$0.01, separate rounded penalty, qualified/non-qualified HSA, 65th-birthday waiver **and invalid-waiver-age rejection >120**, non-monotone rounding dip, ≤256 bound / explicit diagnostic); `projection.test.ts` CA04 (`gross = net + tax + penalty`) | **P2-scoped (partial)** — PS06 benchmark and P3 consumption pending |
| CA08 | P2.1/P2.7 | `dates.test.ts` (leap, day-31, inclusive clip, 960-month horizon); `money.test.ts` (HAFZ, 960-occurrence safe target, overflow diagnostics); `valuation.test.ts` (exact APY, partial-month exponent); `projection.test.ts` CA08 (960 inclusive closes, exact APY, mid-month clip, retirement-rate override) | **P2-scoped (partial)** — PS20 960-month aggregate benchmark pending |
| CA13 | P2.7 | `projection.test.ts` (byte-identical runs, caller scenario not mutated); `scheduler.test.ts` (deterministic order, context not mutated); `configuration.test.ts` (deep-frozen/immutable reads) | **P2-scoped (partial)** — P6.7 ordered-ID/source/revision benchmark pending |

The later `tax waiver-age upper bound` verifier finding is **stale**: `taxes.ts` already rejects a
waiver age above 120 with an explicit `invalid-waiver-age` diagnostic and `taxes.test.ts` asserts
it (27/27 taxes). It is **not** an open issue.

---

## 5. Legacy engine removal (D6)

- `src/engine/projection.ts` no longer contains the pool-era engine; it is the thin
  `projectScenario` facade described in §6.
- `src/engine/projection.test.ts` was rebuilt (17 focused tests) and no longer references
  `PoolDefinition`, `bankAccounts`, `firstYearAmount` or legacy `ProjectionResult` aliases.
- `src/engine/projection.characterization.test.ts` was **deleted**; it could not compile against the
  P1 schema, so no "development comparison harness" was kept.
- Historical evidence `refactor/fixtures/projection.pre-refactor.snap` is present and **untouched**
  (not in the working-tree diff). No comparison path is kept.

---

## 6. Truthful `ProjectionRun` output contract

`projectScenario` returns a **cents-only `ProjectionRun`, never the legacy `ProjectionResult`**:

- `complete: false` and `featureCoverage: { kernel: true, processors: false, reporting: false,
  accountValuation: true, deferred: DEFERRED_FEATURE_DOMAINS }`. Deferred domains are payroll,
  otherIncome, creditCards, loans, housing, largePurchases, longTermPurchases,
  retirementWithdrawals, planner, propertyAppreciation, debtInterestAccrual, reporting.
- With no injected events the run performs only account month-close APY valuation — **no fabricated
  income reservoir, no fake pool map, no wall clock**. The default start is the authoritative
  opening observation date; an absent/invalid observation throws `ProjectionError`.
- `monthlyCloses` is an eager, inclusive, full-horizon close per month (960 by default, never
  silently shortened). Only **actually executed** funding plans become audit rows (`plans`); a zero
  target or unexecuted event is never a fabricated row.
- Account growth uses `(1 + annualRate)^(1/12) − 1` with the retirement override when
  `ratePhase === 'retirement'` and a clipped partial-month exponent for a mid-month start; the final
  posting is converted to safe integer cents once and committed through `state.commitChanges`.
- Legacy fields (`years`, `summary`, `incomeUsageByMonth`, `incomeValidation`,
  `accountBalancesById`) are intentionally absent and asserted absent in tests.

---

## 7. Low-severity observations (no acceptance claimed)

1. **Explicit retirement fallback policy semantics.** In `funding.ts` `resolveSourceOrder` a
   `purpose === 'retirement'` request uses only the pinned `retirementOrderedList` (an explicit
   empty list resolves to no sources; `globalDefaults` is not applied), and `quoteFunding` applies
   the `allowAutomaticFallback === false` gate by **position** (`index > 0`). Position 0 of the
   pinned retirement list therefore bypasses the fallback restriction while later positions honor
    it. Whether a user-pinned retirement fallback should bypass the automatic-fallback flag is not
    explicitly settled; P3S.2 must pin this policy when it supplies the list. No P3 routing acceptance
    is claimed.
2. **Empty-state / empty-change-set no-op revision.** `EngineState.commitChanges` with an empty
   change set and no declared delta validates clean and still advances `#revision` by one
   (`state.ts`), although nothing changed and conservation is not exercised. The facade only calls it
   when `accountChanges.length > 0`, so no current path trips it; a future caller should treat a
   nominally no-op commit as revision-advancing.
3. **Direct gross sum in `buildFundingChangeSet`.** `funding.ts` accumulates
   `grossDebitCents += allocation.grossDebitCents` without `safeAdd`. The public `commitFunding`
   path first runs `validateFundingPlan` (which uses a safe add) and `state.commitChanges`
   re-validates the declared delta, so the internal path cannot overflow silently; only a direct
   external caller of the exported builder would need its own guard.

---

## 8. Removed/impaired consumers and restoring owners

Removing the pool-era engine and the obsolete types left these consumers broken. None are treated as
passing; each has an owning later task.

| Impaired surface | Remaining legacy consumer | Restoring owner |
|---|---|---|
| Legacy `ProjectionResult` aliases (`years`/`summary`/`incomeUsageByMonth`/`incomeValidation`/`accountBalancesById`) and dollar-shaped results | `src/App.tsx`, chart/table/summary components | P4 reporting + P5.2 UI |
| Pool/account-management UI still importing `PoolDefinition`/`BankAccountDefinition`/`poolId` | `src/App.tsx`, `src/components/CareerPlanEditor.tsx`, `src/components/ExpensesPlanner.tsx`, `src/components/HousingEditor.tsx`, `src/components/PaycheckEditorModal.tsx`, `src/components/SavingsStackedChart.tsx`, `src/financeModel.ts`, `src/importers/expenseImport.ts` | P5.2 (UI) with P3I/P3D/P3H/P3S; removal P7.1/P7.2 |
| Feature processors (payroll/cards/loans/housing/purchases/retirement/planner/property appreciation/debt accrual) absent — `featureCoverage.processors === false` | engine run | P3I/P3D/P3H/P3S |
| Reporting (audit/monthly/annual/warnings) absent — `featureCoverage.reporting === false` | views | P4 |
| Whole build / `App.test.tsx` / `src/utils/dateMarkers.test.ts` (removed `resolveCurrentAge` / `defaultScenario` singleton) | test + build gate | P5.5 (tests), P5.2/P7 (build) |

---

## 9. Full suite / build status

| Check | Result |
|---|---|
| Focused engine suite (9 files) | **191 pass / 0 fail** |
| `src/engine/taxes.test.ts` | **27 pass / 0 fail** |
| `src/App.test.tsx` (final verifier) | **2 pass / 81 fail** — `resolveCurrentAge` removed; pool-era UI and legacy result consumers |
| `src/utils/dateMarkers.test.ts` | **10 fail / 1 pass** — imports the removed `defaultScenario` singleton |
| Full `npm run test -- --run` | **293 pass / 91 fail (384 total; 2 failing files)** — the pre-verifier handoff recorded 292/91; the final verifier and docs-agent re-run both observe 293/91 |
| `npm run build` | **Fails, ~186 TS errors, no kernel errors** — all in `App.tsx`, `CareerPlanEditor`, `ExpensesPlanner`, `HousingEditor`, `PaycheckEditorModal`, `SavingsStackedChart`, `financeModel`, `expenseImport`, `dateMarkers.test.ts` |

The engine failures of Phase 1 are resolved; the remaining failures/build errors are the unrewired
pool-era UI and legacy result consumers, owned by P3/P4/P5/P7. Final full-suite/build/release
verification remains **Phase 8** (parent validation owner).

---

## 10. Preserved historical evidence and data

- `refactor/fixtures/projection.pre-refactor.snap` — present and untouched.
- `netWorth.history` entries remain present and labeled `assetOnly` (P1.5); no retraction or
  reinterpretation as signed net worth.
- Focused kernel suite is byte-identical-iteration deterministic (CA13) and mutates only through
  `commitChanges`.

---

## 11. Non-claims

This handoff does **not** claim: a runnable App, a passing whole suite or build, full App/GUI
acceptance (GUI-A01–A10), Phase 3 feature-processor or Phase 4 reporting acceptance, full
CA01–CA13 (only the focused CA03/CA04/CA08/CA13 kernel subset above), or any PS/B-P performance
benchmark evidence. Phase 2 exit does not assert a runnable release (ADR-022).
