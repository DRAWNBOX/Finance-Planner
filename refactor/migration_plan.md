# Save Format Transition — Defaults and Obsolete-Field Pruning

## Authority and scope

**Target save plan; incremental implementation authorized (ADR-022); no user data has been rewritten by this document.** User explicitly accepts that the refactor may require a new save. Unused/unneeded values may be removed; changed values/types may remain; absent values use new-item/first-launch defaults. This replaces the parent's requirement for equivalent old-plan migrations, mandatory backup/rollback storage and old-card mapping prompts.

This is a normalization/cutover plan, not a promise old plans project the same amounts. Financial corrections and new product types intentionally change results. Preserve unrelated supported configuration; permission to remove obsolete **code consumers** early or prune obsolete fields is not permission to silently erase supported saved history/import data or omit accepted capabilities from the final product. Intermediate UI/build/tests may fail until the dependent phases restore them (ADR-022).

User now explicitly requests removing Pools; rates belong to accounts. This is **planned, not implemented**. ADR-014/[account_only_subplan.md](account_only_subplan.md) supersede earlier pool-retention assumptions; no storage changes in this planning phase.

GUI write-path requirement (G01/ADR-015): `App.updateScenario` and source-sync effects currently reconstruct records independently of storage. Future canonical normalizers must be shared across edit/load/save so account rates/policies and new debt/funding/history fields cannot disappear after an unrelated GUI edit. Test this round-trip before release, not only raw storage normalization.

Performance proposal (PS10/ADR-016): ordinary canonical saves must not serialize generated live audits/cache/occurrences. Coalesce durable config/UI writes with tested final flush and visible failure, measure actual serialized bytes/quota, and evaluate asynchronous storage for large supported config/history/import/frozen artifacts. LocalStorage-only scalability is not established; moving backend is a proposed decision, not implemented or required solely by this document. Valid user data must not be silently dropped to stay below a size target.

Review update RV29 recovery/RV30 async storage, account defaults0%/none/opening$0, twelve cards/view-only occurred imports/universal partial accepted. ADR-020: taxable assumed gain20% of gross, LTCG default15% editable (no actual basis ledger); pending partial acquisition deposit retained asset until complete. ADR-021: per-source editable initial-balance withdrawal percentage (new-item default4%) and non-qualified HSA configurable extra penalty default20% before65/waived from65 regardless of retirement. Canonical shapes/funding dates/linked IDs must cover pending deposits and actual completion, with no borrowing/no duplicate deposit/property snapshot.

## Supplementary audit findings — current behavior, not fixes

- `storage.ts:637` treats an explicit empty career array as absent and restores the default career. Missing bank accounts become [] at 721–743, inconsistent with first-launch seeded defaults. Current loading therefore does not fulfill the target default contract consistently (TC05).
- First-launch/no-window/catch load returns shared defaultScenario/defaultUiState, and App reset reuses defaultScenario. Fresh independent factories/reset are required to eliminate shared-reference risk (TC06).
- Whole-load catch can reset the entire scenario if one nested normalizer throws; App autosave can subsequently overwrite stored valid sibling data with fallback state (TC07). Raw JSON type assertions are not structural validation.
- Current storage tests primarily cover approved manual-contribution removal; general canonical round-trip/default/malformed/independence coverage is still pending (TC08/CA11). See [testing audit](testing_correctness_audit.md) and ADR-018.

These are observed inconsistencies/candidate loss paths, not a requirement for elaborate old-plan conversion. New-save/pruning permission remains; unrelated supported valid data should survive ordinary local validation.

## Proposed canonical envelope

```ts
interface SavedAppState {
  schemaVersion: number;
  scenario: Scenario; // target allowlisted configuration
  ui: AppUiState;
}
```

Use the existing `finance-planner-state` key unless implementation establishes a reason to change it. Define one canonical schema version for the new account-flow release, an allowlisted serializer and shared normalizers used by App update/load/save. Do not spread the entire raw JSON into canonical persisted objects.

