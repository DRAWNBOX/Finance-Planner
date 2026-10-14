# Architecture Decisions — Account Cashflow Refactor

Status legend: **accepted** = parent plan or explicit user instruction; **proposed** = architecture recommendation pending Gate B; **open** = unresolved interpretation. No proposed financial behavior is authorized merely by being written here.

RV01–RV31 and follow-up clarifications recorded in review.md / ADR-019/020. Accepted choices override earlier recommendations: partial home funding held as acquisition deposit; taxable gain20% of gross proceeds and LTCG default15% editable. These ambiguities resolved; implementation/verification remain separate, with user withdrawal/payoff dates/source/rounding contracts explicit.

## ADR-001 — Direct account state and compact event audit

**Accepted direction (parent plan).** Accounts own assets; liabilities separate; income posts once; obligations debit designated accounts with ordered split fallbacks. Annual budgets cannot fund payments. No general transfer workflow or individual card-purchase tracking. Keep auditable postings rather than building full double-entry bookkeeping.

F01/F04–F20/F24; R01/R02/R04/R05/R07. Tradeoff: replaces income-selector semantics and incomplete report math; retain derived budgeting/shortfall views. Acceptance: posted income once, closing=opening+postings, assets−debt=net worth, actual funded principal only.

## ADR-002 — New-save compatibility and default/pruning load contract

**Accepted (user answer 1).** New save acceptable; unused/unneeded persisted fields can be removed. Changed-type/changed-meaning fields may remain if meaningful in the target schema. Missing fields default as a new item/first launch. Do not force equivalent legacy conversions, mandatory backups or mapping/approval dialogs for old saves.

F01/F16/F23/F25/F26; R06/R16. Supersedes parent/audit requirement for financially equivalent legacy migration and mandatory rollback workflow. Retains new-format round-trip/idempotence tests and debt opening identity. No data deletion performed during design. [migration_plan.md](migration_plan.md) defines proposed normalization mechanics; permission to prune storage is not permission to remove unrelated product features.

## ADR-003 — Retirement withdrawals are spending

**Accepted (user answer 4).** Retirement source withdrawals fund modeled spending and leave account assets. No deposit into spending account, added income or second expense for the same withdrawal. Preserve source min/max/4%/inflation/priority capability.

F10; R01/R13. RV17 accepted: housing/cards/planner expenses remain additional configured obligations, labeled “Retirement living spending (in addition to separately scheduled expenses).” Do not guess offsets. RV18 requires user-selected withdrawal timing rather than a forced global retirement schedule/basis. Acceptance: net retirement spending consumes tax-aware gross once at configured dates.

## ADR-004 — Planner entries execute; imported history default remains separate

**Accepted:** manual planner entries/recurrences are projected obligations. RV22 changes the historical-import boundary: imported transactions that already occurred are **view-only** and never affect planned income/spending/balances/budgets, even if the simulation anchor is earlier. Preserve original source date/sign; do not clamp historical records into future execution. Future imported schedules need explicit planned status; historical originals are not promoted into obligations by editing their display date.

F22/F12/F13/F15; R09. Code evidence: importer uses absolute values and moves historical dates to future; automatic execution of imports can turn deposits/already-spent money into new expense. Preserve provenance and distinguish source transaction date/sign from planned execution date. Never infer duplicates from labels; same-obligation views use explicit linked IDs.

Acceptance: occurred import has zero financial/planner effect; its source remains reviewable/removable; any explicitly created new future manual obligation has its own identity and is not a re-execution of the historical original. Manual recurrence once, engine/planner shared results and no parent double charge. RV25 accepted day31 month-end clamp.

## ADR-005 — Manual contributions

**Accepted and implemented (user: “remove these controls and rely on career allocations/other-income events”).** Remove Options → Contributions → Yearly Contribution / Yearly % Increase, `Scenario.contribution`, its defaults/load normalization and the unposted annual scalar calculation. Old configuration is ignored and pruned on load/save; it is not converted into extra income.

F21; R03 resolved by removing this redundant capability with explicit approval. Career allocation totals/reporting and cashflow/life-event income remain. Archived B09 in `refactor/fixtures/projection.pre-refactor.snap` preserves the original defect; current regression snapshots verify obsolete config no longer contributes. Storage tests verify pruning, preserving supported income config, and no mutation on save. The rest of the architecture remains a Gate B draft.

