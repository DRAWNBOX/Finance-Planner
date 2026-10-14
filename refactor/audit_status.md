# Refactor Audit Coverage and Readiness

## Coverage status

All six requested areas have **source/document inspection coverage**. Existing audits were reused rather than repeated; testing/correctness and maintainability/documentation received supplementary inspection. GUI/performance audits are additional cross-cutting coverage. **ADR-022 authorizes incremental implementation and temporary intermediate breakage; inspection/authorization do not imply the new engine is implemented or verified.**

| Audit area | Primary records | Status / implementation follow-up |
|---|---|---|
| Codebase architecture | [Feature inventory](feature_specification.md), [Architecture](architecture_specification.md), [Decisions](architecture_decisions.md) | Inspected; contracts frozen and incremental implementation authorized by ADR-022; target runtime pending. |
| Financial calculations/simulation | Feature inventory/R-register; [original baselines](fixtures/projection.pre-refactor.snap); [Testing/correctness](testing_correctness_audit.md) | Inspected, representative baseline defects reproduced earlier; approved contribution removal implemented. Account-only income/funding/debt/date corrections unimplemented. |
| Data models/persistence | [Save plan](migration_plan.md), [account-only plan](account_only_subplan.md), TC05–08/MD04/MD06 | Inspected; fresh/default/empty/malformed/isolation inconsistencies recorded; shared canonical schema/factories/pruning acceptance pending. |
| State management/data flow | [GUI audit](gui_compatibility_audit.md), architecture, MD01–03 | Inspected; write-loss/context/cloning/local-preview hazards mapped; shared commands/context/view selectors pending. |
| Testing/correctness | [Supplementary audit](testing_correctness_audit.md) | Inspected; P0.6 corrected the fixed-amount "4%" fixture and minimum-warning assertion and reproduced the existing loan-row failure. Target CA01–CA13 execution pending. |
| Maintainability/documentation | [Supplementary audit](maintainability_documentation_audit.md) | Inspected; duplication/legacy helper/schema/test/doc drift and ownership/authority requirements recorded. Runtime cleanup/general-doc refresh pending. |
| GUI preservation | GUI G01–G40 / GUI-A01–A10 | Inspected/planned replacements; target UI adaptation/verification pending. |
| Performance/scalability | [Performance audit](performance_scalability_audit.md), PS01–PS20 / B-P1–B-P8 | Analytical costs/risks/proposed benchmarks documented; no new-engine measurements or performance pass claim. |

## Executed evidence versus pending verification

- Last recorded full functional run: **207/208 passed**, one pre-existing `App.test.tsx:519` loan-row failure, build passed.
- Phase 0 subsequently reproduced the loan-row failure and applied P0.6 test-only fixes; no target account-only finance code is implemented yet. Intermediate app/build/tests may become broken during authorized implementation (ADR-022); record each actual result rather than carrying forward this historical baseline as a new run.
- Original nine Pre-Step 0 snapshots retained in `fixtures/projection.pre-refactor.snap`; current characterization expectations reflect only the approved contribution removal.
- Static audits have since inspected additional gaps. They did not rerun tests/build/browser/performance jobs. Writing these supplementary documents also does not constitute execution evidence.
- No source code fixes for TC01–TC13/MD01–MD11, canonical defaults, pools, new liabilities or target funding have been made by the supplementary documentation work.

## Priority follow-up

1. **Begin authorized target implementation:** use frozen contracts/ADR-021, then P1 schema/defaults/codec/commands and P2 kernel work. ADR-022 permits deleting obsolete consumers immediately and recording temporary build/test failures without claiming they pass.
2. **Canonical defaults/persistence:** independent factories; absent versus valid empty/0/false/null; consistent partial-record defaults; local malformed recovery/diagnostics and no silent unrelated-data loss on autosave; shared load/edit/save/reset.
3. **Meaningful acceptance:** repair 4% branch coverage and contradictory test names/expectations, isolate the existing loan failure, then implement CA01–CA13 without using snapshots of defects as the oracle.
4. **Engine + GUI integration:** indexed private state/atomic funding/deterministic scheduler/debt/valuation, common named-context outputs/preview/indicators, all required target inputs and timeline references.
5. **Performance and maintainability cutover:** output-sensitive complete audit/windowed views, bounded caches and safe cents; publish B-P measurements. Obsolete helpers/types may be removed in earlier phases; Phase 7 verifies no survivors and refreshes actual-code docs before final Phase-8 release checks.

## Documentation authority

Latest user decisions and explicit accepted ADRs supersede conflicting old plan passages. Current source and dated executed results establish observed behavior. Proposed contracts, audit remediation/acceptance lists and performance budgets remain pending implementation/validation. See [maintainability audit](maintainability_documentation_audit.md) for the detailed authority/status convention.

**Readiness conclusion (updated 2026-10-14):** audit inspection/contract coverage is complete and incremental implementation is authorized by ADR-022. Current account-only runtime correctness, full implementation and final cutover readiness are **not** established. The previously approved standalone-contribution removal and P0.6 test corrections are the only related source changes recorded to date.

## RV01–RV31 review outcome

All user responses recorded in [review.md](review.md#recorded-responses)/ADR-019. Accepted contracts include account defaults/retirement override, ordered allocations/caps/fallbacks, universal partial spending, user withdrawals, residual0% lump sum, twelve ordinary payments, view-only occurred imports, net-worth graph/exact warnings, local recovery/async storage and responsive eighty-year support.

Follow-up selection examples/acceptance: a partially funded$30k home down payment becomes a$30k non-liquid deposit asset pending full required funding, not a full home/mortgage or lost expense; taxable$1,000 gross uses$200 assumed gain/default$30 LTCG/$970 net. No actual basis/jurisdiction inferred. Reviewed configurable withdrawal/percentage-base/payoff dates documented in architecture; coincident final payoff runs once.

Follow-up resolved acquisition/tax: held-deposit partial funding until completion; gain20% gross/default editable LTCG15%. Withdrawal percentage-base/date and residual payoff date/source remain explicit configurable engineering contracts, never forced globally/double-executed. Eighty-year support accepted; numeric budgets unmeasured. All review responses/clarifications recorded; no target runtime/test/cutover success claim.

Review recording verification: responses/clarifiers cross-checked against ADR-019/020 and active funding/tax/deposit/card/import/report/80-year contracts; source unchanged. No tests/build/benchmark run for this documentation update; last executed baseline remains above. Older review recommendation tables/inspection findings remain historical and yield to recorded user choices.

## Supplementary documentation update verification

Testing/correctness, maintainability/documentation and this coverage index were written; ADR-017/018, R22–R24, canonical-default/save contracts and phase/acceptance links updated in the existing refactor records. References/IDs/status checked; tracked source diff fingerprint matched before/after, with no application edits. Root README's expanded overview was rechecked and MD09 updated to avoid retaining the outdated minimal-README claim. No tests/build/browser/performance jobs were run for this documentation-only update; the executed baseline above remains historical.
