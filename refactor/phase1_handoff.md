# Phase 1 Handoff — Canonical Schema, Defaults, Persistence Codec and Configuration Commands

Status: **Phase 1 is implemented only to its scoped exit criteria (ADR-022, intermediate
breakage authorized). It is not a runnable release.** Canonical Phase-1 modules exist and pass
their focused suite; the whole App/engine/build are intentionally broken because the old
pool-era consumers were removed before their replacements run. This document records the actual
state and the owning later tasks — it does not assert full App/UI acceptance, coverage or release.

Authority: `implementation_plan.md` §4 Phase 1 and `phase1_plan.md` (P1.1–P1.7). Builds on
`frozen_contracts.md` (P0.3–P0.5, D1–D4) and `coverage_register.md`.

The final App hydration path does not save on load; it canonicalizes marker/chain references
before state initialization and uses explicit reset/date inputs. Final gates below reflect that
change. A subsequent focused codec assertion covers the absent birthday-start default.

---

## 1. Scoped exit criteria vs. actual state

| `phase1_plan.md` exit criterion | Actual state |
|---|---|
| 1. Canonical config + codec tested in isolation (focused CA11); broken App/engine imports listed with ownership | Met: focused suite 86/86; broken consumers listed in §5/§6. |
| 2. Units/default/reference contracts (D1–D4) available to all streams | Met for types/factories/codec (D1–D4 encoded; see §3). |
| 3. No new field lost on implemented canonical command/edit paths; end-to-end App flows remain P5 | Met at command level (codec/command tests preserve new fields). App flow **not** verified. |
| 4. D1–D4 reflected in types, factories, codec and focused tests; Phase-2/3 math validation separate | Met for config/round-trip; Phase-2/3 runtime math still pending (see §7). |
| 5. Handoff lists removed consumers, affected F/G/TC/MD rows, exact commands/results, failing suites/build and restoring phase | This document. |

---

## 2. Completed task IDs, files and contracts (P1.1–P1.7)

### New files
- `src/codec.ts` (~1.6k lines) — P1.3 canonical persistence codec.
- `src/codec.test.ts` — P1.3/P1.7 codec tests.
- `src/commands.ts` (~1.2k lines) — P1.4 configuration commands and reference registry.
- `src/commands.test.ts` — P1.4/P1.5/P1.7 command + opening tests.
- `src/engine/contracts.ts` — P1.1 runtime funding contracts.
- `src/engine/opening.ts` — P1.5 opening-resolution contract.

### Modified files
- `src/types.ts` — P1.1 canonical target types.
- `src/defaultScenario.ts` — P1.2 independent factories/defaults.
- `src/storage.ts` — P1.3 storage lifecycle (thin wrapper over `codec.ts`).
- `src/storage.test.ts` — P1.3/P1.7 lifecycle tests.
- `src/App.tsx` — P1.6 hydration/`updateScenario` rewiring (pool-era UI still present; see §5/§6).

### P1.1 (S) — Target types (`src/types.ts`, `src/engine/contracts.ts`)
- `BankAccountDefinition` → **`AccountDefinition`**; dropped `poolId` + `priority`; `balance` →
  `openingBalance`; added `annualReturnRate`, `retirementAnnualReturnRate: number | null`,
  `color?`, `displayOrder`, `withdrawalPolicy`, `assumedGainPercent?`, `capitalGainsTaxRate?`.
- **`AccountWithdrawalPolicy`** `{ allowAutomaticFallback, withdrawalTaxRate, penaltyRate,
  restrictionNote, hsa? }`; HSA-only **`HsaWithdrawalPolicy`** `{ nonQualifiedPenaltyRate (20),
  nonQualifiedPenaltyWaiverAge (65) }` keeps income tax, generic penalty and pre-65 penalty
  separate.
- Added `LiabilityDefinition` (`LiabilityKind`), `PropertyDefinition` (+`PropertyFundingEvent`),
  `OpeningSnapshot` (+`OpeningMeasurement`/account/liability/property values), `FundingPolicy`,
  `CareerDepositPlan`, `CardPlan = OrdinaryCardSchedule | ZeroInterestCardPlan`,
  `ResultContextMetadata`/`MeasurementBasis`, planner provenance fields, and
  `RetirementWithdrawalSourceLine` (`mode: 'amount' | 'percentOfInitialBalance'`, `firstWithdrawalDate`,
  `initialWithdrawalValuationDate?`, `paymentDay?`, `initialWithdrawalRatePercent?` 0–100).