## ADR-006 — New card product model

**Accepted direction:** ordinary expected payments with end date and permanent-0% opening liability with linear adaptive payoff (parent); equivalent legacy save behavior not required (ADR-002). Remove obsolete APR/charges/minimum/full/fixed+lump stored fields/controls when target card editor and schedule/report views are ready.

**Accepted review details:** inclusive months/day (RV25); ordinary card starts configured month and defaults to **twelve payments, end=start+11** (RV20). Missing amount defaults 0. Unpaid 0% balance requires a **lump-sum payoff** (RV19); debt persists and no interest/fees invented. Payoff date/source must be explicit. The last adaptive linear payment already targets full remaining balance; do not create another duplicate principal request at the same deadline. Exact future overdue payoff scheduling and initial cent allocation remain explicit engineering contracts; no automatic repeated debit assumed.

F15/F16/F01/F24; R05/R06/R08. Liability ID links opening card/snapshot once. Acceptance: ordinary twelve inclusive payments/no debt; 0% funded-only adaptive payoff, retained unpaid lump sum, no duplicate final principal, zero interest after deadline, opening dedup and actual-funded preview. All payments allow partial funding under RV11.

## ADR-007 — Funding atomicity and failure policies

**Accepted RV10–RV14 + clarification:** every obligation partial, actual allocations/related state changes atomic. Primary-first/global-overrides/retirement order, no negative cash/implicit debt/retry. Partial home down payments become valued held acquisition deposits; no full home/mortgage until required funding complete. Zero-fund/invalid transaction no debit; this reconciles RV12 with partial spending. Old indivisible funding defaults not retained.

F07/F08/F10/F12–F20; R02/R14. Separate interest accrual from payment; failed payment cannot undo interest due, but creates no principal reduction. Primary + per-obligation override fallbacks else global default; deduplicate IDs; retirement uses its explicit ordered account list, never pool/type sweeps (ADR-014). Acceptance: exact allocations, atomic no-op including acquired asset/debt, partially funded principal, stable order and stale-quote rejection.

## ADR-008 — Account eligibility and withdrawal taxes

**Accepted RV14/RV16/RV15 clarification:** cash/savings/taxable ordinary eligibility, retirement/Roth/HSA explicit rules, account/purpose/HSA settings and no pool lookup. Taxable withdrawal assumed gain=20% of gross proceeds; cost portion80%; LTCG default15% editable per account, effective3% gross before penalties/rounding. Disclose proxy, not actual basis/statutory bracket/all-proceeds tax. No inferred Roth basis or default-zero brokerage tax.

F09/F10/F11/R10: fixed disclosed brokerage gain proxy, no actual basis/tax-lot model. Tax/penalty within gross debit, not charged again. Test configured cash/401K/HSA rules, taxable20%-gain/15%-editable rate, exact gross/net/assumption labels/eligibility/invalid rates; no duplicate ordinary all-proceeds tax on brokerage.

## ADR-009 — Net-pay allocation and cap overflow

**Accepted RV05/RV07:** preserve individual payroll destinations; net allocations deposited directly in explicit configured order until actual net pay exhausted, unmet requests reported. Remainder deposited directly into its configured account; missing/deleted destination visibly unresolved. No proportional scaling or minted deposits. No ordinary income during inactivity/break/retirement.

**Accepted RV08:** incoming cap overflow routed directly; existing excess rerouting only through an explicit separately audited cap policy, without a general transfer workflow or restriction bypass.

F03–F07; R04/R11. Missing remainder/destination never automatically deposits into a restricted account. First-launch cash account default can establish new-item references. Acceptance: pay reconciliation, multiple bucket accounts, allocation exceeds net, cap cycle/self/missing fallback, no restriction bypass.

## ADR-010 — Dates, order, growth and period reporting

**Accepted RV06/RV23/RV25:** timezone-independent date-only parsing and dated events inside months; configurable monthly income day (fresh default 1), explicit card/withdrawal payment days, month-only default day1. Frequency annualizes rather than invents exact paycheck dates. Stated phases/same-day income before obligations, discretionary after mandatory; no future pay/closing growth funds earlier requests. RV18 adds user-selected withdrawal dates/start/day, retirement/marker links optional.

