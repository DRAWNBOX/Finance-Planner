# Account Cashflow Refactor — Phase and Sub-Plans

Parent: [`../agent_plan.md`](../agent_plan.md). Inventory: [`feature_specification.md`](feature_specification.md).

## Checkpoint at original drafting (later authorization: ADR-022)

Pre-Step 0 complete. User decisions: new save/pruning/defaults accepted; planner entries are obligations; retirement withdrawals are spending; standalone manual contributions removed in favor of career allocations/other-income events. **At the time of this draft, only that explicit removal was implemented and Gate B remained pending.** ADR-022 subsequently authorized broader financial implementation; no new account-only engine implementation is claimed by this historical checkpoint.

RV01–RV31/clarifications recorded in review/ADR-019/020: universal partial, held home deposit until completion, taxable gain20% gross/default editable LTCG15%, user withdrawals/residual0% lump sum/twelve ordinary payments/view-only history/net-worth graph/defaults/ordering/timing/recovery/responsive80years. Acquisition/tax ambiguity resolved; configurable4% valuation/payoff dates/source/rounding explicit. Code/test/cutover pending.

The parent's order remains inspect → validate → design/validate → implement → verify. User decisions supersede equivalent old-save conversion and mandatory backup requirements. Draft documents label proposals; implementation remains pending. Track features by F-ID and issues by R-ID.

**Historical phase at this plan's drafting: planning only.** User requested removing Pools and defining rates per account, with no code changes at that time. ADR-014 and [account_only_subplan.md](account_only_subplan.md) revise all target ownership/funding/reporting/default assumptions. The later [ADR-022](architecture_decisions.md#adr-022--incremental-implementation-authorized-intermediate-breakage-permitted) authorizes incremental implementation and early consumer removal; this older sub-plan does not override the consolidated implementation plan.

GUI investigation delivered [gui_compatibility_audit.md](gui_compatibility_audit.md): G01–G40 at-risk controls/read-write paths, proposed canonical normalization/view/context/shared selectors and GUI-A01–A10 tests. Treat GUI work as required in each future integration phase, not a final cosmetic update. No source changes in this audit.

Performance audit delivered [performance_scalability_audit.md](performance_scalability_audit.md): PS01–PS20, complexity/memory/event-size estimates, output-sensitive architecture refinements and future B-P1–B-P8 benchmark profiles/budgets. No new-engine performance claims until production-browser measurements; no code changes in this audit.

All six requested audit areas have source/document inspection coverage, consolidated in [audit_status.md](audit_status.md). Supplementary [testing/correctness](testing_correctness_audit.md) (TC01–TC13/CA01–CA13) and [maintainability/documentation](maintainability_documentation_audit.md) (MD01–MD11) identify actual 4% test coverage gap, default/empty/isolation/malformed inconsistencies, loan failure static triage and ownership/doc drift. These findings are documented, not source fixes or newly executed tests.

## Sub-plan A — Inventory validation and baseline follow-up

1. Review F01–F26 and the preservation matrix; add omitted capabilities if identified.
2. User resolved old-save tolerance, planner obligations, retirement spending and manual-contribution removal; review remaining proposed import/payroll/opening/cap policies in the decision log.
3. Reproduce baseline App loan failure with fixed dates/source/debt/paycheck setup; static audit identifies failure after switch to income and capped payment versus annual budget (TC01), but diagnosis must be executed before correction. Separate legacy observation from approved target monthly funding; preserve original failure record.
4. Extend characterization where needed for historic snapshot opening, explicit career gaps, fixed deposits during retirement/break, missing account IDs and planner/import data. Use existing UI tests where adequate; do not write redundant mirror tests.
5. Record validation outcome and intentional correction candidates in the feature spec.
6. Repair misleading coverage: actual account-source four_percent target with varied balances, minimum miss warning versus depletion assertions, and renamed accurate tests; no false-green fixture or blind snapshot update (TC02–04).
7. Capture/validate canonical absent vs empty/0/false/null, independent defaults/reset and record-local malformed recovery/autosave contracts (TC05–08/ADR-018); scope tests to supported data, not equivalent obsolete saves.

Exit: validated feature inventory/preservation decisions; no destructive runtime change before this exit.

## Sub-plan B — Architecture, behavior contracts and migration design