- Removed `PoolDefinition`; `SourceType` → `'account'`; `LoanPaymentSource` pool variant removed;
  `ExpenseEntry.poolId` and `ExpenseTimelineUiState.selectedPoolIds` removed;
  `NetWorthConfig.pools`/`bankAccounts` → `accounts`; **D3** removed `WithdrawalPlan.firstYearAmount`
  (and the obsolete `firstYearAccountWithdrawals`/`firstYearAccountUseFourPercent` shapes are pruned
  by the codec). `WithdrawalMode 'four_percent'` → `'percentOfInitialBalance'`.
- `src/engine/contracts.ts`: runtime, **integer-cent** result metadata `FundingRequest`,
  `FundingAllocation`, `FundingPlan` (identity `gross = net + tax + penalty`; aggregate
  `executedCents = Σ netFundedCents`; stale `stateRevision`). These are types only — no runtime
  funding engine yet (§7).

### P1.2 (S) — Fresh factories and defaults (`src/defaultScenario.ts`)
- Independent factories, no exported mutable singleton; date-dependent defaults take an explicit
  `referenceDate`.
- `$0` opening, `0%` account return, `null` retirement override; new retirement source defaults to
  **4%** (editable; explicit `0` valid); HSA non-qualified extra penalty default **20%** before age
  **65** (configurable); ordinary card `end = start + 11` (twelve inclusive payments); zero `0%`
  card debt. Default accounts: checking / emergencyFund / HSA / investments / 401K.
- Preserved payroll/housing/purchase/cashflow defaults; no resurrected hidden scalar asset
  (`portfolio.currentAssets = 0`).

### P1.3 (S + Q) — Canonical normalizers + versioned allowlisted codec (`src/codec.ts`, `src/storage.ts`)
- `CURRENT_SCHEMA_VERSION = 1`; `schemaVersion ≤ current` → allowlist rebuild + defaults for missing
  fields + prune obsolete fields; **`schemaVersion > current` → blocked** (D2).
- Preserves valid siblings and explicit `[]` / `0` / `false` / allowed `null`; deterministic ID
  repair; record-local diagnostics; never mutates raw input.
- `decodeAppState(raw, referenceDate)` / `encodeAppState(state, referenceDate?)`; `storage.ts` keeps
  the storage key + save guard: blocked/corrupt bytes are **preserved** until an explicit canonical
  save or reset; `getStorageStatus()` exposes status.

### P1.4 (S) — Shared commands + reference registry (`src/commands.ts`)
- Pure `deepClone` / `deepFreeze`; deterministic `createCommandId` (no wall clock).
- Active-timeline selectors/writes over the six local domains (`purchases`, `longTermPurchases`,
  `loans`, `creditCards`, `careerPlan`, `housing`); base fields are the implicit base timeline;
  dangling `activeTimelineId` recovered safely.
- Timeline / career / pay-plan / account CRUD with deletion-reference cleanup;
  `scanMarkerReferences` / `clearDanglingMarkerReferences` / `removeDateMarker` / `resolveMarkerReferences`
  across base, timelines, pay plans and card plans; `resolveCareerChain`,
  `resolveHousingChain`, `resolveCareerAndHousingChains`.
- `createConfigurationCommands()` App integration seam (pure `Scenario → Scenario`).

### P1.5 (S + K) — Opening-resolution contract (`src/engine/opening.ts`)
- Pure `resolveOpening` / `summarizeOpening` / `resolveOpeningAccountBalances` /
  `resolveHistoricalObservations`.
- **Observed debt wins, including observed `0`**; configured `openingBalance` used **once** only when
  no observation exists; snapshot-only accounts carry an `'unknown'` type; property-only observed debt
  creates one synthetic `property:<id>` mortgage liability so it is not omitted or double-counted.
  **Historical history entries remain `assetOnly`**; no speculative mortgage amortization or loan proceeds.

### P1.6 (U + S) — Route incremental writes through canonical helpers (`src/App.tsx`)
- Hydration and `updateScenario` now resolve markers + career/housing chains through the canonical
  commands; obsolete App-local mount-time career normalization and pool-era career rebuild effects
  were **removed** (comments mark the removals). Unrelated fields survive edits.
