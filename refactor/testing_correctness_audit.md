# Testing and Correctness Audit

## Status and evidence

Source inspection complete; target acceptance implementation and execution pending. This document records the supplementary audit requested after the architecture/financial/persistence/GUI/performance reviews. **Writing this report does not run tests or fix source code.**

RV01–RV31/ADR-019/020 target expectations: universal partial, home funding held as deposit until completion, taxable gain20% gross/default LTCG15% editable, user withdrawals/residual0% lump sum/twelve ordinary payments/occurred imports view-only/net-worth graph/exact warning/80years responsive. No old indivisible/zero-tax/thirteen-payment/past-import-promotion expectations.

Last recorded functional run after standalone-contribution removal: **207/208 passed**, one pre-existing App loan-row failure, passing build. That historical result is not a new run or verification of the proposed account-only engine. The new funding/debt/0%/planner architecture is not implemented.

Observed suites: `src/engine/projection.test.ts` (90), `projection.characterization.test.ts` (9), `src/App.test.tsx` (83), `src/storage.test.ts` (3), `src/paycheck.test.ts` (6), `src/utils/dateMarkers.test.ts` (11), `colorPalette.test.ts` (6). Vitest uses jsdom and `vitest.setup.ts`; package scripts provide test/build, but no dedicated browser/coverage/benchmark scripts. No `.github` workflow was found in this working tree; external CI status was not investigated.

## Findings and corrective work

| ID / priority | Observed evidence | Consequence / required work |
|---|---|---|
| TC01 / High | The baseline suite has one recorded failure at App.test.tsx:519. | Do not label handoff green, ignore/skip the test or change an assertion just to remove the failure. Isolate expected financial behavior with a deterministic fixture; triage below. |
| TC02 / High | `projection.test.ts:129–188` “uses 4 percent” sets global withdrawal mode=four_percent, but source line mode=amount and amount=$4,000 on $100,000. `sourceLineTargetAmount` actually branches on the line mode. The test's broad inequality also admits a fixed amount. | False-positive coverage: the test can pass without executing the percentage branch. Test actual four_percent account source, varied initial balances and nonmatching amount field; verify account-only initial target/cap/date/inflation contract. |
| TC03 / Medium | `projection.test.ts:998–1038` title says minimum miss “marks depletion” but asserts survival and no depleted age. It does not assert the warning that now expresses this condition. | Misleading title and incomplete behavioral assertion. Verify a minimum miss yields its warning while funded assets remain positive; separately test actual depletion and min/max boundaries. |
| TC04 / High | B01–B09 characterization captures repeatability/input immutability/full output, including known income-reuse/mortgage defects. Most sample cases use invalid DOB to force twelve-month periods. | Snapshots are historical/change-detection evidence, not financial truth. Keep archived originals; add target numerical invariants with real DOB/partial periods and deterministic dates. Approved corrections may intentionally differ from old snapshots. |
| TC05 / High | Storage:637 uses career entries.length to choose defaults; missing bank accounts normalize to [] at 721–743 although first launch returns seeded defaults. | Explicit empty versus absent and partial-save defaults do not follow the target contract. Add empty/0/false/missing/null tests for every supported nested collection/value, not just deleted standalone contribution. |
| TC06 / Medium | First launch/catch/no-window load returns exported defaultScenario/defaultUiState; App reset also reuses defaultScenario. | Shared mutable reference risk. Test two independent factory/load/reset instances and nested data mutation isolation. Confirm risk does not mean current GUI was proven to mutate defaults. |
| TC07 / High | Broad load catch falls back to entire defaults if a nested normalizer throws; App autosave writes loaded state. Raw JSON is cast, not fully structurally validated. | One malformed item can discard unrelated valid data and later autosave fallback. Add collection-local failure tests plus save lifecycle/retained data assertions; behavior for entirely invalid JSON remains explicit fresh defaults. |
| TC08 / High | New storage suite specifically covers contribution pruning/preservation; no general new-schema acceptance suite exists. | Need canonical load/edit/save round-trip/idempotence, unknown-field pruning, defaults and raw-input immutability across active/inactive timelines and liability identity. Do not require equivalent obsolete-plan conversion under accepted new-save scope. |
| TC09 / High | Current tests assert old Income options, negative hypothetical purchase balances, pool maps and old card payment modes. | These assertions are not target requirements after approved changes. Replace with reviewed primary/fallback/atomic/0%/account-output behavior; preserve the original evidence, not removed UI/schema as fake compatibility. |
| TC10 / High | No target code/tests for monthly ledger conservation, atomically skipped acquisitions, independent account rates, complete liabilities, adaptive permanent-0% payoff or planner-obligation posting. | Add acceptance first with independent expected values/reference contracts; test actual funded principal and no annual income reservoir. Matrix below defines coverage. |
| TC11 / Medium | Some tests use currentYearMonth/new Date or implicit project start; only selected tests freeze clock. Date-only UTC/local month risk is documented in R12. | Inject/freeze reference dates for boundary tests; verify leap/day31/inclusive deadline/timezone behavior. Do not assume replaying identical Date.now-dependent fixtures is deterministic. |
| TC12 / Medium | No dedicated `expenseImport.test.ts` exists; jsdom UI coverage is not real-browser chart/layout/worker/localStorage-quota performance evidence. | Add parser/scheduler edge tests and targeted production-browser interaction/storage/worker checks when those features are implemented. No new testing framework is mandated solely by this audit. |
| TC13 / High | Proposed exact cents/gross-net search lacks executed minimal-debit/rounding/overflow proof; safe initial values can overflow under long growth (PS06/PS20). | Property/table-driven tests for gross=net+tax+penalty, minimal sufficient debit under approved rounding, bounded solver and runtime safe-integer checks after growth/aggregate/commit. |