Drafts delivered: `refactor/architecture_specification.md`, `refactor/architecture_decisions.md`, `refactor/migration_plan.md`. Finalize after remaining Gate A/Gate B decisions; financial implementation stays gated.

1. Document current state ownership and proposed config/scheduler, income, account/liability state, obligations, funding, valuation and reporting boundaries. Retain React/TypeScript/Vite conventions and compatibility outputs.
2. Define explicit account deposits: percentage/fixed savings allocations, remainder destination, employee/employer bucket destinations and rental/benefit income; standalone manual contribution controls/configuration are already removed, with no conversion into income. Prohibit posted amounts beyond real income.
3. Independent account rates/defaults/eligibility/liquidity/withdrawal rules/retirement order and taxable20%-of-gross/default editable LTCG15% proxy. No pool/basis ledger; distinguish actual gross/net/tax/penalty and assumed metadata.
4. Universal partial/atomic actual-change commit/unpaid amounts; home funding retained deposit until required down payment complete. No indivisible default/implicit borrowing/retry/expense debt.
5. Define permanent 0% liability schema and ordinary expected schedules, legacy F16 reconciliation, opening identity links, end-month count, adaptive shortfall payoff, rounding and retained unpaid deadline liability/warnings.
6. Define debt principal/interest and property purchase/sale postings, failed down payment and underwater sale handling. Retain housing group sources, PMI, historical mortgage catch-up or explicit opening debt replacement.
7. Define a dated month/event lifecycle, stable tie order, precision policy and due-day availability limits. Resolve no-future-income use, period/calendar boundaries, growth timing and cashflow inclusion.
8. Define complete event audit and monthly state/reconciliation; derive annual reports and all existing preview/graph/warning views. Preserve legacy balance fields via labeled adapters; introduce explicit net-worth fields rather than silently changing old saved trajectory meaning.
9. Design versioned allowlisted saved schema, opening provenance, base+all-timeline normalization, obsolete-field pruning and new-item defaults. No equivalent old-plan conversion, mandatory backup or mapping prompts; user accepts a new save. Verify normalization/idempotence before writing saved state.
10. Add current/target Mermaid diagrams, component contracts and an F-ID coverage table. Decision records contain context, observed behavior, proposed change, alternatives/tradeoff, affected F/R IDs, status and acceptance tests.
11. Validate G01/G02 canonical writes/result context and missing target inputs before introducing engine-facing GUI schema changes; all new fields must survive unrelated edits and all views use the same declared measure/units/date/context.
12. Validate indexed compile/month-batched recurrence, sparse atomic funding, compact complete audit, bounded named-context caching, windowed views and safe-runtime-cent strategy (ADR-016). Decide worker/chunk/persistence choices using future stage/heap/transport measurement, not assumption.
13. Finalize CA01–CA13 target acceptance and one-rule ownership/default validation map (ADR-017/018). Avoid extracting a duplicate formula/normalizer into another module; list every caller and publish current/proposed/implemented evidence status.

Exit (**Gate B**): validated architecture, substantive behavior changes and migration mapping; every preservation row has owner/test/migration action; unresolved ambiguity cannot silently select a financial interpretation.

## Sub-plan C — Authoritative state and funding kernel

After both gates:

1. Add meaningful CA01–CA13 financial/default/determinism acceptance beside B01–B09 evidence. Actual branch/input variations must independently establish expected values; old bug snapshots are not target financial truth.
2. Introduce account/liability state with stable IDs/provenance, date/precision helpers, event/obligation/audit types behind adapters. Keep old engine available for baseline comparisons.
3. Implement pure funding quote and atomic commit with eligibility, primary-first split, taxes/penalties, partial policy and zero-negative-balance invariant.
4. Implement direct payroll/other-income deposit and allocation without independent spendable income. Build derived budgets for reporting only.
5. Verify conservation, split allocations, no-op atomic failure, gross/net withholding, missing/duplicate IDs, deterministic repeats, exhausted/restricted accounts and posted state immutability boundaries.

Exit: kernel correct and tested without prematurely deleting old paths; each new behavior has approved contract.

## Sub-plan D — Cards and existing obligation integration

