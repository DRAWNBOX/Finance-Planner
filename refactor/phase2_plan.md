# Phase 2 — Deterministic Execution and Atomic Funding Kernel (authorized breakdown)

Implementation authorized by [ADR-022](architecture_decisions.md#adr-022--incremental-implementation-authorized-intermediate-breakage-permitted). Builds on `frozen_contracts.md` (P0.3) and the Phase-1 handoff (`phase1_handoff.md`). Scope: the deterministic kernel — date/money primitives, private state with a sole atomic mutation route, eligibility/tax gross-net, ordered partial funding, the named-context compiler, the month-batched scheduler, and the rebuilt `projectScenario` facade. Feature processors (payroll/cards/loans/housing/planner) are Phase 3; reporting is Phase 4. The old pool-era engine is removed now; the App/build/full suite remain broken until later phases and are recorded, never treated as passing.

Owner legend: S=Schema/config, K=Kernel, I=Income, O=Obligations, R=Reporting, U=UI, P=Performance, Q=Quality. K owns the projection facade, state and scheduler; the integration owner serializes `App.tsx`.

Inputs (frozen): `frozen_contracts.md` P0.3.1–P0.3.6 (units, event phases, funding/partial policy, cents rounding, safe limits, bounded gross-net), ADR-021 (solver, HSA age rule, configurable withdrawal rate), and P1.1 final types (`src/types.ts`, `src/engine/contracts.ts`) plus P1.5 opening resolution (`src/engine/opening.ts`).

---

## 0. Locked engineering decisions

### D5 — Bounded minimal-gross solver algorithm (closes the monotonicity ambiguity)

The frozen contracts say both "smallest cent-valued G" and "evaluate ascending from L, take the first sufficient," while ADR-021 warns "do not assume `net(G)` is monotone." These are consistent **only under linear ascending enumeration**; the warning forbids binary search and closed-form shortcuts, not the linear scan. Pin the algorithm:

- For integer-cent gross `G`, `net(G) = G − tax(G) − penalty(G)`, where each component is computed from `G` and rounded **half away from zero exactly once**. `gross = net + tax + penalty` holds by construction.
- `C` = number of independently rounded withholding components, by source type:
  - `0` — Roth, qualified HSA medical spending (no tax, no penalty).
  - `1` — taxable brokerage: `tax(G) = roundHAFZ(G × 0.20 × LTCG/100)`, no penalty.
  - `2` — retirement (401k/IRA) and non-qualified HSA: `tax(G) = roundHAFZ(G × incomeTaxRate/100)`, `penalty(G) = roundHAFZ(G × penaltyRate/100)`. The 20%-gain proxy never applies to HSA/401k/property/payroll (P0.5.4).
- `r` = sum of the pre-rounding withholding rates; require `r < 1` and nonnegative component rates (else diagnostic).
- Bracket: `L = max(0, floor((N − C/2) / (1 − r)))`, `U = ceil((N + C/2) / (1 − r))`. Any `G < L` has `net(G) < N` (rounding error ≤ C/2 cents), so the minimal sufficient G lies in `[L, U]`.
- Enumerate `G` from `L` to `U` **ascending, in integer cents**; the first `G` with `net(G) ≥ N` is the minimal sufficient gross. Do not binary-search and do not reuse the closed-form estimate `N/(1−r)` as the answer.
- If `U − L + 1 > 256`, any rate/intermediate is non-finite/unsafe, or no candidate in the bracket suffices, return an **explicit unsupported-range diagnostic** — never approximate, truncate, or run an unbounded search.
- Balance cap: if minimal `G > balance`, **do not assume** `net(balance)` is maximal: independently rounded tax and penalty can make `net(G)` dip at a coincident threshold. Search the rounding-error-bounded neighborhood at or below the available balance (at most 256 candidates, else an unsupported-range diagnostic), choose the highest achievable net and its smallest gross, and report that as actual partial funding. An unfunded target is never marked paid.

The request must explicitly identify qualified HSA medical spending; never infer qualification from an expense category or a generic purpose label. For non-qualified HSA the two rounded components are configured income tax and the HSA-specific extra penalty (not an additional generic penalty). The extra penalty is waived starting on the holder's 65th birthday, regardless of retirement status; compute that boundary from the withdrawal date and DOB, not an annual age label. Per-account partial feasibility uses the same bounded maximum-net quote.

Proof obligations (CA04/TC13/PS06): minimum debit, rounding identity, bracket/iteration bound, and exact `gross = net + tax + penalty` for executed allocations.

### D6 — Legacy engine removal

`src/engine/projection.ts`, `src/engine/projection.test.ts`, and `src/engine/projection.characterization.test.ts` no longer compile (Phase 1 removed `PoolDefinition`, renamed `balance`→`openingBalance`, and dropped `firstYearAmount`). A "development comparison harness" is therefore infeasible. Remove all three now; P2.7 rebuilds `projection.ts` as a thin facade over the new kernel. Historical evidence remains `fixtures/projection.pre-refactor.snap`. No comparison path is kept.

### D7 — Kernel module/test layout

One file per single responsibility, each with a same-named `.test.ts`; all runtime money is integer cents (`src/engine/contracts.ts`):

| Module | Test | Owns |
|---|---|---|
| `src/engine/dates.ts` | `dates.test.ts` | date-only calendar/month ordinals/leap/day31/inclusive clip |
| `src/engine/money.ts` | `money.test.ts` | cents conversion, HAFZ rounding, cumulative per-line targets, safe-range checks |
| `src/engine/state.ts` | `state.test.ts` | private account/liability/property/deposit state; sole `commitChanges` |
| `src/engine/taxes.ts` | `taxes.test.ts` | eligibility + exact gross-net solver (D5) |
| `src/engine/funding.ts` | `funding.test.ts` | primary-first ordered split, sparse overlays, atomic commit preparation |
| `src/engine/configuration.ts` | `configuration.test.ts` | compile named context (immutable inputs) |
| `src/engine/scheduler.ts` | `scheduler.test.ts` | month batches, recurrence cursors, stable event order |
| `src/engine/projection.ts` | `projection.test.ts` | `projectScenario` facade + orchestration |

---

## P2.1 (K) — Date and money primitives

**Prereqs:** P0.3 (frozen). Can run concurrently with Phase 1; now unblocked. **Deliverable:** pure, side-effect-free date and money utilities.

- `dates.ts`: date-only parse/format (`YYYY-MM-DD`), month ordinals and day-of-month add/subtract, leap-year and day31 clamping, inclusive start/end clipping, explicit `startYearMonth`/`endYearMonth`/horizon metadata, stable day ordering. Timezone-safe; no `Date` time components leaking into month math.
- `money.ts`: dollars→cents once at the posting boundary (HAFZ), cents→dollars for display, per-line **cumulative** scheduled-target rounding (`round(cumulative through k) − round(cumulative through k−1)`, reset on plan/annual-target change), and safe-integer overflow/aggregate validation (P0.3.5). Rate intermediates stay high-precision/rational; round only at the final posting boundary (P0.3.4).

**Files:** `src/engine/dates.ts`, `src/engine/money.ts` (+ tests). **Acceptance:** TC11/CA08 date and cents cases; a `$100` annual target splits to eight `$8.33` + four `$8.34` (ADR-021).

---

## P2.2 (K) — Private state and sole atomic commit

**Prereqs:** P0.3; P1.1 for final types. **Deliverable:** indexed, private, immutable-by-default state with one mutation route.

- `state.ts`: build private account/liability/property/held-deposit state from the compiled context (P2.5) and `resolveOpening`; expose indexed read access and sparse change sets.
- Sole `commitChanges(changeSet)` route: validate state revision, nonnegative cash, ownership/conservation, and safe cents; reject invalid changes **without mutation** (P0.3.3 items 4–5). Zero-fund/invalid transactions debit nothing.
- No public setters, no whole-ledger cloning per event, no separate ledgers in feature processors.

**Files:** `src/engine/state.ts` (+ tests). **Acceptance:** CA03 atomicity/conservation; invalid commit is a no-op.

---

## P2.3 (K) — Eligibility and exact gross-net taxes

**Prereqs:** P2.1, P1.1. **Deliverable:** the D5 solver plus purpose/age/account eligibility.

- `taxes.ts`: taxable brokerage proxy (`0.20·gross` gain, editable LTCG 15%), retirement/HSA income tax + penalty, qualified vs non-qualified HSA, and the age-65 penalty waiver (waive **only** the non-qualified extra penalty at the holder's 65th birthday, regardless of retirement; the withdrawal date drives the age check, not an annual age label).
- Implement D5 exactly; separate `tax`/`penalty` identities, both rounded HAFZ from gross once; explicit unsupported-range diagnostic.

**Files:** `src/engine/taxes.ts` (+ tests). **Acceptance:** CA04 — `$1000` gross→`$970` net, `$1000` net→`$1030.93` gross, `$0.17`→`$0.01` tax; separate rounded penalty; ≤256-candidate bound or diagnostic; qualified HSA, retired-under-65 vs working-65+, custom penalty, birthday boundary. TC13/PS06.

---

## P2.4 (K) — Ordered partial funding and atomic commit preparation

**Prereqs:** P2.2, P2.3. **Deliverable:** pure quote + commit-preparation over the state.

- `funding.ts`: primary-first, ordered, eligible split; dedupe IDs preserving first position; per-obligation overrides vs global defaults; separate retirement ordered list; sparse overlays (touch only affected accounts); actual partial/unpaid outcomes (`executed = Σ netFundedCents`, `unpaid = requested − executed`); stale-quote recompute against `stateRevision`; atomic commit including related debt/deposit/acquisition changes.
- No pool sweep, no implicit borrowing, no retry; zero-fund/invalid debits nothing (P0.3.3).

**Files:** `src/engine/funding.ts` (+ tests). **Acceptance:** CA03 primary/fallback/dedupe/eligibility/replenishment, partial/zero/invalid/stale; held deposit only for actual funding.

---

## P2.5 (S + K) — Named-context compiler

**Prereqs:** P1.4, P1.5, P2.1. **Deliverable:** immutable compiled context; the bridge from canonical config to the kernel.

- `configuration.ts`: consume the hydrated `Scenario`, `resolveOpening`, and the `commands.ts` resolvers (markers, career/housing chains, active timeline/pay-plan) to produce an immutable compiled context: indexed accounts/liabilities/properties, resolved date dependencies, active career/pay-plan intervals, per-account rates/overrides, and ordered funding sources.
- Inactive timelines are validated/persisted but **not** eagerly simulated. No `storage.ts` dependency; no financial calculation.

**Files:** `src/engine/configuration.ts` (+ tests). **Acceptance:** compiles base + timeline contexts; inactive timeline validated without simulation.

---

## P2.6 (K) — Month-batched scheduler and handler interfaces

**Prereqs:** P2.1, P2.5. **Deliverable:** scheduler with stable ordering; no balance mutation here.

- `scheduler.ts`: clip months into batches, drive recurrence cursors, resolve active boundaries, and emit events in stable date/phase/priority/occurrence-ID order (P0.3.2 phases: accrual → income → cap → mandatory → discretionary → close). Define the handler interface consumed by Phase 3 processors.
- No full-horizon eager expansion; no per-event whole-ledger cloning.

**Files:** `src/engine/scheduler.ts` (+ tests). **Acceptance:** stable order and month-batch boundaries; no state mutation.

---

## P2.7 (K + Q) — `projectScenario` facade and kernel integration tests

**Prereqs:** P2.2–P2.6. **Deliverable:** the public `projectScenario` facade orchestration plus tiny real-kernel projections.

- Rebuild `projection.ts` as a thin facade: compile context (P2.5) → schedule (P2.6) → post events via `commitChanges` (P2.2/P2.4) → read-only report assembly (minimal, consumed later by Phase 4). Remove the old pool-era engine and its test files (D6).
- Tiny real-kernel projections over fixed-date fixtures prove CA03/CA04/CA08/CA13 and determinism; no balance mutation outside `commitChanges`.

**Files:** `src/engine/projection.ts` (+ rebuilt `projection.test.ts`); delete `projection.characterization.test.ts`. **Acceptance:** CA03/CA04/CA08/CA13 focused; deterministic output; gross=net+tax+penalty reconciles.

---

## Exit criteria

1. Focused kernel suites (`dates/money/state/taxes/funding/configuration/scheduler/projection`) pass in isolation.
2. No negative cash, future-income spending, unsafe cents, or balance mutation outside `commitChanges`.
3. Every executed funding plan reconciles `gross = net + tax + penalty` under the finalized rounding policy; the bounded solver never exceeds 256 candidates without an explicit diagnostic.
4. Legacy pool-era engine removed (D6); removed consumers, broken App/build/full-suite, and their restoring owners (P3*/P5.2/P5.4) are recorded, not treated as passing.

Phase 2 exit does **not** assert a runnable App, full suite, or build (ADR-022). Feature processors (Phase 3) and reporting (Phase 4) consume these kernel contracts.

## Parallelism

P2.1 and P2.2 start immediately (P0 frozen, P1.1 types ready). P2.3 follows P2.1; P2.4 follows P2.2/P2.3; P2.5 follows P1.4/P1.5/P2.1 (already available); P2.6 follows P2.1/P2.5; P2.7 follows P2.2–P2.6. P2.1–P2.4 are independently testable once their primitives land; no two tasks rewrite the same module.
