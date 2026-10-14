# Account-Only Model — Pool Removal Sub-Plan

## Status and authority

**Status:** this sub-plan originated as planning only; no pool-removal code has been implemented by writing it. The later explicit authorization in [ADR-022](architecture_decisions.md#adr-022--incremental-implementation-authorized-intermediate-breakage-permitted) permits account-only implementation and immediate deletion of superseded consumers while other phases remain incomplete.

Accepted: remove the pool domain, configuration/UI, source references and shared rate ownership. Proposed: exact account field names/defaults, optional retirement-rate override, withdrawal-policy relocation, retirement fallback contract and report shapes below. This sub-plan supersedes earlier target-architecture passages retaining pool rules/expansion. Existing pool behavior in the feature inventory and archived fixtures remains historical evidence.

Review update RV01–RV31/ADR-019/020: rates/optional override/default0%/none/opening$0/global account-planner scope/explicit funding order accepted. Universal partial spending; pending home funding held as deposit until completion. Taxable proxy gain20% of gross/LTCG default15% editable, not actual basis. Withdrawals user-controlled,80years responsive. Historical proposals below yield to these choices.

Related: ADR-014 in [architecture_decisions.md](architecture_decisions.md); F01/F03/F06/F09/F10/F11/F22–F26 and R18 in [feature_specification.md](feature_specification.md).

Additional GUI audit: [gui_compatibility_audit.md](gui_compatibility_audit.md) maps G01–G40 elements and required replacements. Account-only source definitions/rates are insufficient without updating App-local normalizers, duplicate editor placements, pool-derived charts/previews and result transformations. GUI acceptance is part of future cutover.

Supplementary correctness/ownership: [testing audit](testing_correctness_audit.md), [maintainability audit](maintainability_documentation_audit.md), ADR-017/018. Account-only acceptance must exercise actual percentage source lines/independent rates, not pool-era fixed examples; canonical factories/defaults distinguish absent versus empty and isolate reset/load instances. Consumer cleanup must preserve one rule owner rather than duplicate new account formulas across editors.

## 1. Confirmed current dependencies

| Responsibility currently owned by pools | Actual source | Account-only replacement |
|---|---|---|
| Account membership/shared assumptions | `types.ts`: PoolDefinition, BankAccountDefinition.poolId, NetWorthConfig.pools; defaults/storage | Independent account records, no parent/group membership. |
| Pre/post interest or investment returns | `projection.ts`: getManualRates/applyMonthlyGrowth; CareerPlanEditor estimators; App net-worth/retirement editors | Account annual rate and proposed optional retirement override; shared valuation engine. |
| Tax/penalty/HSA/restriction rules | `projection.ts`: resolvePoolRule/applyNetTargetWithdrawal; App retirement pool rows | Explicit account withdrawal policy and accountType; purpose/age-aware tax quote, no pool lookup. |
| Priority and source exhaustion | sortAccountsByPriority/getPoolAccounts; monthlyRetirementLines pool fallbacks; App orderedBankAccounts | Explicit account source/fallback lists, separate display order, stable ID tie-breaks. |
| Amount and 4% targets | sourceLineTargetAmount; default retirement pool source | Account-specific targets, with optional total across explicitly selected account IDs derived for display only. |
| Career deposits and previous-career totals | applySourceContributions; App/CareerPlanEditor pool-to-account helpers and careerEndSavingsBalances | Destination account IDs; career-end balances keyed by account ID. |
| Purchase/loan/housing source variants | SourceType, LoanPaymentSource, financeModel helper, App selectors/normalization | Account primary/fallback policies; no `pool:*` source. |
| Stacked chart/legend/color | SavingsStackedChart groups accounts by pool, pool.color; App props | Account layers/legend/color; retain monthly hover/visibility/flags. |
| First-retirement-year outputs | WithdrawalResult.byLegacyPool/emptySavings/firstRetirementYearPlannedAccountWithdrawals | Gross/net/tax/penalty breakdown keyed by actual account ID. |
| Annual/saved trajectory totals | ProjectionYear/TrajectoryYear.savingsBalances; deflation/comparison | accountBalancesById and explicitly named totals, no misleading legacy pool keys. |
| Planner/import/reporting filters | ExpensesPlanner pools prop/Pool column/ExpenseEntry.poolId, expenseImport signature and derived poolId; expenses.ui selectedPoolIds/groupingMode | Account/category views, account matching, source provenance; no pool column/filter/import dependency. |
| Default/legacy aggregate storage | netWorth.accountBalances legacy pool map, career pool fields, default source rates keyed by poolId | Account opening snapshots/default factories; obsolete aggregate fields pruned under new-save policy. |

Pool names such as “Emergency Fund” can remain an **account label** or planned-expense category if the user chooses. There is no replacement “bucket” or account group owning balances/rates/rules. Existing paycheck `bucket: retirement | hsa` identifies employee benefit deduction kinds, not a balance-holding pool; rename if useful for clarity without deleting payroll capability.

`IncomePoolUsagePeriod.pool = monthly | yearly` is a different legacy budgeting term, not account membership. Target derived diagnostics rename it to `periodKind` and contain no spendable reservoir. Housing payment “groups” are sub-obligations, not pools; retain their separate payment-source capability.

## 2. Proposed account schema and defaults

Illustrative TypeScript, **documentation only**:

```ts
interface ProjectionAccountDefinition {
  id: string;
  label: string;
  accountType: 'checking' | 'savings' | 'taxable' | 'retirement401k' | 'roth' | 'hsa';
  openingBalance: number; // Persisted dollars; runtime postings use cents.
  annualReturnRate: number; // Percent effective annual yield/expected return.
  retirementAnnualReturnRate: number | null; // Proposed override; null = same rate.
  color?: string;
  displayOrder: number;
  withdrawalPolicy: {
    allowAutomaticFallback: boolean;
    withdrawalTaxRate: number;
    penaltyRate: number;
    restrictionNote: string;
  };
  assumedGainPercent?: number; // Confirmed taxable proxy:20% of gross proceeds.
  capitalGainsTaxRate?: number; // Confirmed default15%, editable per account.
}
```

- Primary UI field: **Annual interest / return (%)** on each account. Cash accounts may label this APY; investments label it expected annual return. Both use effective annual compounding, not nominal loan APR.
- Proposed default: 0% annual rate for a newly created account; optional retirement override defaults null; zero/negative valid rates never replaced via truthiness checks. First-launch seeded assumptions must be individually stored on accounts if chosen; **no shared inherited default rate**.
- Proposed preserve existing two-phase capability: optional “Use a different rate after retirement” override on each account. Retirement transition comes from the resolved projection scenario's retirement date. If not enabled/absent, the base rate applies throughout. Single-rate-only UI remains an open simplification requiring approval.

RV01/RV02 accepted two-phase per-account rates/defaults; no single-rate-only simplification/pool inheritance. RV15 clarification: disclosed taxable gain20% gross/LTCG default15% editable; no actual basis tracking or unknown-basis zero-tax guess.
- AccountType identifies tax/eligibility semantics and HSA treatment, not membership or automatic grouping/funding priority. Existing `isHSA` pool flag becomes `accountType: hsa`; not a second potentially contradictory boolean.
- General account withdrawal tax/penalty settings remain independently configured; taxable brokerage's distinct default LTCG15% applies only to assumed20% gross gain (3% effective before penalty/rounding). Do not apply a second generic all-proceeds tax or infer actual basis; cash/HSA/401K purpose/age rules independent. Display assumptions explicitly.
- ADR-021: explicitly qualified HSA medical spending is tax/penalty-free. Non-qualified HSA spending retains its configured income-tax assumption; the separately configurable extra penalty defaults to 20% before the account holder's 65th birthday and is waived thereafter whether retired or working.
- Proposed automatic fallback defaults: checking/savings/taxable allowed, retirement/Roth/HSA require explicit eligibility/source configuration. An account's display visibility/order never changes opening net worth, growth or funding eligibility.
- No generic pool-like enable switch that makes a real account disappear from valuations. If an account is retained with a positive balance, it counts in account assets; explicit liquidity/purpose/allowed-source policy determines whether it may fund a payment.
- New rates/rules live globally on accounts, matching current shared net-worth configuration across timelines. Timeline-specific career/housing/card plans continue to refer to those IDs. Per-timeline rate forecasts would be a separate, unrequested feature.

## 3. Account-specific valuation and derived summaries

For eligible account `a` in month `m`:

`annualRate = applicableAccountRate(a, resolvedRetirementDate, m) / 100`

`effectiveMonthlyRate = (1 + annualRate)^(1/12) - 1`

Post growth/interest to the **same account** as a valuation event. An account with 2% and another with 6.5% must never silently share their return assumption. Maintain ADR-010's explicit pending growth timing/partial-month policy; moving ownership does not approve a timing change.

Proposed supported rates: finite, >=−100%; −100% explicitly zeroes positive value at an applicable valuation boundary; no complex/NaN exponent for less than −100%. If zero elapsed time, no valuation event. Cash fees/taxes remain separate configured expenses rather than hidden negative growth assumptions.

Aggregate annualReturnRate, if retained for display, is balance-weighted **from account rates only**; it never drives growth of accounts. Define its observation date/weights in reporting. Zero total eligible asset balance yields display rate 0, not a synthetic rate or asset seed. Actual posted gains and net-worth change remain separately reported; APY is not cash income.

Properties have appreciation and liabilities have contract APR independently. Neither acquires a bank-account interest rate or participates in a hidden account-rate pool. The 0% card remains 0% debt regardless of funding-account yield.

## 4. Funding and retirement without pools

- All deposits, paycheck benefit destinations, career allocations/caps, obligations and shortfalls use account IDs. Remove `sourceType: pool`, `sourceId` ambiguity and `pool:*` source strings in the target schema. Prefer `accountId` and `FundingPolicy` directly.
- A payment debits selected primary account then configured eligible fallbacks, deduplicated in order. No “first account in pool” lookup or automatic sweep by account type. Source quotas/split funding remain supported where already meaningful.
- Retirement spending rows become **account rows**: enabled, account ID, fixed amount or configurable initial-balance percentage (new-item default 4%), start date/age, retirement-start link. Min/max/inflation and spending interpretation remain.
- Proposed retirement priority is an explicit `withdrawal.fallbackAccountIds` list, separately configurable from ordinary payment fallback defaults. Per-row override may select a different ordered list; default empty means no unconfigured automatic draw. Choosing all intended retirement accounts is an explicit plan action.
- For a percentage row, derive its initial net target from **that account's** authoritative balance at its configured valuation date × its own `initialWithdrawalRatePercent` (editable 0–100%, default 4%), then preserve target escalation. The default valuation date is that source's first withdrawal date, including later-start rows, never a shared retirement target date. Selecting multiple account rows sums their targets without a shared pool or mandatory shared rate.

RV18 overrides a fixed global retirement date: user chooses per-row withdrawal start/date/day and may optionally link retirement/markers. The initial percentage valuation date defaults to that row's first withdrawal date and can be explicitly selected if an authoritative observation exists (ADR-021); it never silently uses a global date.
- When one source exhausts, continue to the next explicitly eligible account in the configured retirement order. Record each actual gross debit/net payment/tax/penalty by account; shortfall when list exhausted. Account type/display order does not silently broaden the list.
- Separate **display order**, **deposit allocation order**, **fallback order**, and **same-date obligation priority**. A chart reorder cannot alter payment funding. Stable account IDs are final tie-breaks where ordering matters.
- Existing tax-aware withdrawal, HSA age/purpose restrictions, caps and source start age capability move to account policy/plans; removing pools does not remove these financial requirements.

## 5. UI/report contract

| View | Target change | Retained capability |
|---|---|---|
| Net Worth account editor | Remove pool table/Add Pool/membership dropdown; add rate/optional retirement override, color and account rule controls | Account CRUD/balances/history/type, named accounts, priority configuration in appropriate plan views. |
| Retirement | Account-specific source rows, spending amounts or configurable initial-balance percentage (4% default), start links and ordered fallback accounts | Tax/penalty/HSA controls, min/max/inflation/exhaustion warnings without pooled balances. |
| Careers/pay plans | Each savings/expense line targets account; shared engine previews read account rates | Paycheck employee/employer deposits, fixed/% savings, raise options, cap overflow, monthly expenses and career end totals. |
| Stacked savings chart | One layer per account, account color/label/ID, per-account legend visibility and hover | Monthly stacked chart, totals, range, flags and color UI. No substitute user-defined financial grouping. |
| Results/summary | Account columns and explicitly named asset/debt/net-worth totals; weighted rate derived from accounts | Monthly/yearly views, warnings/tooltips, current dollars and trajectory comparisons. |
| Expense planner/tracker/import review | Remove Pool column/grouping/filter, match account directly, retain per-account categories | Weekly planning, recurrence, account selector, imports/source removal, requested/paid charts. |
| Loan/housing/card/purchase funding | Primary/fallback account selectors only | Independent payment groups/down/lump-equivalent scheduled payoff choices through approved new product model. |

Target result fields:

- `accountBalancesById` remains the authoritative per-account asset map.
- `careerEndAccountBalancesById[careerId][accountId]` replaces pool-keyed career end totals; retirement-assets display sums the appropriate snapshot once rather than double-counting account balances across careers.
- `firstRetirementYearWithdrawalsByAccountId[accountId]` records `{grossDebit, netSpent, taxes, penalties}`; correct original misleading “planned” label if actual funded amount is shown.
- Remove pool-keyed `savingsBalances`, `byLegacyPool`, `emptySavings()` and hard-coded emergency/HSA/investment/401K aggregate fields from target output contracts.
- Saved trajectory/history with valid account IDs still usable where their measurement/version is supported. Old pool-only derived breakdowns may be pruned under accepted save policy; never reinterpret a pool ID as an account ID or add aggregate and account balances together.

## 6. Persistence/cutover planning

Accepted new-save/default rule applies. **Proposed normalization:** keep supported account IDs, labels, balances/types and direct account rate/rule values; missing rates/rules use the new account factory defaults. Do not preserve a runtime pool lookup or automatically inherit a deleted pool's rates after loading. Existing users may need to re-enter account assumptions as part of a new save.

Prune on canonical save: netWorth.pools; account.poolId; pool source variants; legacy netWorth.accountBalances pool aggregates; pool-dependent career start/contribution aliases; ExpenseEntry.poolId; selectedPoolIds/groupingMode=pool; pool-keyed result/cache fields. Apply across base and all inactive timelines/pay plans, not only current edits. Account/category/history/import provenance is retained where supported.

Unsupported old pool-funded source does not resolve its pool ID as an account ID. Proposed: normalize to new-item source default (designated cash account, or empty when none); retirement rows require an actual account ID and default to a new explicit account plan rather than expand old membership. This changes old financial assumptions under the accepted new-save rule; document it and test missing account behavior. One-time copying old shared rates to account records is an alternative, **not selected** for the draft and not required for equivalent saves.

Normalization remains read-only until normal save; code rollback through git remains possible, equivalent old-plan reconstruction after pruning not guaranteed. Opening liabilities still deduplicate by ID; deleting pool metadata does not change supported snapshot account balances or imply debt was included.

## 7. Authorized implementation sequence (ADR-022)

1. Finalize account rate fields/defaults/override and withdrawal/fallback contract at Gate B; update types/default/storage/consumer checklist.
2. Add target account-only characterization/invariants and synthetic saved-input normalization fixtures; keep original pool baseline evidence archived.
3. Introduce independent account definitions, account tax quote, direct account source/fallback contracts and account-only valuation through the new engine, without mixed old/new execution.
4. Adapt account/retirement/career/funding editors and default plans; old editors/helpers may be removed before every replacement is wired, with remaining target behavior tracked to its owner and intermediate failures recorded.
5. Adapt stacked/chart/table/trajectory/deflation and career/retirement breakdown outputs; verify all account assets are counted exactly once.
6. Adapt planner/import APIs and account/category UI; remove all pool grouping/filter fields and props.
7. Canonical save prunes obsolete pool fields across all timelines; validate missing defaults/invalid source IDs.
8. Verify that pool types/functions/state/normalizers/derived maps removed during earlier phases have no survivors; finish actual-code docs after integrated replacement tests pass. Pool-era consumers may be removed earlier under ADR-022.

## 8. Acceptance tests to add later

- Two same-type accounts with different rates grow independently (unrounded formula: $10,000 at 2% → $10,200; at 6.5% → $10,650 over twelve full months without other events). Cent-posting tests reconcile the explicit rounding/residual policy instead of assuming repeated rounded postings reproduce the unrounded figure exactly.
- Changing one account's rate does not affect another account; changing weighted portfolio display rate never changes postings.
- Zero balance/rate, negative investment return, optional retirement-rate boundary and partial periods follow explicit policy; no NaN/phantom principal.
- Two accounts with different tax/penalty/basis/purpose rules yield independent gross/net funding allocations; HSA medical/general capability persists without isHSA pool flag.
- Retirement primary + multiple explicit fallbacks split correctly and retain liability/expense conservation; unconfigured or restricted accounts never implicitly fund spending.
- Per-account configurable initial-balance percentage targets (new-item 4%) / min/max / inflation / source start dates retain capability; account exhaustion no longer depends on membership.
- Deposit/payroll/cap overflow destinations exactly match IDs; no first-account-in-pool or duplicate allocation conversion.
- Stacked chart includes all visible accounts once, even multiple same-type accounts; account color/legend visibility cannot change projection math.
- Career/retirement output maps keyed by account ID reconcile to monthly audit; totals/current-dollar/trajectory views contain no pool aggregate double count.
- Planner/import data retains valid account/category/source links; no Pool column or pool API dependency; projected recurrence once.
- Load/save defaults/prunes old pool fields without mutating input or unrelated valid account/history data; absent/null/0 values behave as specified; inactive timelines covered.
- Runtime/schema/UI/static consumer search finds no pool domain after cutover; historical docs/archive references deliberately remain. Budget diagnostics use periodKind, not “pool” reservoirs.

## 9. Open account-only decisions

1. Resolved RV01: base rate/optional retirement override.
2. Resolved RV02/RV03: rate0%/none, openings$0/no pool inheritance/scalar seed.
3. Resolved RV10/RV14/RV16/clarifications: explicit eligibility/retirement order; taxable gain20% gross/LTCG default15% editable; partial acquisition held deposit until complete. Withdrawal/percentage-base and payoff dates/source explicit engineering contracts; no longer blocked by gain or acquisition ambiguity.

Broader timing/import/atomicity/precision/depletion choices remain the previously documented Gate B questions. None is implicitly approved by removal of pools.