## Recorded loan-row failure: static triage, not a fix

`App.test.tsx:495–521` first makes an account-funded loan unaffordable and successfully expects red. It then switches Pay From to Income and still expects red; the recorded failure is that second assertion.

Source explains why a huge requested minimum does not automatically imply the current income branch is unfunded:

- Test leaves default current debt around $25,000 and sets requested minimum $500,000.
- Engine `projection.ts:1688–1689` caps `paymentTarget` at interest-added remaining debt, so the request is not $500,000.
- That branch funds the capped amount from the freshly initialized **annual income** budget, not that month's available net pay. Default active career annual income can cover the capped debt. This annual pool is already a financial defect/target removal (R01).
- App row severity comes from actual returned shortfall/status (`App:3896–3912`), not the uncapped entered minimum. Thus the static evidence narrows the failure to its income-path expectation/fixture and old annual semantics; it does not prove the GUI lost the initial selected-account warning.

Required triage when execution is authorized: freeze date; set explicit career/net deposit/opening account/debt/fallbacks; assert the capped target and actual requested/covered/shortfall values; separate account-funded, current legacy annual-budget observation, and approved target monthly account-funded cases. Under target timing, $25k due before enough deposited money may legitimately be partially/unfunded. **Do not make the test green by preserving annual income reuse, assuming target behavior exists, or relabeling red styling.** Keep baseline failure record and publish the reproduced diagnosis/correction.

## Target correctness/acceptance matrix

Tests below are pending; final expected amounts use validated ADR rounding/date/eligibility/partial policies. Prefer small independently calculated numeric cases over tests mirroring implementation loops.

