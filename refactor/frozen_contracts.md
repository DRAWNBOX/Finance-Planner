# Frozen Contracts — Phase 0 (Account-Only Finance Planner Refactor)

Phase 0 (P0.3/P0.4/P0.5/P0.7) contract freeze. Planning/contract only — **no financial math replaced**. This document is the authoritative contract register consumed by Phases 1+.

Authority order: RV01–RV31 plus explicit follow-ups (`review.md`) and ADR-019/020/021 > other accepted ADRs (`architecture_decisions.md`) > target specs (`architecture_specification.md`, `account_only_subplan.md`, `migration_plan.md`) > audits. Each clause cites its authority; any future `UNRESOLVED → blocker` marks an element not yet pinned by an accepted decision.

**Rule status:** D1–D3 resolved the Phase-1 naming/save/dead-field questions; [ADR-021](architecture_decisions.md#adr-021--exact-cents-hsa-age-rule-and-configurable-initial-balance-withdrawal-rate) resolves the six previously listed finance-rule choices. **No open choice remains among those six.** The quoted solver, HSA defaults, source-specific withdrawal percentage/date, and other target rules still require implementation, numeric proof, GUI validation and performance measurements; the existing runtime is unchanged.

## Follow-up decision record (D1–D3: 2026-10-13; D4: 2026-10-14)

### D1 — Concrete TypeScript names (resolves blocker 7)

| Frozen contract | Concrete name | Notes |
|---|---|---|
| Account / rate / policy | `AccountDefinition` (rename `BankAccountDefinition`) | drop `poolId`+`priority`; `balance`→`openingBalance`; add `annualReturnRate`, `retirementAnnualReturnRate: number \| null`, `color?`, `displayOrder`, `withdrawalPolicy`, `assumedGainPercent?`, `capitalGainsTaxRate?` |
| Account withdrawal rules | `AccountWithdrawalPolicy` | `{ allowAutomaticFallback, withdrawalTaxRate, penaltyRate, restrictionNote }` |
| Liability | `LiabilityDefinition` | `{ id, kind: 'loan'\|'mortgage'\|'zeroInterestCard'\|'saleDeficiency', openingBalance, linkedPropertyId?, … }` |
| Property | `PropertyDefinition` | `{ id, value, debtLink?, requiredDownPayment, status: 'pending'\|'owned'\|'sold', … }` |
| Held deposit | field `acquisitionDepositCents` | runtime property state, not persisted |
| Opening snapshot | `OpeningSnapshot` | `{ date, accounts, liabilities, measurement: 'assetOnly'\|'assetsMinusLiabilities', sourceSnapshotId? }` |
| Funding policy | `FundingPolicy` | `{ primaryAccountId, fallbackAccountIds: string[] }` |
| Allocation / remainder | `CareerDepositPlan` | `{ allocations: CareerSourceLine[], remainderAccountId, postingDay? }` |
| Withdrawal source row | `RetirementWithdrawalSourceLine` (withdrawal-specific successor to `SourceLine`) | `mode: 'amount' \| 'percentOfInitialBalance'`, `firstWithdrawalDate`, `initialWithdrawalValuationDate?`, `paymentDay?`, and `initialWithdrawalRatePercent` in percentage mode (editable; new-item default 4%); do not rename purchase modes |
| Cards | `CardPlan = OrdinaryCardSchedule \| ZeroInterestCardPlan` | `{ kind: 'expectedPayment' } \| { kind: 'zeroInterestPayoff' }` |
| Planner provenance | extend `ExpenseEntry` / `RecurringExpenseEvent` | add `provenance`, `sourceDate`, `sourceSign`, `asOf` |
| Result metadata | `FundingRequest` / `FundingAllocation` / `FundingPlan` | engine-internal (`src/engine/`), integer cents |

Persisted shapes → `src/types.ts` + `src/defaultScenario.ts`; runtime/audit → `src/engine/`.

### D2 — Future-schema-version: block (resolves blocker 4)

Add a `schemaVersion` to the saved envelope (currently absent). Load policy:
- `version ≤ current` → load allowlisted fields + apply current-version defaults for missing fields + prune approved obsolete fields → normal save (safe; existing data preserved, new fields defaulted).
- `version > current` → **block** with "created by a newer version — please update"; do **not** allowlist-load-and-resave (resave would silently drop the unknown newer-version fields = blank data on reopen in the newer version).

### D3 — Remove `firstYearAmount` (resolves blocker 9)

Dead config (zero engine references). Remove from: `WithdrawalPlan.firstYearAmount` (`src/types.ts:515`) and the equally-dead `firstYearAccountWithdrawals`/`firstYearAccountUseFourPercent` if unused; default `src/defaultScenario.ts:445`; the two derived recomputes `src/App.tsx:1442`/`:2435`; load normalization + save pruning in `src/storage.ts`; and ~10 fixtures in `src/App.test.tsx`.

### D4 — Exact finance and configurable percentage contracts (ADR-021)

Accepted: bounded rational gross-up with separately rounded gross-based tax and penalty (at most 256 candidate cents, otherwise explicit unsupported-range diagnostic); cumulative per-line rounding for annualized targets; ceiling-cent adaptive 0% repayment from actual remaining debt; HSA non-qualified 20% default extra penalty before 65, waived at 65 regardless of retirement while configured income tax remains; and a user-configured `initialWithdrawalRatePercent` on each percentage-based retirement source (new-item default 4%). The percentage basis defaults to **that source's first withdrawal date**, including later-start sources. Details and proof obligations are specified below and in ADR-021. These are accepted target contracts, not passing tests.

---

## P0.3 (K + R) — Interfaces and execution rules

### P0.3.1 Config interfaces, canonical fields, units

**Global unit rule (RV28, ADR-010):** persisted config = dollars; runtime posting/balance = integer cents; dollars converted once, rounding half-away-from-zero; rate math uses high-precision/rational intermediates, rounding only at the final posting boundary (ADR-020).

1. **Account / rate / policy** (RV01–RV04/RV10/RV14/RV15/RV16, ADR-014, ADR-020): `id`, `label`, `accountType` (`checking|savings|taxable|retirement401k|roth|hsa`), `openingBalance` (`$0` default), `annualReturnRate` (missing = `0%`), `retirementAnnualReturnRate` (`number|null`, null = base), `color?`, `displayOrder`, `withdrawalPolicy { allowAutomaticFallback, withdrawalTaxRate, penaltyRate, restrictionNote }`, `assumedGainPercent?` (fixed `20`), `capitalGainsTaxRate?` (default `15`, editable). No pool inheritance / hidden scalar asset. Display ≠ funding ≠ deposit ≠ fallback order.
2. **Liability** (ADR-011, ADR-006): `id`, `kind` (`loan|mortgage|zeroInterestCard|saleDeficiency`), source-config ID, `openingBalance` (positive = debt), `linkedPropertyId?`, interest/payment terms. Negative account balances are never debt.
3. **Property** (ADR-011, ADR-020): `id`, observed opening value/debt link, acquisition dates/costs/appreciation, `requiredDownPayment`, dated funding events, `status: pending|owned|sold`, held deposit, `completedDate`.
4. **Held deposit** (ADR-020, ADR-011, RV11): non-liquid acquisition-deposit asset, counted once in assets/net worth, never a funding account, default no growth. Represented in property state (`acquisitionDepositCents`), not a bank account.
5. **Opening snapshot** (ADR-011, P1.5): `date`; account/property/liability values keyed by stable IDs; measurement metadata (`assetOnly` vs `assetsMinusLiabilities`); source snapshot ID. Observed debt wins (incl. `0`); configured debt used once when absent; old history asset-only; no speculative mortgage history/proceeds.
6. **Funding sources / order** (`FundingPolicy`, RV10/RV11/RV12, ADR-007, ADR-014): `primaryAccountId`, `fallbackAccountIds[]` (ordered), purpose, eligibility, per-obligation override vs global default, separate retirement ordered list. All obligations partial.
7. **Allocation / remainder** (RV05/RV07/RV08, ADR-009, ADR-013): ordered %-of-net / fixed-per-pay-period net allocations (each with account ID), `remainderAccountId`, optional posting day. Not expenses, no double-debit; missing/deleted destination visibly unresolved.
8. **Withdrawal** (RV18, ADR-003, ADR-014, ADR-021): `enabled`, `accountId`, amount-or-percentage-of-initial-account-balance target, `initialWithdrawalRatePercent` (editable per percentage-mode source; default 4%, valid 0–100%), min/max/inflation, `firstWithdrawalDate`, payment day, optional retirement/marker link, explicit ordered retirement fallback, explicit valuation date. Net additional living spending; gross/tax separate.
9. **Two card types** (ADR-006, RV19/RV20): `OrdinaryCardSchedule { kind:'expectedPayment', amount, inclusive start/end (default end=start+11), payment day, funding, flags }` — no tracked balance/charges/APR. `ZeroInterestCardPlan { kind:'zeroInterestPayoff', liabilityId, initial balance, start, inclusive target, payment day, funding, flags }` — APR 0, snapshot-linked debt uses same liability ID once.
10. **Planner provenance** (ADR-004, RV22): occurred imports carry `sourceDate/sourceSign/asOf` (view-only); stable keys `planner:<entryId>:<date>` / `recurrence:<eventId>:<date>`; one-time `endDate` is display span; no parent+occurrence double-charge.
11. **Result metadata** (ADR-012): `FundingRequest { id, occurrenceId, date, requestedCents, primaryAccountId, fallbackAccountIds[], purpose }`; `FundingAllocation { accountId, grossDebitCents, netFundedCents, withheldTaxCents, penaltyCents, assumedGainPercent?, capitalGainsTaxRatePercent? }`; `FundingPlan { stateRevision, request, allocations[], feasibleCents, executedCents, shortfallCents, status: funded|partial|unfunded }`. Audit rows: source/date/phase/occurrence IDs, requested/executed/unpaid, gross/net/tax/penalty, assumption metadata, touched deltas. All cents. Result objects, monthly closes, and saved trajectory/opening snapshots are **deep-frozen** and never alias engine state; state mutates only via `commitChanges`. The snapshot/copy lifecycle has one owner (canonical clone/freeze codec).

### P0.3.2 Event/posting phases and same-date order (RV23, RV25, ADR-010)

1. Contractual debt-interest accrual + acquisition/disposition preparation. 2. Payroll/other direct income. 3. Explicit cap policy. 4. Mandatory obligations (loan/mortgage installment, rent/housing groups, ordinary card + 0% payoff, recurring living, retirement spending). 5. Discretionary purchases/extra debt payment. 6. Month-close valuation, then closing snapshot.

Opening snapshot is observation before same-date events; no funding from future deposits/gains; same-date income-before-payment is explicit approximation. Acquisition + down-payment funding = one event; mortgage installments begin only after acquisition; sale proceeds cannot fund before sale commits. Events sort by date/phase/priority/stable occurrence ID.

### P0.3.3 Funding / partial policy (ADR-007, RV05/RV07/RV10/RV11/RV12, ADR-014)

1. Primary-first, ordered, eligible split; deduplicate IDs preserving first position; never sweep by type/pool. Retirement uses its explicit ordered list.
2. Global payment defaults + per-payment overrides; retirement separate list (fully pinned).
3. Partial allowed for all: `executed = Σ actual net funded`; `unpaid = requested − executed`.
4. Atomic commit: allocations + related debt/deposit/acquisition changes commit together (one change set) or no-op; validate revision/nonnegative cash/ownership/conservation; stale quote recomputed.
5. Zero-fund/invalid = no debit, visibly unfunded, no postponement/retry/borrowing (distinct from valid partial funding).

### P0.3.4 Cents rounding (RV28, ADR-010)

1. Integer cents; dollars→cents half-away-from-zero at posting boundary.
2. For each independent annualized target/line, request at occurrence `k` the rounded cumulative scheduled amount through `k` minus that through `k−1`; reset on plan/annual-target changes and prorate actual partial periods. Twelve requested shares sum to the rounded annual amount; actual deposits may be smaller when net pay is exhausted. Apply to percentage-based initial targets and employer contributions as applicable. No `$0.01` tolerance erasing unpaid principal (ADR-021).
3. High-precision intermediates; round only final posted cent; never recompute tax from a displayed rounded gain.

### P0.3.5 Safe integer limits / overflow (RV28, PS20, ADR-016)

Reject nonfinite/unsafe/negative-request at normalization; validate safe-integer cents after multiply/round/aggregate/commit and valuation — not just input; unsupported range ⇒ explicit diagnostic or approved exact representation; account rate finite `>= −100%`; zero elapsed time ⇒ no valuation event.

### P0.3.6 Exact bounded gross-net algorithm (ADR-020, RV15, CA04)

Assumed gain = 20% of gross debit; cost = 80%; LTCG default 15% editable.

- **Gross→net:** `gain = gross × 0.20` (unrounded); `tax = roundHalfAwayFromZero(gross × 0.20 × (LTCG/100))` (one high-precision product); `net = gross − tax − penalty`. `$1000` → gain `$200` → tax `$30` → net `$970`. Edge `$0.17` gross → gain `$0.034` → tax `$0.01` (not from rounded `$0.03`).
- **Net→gross:** smallest cent-valued `G` with `G − tax(G) − penalty(G) ≥ netRequest` and `G ≤ balance`. Compute each applicable tax and penalty **separately from gross** with one half-away-from-zero cent rounding each; they reduce gross proceeds once and are never charged again. `$1000` net @15% LTCG with zero penalty → `G = $1030.93` → tax `$30.93`. Rounding remainder stays in the source account.

**Bounded quote (ADR-021/PS06):** represent accepted decimal rates as exact rational coefficients. For target net cents `N`, combined effective withholding fraction `r < 1`, and `C` independently rounded components (`0–2`), each rounding error is at most half a cent. Thus a sufficient full-funding debit lies between `L = max(0, floor((N − C/2)/(1 − r)))` and `U = ceil((N + C/2)/(1 − r))`, absent a balance cap. Evaluate integer cents in ascending order from `L` and take the first sufficient debit. If balance cannot cover that debit, report actual partial funding using the same exact policy; the highest partial net can be found by checking the rounding-error-bounded neighborhood of the available balance. Validate nonnegative rates and `r < 1`; if a proven candidate window exceeds **256** candidates or a balance/intermediate is unsupported, return an explicit diagnostic, not an approximate result or an unbounded search. Test minimum debit, the bracket/iteration bound, and exact `gross = net + tax + penalty` identity for executed allocations.

---

## P0.4 (S + U) — Factories / default / persistence semantics

### P0.4.1 Independent factories (ADR-018, TC06)

Fresh independent default scenario + UI (never shared mutable singleton); date-dependent defaults get explicit reference date from App; no shared mutable nested refs across factory/load/reset; reset uses independent factory. A new percentage-mode withdrawal source defaults `initialWithdrawalRatePercent` to 4%; an explicit valid `0` remains `0`.

### P0.4.2 Absent vs empty vs 0 vs false vs null (ADR-018, CA11)

Absent field → factory default; absent collection → new-scenario default, but explicit `[]` stays `[]` (never restored by truthiness/length); numeric `0`/boolean `false` are values; allowed `null` preserved; invalid enum/type values default (no financial conversion); stable IDs retained, duplicates deterministically repaired; dangling funding links → empty/default → visibly unresolved (never create balances).

### P0.4.3 Local malformed recovery / future-version (RV29, ADR-018, TC07)

Record-local recovery with diagnostics; default/reject only the affected record, preserve valid siblings; fully-invalid JSON → fresh defaults. Future-schema-version behavior **resolved by D2: block** (version > current refuses to load, no silent allowlist-and-resave).

### P0.4.4 Hydration / autosave / save lifecycle (RV29, ADR-018, PS10)

Load does not immediately rewrite; autosave never overwrites valid plan with broad fallback; show diagnostics; normal save writes canonical fields (pruning obsolete raw); no silent loss; no mandatory backup/conversion/approval; saves exclude live audits/caches/expanded occurrences/calculated balances; coalesced/debounced writes with flush + failure visibility; async storage only when measured scale requires.

### P0.4.5 Initial $0 cash/payment account (RV03, ADR-014)

Opening `$0`; designated cash/payment account = initial remainder destination; no hidden scalar asset; deleting that account → references empty/invalid until configured, never redirected to restricted account.

---

## P0.5 (I + O) — Remaining product detail contracts

### P0.5.1 Withdrawal first date / configurable percentage basis (RV18, ADR-003, ADR-020/021)

Per-source first withdrawal date (y/m/d) + payment day; optional retirement/marker link; percentage mode has an editable `initialWithdrawalRatePercent` (new-item default 4%, valid 0–100%; `0` is intentional). The account's initial net spending target is its balance on the explicit valuation date times that rate, before min/max/inflation; subsequent years escalate the frozen target, not an automatically recomputed percentage. The valuation date defaults to **the same source's first withdrawal date**, even if later than retirement. Explicit earlier dates require an available authoritative observation; no invented past/future balance or forced global retirement basis.

### P0.5.2 Residual 0% lump-sum payoff (RV19, ADR-006)

Explicit date/source; default date = final scheduled payment date, default source = regular policy. Each scheduled request is `ceil(remaining principal cents / remaining scheduled payment count)`, capped at actual remaining debt and recalculated after **funded** payments; $100 over three fully funded dates requests $33.34/$33.33/$33.33. Coincident final installment + payoff = one remaining-principal request; later lump date pays only then-outstanding debt; no automatic monthly retry/duplicate principal (ADR-021).

### P0.5.3 Acquisition-deposit lifecycle (ADR-020, ADR-011, RV11/RV21, CA09)

Partial `$30k` toward `$60k` → debit gross, create deposit `$30k`, no home/mortgage/PMI/appreciation pending. Later `$30k` → atomically remove `$60k` deposit + create `$300k` property/`$240k` mortgage. No second down-payment expense; no retry/borrowing; zero-down completion may occur if terms valid; deposit counted once, non-liquid, no growth.

### P0.5.4 HSA / retirement purpose & age rules (RV14/RV16, ADR-008)

Checking/savings/taxable ordinarily eligible; retirement/Roth/HSA explicit eligibility. Explicitly qualified HSA medical spending is tax/penalty-free. Non-qualified HSA spending retains configured income tax and defaults to a configurable **20% extra penalty before age 65**; from the holder's **65th birthday**, waive only that penalty regardless of retirement status. A category label does not confer medical qualification. The taxable brokerage proxy does not apply to HSA/401K/property/payroll; tax/penalty come from gross once (ADR-021).

### P0.5.5 Raise / career-break boundaries (RV09, ADR-009, ADR-013)

Salary `0` outside active career ⇒ no deposits; explicit months do not fall back to age-only career in date gaps; payroll deductions reduce net once; living spending separate.

---

## P0.7 (P + U) — Performance / ownership contracts

### P0.7.1 Benchmark profiles (RV31, ADR-016)

B-P1 household: `M=960, A=12, D=6, P=2`, ~30 monthly + 10 weekly obligations, 5 career/pay plans. B-P2 large: `M=960, A=100, D=50, P=20`, 250 monthly + 100 weekly, 50 career/pay plans. 960-full-month support is required, not a cap/default; no silent horizon shortening.

### P0.7.2 Stage/counter metrics (ADR-016)

Report E (emitted events), K (candidate funding checks), L (committed allocations, `L ≤ K`), solver iterations, serialized bytes, peak footprint (main+worker+in-flight), transport, commit/paint, save. Bounded diagnostic ring buffer; p50/p95 + sample count.

### P0.7.3 Measurement procedure + budgets = MEASUREMENT GOALS (RV31, ADR-016)

Production build, desktop Chrome/Edge, documented Windows machine + one CPU-throttled profile; record CPU/RAM/browser/build/commit, viewport, cold/warm, storage state; ≥30 warm samples. Goals (not promises; miss ⇒ document + revise + restate envelope; never shorten horizon/degrade precision): echo p95 ≤ 50ms; household fresh ≤ 250ms; large fresh ≤ 2s (background runner); cancel ≤ 100ms; footprint ≤ 64MiB/256MiB; small save p95 ≤ 10ms (~2MiB design trigger). Correctness-preserving: no per-cent search, no audit loss, no horizon shortening, no saturation, no fabricated income; optimized ≡ reference (CA13).

### P0.7.4 Ownership (implementation_plan §2, MD audit)

- Cache (bounded financial-revision cache, invalidation) → **P** (`src/utils/perfTools.ts`).
- Runner (on-demand compute, revision/cancel/stale, worker/chunking) → **P**.
- Audit-query (compact indexed audit, monthly/annual/outcome selectors) → **R**.
- Storage (hydration/save/codec/envelope/diagnostics/async) → **S** (no financial calc).
- Integration owner serializes `App.tsx`; K owns projection facade/state/scheduler.