1. Implement twelve-inclusive ordinary payments and0% funded-only adaptive payoff/residual lump-sum date/source/warning, no duplicate final principal and opening liability deduplication.
2. Integrate user-selected withdrawal timing/explicit4% valuation date, retirement/HSA/additional expenses, explicit fallback order and accepted cap policy.
3. Integrate loans monthly, interest/principal audit, funded-only debt reduction and arrears.
4. Mortgage/rental groups, explicit acquisition funding/deposit/completion, PMI/rent/appreciation/sale/deficiency. Pending deposit non-liquid/no full property/mortgage/ownership costs/growth; counted once until completion.
5. Integrate partial planned spending/benefits/life events/manual planner obligations; occurred imported history view-only/original date/sign, never projected by clamping/promoting its display date.
6. Replace old card modes with the agreed ordinary schedule and permanent-0% payoff types; normalize saved cards with new-item defaults, without attempting equivalent legacy conversions.

Exit: F03–F22 map to one posting/funding path; mandatory obligations and acquired assets never change on unfunded events contrary to contract.

## Sub-plan E — Reports, persistence and cutover

1. Generate monthly snapshots, event allocation history, liabilities/property equity/net worth and derived income metrics from authoritative state.
2. Aggregate annual calendar/age views as validated; adapt chart/table/summary/warnings/funding colors and all independent previews to shared outputs.
3. Make real-dollar transforms valuation-date consistent; retain supported historical/trajectory data with explicit engine/schema/measurement labels and never reinterpret it as new results.
4. Implement versioned default/pruning normalization; verify round-trip/idempotence including inactive timelines, history/import/UI state and liability links. Unsupported derived output may be dropped as recorded in the persistence plan.
5. Compare all baseline fixtures; document approved numeric changes per F/R ID. Keep characterization originals as historical evidence; add new target expectations instead of erasing original findings.
6. Execute the account-only sub-plan: remove pool definitions/membership/source helpers/shared rates/rules/UI grouping/report maps and obsolete scalar paths after integrated account-only tests/default normalization pass. Keep archived historical evidence.
7. Update feature matrix, architecture/decisions/diagrams and changelogs to actual implemented status.
8. Complete GUI-A01–A10 checks for the adapted G01–G40 elements, including zero-career/empty states, atomic skipped purchases, partial debt/card schedules, planner integration, negative net worth, real-dollar tooltips, clone/reference cleanup and new-field persistence.
9. Run B-P1–B-P8 benchmarks, scale one dimension at a time and compare against deterministic reference/invariants; publish reference environment/sample counts/p95/peak footprint/bytes/cancellation and validated supported envelope. No silent event/audit truncation to meet a budget.
10. Complete MD01–MD11 ownership/helper/schema/test/doc **verification** after integration; ADR-022 permits obsolete consumer/helper removal earlier with interim failures tracked. Refresh general runtime code/domain/persistence/test docs with actual modules/suites/commands; label historical plans, retain this-session refactor records here, and do not claim undocumented CI/coverage/browser verification.

Exit: no missing preservation rows; tested reset/default saved-plan cutover; full verification completed or pre-existing exceptions explicitly reviewed.

## Verification and phase handoff protocol

- Current pool-removal instruction is **documentation-only**: revise plans/decisions/mapping, verify consistency and source unchanged; do not run tests/build as if account-only code had been implemented.

- Account/math changes: at least `npm run test -- --run src/engine/projection.test.ts` and `npm run test -- --run src/App.test.tsx`, plus relevant new suites.
- Handoff checks: `npm run test -- --run` and `npm run build`. Current baseline has the documented one App failure; do not report the suite green until it is resolved.
- Target invariants: income posted once; closing=opening+posted changes; assets−liabilities=net worth; net allocations=sum executed payment; funded principal reduces debt exactly once; atomic failure changes no state; partial payments change only funded amounts; no negative cash/phantom transfers; investment valuation is not pay income.
- Dates/precision: leap years, timezone-independent date-only parsing, inclusive card/end windows, first partial periods, final cents, early payoff, missed payment deadlines and long horizons.
- End each phase with verified findings/decisions, open questions/R-register changes, affected files, exact test status and next gate/step. No gate is marked approved on the agent's assumption.
- Follow [audit_status.md](audit_status.md) for inspection versus execution. New financial/default code needs focused CA tests as modules become executable; engine/App suites can fail or be unavailable during authorized intermediate removals (ADR-022), with exact results recorded. Full test/build is a **final** handoff gate. The recorded 207/208 baseline failure is historical until a fresh run/fix verifies a change; static review and writing docs are not a fresh test pass.