- The pool/account management UI in `App.tsx` is **not** rewired and still calls removed fields
  (§5) — owned by P5.2 (with P3 streams). Full GUI-A01/G01 App flow acceptance is P5.

### P1.7 (Q) — Persistence acceptance tests (CA11)
- `src/commands.test.ts`, `src/codec.test.ts`, `src/storage.test.ts` cover factory isolation,
  absent vs empty/0/false/null, malformed-record recovery, future-version block without overwrite,
  byte-idempotent round-trip/pruning, inactive-plan/orphan-reference cleanup, liability identity,
  unrelated-edit field preservation, D3 removal and the D4/ADR-021 withdrawal-rate/HSA defaults.

---

## 3. Frozen decision coverage (D1–D4)

- **D1** concrete type names + units: `AccountDefinition`, `AccountWithdrawalPolicy`,
  `LiabilityDefinition`, `PropertyDefinition`, `OpeningSnapshot`, `FundingPolicy`,
  `CareerDepositPlan`, `CardPlan`, `RetirementWithdrawalSourceLine`, `FundingRequest/Allocation/Plan`.
- **D2** future schema version → blocked (codec + storage save guard).
- **D3** `firstYearAmount` removed from `WithdrawalPlan`; codec prunes it (and the obsolete account
  withdrawal maps) on decode/encode.
- **D4 / ADR-021** per-source configurable initial-balance withdrawal percentage (new-item **4%**,
  editable, explicit `0` valid); non-qualified HSA age/penalty defaults (extra penalty **20%** before
  age **65**, waived at/after 65). Exact cents math is consumed by Phase 2/3.

---

## 4. Focused evidence (parent-run)

Command (parent-run):

```
npx vitest run src/commands.test.ts src/codec.test.ts src/storage.test.ts
```

Final focused result: **87/87 passing**. `it()` block counts by file match the total:
`commands.test.ts` 35, `codec.test.ts` 40, `storage.test.ts` 12 = 87.

CA11 coverage mapped to the focused tests:

| CA11 requirement | Focused test source |
|---|---|
| Factory/reset isolation (TC06) | `codec.test.ts` *independent factories and fresh load*; `storage.test.ts` *independent load/reset instances* |
| Absent vs empty/0/false/null | `codec.test.ts` *absent vs explicit empty/0/false/null* |
| Record-local malformed recovery (TC07) | `codec.test.ts` *record-local malformed recovery*; `storage.test.ts` *corrupt recovery and autosave guard* |
| Future-version block without overwrite (D2) | `codec.test.ts` *future-version block*; `storage.test.ts` *future-version block and autosave guard* |
| Round-trip / idempotence / pruning | `codec.test.ts` *round-trip and idempotence*, *allowlist pruning of obsolete fields*; `storage.test.ts` *byte-idempotent canonical saves* |
| Inactive plans / orphan refs / unrelated edits | `codec.test.ts` *configuration commands preserve new fields and clean orphan references*; `commands.test.ts` *account CRUD / deletion cleanup*, *marker reference registry* |
| Reference cleanup / deterministic ID repair (TC05) | `codec.test.ts` *deterministic duplicate id repair*; `commands.test.ts` *career / housing chain resolution* |
| Liability identity (R05) | `codec.test.ts` *opening liability identity*; `commands.test.ts` *engine/opening resolution* |
| D3 removal / D4 defaults (ADR-021) | `codec.test.ts` *legacy pool-era persistence regression*, *withdrawal percentage and HSA policy*, *encode date default regression*; `storage.test.ts` *load/save lifecycle* |

This is **focused isolation evidence only**. It does not verify the App UI, engine runtime or
end-to-end persistence flow.

---

## 5. Removed consumers and legacy breaks (with owners)

Removing pool-era and obsolete types under ADR-022 left these consumers on the old model. None are
treated as passing; each has an owning later task.