| Acceptance ID | Contract | Representative cases / links |
|---|---|---|
| CA01 | Income posted/allocated once | Gross, true payroll deductions, employee/employer deposits, %/fixed allocations and remainder reconcile; overspecified requests never mint assets; inactive career/break/retirement; multiple bucket destinations. F03–F07/R01/R04/R11. |
| CA02 | Monthly state and annual reports reconcile | Each account closing=opening+actual gross postings; debt/property state changes separate; annual totals=sum(months), first/last balance observations; no aggregation spends income. F24/R07/R13. |
| CA03 | Atomic eligible primary-first partial funding | All obligations partial; source order/dedup/eligibility/replenishment; actual account/debt/deposit changes atomic. Zero-fund/invalid/stale plan no debit; valid partial home funding retained deposit, no full acquisition until complete. |
| CA04 | Exact withdrawal tax/penalty/gain assumption | Broker gross$1,000→gain$200/cost$800/tax$30/net$970 with zero penalty; net$1,000 needs gross$1,030.93/tax$30.93 with default15%. Gross$0.17→unrounded gain$0.034→tax$0.01, not tax on displayed rounded gain. Separate gross-based rounded penalty, exact minimal gross/partial funding and ≤256 checked candidates or explicit unsupported diagnostic (ADR-021); editable account rates/invalid rates. Explicitly qualified HSA medical spending has no tax/penalty; non-qualified HSA retains configured tax with default extra penalty 20% while retired **under** 65, zero from 65 even **while working**; test custom extra penalty and the birthday boundary. |
| CA05 | Debt principal and interest accounting | Only actual funded repayment reduces debt; principal paid lowers cash and liability without a second net-worth expense; unpaid interest/liability retained; excess payment capped, extra separate from required. F14/F17/R02. |
| CA06 | Twelve ordinary payments and residual0% lump sum | Ordinary start→start+11 inclusive exactly twelve/no debt; $100 0% liability across three funded dates requests $33.34/$33.33/$33.33 by ceiling cents, recalculated after an underfunded payment; residual lump-sum date/source/no duplicate coincident final principal, unpaid liability/snapshot ID counted once (ADR-021). |
| CA07 | User-selected withdrawal timing, percentage and basis date | Per-source user start/date/day/optional links and editable `initialWithdrawalRatePercent` (new-item 4%; 0 preserved); $100k observed account at selected date → $4k at 4%, $6k at 6% before caps/inflation; later-start source uses its own first-date observed balance, not retirement-date balance. Test min/max/inflation/fallback/additional spending and minimum warning without global depletion (ADR-021). |
| CA08 | Independent valuation/date precision | Same-type accounts at distinct yields; zero/negative/retirement override/partial month; growth not pay income, exact APY before rounded posting policy; explicit due dates/leap/timezone/horizon boundary; safe runtime and aggregate cents. F02/F11/PS20. |
| CA09 | Held deposit/acquisition/rent/sale | Partial$30k toward$60k down creates deposit$30k/no full$300k home/$240k mortgage; explicit later$30k completes, deposit removed and home/debt created atomically. Net worth not charged twice; tax/fees real, no pending ownership costs/growth/implicit borrowing/retry. Observed openings, sale deficiency/rent/PI/PMI retained. |
| CA10 | Scheduled partial spending; occurred imports view-only | One-time/recurrence once, inclusive/day31 rules, funded/unpaid amounts and no linked-view duplicates. Occurred imports never affect financial/planning state even with older anchor/moved display date; new future manual plan separate. |
| CA11 | Canonical persistence/default/isolation | Absent vs empty/0/false/null, fresh independent factories/reset, malformed item local recovery, input immutable, allowlisted prune/idempotence, all supported new fields survive unrelated edit/reload, account deletion references and snapshot liability IDs. F01/F23/F26/TC05–08. |
| CA12 | Reviewed GUI/report context | Default net-worth graph/account-assets view/exact shortage warning and eligible exhaustion only when true; nonnegative partial/unfunded purchase accurately flagged, selected-date funded previews, signed/real-dollar/clone/history context. |
| CA13 | Determinism and optimized equivalence | Explicit-date same input/policy gives same event order/amounts/result and unchanged input; indexed/sparse/chunked/worker execution matches reference; cancellation/stale result cannot corrupt accepted state. ADR-016/B-P1–B-P8. |

## Execution strategy and exit criteria

1. Fix titles/fixtures/coverage claims separately from numerical behavior changes; tie corrected expectations to approved F/R/ADR IDs.
2. Preserve full original archived B01–B09 and useful current regression cases; add target acceptance, not blanket snapshot updates to hide discrepancies.
3. Parameterize money/date/source boundaries; use independent analytical cases and meaningful invariant/property checks. Do not demand randomized testing without recorded deterministic seeds/expected properties.
4. For engine/account/funding changes, run engine and App integration suites plus relevant new suites. Future handoff: `npm run test -- --run` and `npm run build`; declare remaining pre-existing exceptions accurately until resolved.
5. Run browser/performance checks separately under the declared environment; jsdom/global suite duration cannot prove actual painting, quota, worker transport or performance goals.
6. Publish test ID→feature/decision mapping, result/error records and any intentional current-vs-target numerical changes. No target cutover until required acceptance passes, original failure triaged, and missing policy decisions finalized.

Coverage inspection is complete; **correctness execution/cutover is not complete**. This report adds no code/tests and does not upgrade the historical baseline to a fresh green run.