**Accepted RV24:** month-close growth on post-event account balances, effective APY and activeDays/daysInMonth/12 partial exponent; disclose full active-period growth for deposits and no growth on already spent funds. Home appreciation consistent for valuation/PMI/sale; debt APR distinct from asset APY. User did not request daily-weighted return simulation.

**Accepted RV25/RV26:** inclusive ends, day31 clamp, opening observation before same-date events, stated end-age boundary and calendar-year totals from actual months (age grouping separately labeled). **RV31:** support an 80-year/960-full-month horizon, not a universal fixed cap/default; chosen horizon/end metadata must reflect actual requested dates and partial periods without silent shortening.

F02/F03/F11/F14/F17–F24; R07/R12. Acceptance: timezone/leap/DST/day31; no future pay; partial month; APY twelve full months; retirement/deposit boundaries; annual sum and final horizon.

## ADR-011 — Assets, debt principal, acquisition and disposition

**Accepted RV21 + held-deposit clarification:** observed opening property/debt, no assumed paid history/proceeds. Partial down payment debits actual gross funds and creates held acquisition-deposit asset for net funded amount; pending acquisition has no full home value/mortgage/ownership expenses. Explicit later funding may complete; atomically exchange accumulated deposit into configured property/mortgage at actual completion date. No automatic retry/extra borrowing. Sale settlement preserves deficiency.

F01/F14/F17/F18; R02/R05/R14. Principal repayment lowers cash and debt equally; interest/costs reduce net worth. Preserve funding groups, extras, PMI and rent/sale destinations. Tradeoff: opening debt/value inputs replace historical amortization guesses; new-save accepted. Acceptance: principal-neutral net worth, interest expense, failed down payment no-op, underwater sale, snapshot same liability ID.

## ADR-012 — Reports and views consume authoritative results

**Accepted RV27/RV26:** primary graph **Net worth**, optional account-assets view, signed totalAssets/totalLiabilities/netWorth and actual monthly-derived calendar totals. Legacy endBalance may remain explicitly account-assets-only for compatibility. Complete audit/common actual-funded previews and consistent current-dollar dates/units remain required; budgets derived only.

F24/F25; R07/R08/R13/R17. Preserve historical measurement/version labels. Exact accepted shortage warning: “Some scheduled payments could not be fully funded, beginning in [month].” Say “eligible funding accounts exhausted” only when eligible configured sources actually run out. Partial/restricted/source-specific unmet obligation is not negative net worth or proof every account is empty; positive property equity is not automatically spendable.

Acceptance: each month's posting reconciliation; annual summed income; closing debt/property/current-dollar consistency; no independent preview guesses; warning severity preserved.

## ADR-013 — Payroll deductions versus living expenses

**Accepted RV09:** actual granular payroll deductions stay deductions once; living spending separate account-funded obligations. Remove obsolete flat livingExpenses authority on canonical save; labels alone do not change payroll line meaning.

F04/F05/F07/F19/F21; R03/R11. New-save acceptance removes need to guess semantic conversions of obsolete flat livingExpenses into an expense. Existing actual paycheck posttax deductions cannot be silently dropped. Acceptance: net pay excludes actual payroll deductions once; separate living obligations execute once; employer deposits not deducted; missing new fields default.

## ADR-014 — Remove Pools; rates and policies belong to accounts

**Accepted direction (user):** remove Pools in this restructuring; interest rates defined per account. **This phase is planning only; no source/schema/tests/storage data changed.** Supersedes earlier targets preserving shared pool definitions/rates/rule lookup/source expansion and pool-grouped UI.

Plan: independent account rates, account-level withdrawal rules, explicit account fallback ordering, per-account stacked chart/career/retirement breakdowns, account/category expense/import views, pruning of pool membership/aggregate/source/UI fields under accepted new-save/default policy. AccountType and paycheck benefit kinds retain their purposes without creating new financial pools. Derived summaries may aggregate account values but never own balances or provide shared funding/rates.