| Removed/renamed surface | Remaining legacy consumers (not yet migrated) | Owner / restoring task |
|---|---|---|
| `PoolDefinition`, `NetWorthConfig.pools`, `poolId`/`priority` | `src/engine/projection.ts` (pool math throughout), `src/App.tsx` (pool editor ~1617–1658, 2277–2287), `src/components/CareerPlanEditor.tsx`, `src/importers/expenseImport.ts`, `src/financeModel.ts` | Remove: P7.1/P7.2; migrate: P3I.6, P3S.4, P5.2 |
| `BankAccountDefinition`, `NetWorthConfig.bankAccounts`, `AccountDefinition.balance` → `openingBalance` | `src/engine/projection.ts` (`LedgerAccount extends BankAccountDefinition`), `src/App.tsx`, `src/components/CareerPlanEditor.tsx`, `src/financeModel.ts`, `src/importers/expenseImport.ts`, engine tests | P2.5 (compiler), P3*/P5.2 (UI), P7.1 (removal), P2.7/P3 (tests) |
| `SourceType 'pool'` / pool branch in `SourceLine`/`CareerSourceLine` | `src/engine/projection.ts` (`addSourceContribution` pool branch), `src/App.tsx`, `src/components/CareerPlanEditor.tsx` | P3I.3/P3S.1/P5.2; remove P7.1 |
| `LoanPaymentSource` `` `pool:${string}` `` | `src/engine/projection.ts`, `src/App.tsx` | P3D.3/P3H.3/P5.2; remove P7.1 |
| `WithdrawalPlan.firstYearAmount` (D3) | `src/engine/projection.ts`, `src/engine/projection.test.ts`, `src/App.test.tsx` fixtures | P3S.2 (runtime), P2.7/P5.5 (tests) |
| `WithdrawalMode 'four_percent'` → `'percentOfInitialBalance'` | `src/engine/projection.ts` retirement-source handling | P3S.2; tests P2.7/P5.5 |
| `ExpenseEntry.poolId`, selected pool ids | `src/App.tsx`, `src/importers/expenseImport.ts` | P3S.4 |
| `createDefaultCreditCard` factory (replaced by `createDefaultOrdinaryCardSchedule` / `createDefaultZeroInterestCardPlan`) | `src/App.tsx` import (line 17) | P3D.4 / P5.2 |
| `NetWorthConfig.accountBalances` | `src/App.tsx` (line 432) | P5.2 / P2.5 |

Intentionally-removed obsolete fields (dead by D3) are pruned by the codec rather than migrated.

---

## 6. Affected coverage rows

`coverage_register.md` Status column updated to `P1-scoped` / `P1-scoped (partial)` (owner/task/
evidence columns unchanged):

- **TC05–TC08** — P1.3/P1.7 codec + command + opening tests.
- **R05, R16, R23** — P1.5 opening identity; P1.3 codec/CA11. (R05 partial: CA09 held-deposit is P3H.)
- **MD02, MD04, MD06** — P1.3/P1.1/P1.2 normalizer/type/factory review.
- **F01, F23, F26** — partial: P1.1 types / P1.5 opening / P1.4 commands / P1.3 codec done; CA08/
  CA12/GUI-A01/A02/A09/A10 and P5.3 autosave integration pending P2/P4/P5.
- **G01, G13, G37, G38** — partial: P1.3 codec + P1.4 commands done; App/GUI wiring pending P5.2.
- **CA11** — partial: focused factory/codec/command assertions pass; App-only checks pending P5.
- **GUI-A09** — partial subset: command-level write/selection/inactive-plan/defaults behavior;
  App UI acceptance pending P5.4.

No other row statuses were changed; no benchmarks (PS/B-P) or unexecuted CA/CGUI claims were added.

---

## 7. Unresolved financing runtime math (owner phases)

Phase 1 supplies **config/contracts**, not execution. Still unresolved:

- **Funding execution** (P2.3/P2.4/P2.6): `FundingRequest/Allocation/Plan` are types only; there is
  no quote/commit engine, no gross/net/tax/penalty identity enforcement, no bounded minimal-gross
  solver, no primary/fallback eligibility. `src/engine/projection.ts` remains fully pool-era and does
  not consume these contracts.
- **Opening consumption** (P2.5/P3H): `resolveOpening` is a pure helper; `projectScenario` does not
  start from it yet, and held acquisition deposits are not implemented.
- **Income/net-pay allocation** (P3I): `CareerDepositPlan` is config-only; ordered net-pay
  allocations + remainder, caps and unmet allocations are not executed.
- **Two-card runtime** (P3D): `OrdinaryCardSchedule`/`ZeroInterestCardPlan` are config-only; there is
  no expected-payment schedule or 0%-payoff ceiling/adaptive recalculation/residual payoff execution.
- **Retirement percentage** (P3S.2): per-source configurable initial-balance percentage (4% default),
  min/max/inflation, later-start valuation date are not executed.