### Default contract

1. Missing top-level state creates a **fresh independent** default scenario and UI; never return a mutable shared singleton.
2. Missing object fields use that object's current factory defaults. Defaults depending on dates receive an explicit reference date from App, not an engine-internal wall clock.
3. Absent collection uses its new-scenario default collection; an explicitly present empty array stays empty (e.g. user deleted all careers). Missing fields on each retained item use that item's factory defaults; one malformed item does not reset the whole scenario.
4. Valid supported changed-meaning field values may remain after validation. Invalid/obsolete enum/type values default, not guessed financial conversion. A numeric 0 and boolean false are values, not missing data.
5. Stable valid IDs retained; duplicate/missing IDs deterministically repaired. Empty/dangling funding links become empty/default references, then visible unresolved-funding results. Do not create balances to satisfy dangling links.
6. Missing scalar/deposit/liability fields default per new factory, not by extracting speculative values from legacy names. The proposed new 0% card initial debt default is 0; loan/mortgage defaults follow their own factories. Balance inputs must be finite/in bounds; liability values positive and separate from cash.
7. Load itself does not immediately rewrite storage. The normal save path writes only current canonical fields, naturally pruning obsolete raw values. No new mandatory approval dialog or backup file.
8. Invalid complete JSON resolves to fresh defaults. A save with an **unknown future `schemaVersion` is blocked** with an update message; do not load a partial allowlist and then autosave over the unknown newer fields (D2 in frozen_contracts.md). Older/supported versions receive current factory defaults for missing fields and are saved normally.
9. Validate raw collection/item shapes locally before access/map, collecting diagnostics and defaulting/rejecting only the affected record/field according to a reviewed rule. Completely invalid JSON cannot be repaired as a partial record; distinguish it explicitly from valid siblings plus one malformed item.
10. Initial hydration/recovery must have an explicit save lifecycle: no silent broad data loss because an automatic GUI save persists a whole-plan fallback after a local error. Preserve valid siblings, show load/save diagnostics and write canonical accepted state under the normal save policy; no mandatory conversion/backup/approval dialog.

## Field transition map