**Accepted RV01–RV04/RV10:** base annual rate plus optional retirement override, missing rate0%/override none, opening balances$0/payment account and no pool inheritance/hidden scalar assets. Global account/rate/planner scope with timeline-local plans. Explicit retirement fallback order; display order cannot change funding order. User-selected withdrawal timing under RV18; no single forced retirement-date schedule. Account factory details retain supported types/capabilities without seed money.

F01/F03/F06/F09/F10/F11/F22–F26; R18 tracks cross-cutting coverage. Detailed source map/schema/UI/report/default/cutover/acceptance sub-plan: [account_only_subplan.md](account_only_subplan.md). Acceptance: accounts with different rates/rules independent, eligible split funding, account-keyed reconciliation/chart, no pool domain after cutover, preserved historical account identities. Exact default/tax/timing/retirement contracts still Gate B proposals.

## ADR-015 — GUI is part of the architecture cutover

**Accepted investigation scope (user):** investigate GUI interaction with planner and list elements that may fail under planned changes. **Proposed integration:** canonical shared edit/load/save normalization; named result contexts; display-dollar/date/measurement view adapter; shared funding editor/outcome and recurrence/reference selectors. No new state-management framework and no application changes during this planning audit.

Evidence: `App.updateScenario` rebuilds accounts/loans/history and would strip new fields (G01); no-career gate hides otherwise valid projections (G02); pool grid/chart props compile against deleted types; purchase red rows depend on forbidden negative cash (G17); local card/career/planner estimates ignore funded event history; warnings/deflation/saved trajectories assume old result schemas. Complete G01–G40 list and GUI-A01–A10 checks: [gui_compatibility_audit.md](gui_compatibility_audit.md).

F01–F26, R19. Tradeoff: existing UI/layout is reusable, but an engine-only rewrite or fake empty legacy maps would silently lose capabilities or misreport outcomes. Acceptance: new fields survive unrelated edits, all previews/reports match authoritative posted context, signed net worth/atomic/overdue states visible, selected-plan/timeline clones isolate nested configuration. Gate B must validate view/input contracts; static audit is not proof target GUI tests pass.

## ADR-016 — Output-sensitive computation and bounded GUI/runtime overhead

**Proposed after user-requested performance/scalability audit.** Compile ID/source/boundary indexes once per relevant revision; generate month-batched recurrence/events; use sparse atomic quote overlays and exact bounded gross-net algorithms; retain one compact complete audit with indexed/paged access; compute named contexts on demand with bounded caches; window large GUI tables/planner/audit and decimate charts only for presentation.

Current evidence: two synchronous App projections, broad normalization/rebuilds, repeated account/cell scans, rich full-result copying, unwindowed cells, synchronous whole-state localStorage saves and unbounded diagnostic timings. Plan scales with actual emitted E/candidate checks K and monthly output M×(A+D+P); million-event audit can dominate CPU/heap/storage. No target benchmark results yet. Full analysis/risk register and proposed budgets/profiles: [performance_scalability_audit.md](performance_scalability_audit.md).

Conditional proposals: background chunked/worker runner with revision IDs/stale rejection/real cancellation; compact numeric buffers with safe integer cents; asynchronous storage if full payload/quota/transport measurements justify it. These do not change event order, tax rounding, atomicity, complete audit or financial invariants. Do not silently drop horizon/events/data, use approximate finance, or cache wrong contexts for speed.

F01–F26; R20/R21; GUI G01–G40; PS01–PS20. Acceptance: B-P1–B-P8 synthetic benchmark stage/counter/heap/transport/render/save reports, smaller-fixture financial equivalence, correct invalidation and cancellation; achieved metrics versus explicitly proposed budgets on declared production-browser hardware. Runtime overflow/aggregate safety and solver monotonicity/minimal-debit proof validated before optimization.

## ADR-017 — Acceptance evidence must exercise the actual financial contract

**Supplementary inspection complete; remediation proposed/pending.** TC01–TC13 in [testing_correctness_audit.md](testing_correctness_audit.md) distinguish executed baseline evidence, static gaps, archived defects and unimplemented target acceptance. Four-percent test config currently selects fixed amount, minimum-miss title contradicts survival assertions, and recorded loan failure is after switching to income; static cap/annual-budget analysis narrows diagnosis but is not a fixed-date rerun.