- **Taxable/HSA rules** (P2.3): 20%-of-gross gain proxy, LTCG 15%, HSA qualified vs non-qualified
  penalty/waiver are configured but not computed.
- Engine numerics (APY compounding, determinism, safe cents) remain Phase 2; no Phase-2/3 numerical
  claim is made here.

---

## 8. Suite / build status (verifier report from parent)

| Check | Result |
|---|---|
| Baseline (pre-P1) `npm run test -- --run` | 207 pass / 1 pre-existing loan-row App failure (208 total); build passed |
| Focused `npx vitest run src/commands.test.ts src/codec.test.ts src/storage.test.ts` | **87 pass / 0 fail** |
| Engine `src/engine/projection.test.ts` | 2 pass / 88 fail |
| App `src/App.test.tsx` | 59 pass / 24 fail + 1 unhandled; one historical test expects a save on load |
| Full `npm run test -- --run` | 160 pass / 131 fail (291 total; before the final codec assertion) |
| `npm run build` | Fails, ~150 type errors |
| `src/engine/projection.characterization.test.ts` | Fails within the full gate; still references removed fields/snapshots (P2.7/P3 restore) |

The engine failures stem from `src/engine/projection.ts` and `projection.test.ts` still using the
removed pool/account/`firstYearAmount` model; App failures come from the unrewired pool-era UI
(§5). These are expected intermediate breakage; the restoring owners are P2/P3 (engine) and
P5.2/P5.4 (App/UI). Final full-suite/build/release verification remains **Phase 8**.

### App hydration correction (included in final verifier gate)
Implemented in `src/App.tsx` + `src/storage.ts` to satisfy the P0.4.4 hydration contract and P1.3
save guard:
1. **No load-time save** — hydration happens once in the `useState` initializer; the autosave effect
   skips while the live state equals the hydrated/last-committed state (`lastCommittedStateRef`)
   and skips while storage is blocked/corrupt.
2. **Canonical marker/chain normalization before state** — the initializer runs
   `resolveMarkerReferences` then `resolveCareerAndHousingChains` before returning the hydrated
   scenario (no mount-time mutating effect).
3. **Explicit reset** — `resetScenario` uses fresh factories + `saveAppState(freshState, { reset: true,
   explicitCanonical: true })`, the only path allowed to replace newer-version bytes.
4. **Explicit date factory arguments** — a single App-boundary `referenceDate` is passed to
   `loadAppState` and every `createDefault*` factory; the codec/factories never read the wall clock.

Backed by `storage.test.ts` *load does not immediately rewrite the stored bytes (hydration contract)*
and *independent load/reset instances (TC06)*. The verifier re-ran the App/full/build gates after
the hydration change. Its full-suite count preceded
the one-case codec default assertion; the focused 87/87 result is from the final code.

---

## 9. Preserved historical evidence and data

- `fixtures/projection.pre-refactor.snap` — untouched (not in the working-tree diff).
- `netWorth.history` entries remain present and are labeled `assetOnly` by P1.5; no retraction of old
  history totals and no reinterpretation as signed net worth.
- Standalone manual-contribution removal retained (exercised by `storage.test.ts`).
- Legacy `netWorth.bankAccounts` loads into canonical `accounts` with a diagnostic (no pool
  inheritance) and legacy pool source ids are cleared — see `codec.test.ts` *legacy pool-era
  persistence regression*.

---

## 10. Next dependencies / now-unblocked work

- **P2.1** can proceed (frozen P0.3 contracts); **P2.2** now has its P1.1 final types.
- **P2.5** compiler may consume `AccountDefinition`/`LiabilityDefinition`/`PropertyDefinition` and
  `resolveOpening`.
- **P3I/P3S/P3D/P3H** feature editors can build against the canonical commands (`createConfigurationCommands`)
  and factories; each stream owns migrating the consumers in §5.
- **P5.2/P5.3/P5.4** own App UI rewiring, autosave integration and GUI acceptance.

## 11. Non-claims

This handoff does **not** claim: a runnable App, passing whole suite/build, full App/UI persistence
acceptance, engine numerics, CA01–CA10/CA12/CA13, GUI-A01–A10 (beyond the GUI-A09 subset above),
F/R/G rows not listed in §6, or any PS/B-P benchmark evidence. Phase 1 exit does not assert a
runnable release (ADR-022).