| Current data | Proposed treatment | Missing/default behavior / acceptance |
|---|---|---|
| Profile/DOB/future retirement | Retain supported controls, derive explicit projection boundary | Factory horizon defaults; date-only validated. |
| Pool definitions/membership/shared rates/rules | Remove `netWorth.pools` and account `poolId`; move target rates/rule ownership to accounts, no ongoing inheritance | Proposed missing account rate 0%, retirement override null, new policy defaults; no automatic old-pool copying. |
| Bank account ID/label/type/balance/order and direct rates/rules | Retain supported account opening/rate/eligibility and disclosed taxable assumption fields | Preserve0; missing new factory defaults; no actual basis ledger or fictional opening asset. |
| `portfolio.currentAssets`/legacy pool aggregate balance | Remove as runtime balance authority once account editor replaces consumers | No hidden initial $500,000 in empty accounts. New-scenario account defaults authoritative; any default seed must be posted to actual account. |
| Granular paycheck categories/lines/pay plans | Retain supported lines/frequency/amount/bucket/account; respect individual deposit destinations | Current new-paycheck defaults for absent fields; preserve true posttax payroll deductions. |
| Flat paycheckInfo/legacy taxInfo/period/livingExpenses | May remove obsolete consumers/fields before granular payroll is integrated; never fabricate a replacement income amount | Missing granular paycheck uses fresh paycheck factory. Changed results accepted; no label inference; track temporarily broken consumers until income/UI work completes (ADR-022). |
| Career source lines/monthly expenses/caps | Retain controls with new income allocation/funding contracts | Default percent/fixed/raise/cap fields from current new source-line factory; overspecified allocations never mint assets. |
| Legacy career manual starting pool fields/savings totals | May remove old consumers/fields during the refactor; final integration verifies no surviving references | Opening accounts/historical snapshots supply balances; incomplete screens may remain unavailable until target consumers exist. |
| Manual contribution pair | **Removed with user approval; implemented** | Strip `Scenario.contribution` on load/save; no restored defaults, converted income or standalone UI controls. Career allocations/other-income events remain. |
| `income` funding selectors and fallback1/fallback2 | Replace selector with explicit payment account; retain supported fallback IDs as ordered policy values if valid | New item payment-account default is designated current cash account or empty if none; no inferred retirement source. Deduplicate fallback IDs. |
| Large/long-term purchases/source lines/categories/flags | Retain schedule/source order; universal partial | No indivisible toggle; zero-fund no debit/no retry. Home partial funding held as deposit, not ordinary expense/full property. |
| Taxable withdrawal assumption | Store disclosed assumed-gain share20% gross and default LTCG15% editable | Missing new fields use these confirmed defaults; no actual basis reconstruction, statutory bracket or generic zero tax. |
| Retirement percentage source | Per-source initial balance withdrawal rate and explicit valuation date/start/day | New percentage source defaults to editable 4%; explicit valid 0 retained. Valuation date defaults to **that source's** first withdrawal date; an absent rate does not inherit a global/pool rate. |
| HSA non-qualified withdrawal rule | Account-level tax assumption and separately configurable extra penalty; explicit qualified medical flag | New non-qualified HSA penalty defaults20% before age65, waived from65 even when working; tax remains configured. Qualified medical withdrawals have no tax/penalty; never infer qualification from category text. |
| Pending home acquisition | Required down payment, explicit dated funding events, funded deposit/status/actual completion identity | Pending deposit asset preserved once in snapshot; no full property/mortgage before funding complete, no implicit retry/financing. Derived runtime state recalculated unless saved as observed opening history. |
| Loans | Retain ID/balance/interest/payment/down-source config; add liability identity | Missing balance 0/new loan default as defined by factory; no auto income proceeds. Legacy paymentSourceAccount and its consumers may be removed early with interim failures recorded. |
| Housing/rent/links/expense groups/sale fields | Retain supported controls; add observed opening debt/property identity | New mortgage factory defaults, explicit opening amount/value; no conversion assuming past payments. |
| Legacy credit card modes/APR/charges/intro/minimum/lump | Prune superseded fields; new discriminant ordinary/0% | Unknown/missing kind uses new ordinary factory; new amount/end/start defaults. Do not map monthlyCharges/minimum/fixed modes into inferred equivalent schedule. |
| New 0% card/liability identity | Retain type/initial balance/target/payment/policy/snapshot links | Missing initial balance=0; missing target/start/day from fresh factory; no duplicate linked debt. |
| Expenses/manual/recurring/category/import metadata | Manual plans execute; occurred imported history permanently view-only (RV22) | Preserve original date/sign/as-of; no historic re-execution/promotion via clamped dates; new future manual records separate. Missing original provenance not guessed from synthetic future date. |
| Cashflow/life events | Retain supported config, convert into scheduler events | Missing date/account/policy current item defaults; no heuristic linkage of generic house events to housing acquisition. |
| History | Retain supported dated asset observations; normalize new liability entries by stable ID | Old format stays asset-only; absent liabilities means no recorded liabilities, not “debts included in total.” New config debt counted unless same ID recorded. Custom net-of-debt assets require new explicit gross snapshot. |
| Trajectory snapshots | Keep supported versioned/measurement-labeled results; unsupported obsolete derived shapes may be pruned | Never treat old asset-only endBalance as new netWorth. Empty/default snapshots if entire shape unsupported. |
| Timelines | Normalize all timelines with same factories, including inactive/base sets | Missing collection default; explicit empty retained; accounts/global policies remain shared as designed. |
| UI settings/selected IDs | Retain supported tabs/display/planner settings; remove orphan selected IDs/old enums | First-launch UI defaults; preserve false toggles; empty selection if target object absent. |
| Pool source variants, UI grouping and derived output | Remove sourceType=pool, `pool:*`, ExpenseEntry.poolId, selectedPoolIds, groupingMode=pool and pool-keyed totals during relevant phases, not only after all replacements work | New account-only source defaults or unresolved empty reference; never treat old pool ID as account ID or sum both maps. |
| Projection/runtime caches | Do not save; recalculate | No persisted spendable income pool, carried runtime debt or generated event allocations from an obsolete engine. |