Require CA01–CA13 independent numerical/invariant acceptance for each approved F/R/ADR contract. Named tests and passing snapshots are not evidence of branches they never execute. Preserve archived B01–B09; target corrections need explicit before/after expectations, not blind snapshot refresh. Triaging the current failure must not preserve annual income reuse or skip tests simply to report green.

F01–F26/R15/R22/R23, GUI-A and B-P checks. Proposed execution: deterministic fixtures and real dates, canonical default/isolation tests, appropriate engine+App suites when runnable, full test/build at **final** handoff; browser/performance evidence separately measured. ADR-022 allows interim App/build/test failures with exact results recorded. Last recorded 207/208 plus passing build remains unchanged. Audit documentation approval is not approval of new financial assumptions or runtime cutover.

## ADR-018 — Canonical defaults, record validation and single-rule ownership

**Accepted user direction/RV29:** fresh-item missing defaults/pruning plus record-local malformed recovery/diagnostics, preserve valid siblings and prevent broad fallback autosave loss; fully invalid JSON gets fresh defaults. Independent factories/reset and valid empty/0/false/null semantics are canonical implementation contracts, not fresh product approvals needed.

TC05–08/MD01–MD11 in [testing_correctness_audit.md](testing_correctness_audit.md) / [maintainability_documentation_audit.md](maintainability_documentation_audit.md). Current load returns shared singleton defaults, restores default careers for entries=[], and has a whole-load catch; no fixes implemented by this decision. Define save lifecycle so automatic save of a recovered record does not silently erase valid siblings; full invalid JSON/future-version/default behavior explicit, without introducing mandatory backup/conversion/approval dialogs contrary to accepted new-save scope.

Shared canonical schema/default/validation functions own load/edit/save/reset; one configuration/date reference/scheduler/payroll/funding/state/report/view owner each. The earlier instruction to remove superseded helpers only after consumer verification/tests is **superseded by ADR-022**: identify and track affected consumers, but deletion may precede replacements and make interim checks fail. Current code docs must be separate from proposed architecture/historical notes. R23/R24/F01/F23/F26; CA11 plus maintainability exit criteria. Runtime/default/schema/quality-tool implementation remains pending.

## ADR-019 — Manual review responses RV01–RV31

