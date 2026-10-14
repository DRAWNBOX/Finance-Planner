# Phase 1 — Canonical Schema, Defaults, Persistence Codec and Configuration Commands (authorized breakdown)

Implementation authorized by [ADR-022](architecture_decisions.md#adr-022--incremental-implementation-authorized-intermediate-breakage-permitted). Builds on `frozen_contracts.md` (P0.3/P0.4/P0.5 + D1–D4) and `coverage_register.md`. Scope: canonical schema/config/persistence; financial formula replacement belongs to later tasks. **Old consumers may be removed now.** No legacy aliases or running old App/engine path are required while the target replaces them; intermediate builds and suites may fail until all phases complete. Run and record focused checks for executable Phase-1 modules. P2.1 may proceed concurrently after P0; P2.2 needs P1.1 for final types.

Owner legend: S=Schema/config, K=Kernel, I=Income, O=Obligations, R=Reporting, U=UI, P=Performance, Q=Quality. Integration owner serializes `App.tsx`; S owns shared schema/default/storage edits.

Inputs (frozen):
- D1 concrete TypeScript names (frozen_contracts.md).
- D2 future-schema-version → block.
- D3 remove `firstYearAmount`.
- D4 / ADR-021 per-source configurable initial-balance withdrawal percentage (new-item 4%) and non-qualified HSA age/penalty defaults; exact cents rules are consumed by Phase 2/3.

---

## P1.1 (S) — Target types

**Prereqs:** P0.3–P0.5 (frozen). **Deliverable:** canonical persisted + runtime type additions.

- `AccountDefinition` — rename `BankAccountDefinition` (`src/types.ts:341`); drop `poolId`+`priority`; `balance`→`openingBalance`; add `annualReturnRate`, `retirementAnnualReturnRate: number | null`, `color?`, `displayOrder`, `withdrawalPolicy`, `assumedGainPercent?`, `capitalGainsTaxRate?`.
- `AccountWithdrawalPolicy` — `{ allowAutomaticFallback, withdrawalTaxRate, penaltyRate, restrictionNote }` (absorbs `PoolDefinition.taxRate/penaltyRate/isHSA/softRestrictionNote`).
- `LiabilityDefinition`, `PropertyDefinition`, `OpeningSnapshot`, `FundingPolicy`, `CareerDepositPlan`, `CardPlan` (`OrdinaryCardSchedule | ZeroInterestCardPlan`) — per D1 table.
- Define a withdrawal-specific `RetirementWithdrawalSourceLine` successor to the shared `SourceLine` (`mode: 'amount' | 'percentOfInitialBalance'`, `firstWithdrawalDate`, `initialWithdrawalValuationDate?`, `paymentDay?`, per-source `initialWithdrawalRatePercent` in percentage mode; valid 0–100). Keep purchase line modes distinct; no target type/UI label should imply a fixed 4%. Extend `ExpenseEntry`/`RecurringExpenseEvent` (`provenance`, `sourceDate`, `sourceSign`, `asOf`).
- Runtime result metadata in `src/engine/`: `FundingRequest`, `FundingAllocation`, `FundingPlan` (integer cents).
- Remove dead `firstYearAmount` + `firstYearAccountWithdrawals`/`firstYearAccountUseFourPercent` if unused (D3).
- Keep `AccountTypePreset` descriptive + payroll retirement/HSA kinds; no financial pools.
- Identify all references to removed account/pool/source types. Migrate target consumers when their task is reached or delete superseded consumers immediately; record remaining compile/test errors with owning follow-up tasks. Do not create dummy pool maps, aliases or invented income just to satisfy old call sites.

**Files:** `src/types.ts`, target `src/engine/*` types as needed and directly superseded consumers. **Acceptance:** canonical target types and their focused type/contract checks are coherent; report any broken whole-app typecheck accurately until integrated.

## P1.2 (S) — Fresh factories and defaults

**Prereqs:** P1.1. **Deliverable:** independent first-launch/item factories.

- Independent scenario + UI factories; never a mutable shared singleton (TC06).
- `$0` opening / `0%` account return / `null` retirement-override defaults; new percentage withdrawal row rate 4% (editable), non-qualified HSA extra penalty 20% before age 65 (configurable), ordinary card `end = start + 11`; zero 0% debt.
- Date-dependent defaults take an explicit reference date from App (not engine wall-clock).
- Preserve supported payroll/housing/purchase/cashflow defaults deliberately; no resurrected hidden assets.

**Files:** `src/defaultScenario.ts`. **Acceptance:** two independent instances don't share nested references; reset ≠ exported singleton.

## P1.3 (S + Q) — Canonical normalizers and versioned allowlisted codec

**Prereqs:** P1.1/P1.2. **Deliverable:** structural normalizers + codec with `schemaVersion`.

- Envelope gains `schemaVersion`. `version ≤ current` → allowlist-load + current defaults for missing fields + prune approved obsolete fields. `version > current` → **block** (D2).
- Preserve valid siblings, empty `[]`, `0`, `false`, allowed `null` (D1/ADR-018).
- Deterministic ID repair; record-local diagnostics; no raw-input mutation.
- Prune approved fields across base/inactive timelines/pay plans/import/UI; drop obsolete `firstYearAmount` etc. (D3).
- On blocked future-version load or local recovery error, preserve the original stored bytes until a valid canonical state is explicitly available; incomplete App wiring must not autosave a fallback over user data.

**Files:** `src/storage.ts` (+ optional codec module). **Acceptance:** CA11, TC05–TC08; round-trip/idempotence.

## P1.4 (S) — Shared configuration commands and reference registry

**Prereqs:** P1.1/P1.2. **Deliverable:** canonical write/read commands.

- Active-timeline / selected-pay-plan commands; deep clone + freeze helpers.
- Marker/reference registry; career/housing chain resolution; deletion-reference cleanup.
- Separate global accounts/rates/planner from timeline-local plans.

**Files:** new `src/commands.ts` (or storage-adjacent module). **Acceptance:** GUI-A09; inactive-plan reference validation.

## P1.5 (S + K) — Opening-resolution contract

**Prereqs:** P1.1/P1.4. **Deliverable:** opening observation semantics.

- Stable IDs + measurement/provenance metadata.
- Observed debt wins (including `0`); configured debt used once when absent; old history remains asset-only.
- No speculative mortgage payment history or loan proceeds.

**Files:** types + storage normalization + engine compiler input (K). **Acceptance:** CA11 liability identity; R05.

## P1.6 (U + S) — Route incremental writes through canonical helpers

**Prereqs:** P1.3/P1.4. **Deliverable:** shared edit-path wiring.

- Build target editor write commands against canonical helpers (not App-local rebuilds) so unrelated edits retain every new field; remove obsolete editors/consumers directly instead of maintaining old types or an old production path.
- Define shared funding control + named-context/view boundaries.
- Record which GUI paths have been rewired and which are intentionally absent until P3–P5. Test available command/editor paths; complete App flow acceptance occurs when the target UI and projection are integrated.

**Files:** target commands and affected `src/App.tsx`/component write paths. **Acceptance:** focused G01/CA11 command preservation now; full GUI-A01/G01 App flow after P5 integration.

## P1.7 (Q) — Persistence acceptance tests (CA11)

**Prereqs:** P1.2–P1.6. **Deliverable:** CA11 + persistence suite.

- Factory isolation; reset/load equivalence; partial malformed records; round-trip/idempotence.
- Inactive plans; orphan UI references; liability identity; unrelated-edit persistence.
- `firstYearAmount` removal, configurable withdrawal-rate default/explicit zero round-trip, and HSA penalty/tax configuration preservation (D3/ADR-021).

**Files:** `src/storage.test.ts`, focused configuration-command tests, and runnable `src/App.test.tsx` cases. **Acceptance:** CA11's independent factory/codec/command assertions; keep any App-only TC05–TC08/GUI checks pending until their target UI is executable rather than claiming they passed.

---

## Exit criteria

1. Canonical config + codecs tested in isolation (focused CA11); unrelated broken App/engine imports are listed with ownership, not counted as passing checks.
2. Units/default/reference contracts (D1–D4) available to all streams.
3. No new field lost on implemented canonical command/edit paths; end-to-end App flows remain P5 acceptance if their consumers were removed.
4. D1–D4 reflected in types, factories, codec and relevant Phase-1 tests; Phase-2/3 math validation remains separate.
5. Handoff lists removed consumers, affected F/G/TC/MD rows, exact commands/results, known failing suites/build and the dependent phase that restores each path. Phase-1 exit does not assert a runnable release (ADR-022).

## Parallelism

Start with P1.1. P1.2 follows P1.1; once P1.2 is complete, P1.3 and P1.4 can run in parallel if separately owned files permit. P1.5 follows P1.4; P1.6 waits for P1.3 and P1.4; P1.7 waits for P1.2–P1.6. P2.1 can run alongside Phase 1 after P0; P2.2 needs P1.1 for its final types. D1–D4/ADR-021 settle the previously open rule choices; focused numerical implementation/proof remains Phase 2/3.