Each proposed renamed field requires a final types/default/storage/consumer alignment checklist. Keeping a value under changed semantics is allowed, but must be deliberate and documented rather than retaining every unknown raw key.

## Opening liability exactly-once contract

- Store `liabilityId` on each 0% plan; snapshot entries with that ID are the authoritative opening observation on snapshot date.
- If no matching snapshot debt exists, use configured initial/opening debt once; do not also add a card-specific duplicate.
- Do not deduplicate by label/amount or assume old totalNetWorth includes a liability. Old storage cannot reliably encode that fact. New-save user can provide explicit asset/liability observations.
- Asset-only historical charts remain historical observations, with their measurement labeled; no retroactive debt subtraction from every old total.
- Test same ID/multiple references, missing ID, balance=0, inactive timeline, liabilities represented in snapshot vs config, and account/custom net-of-debt ambiguity.

## Cutover sequence and code rollback

1. Finalize Gate B/default factories/ADR-005 before persisted runtime changes.
2. Add canonical normalizers and tests in isolation; source raw sample configs contain synthetic data, not user secrets/files.
3. Integrate full new engine and shared editor/report consumers; a development-only comparison boundary is optional if old code remains. Do not mix old monthly spending with new postings in one result. Old consumers may already have been deleted.
4. Test new-format round-trip/idempotence, missing/type-changed/obsolete fields, all timelines/history/import/UI settings and malformed data.
5. Assemble a runnable integrated candidate for browser measurements, then release the new engine/schema together **only after** full Phase-8 verification; ordinary save prunes unsupported fields. Users may create a fresh plan under accepted new-save rule.
6. Remove superseded runtime/normalization consumers whenever their target contract is introduced (ADR-022); make Phase 7 a sweep for survivors. Retain B01–B09 original snapshots as audit evidence, not production migration logic. Record intermediate build/test failures with restoring tasks.

Code rollback remains possible through git history. Once a canonical save has pruned obsolete fields, restoring equivalent old financial data is **not guaranteed** and is not a required runtime workflow. No automatic backups or restore dialogs are added under this scope.

## Required acceptance tests (pending implementation)

- No storage/raw input mutation on load; canonical save prunes exactly unsupported fields.
- Missing nested object fields default like a newly created instance; valid zero/false/empty preserved.
- Fully absent storage equals first launch; normalized state contains no shared mutable default references.
- Changed type/enum defaults sensibly; still-supported changed-meaning values retained deliberately.
- Normalization/save/load idempotent and collection-local errors do not reset unrelated data.
- All base/inactive timeline config receives same defaults/ID rules; UI orphan selections cleared.
- No whole-paycheck source duplication or fictional scalar opening assets.
- Ordinary cards have no residual debt fields; 0% snapshot liability identified once, including zero balance.
- History/trajectory measurement explicitly asset-only vs assets-minus-liabilities; unsupported derived output not mislabeled.
- Obsolete manual contribution configuration ignored/pruned, without altering supported career allocations/other income or the state supplied to save.
- Account-only normalization prunes pool definitions/membership/source/filter/aggregate fields across all timelines; valid account/history/category IDs remain, missing account rates use new-item defaults, and old pool balances/rates are not implicitly inherited or duplicated.
- CA11: two factory/load/reset instances do not share nested mutable data; missing supported accounts/collections default like fresh instances, but explicitly []/0/false and allowed null remain.
- CA11: malformed one-item/collection shape cannot erase unrelated valid accounts/plans/history on load or autosave; load/save diagnostics and entirely invalid JSON follow separate reviewed behavior.