**Accepted user directions recorded; not runtime implementation.** [review.md](review.md#recorded-responses) contains every response and is authoritative over conflicting earlier recommendations. User approved account-specific base/retirement rates and 0%/null missing defaults, $0 openings/payment account, global account/planner scope, ordered bounded income allocation/remainder, explicit cap policy, payroll-versus-spending distinction, global/per-payment/retirement fallback ordering and stated account eligibility/HSA settings.

Also approved: additional retirement spending, observed opening property/debt and retained deficiency, monthly income timing/same-date phases/month-close effective APY/partial months/inclusive boundaries/day31 clamp/calendar annual reports, signed net-worth primary graph with optional account-assets view, exact cents/overflow handling, record-local recovery and measured async persistence. Net-worth negativity and property equity never substitute for eligible liquid funding. Exact warning: “Some scheduled payments could not be fully funded, beginning in [month].” Use “eligible funding accounts exhausted” only for actual exhaustion of the eligible configured sources.

**User changes superseding prior proposals:** every obligation permits partial spending (RV11); disclose assumed 20% taxable gain with long-term capital-gains treatment (RV15); user selects withdrawal timing (RV18); unpaid 0% debt requires lump-sum payoff (RV19); ordinary cards default twelve inclusive payments end=start+11 (RV20); occurred imported history view-only/no planner effect (RV22); responsive **80-year** support (RV31).

**Clarifications resolved by ADR-020:** partial funding held until acquisition completion; gain20% of gross and LTCG default15% editable. User withdrawal/4% base date and residual lump-sum date/source remain explicit fields/contracts; no forced global retirement date or duplicate final payoff. Recording accepted choices is not implementation or numerical verification.

Scope: update contracts and tests to accepted requirements, preserve original baseline/inspection evidence, finalize the few remaining details before affected finance code. Generic atomic commit is retained even for partial funding: all actual funded allocations/related state changes commit together. Old all-or-nothing acceptance remains relevant only where parent atomic correctness is tested, not an approved default purchase funding policy. Financial rounding/complete audit/determinism remain invariants; numeric performance goals are proposed and unmeasured, while 80-year support is required.

## ADR-020 — Held acquisition deposit and disclosed taxable-gain proxy

**Accepted follow-up choices:** “Hold deposit”, “20% of proceeds”, “15%, editable.” These resolve R25/R26's policy ambiguities. Target asset model includes pending acquisition's funded deposit, separate from unowned full property/mortgage; non-liquid deposit counted once in assets/net worth, not ordinary funding accounts, default no growth unless separately approved. No implicit borrowing/retry; completion only after explicitly funded required down payment and valid acquisition terms.

Taxable brokerage proxy: assumed gain share20% of **gross account debit**, assumed cost80%, default editable LTCG rate15%; tax=roundToCents(gross×0.20×0.15) before separately configured penalties. $1,000 gross →$200 gain/$30 tax/$970 net. Gross-up net request with the exact approved cent policy; retain gain/cost/tax labels as **assumed**, do not create an actual basis/tax-lot ledger or infer statutory brackets. Computation uses high-precision intermediate/rational rates until the final posting boundary, not premature rounded intermediate gain. Aggregate withholding/penalty split/minimal-gross validation still needs deterministic engineering tests.

Accepted acquisition example (no fees/tax): $30k partially funded toward required$60k down payment reduces account assets$30k and creates deposit asset$30k; no $300k home/$240k mortgage yet. Another explicitly scheduled$30k completes funding: remove$60k held deposit, create$300k property/$240k mortgage together. Net worth not charged a second down-payment expense; applicable tax/fees remain real expenses. Pending sale/PMI/mortgage costs cannot execute as if home already acquired.

No remaining ambiguity on these choices; policy accepted, implementation/tests pending. CA03/CA04/CA09, GUI G16/G17/G20/G22, state/report/default shapes and audit allocation labels must adapt.

## ADR-021 — Exact cents, HSA age rule, and configurable initial-balance withdrawal rate

**Accepted follow-up (user approved recommendations 1–5):** use a provably bounded minimal-sufficient-gross quote, separate rounded tax and penalty from gross, cumulative per-line rounding of annualized targets, ceiling-cent adaptive 0% card installments, and the HSA age-65 rule below. The user also requires the percentage in the formerly fixed “4% rule” to be configurable. These are target contracts, **not implemented or verified runtime behavior**.

- **Tax-aware quote:** for integer-cent gross debit `G`, calculate each applicable tax and penalty separately from `G`, rounding each half away from zero exactly once. Brokerage tax uses the accepted unrounded 20%-of-gross gain proxy times the editable LTCG rate, with no additional all-proceeds tax. `net(G) = G − tax(G) − penalty(G)`; audit all four amounts without another tax/penalty debit. Use exact rational rate arithmetic to derive a finite rounding-error bracket around the closed-form gross estimate, enumerate that bracket in ascending cents and choose the first debit covering the requested net. Do not assume `net(G)` is monotone when independently rounded components coincide. Validate nonnegative rates and combined effective withholding below 100%; if the proven candidate window exceeds **256 cents/candidates**, the balance/range is unsafe, or the quote cannot be represented exactly, return an explicit unsupported-range diagnostic rather than approximate, truncate or run an unbounded search. For insufficient available balance report actual partial net funding; never treat an unfunded target as paid. CA04/TC13/PS06 prove minimum debit, rounding, gross/net/tax/penalty identity and the iteration bound.
- **Annualized allocation rounding:** for each independent target/line, request the rounded cumulative scheduled amount through occurrence `k` minus that through occurrence `k−1`. Reset the accumulator when its plan/annual target changes; partial periods use their actual scheduled share. A $100 annual target split over twelve full months requests eight $8.33 and four $8.34 payments (total $100); actual account deposits remain limited by available net pay. Do not force a residual onto one fixed month or mix unrelated account lines.
- **Permanent-0% card:** each scheduled installment requests `ceil(remaining principal cents / remaining scheduled payment count)`, capped at remaining debt, recalculated after **actual funded** payments. $100 over three fully funded dates requests $33.34/$33.33/$33.33. A coincident final installment and payoff is one remaining-principal request; a later explicit payoff requests only debt still outstanding, with no interest or automatic retry.
- **HSA:** explicitly qualified medical spending is tax/penalty-free. For non-qualified HSA spending, apply the configured income-tax assumption; default the separately configurable extra penalty to **20% before age 65**, and waive that penalty once the account holder reaches **65 regardless of retirement status**. Do not infer a marginal tax bracket or medical qualification from a category label. The age check uses the withdrawal date, not an annual age label. This replaces the current engine's “65 and retired” condition. [IRS Publication 969](https://www.irs.gov/publications/p969) describes the U.S. age-65 additional-tax exception; implementation remains an explicitly configurable planning assumption.
- **Initial-balance percentage withdrawal:** each retirement source lets the user set `initialWithdrawalRatePercent` (new-item default **4%**, editable 0–100%; 0 is valid). Use a withdrawal-specific `percentOfInitialBalance` target mode and `initialWithdrawalValuationDate` rather than fixed-four-percent field/mode names; purchase modes are unaffected. The UI labels this “Initial balance withdrawal rate (%)” rather than claiming every configured rate is 4%. In percentage mode, the initial **net spending target** is the selected account's authoritative balance on its explicit valuation date times that rate, before min/max/inflation adjustments; do not apply the taxable withdrawal proxy to the target itself. The valuation date defaults to **that source's first withdrawal date**, including later-start sources, never a global retirement date; an explicit earlier date needs an available observation. Freeze that initial target and subsequently apply the configured inflation rule. No fallback account changes the valuation basis. The old hard-coded 4% branch remains a historical baseline test, not proof of the new configurable-rate flow.

No additional product-rule decision is pending among the six previously listed Phase-0 follow-ups. Phase 1/2/3 implementation, CA04/CA06/CA07/CA13 acceptance and benchmark results are still pending; this ADR does not authorize runtime cutover.

## ADR-022 — Incremental implementation authorized; intermediate breakage permitted

**Accepted explicit user direction (2026-10-14):** account-only implementation is authorized beginning with Phase 1 and proceeding through the dependent phases in `implementation_plan.md`. Existing code consumers and pool-era modules/controls may be removed as their target contracts are introduced; no compatibility aliases, duplicate authorities, or running old UI/engine path are required merely to keep intermediate revisions compiling. The app, build and existing test suite **may be broken until all phases are complete**. This supersedes earlier requirements to keep the existing production path coherent and to defer all obsolete-path removal until after consumer parity. It does **not** assert implementation has begun or that any financial result is correct.

- P1 owns target schema/default/codec/commands; consumers removed in P1–P6 are tracked against their F/G/TC/MD rows. P7 is a final residual obsolete-reference sweep and actual-code documentation pass, not the first permissible removal. Do not remove accepted product capabilities from the final integrated codebase merely because a legacy implementation was deleted.
- Each phase records which focused checks ran, what passed/failed, and which existing consumer/build failures remain due to unfinished dependencies. Relevant isolated module/acceptance tests should run when their modules are executable; a broken App/full suite/build in an intermediate phase is recorded honestly, never hidden by `.skip`, fabricated compatibility data, or a false green claim. Intermediate phase exit means its scoped deliverables and available focused evidence are handed off, **not** a runnable release.
- No mixed old/new financial calculations in a displayed result. Incomplete projections must not be represented as complete, and saved user configuration/history/import provenance must not be silently erased by a partial codec or autosave. Keep archived B01–B09 evidence unchanged.
- An integrated runnable app is needed for required GUI/browser/performance validation; final cutover/release still waits for complete CA/GUI coverage, a passing full suite/build (or accurately reviewed exception), 80-year measurements and manual sign-off under Phase 8. Authorization to implement is **not** authorization to release.

## Gate B review checklist

- [x] Parent confirmed product rules + user follow-up captured with source/status.
- [x] Target data ownership, event/funding contracts, report path and diagrams drafted.
- [x] F01–F26 coverage, R-register and default/pruning persistence mapping included.
- [x] ADR-005 resolved: standalone manual contribution controls/configuration removed; use career allocations/other income.
- [x] ADR-014 direction recorded: Pools removed in target; rates defined per account; planning-only phase respected.
- [x] GUI integration investigated, G01–G40 failure list and GUI-A01–A10 acceptance planned (ADR-015).
- [x] All six requested audit areas have inspection coverage; supplementary TC01–TC13/MD01–MD11 and consolidated audit status recorded (ADR-017/018).
- [x] RV01–RV31 responses recorded; accepted user product choices supersede earlier proposals (ADR-019).
- [x] Held-deposit partial acquisition/skip interaction and20%-of-proceeds/15%-editable LTCG clarified (ADR-020); implementation/tests pending.
- [x] Configurable withdrawal/4% base date and remaining0% payoff date/source contracts documented: base defaults first selected withdrawal, payoff defaults final scheduled date/source with one coincident request and actual residual on later explicit date. Implementation/GUI/tests pending.
- [x] Validate CA01–CA13 acceptance contracts, actual 4% branch coverage, minimum-warning assertions and recorded loan failure triage before claiming correctness. (Phase 0: contracts frozen in frozen_contracts.md; 4% branch exercised + minimum-warning asserted in projection.test.ts; loan-row failure reproduced — see coverage_register.md TC01–TC03/R22.)
- [x] Finalize shared fresh/default/empty/null/malformed handling and save lifecycle (Phase 0 P0.4 frozen in frozen_contracts.md). One-rule ownership + current-vs-target documentation remain Phase 7 (MD01–MD11).
- [ ] Validate canonical GUI write/view/context/funding/reference contracts and new input coverage before engine/UI cutover.
- [ ] Validate ADR-016 scheduling/quote/audit/cache/view/storage contracts, safe-runtime-cent strategy and exact bounded solver before claiming scalability.
- [ ] Measure benchmark profiles B-P1–B-P8 against reviewed latency/memory budgets and financial equivalence after implementation approval.
- [x] Base-rate/optional retirement override/missing defaults, account policy direction and explicit retirement account fallback order accepted; implementation/tests pending.
- [x] Ordered allocations/caps and occurred-import view-only boundary accepted; future-import behavior defaults remain explicit, not inferred from historical transactions.
- [x] Monthly pay-day/growth/end/short-month and net-worth/warning report choices accepted; withdrawal-rate, HSA-age and lump-sum cent details finalized in ADR-021 (implementation/tests pending).
- [x] Observed property/debt opening and retained sale deficiency accepted; partial acquisition completion tracked above.
- [x] Authorize incremental runtime implementation (ADR-022); add independent target acceptance tests alongside the replacement math and retain the archived original evidence. Intermediate build/test failures are permitted and recorded, not treated as passing.

## Phase 0 authorization (Gate B) — 2026-10-13

Phase 0 (readiness, baseline triage, contract freeze; tasks P0.1–P0.7) is **complete and authorized**. No financial math was replaced.

- P0.1 baseline repro: App.test.tsx:519 loan-row failure reproduced (income-funded loan draws from the annual income reservoir, R01/ADR-001). Left unresolved — resolution is Phase 5. See testing_correctness_audit.md and coverage_register.md TC01.
- P0.2 coverage register: refactor/coverage_register.md (F01–F26, R01–R26, G01–G40, TC01–TC13, MD01–MD11, PS01–PS20, CA01–CA13, GUI-A01–A10, B-P1–B-P8).
- P0.3/P0.4/P0.5/P0.7 contracts frozen: refactor/frozen_contracts.md (9 blockers at Phase-0 close; the later D1–D4/ADR-021 decisions settle the six finance-rule choices).
- P0.6 test edits (src/engine/projection.test.ts): 4% branch now exercised; minimum-warning test retitled + asserts the actual warning. Engine/schema/storage math untouched.
- Verification: `npm run test -- --run` → 207/208 (same pre-existing loan-row failure, reproduced not fixed); `npm run build` passes.

At Phase-0 close incremental implementation was not yet authorized. The later explicit user authorization is recorded in **ADR-022 (2026-10-14)**; final release authorization remains separate.
