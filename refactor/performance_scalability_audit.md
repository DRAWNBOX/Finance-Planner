# Performance and Scalability Audit — Account-Only Refactor

## 1. Verdict and evidence boundary

**The decomposition is suitable for a household planner, but the plan does not yet specify enough bounds on scheduling, audit storage, recomputation and rendering to claim it scales.** Independent account rates simplify valuation; direct account funding removes duplicated spending. Neither eliminates the cost of millions of recurring events, complete audit records or a large GUI result surface.

**Planning-only audit.** The new engine is not implemented; no new-engine latency/heap/throughput measurement exists. Complexity and capacity examples below are analytical estimates, not benchmark results. Existing code was inspected for patterns that must not be carried forward. No application/test/config/storage data changes in this phase.

Sources: `architecture_specification.md`, `account_only_subplan.md`, `gui_compatibility_audit.md`, `migration_plan.md`; current `src/App.tsx`, engine account helpers, `ResultsTable`, charts/planner, `storage.ts`, `expenseImport.ts`, `dateMarkers.ts`, `perfTools.ts` and package scripts. Last functional verification remains 207/208 passing tests (one known pre-existing App loan-row failure), passing build; that is not a performance benchmark.

## 2. Scale model and cost targets

RV31: eighty-year/960-month responsive support required; B-P1/B-P2/B-P4 target it; RV30 permits measured async storage. Numeric budgets still goals/unmeasured. RV11/ADR-020 partial payment atomic, home deposit retained until completion; taxable proxy20% gross/default editable LTCG15%. Count deposit once in audit/snapshots without extra financial simulation or actual-basis history.

Symbols per resolved projection context:

- **M** simulated months; required eighty-year horizon **960 full months**. Current engine's roughly1,824-month envelope is historical/stress input, not a newly promised maximum. Do not silently shorten requested dates; partial boundaries reported explicitly.
- **A / D / P** account / liability / property counts.
- **C** total relevant configuration size (including paycheck lines, career/pay plans, obligations and dependency references).
- **R** recurring schedule definitions; **E** actual emitted events, including income/valuation/accrual/payment events.
- **K** total candidate funding-source checks; **L** actual committed allocations, L ≤ K. An exhausted/invalid source still costs a check without an allocation.
- **eₘ** event count in month m; **q** tax quote work per candidate; **T** saved timelines; **S** saved trajectory snapshots; **V** visible display rows/cells/points.

### Efficient target shape (proposed)

| Stage | Target work | Avoid |
|---|---|---|
| Compile selected configuration | O(C + A + D + P), plus sorting actual plan boundaries | Rebuilding/indexing all inactive timelines, histories and snapshots on every render. |
| Schedule | O(C + E) with indexed boundaries; or O((C+E) log R) next-event heap if justified | O(M×R×days) full range scans for mostly inactive schedules, or all-horizon eager expansion. |
| Stable chronological order | O(Σ eₘ log eₘ) sorting one month at a time, with date/phase/priority/stable-ID keys | O(E log E) full-horizon sort/memory when a monthly bucket stream suffices. |
| Valuation/accrual/monthly output | O(M×(A+D+P)) for full snapshots; skip zero/closed accrual where semantically valid | Scanning pools or resolving account IDs with repeated array.find per posting. |
| Funding | O(K×q + L) | O(E×A) account searches, O(E×A) state clones, per-cent search. |
| Audit encoding | O(E + L + touched asset/debt changes) | Full before/after global state duplicated inside every event. |
| Annual/summary aggregation | O(E+L+M×(A+D+P)) over existing posting/monthly data | A second financial simulation or repeated history scans per row. |
| View update | Work proportional to changed projection/display selection; DOM bounded by V | All account×month cells, all audit entries or all schedule occurrences rendered simultaneously. |

Overall first-run cost cannot be below actual events/allocations/output size. Complete monthly account snapshots alone have an Ω(M×A) data requirement. Lazy/windowed display saves rendering/copies, not the financial computation that must still reconcile every scheduled event.

## 3. Highest-risk capacity examples

These describe possible inputs, not promised supported profiles:

1. **1,000 weekly schedules ×80 years ×about52 weeks =4.16 million occurrences**, before income/valuation/debt (actual calendar count measured). Streaming bounds scheduler memory, full audit still scales with E.
2. **960 months ×100 accounts =96,000 values**, 768,000 raw numeric bytes (~0.73 MiB) at eight bytes/value. One total each for fifty debts/twenty properties makes ~1.25 MiB; component breakdowns, metadata, audit, object overhead and copied contexts add more.
3. **96,000 account cells** plus result columns/one hundred account series create substantial DOM/path work at eighty years; worker alone cannot solve rendering costs.
4. For illustration only, **one million events × an assumed 200 serialized bytes/event ≈200 MB**, before allocation detail. Actual byte size must be measured. It is not credible to persist such a trace in a small synchronous localStorage JSON blob.
5. Holding both future and retirement projections, several cached timelines, display-dollar/deflated copies and multiple snapshots can multiply an already large trace. Caching every timeline by full output trades CPU for unbounded memory.

The new model adds legitimate work compared with the current engine: net-pay deposits, true liabilities/property balances, projected planner events and complete audit. Benchmark the full target, not a growth-only loop, and do not advertise pool removal as proof it will run faster.

## 4. Risk register and required refinements

P0 = settle before cutover; P1 = important measured optimization; P2 = conditional after profiling. “Current” denotes inspected code, “plan” denotes underspecified proposed design.

| ID / priority | Risk and evidence | Proposed refinement |
|---|---|---|
| PS01 / P0 | **Repeated eager projections on GUI edits.** Current App:760–804 constructs two synchronous results; broad scenario dependencies include nonfinancial edits. Target GUI boundaries alone do not define invalidation. | Compute named contexts on demand; separate financial revisions from labels/colors/UI/saved comparisons; cache only bounded recent active contexts. Avoid hidden retirement what-if execution on every edit. |
| PS02 / P0 | **All-timeline normalization/reference resolution.** App.updateScenario and dateMarkers rebuild many base/inactive collections; source sync JSON-stringifies lines/plans to detect differences. | Canonical initial load validation can cover all data once; localized commands preserve unchanged references. Reference index invalidates dependents of changed markers/accounts only, with global-account changes intentionally broad. |
| PS03 / P0 | **Eager horizon event generation.** Scheduler contract does not specify materialization bound; weekly planner integration changes E dramatically. | Generate one month/chunk of occurrences, seek directly to first in-range date, maintain active schedules/end boundaries; never scan months before anchor or expand inactive schedules beyond target. |
| PS04 / P0 | **Funding/account lookups.** Current account helpers use array.find/filter/sort. Extending those patterns into per-event split funding creates O(E×A)/sort overhead. | Build account/liability/source-ID indexes once per config revision; use ordered prevalidated source IDs/indexes; recheck dynamic eligibility/balance at event time. Never skip a source just because it was previously exhausted if a later deposit may replenish it. |
| PS05 / P0 | **Atomic quote implemented via whole-state cloning.** Plan says pure quote but not how. Deep-copying A+D+P for each request is prohibitive. | Sparse quote overlay over touched accounts/basis/liabilities; validate complete change set and state revision; commit once. State remains private to simulation and input immutable. Snapshot copies only at output/checkpoint boundaries. |
| PS06 / P0 | **Gross/net cent search.** “Smallest cent-valued debit” could be implemented as linear search up to balance; high balances make it pathological. Blind binary search may also be wrong if separate rounded tax+penalty components make net proceeds locally nonmonotone. | Closed-form estimate plus a proven bounded rounding correction, or search only after monotonicity is established for the exact policy. Specify iteration bound/failure outcome and property-test minimal debit/reconciliation; never silently change withholding policy for speed. |
| PS07 / P0 | **Complete rich audit duplicates global state/strings/labels.** Architecture asks before/after changes for every event; repeated copies and annual/UI shadow logs can dominate memory. | Canonical compact event log with IDs/type codes/date offsets, sparse touched before/after values, allocation slices and shared metadata dictionary. Indexed by source/month/account; complete trace retained/queryable once, not cloned into every tooltip/view. |
| PS08 / P0 | **Huge trace transported to the main thread.** A worker emitting all results at once can incur expensive structured-clone and duplicated worker/GUI memory. | Send summaries/selected series first, retain full canonical audit in chunks with paged queries. Transfer independent owned buffers when appropriate; never detach buffers still needed elsewhere. Measure transport and both heaps, not just worker compute time. |
| PS09 / P0 | **Blocking/cancel-unaware financial work.** Current compute runs in render; target long jobs may monopolize main thread. A posted “cancel” message alone cannot interrupt a synchronously busy worker. | Background runner for large profiles; request/context/revision IDs, stale-result rejection, actual chunk-boundary cancellation or worker termination. Yield only between atomic events/month checkpoints, never mid-commit. Do not mutate accepted scenario while compiling a job. |
| PS10 / P0 | **localStorage serialization/quota.** App:1052–1060 saves whole state on UI/scenario changes; storage:1015 synchronous JSON/setItem with no save-error handling. Snapshot/import data can grow with T/S. | Save canonical config/appropriate frozen summaries, never live audit/cache; coalesce/debounce durable writes with explicit final flush/error status. Measure payload; use asynchronous IndexedDB for large config/artifacts if benchmarks require it. No silent pruning of valid user data to meet a byte target. |
| PS11 / P1 | **Too many result cells/audit rows.** ResultsTable maps all monthly rows×all accounts. | Virtualize/paginate rows and horizontally window large account tables; details/schedules/audit loaded for visible window. Keep keyboard/focus/accessibility/export and all financial data available. |
| PS12 / P1 | **Account charts become O(M×A) paths/hover data.** Existing stacked chart repeatedly derives totals; ChartPanel scans points on every mousemove and re-creates path strings on hover render. | Memoize geometry separately from hover state; direct pixel→index for evenly spaced months, binary search dates otherwise; requestAnimationFrame coalescing. View-only shared-point decimation preserving signed extrema/event markers and truthful stacked totals; exact source on hover/detail. |
| PS13 / P1 | **Planner cell searches multiply work.** ExpensesPlanner:785–820 filters all entries/occurrences for each week/category repeatedly; offsets at 809–811 are O(categories²). | Index `(displayAccount, category, week)` once per relevant change; prefix offsets once; occurrence generation and balance lookup shared with scheduler/report queries; virtualize rows/weeks. Avoid eager display of a full century’s weekly columns. |
| PS14 / P1 | **Repeated paycheck/date/rate compilation.** Active plan resolution and compilation can recur per month/event; Math.pow per account uses same rate repeatedly. | Precompile pay-plan coefficients/boundary intervals and monthly account rate factors per phase. Re-evaluate salary/raise/time-dependent inputs correctly at boundaries; keep partial-month/date policy exact. |
| PS15 / P1 | **Warnings/reconciliation repeated across all history.** Current dedup often warnings.includes; target source labels/text may be generated per occurrence. | Warning IDs/cause sets, per-source aggregates and incremental monthly reconciliation; materialize grouped text only in visible views. Reconcile each actual change; do not rescan every prior event at each close. |
| PS16 / P1 | **Deflation and view-model copy multiplication.** App:826–908/4283–4297 clones complete matrices/maps for current dollars; new liabilities/audit increase size. | Cache nominal data once, precompute per-date factors, transform requested view windows lazily. Same unit/date basis across all views; labels/colors cannot invalidate raw numeric state. |
| PS17 / P1 | **Memoization defeated by recreated props/inline callbacks.** React.memo does not help unstable arrays/options/objects; derived account lists recreated each App render. | Stable selectors keyed to canonical relevant revisions; UI-only changes reuse financial results/series. Measure React commits; avoid expensive custom deep comparisons that serialize C/E on each render. |
| PS18 / P1 | **Large imports and saved trajectories.** Import parser fully materializes rows/text and searches A labels per row; stored previews/snapshots add bytes. | Parse large batches off thread/chunked, index normalized account hints, limit displayed preview (not retained source capability), retain originals/provenance in appropriate store; frozen annual snapshots avoid live full-audit copies. Remove independent financial simulations in previews. |
| PS19 / P1 | **Unbounded diagnostic logging.** perfTools:timingLogs grows forever and logs per render; existing timers cover memo callbacks, not pipeline stages/render/save/heap/transport. | Bounded ring buffer and separate stage/counter metrics, optional sampling, production-build profiling without console logs in timed region. Capture p50/p95/p99, input responsiveness, peak main+worker memory, payload and cancellation latency. |
| PS20 / P0 | **Finite input cents do not ensure safe runtime cents.** Account growth over long horizons/high rates and summed balances can exceed Number.MAX_SAFE_INTEGER, corrupting supposedly exact funding. | Validate safe integer after multiplication/rounding/aggregation/commit and compiler rate range; explicit unsupported-range diagnostic or approved exact representation. Never wrap typed integers, saturate/cap wealth silently or substitute imprecise amounts for speed. |

These risks link to GUI G01/G02/G07/G10/G17/G24/G26/G29/G32–G40 and F01–F26. PS20 is financial correctness at scale as well as a performance-design constraint.

## 5. Recommended architecture refinements

All are **proposals pending Gate B**, not implemented optimizations:

### A. Compile once, stream chronologically

- `CompiledScenario` contains stable ID→index maps, account rate factors, source policy orders, sorted career/plan boundaries and recurrence cursors clipped to projection interval.
- Only selected timeline and requested named context are simulated; inactive timeline config remains persisted/validated but does not generate events. T affects load/config storage, not an automatic T×full-run multiplier.
- Month batches retain date/phase/priority/stable-ID order; dynamic payment targets (debt payoff/PMI/0%-deadline recalculation) derived from current state at execution, never cached as fixed future amounts.
- Ordinary calendar recurrence is arithmetic/next-date enumeration; no individual card transactions, tax-lot ledger or event per dollar/cent.

### B. Sparse atomic plans, canonical audit, output-sensitive state

- Quote reads indexed state with sparse proposed debits; allocations at most distinct configured sources. Rate/basis/eligibility quote data cached only while valid; balances/basis/deadlines remain dynamic.
- One compact complete audit per context; touched balances only, exact account/debt/deposit partial postings and zero-fund/invalid plan no fake debit. Exchange deposit for property/mortgage at completion; no simultaneous deposit/equity duplicate. Fixed disclosed gain proxy requires no actual basis/tax-lot ledger.
- Monthly closes copy/record required per-account/debt/property values once. Annual rows are summaries over existing months; event indexes point into the canonical log instead of duplicating it.
- Large-trace runner may spill/query complete audit chunks through an external storage adapter; core calculation still deterministic and side-effect-free with respect to input. Streaming/persistence orchestration is outside finance formulas. Cancellation or chunk-save failure must never present an incomplete trace/result as complete.
- Typed numeric buffers are an option after profiling, not mandatory before measurement. Integer cents need safe-integer checks; Float64 buffers can represent checked integer cents, while Int32 wrapping is unacceptable. Object view adapters need not expose storage representation.

### C. Compute/UI/save invalidation are separate

Classify edits using canonical commands/revisions, not full JSON hashing on each render:

| Edit | What must change | What should be reused |
|---|---|---|
| Amount/rate/tax/funding/balance/date/debt/recurrence/paycheck/plan order | Financial compile/result for dependent active context; saved config | Independent inactive context only if dependencies actually unaffected. |
| Account/source label or color, chart range/visibility, selected row/tab, current-dollars toggle | Display metadata/visible selectors; durable UI state as appropriate | Numeric engine output and audit. New deterministic tie order must not depend on labels. |
| Marker date, account removal, global rates/rules | Dependency-index invalidation, affected plan references/context | Unrelated collections/views; do not omit global/account dependencies from cache key. |
| Save/rename/remove an immutable trajectory | Snapshot metadata/persistence/comparison view | Current live financial output. |
| Switch active timeline | Required named-context computation or valid cache reuse | Bounded previous result/context cache, not full eager run for every saved timeline. |

Cache key includes engine/schema policy version, context, financial revision, opening date/snapshot identity and all global dependencies. Invalid keys can return a fast **wrong** plan; correctness outweighs reuse. Bound cache entries/bytes and release canceled/superseded generated results. Never evict user-authored configuration/history to bound a runtime cache.

A worker does not automatically make a large result cheap. UI can keep the last completed result during edits but must label its revision as pending/stale until the newest job is accepted. Two different financial contexts cannot be blended in chart/warnings/tooltips to appear responsive.

### D. Render and persist proportional to requested view

- Results tables/audit/schedules/planner cells window by selected date/account, with pagination/export of the full dataset available. Avoid off-screen detail creation and per-cell Intl.NumberFormat construction; reuse formatters and shared metadata.
- Chart decimation is strictly display-only. For stacked series, use coordinated sample dates and recompute visible total from those same exact values; do not independently sample layers into false sums. Preserve extremes, discontinuities and flags; exact original data backs hover/details.
- Monthly aggregation cannot combine events with different due dates/phases/tax purposes/partial rules if that changes funding. Display grouping preserves underlying ordered trace.
- Canonical saves contain config, supported history/import data and appropriately scoped immutable comparison output. No generated live trace, selector caches or every recurring occurrence. Larger persistence backend is an architectural option, not silently added now.
- Save coalescing must not create silent lost edits: flush on explicit save/context operations, handle page lifecycle conservatively, expose failure; do not rely solely on unload events. Small UI preference writes should not serialize every saved trajectory.

## 6. Benchmark plan — measurements still required

Use synthetic IDs/data, fixed explicit dates/seed, validated financial invariants and identical source ordering. Proposed reference environment: production build in desktop Chrome/Edge on a documented Windows machine, plus one recorded CPU-throttled browser profile. Record actual CPU/RAM/browser/build/commit, visible viewport, cold/warm and storage state. Do not compare dev StrictMode/debug-console timings with production figures or call Vitest suite elapsed time a browser latency measure.

### Profiles

| Profile | Dimensions | Purpose |
|---|---|---|
| B-P1 — household | M=960, A=12, D=6, P=2; ~30 monthly +10 weekly obligations, five career/pay plans | Required eighty-year household run/responsive edit/render/cancel; actual E counted. |
| B-P2 — large plan | M=960, A=100, D=50, P=20; 250 monthly +100 weekly obligations, fifty career/pay plans | Eighty-year large profile/~656k payments if all active (approximate weeks), plus other events; measure audit/render/transport. |
| B-P3 — sparse schedules | M=1,824, large C (10k dated schedule definitions), small active E | Verify direct date seeking/active indexing; doubling inactive C should not multiply per-month execution. |
| B-P4 — dense recurrence stress | M=960; 1,000 weekly schedules plus monthly/debt events | ~4.16m weekly occurrences; measure support/heap/cancel/chunk storage. Dense count is stress, not a user-specified schedule count. |
| B-P5 — funding stress | A=100; candidate list lengths 1/2/10/100; zero/replenished/restricted/taxable balances, high safe amounts | K and q costs; avoid per-cent solver; minimal gross/net correctness and source exhaustion ordering. |
| B-P6 — saved plan growth | T=1/10/100 inactive plans; S=0/10/100 frozen trajectories; large history/import metadata | Load/edit/save bytes/time, cache eviction; number of full runs for one active edit must not grow automatically with T or S. |
| B-P7 — GUI workload | B-P2 with monthly table, many accounts/flags, planner weeks/categories, audit/schedule paging | DOM/path costs, hover/scroll/type latency, signed metrics and real-dollar toggles; no financial reruns for view-only actions. |
| B-P8 — sustained revisions | 100 sequential edits, rapid date/rate changes, timeline switch, cancellations and return to unchanged context | Cache correctness/stale rejection, detached buffer safety, memory plateau after releasing old results, bounded diagnostic log. |

Measured actual E/L/K and serialized bytes are part of every result. Some schedules pay off/expire; do not infer actual emitted count from R×M when generating test fixtures.

### Stage metrics and procedure

1. Instrument compile/reference normalization; schedule generation/order; paycheck/debt/valuation; funding quote/commit; audit append/index; monthly/annual output; view-model/deflation; worker serialization/transport; React commit/paint; JSON/storage write independently. Existing `?perf` memo timers are only a starting point.
2. Count runs and allocations/scans/state clones/solver iterations, event/audit count, visible DOM cells/points, result/cache/serialized bytes and peak memory **including worker + GUI + in-flight copies** where tools permit.
3. Use at least thirty warm household edit samples and separate cold-run samples; report p50/p95, sample count, variability, failures and GC. Large/stress repetitions may be fewer but disclose count rather than invent meaningful p99 from a handful of samples.
4. Record first input echo, last-edit→accepted result, paint/hover/scroll response and cancellation-to-stop. Distinguish intentionally deferred result freshness from UI responsiveness.
5. For each optimization, compare against a deterministic reference implementation on smaller fixtures: balances/debts/net worth/shortfalls/tax/penalty/ordered allocations/event IDs and monthly sums must match the approved rounding policy. Same aggregate amount with changed source/date is not equivalence.
6. Scale one axis at a time (M/A/R/K/T/S), and include sparse vs dense schedules. Use operation counts/complexity trends to catch accidental quadratic growth before flaky wall-clock CI thresholds.

### Proposed performance budgets (review, not measured commitments)

| Budget | Initial goal on declared reference machine |
|---|---|
| Household edit input echo | p95 ≤50 ms; no synchronous engine/storage long task ≥50 ms in input handler/render. |
| Household last-edit→fresh painted result | p95 ≤250 ms for B-P1, including queue/transport/view work. |
| Large-plan last-edit→fresh result | Initial p95 ≤2 s for B-P2 in background runner, while main thread remains responsive. |
| Hover/scroll/rendered window | p95 ≤16–32 ms work per frame; selected audit/schedule page response ≤100 ms after result ready. |
| Cancellation | Cancel request → stopped work ≤100 ms, including dispatch delay, with no stale result accepted; chunk size tuned to measured cost. |
| Incremental peak projection footprint | Initial total main+worker+transfer target ≤64 MiB B-P1 / ≤256 MiB B-P2; account for caches and copy peak, not raw numeric buffer only. |
| Small localStorage save | p95 ≤10 ms below measured payload threshold; proposed ~2 MiB threshold is a design trigger for testing async storage, not browser quota guarantee. |
| Dense stress support | Document achieved throughput/time/heap/storage and supported mode; no fabricated low-latency guarantee for B-P4. Complete events never silently truncated. |

Browser quota and JSON/string memory vary; measure byte/character representations and actual quota/failure behavior. If goals fail, revise implementation/storage/renderer, or present an explicit supported-envelope decision for validation; never silently shorten horizon/drop features/degrade financial precision to hit a target.

## 7. Correctness-preserving optimization rules

- Do not independently simulate previews, count income twice, use aggregate portfolio rates for account growth, or finance payments from future income to reduce work.
- Stable chronological/phase/source priority and atomic transaction boundaries survive scheduling/cancellation/chunking. Parallelize independent contexts or pure compile work only; within one dependent account ledger, posts remain ordered.
- Daily rows are not required by month-scoped planning, but due dates within a month still matter. Optimize occurrence generation, not contractual date fidelity.
- Audit can be packed/paged/chunked, never missing/fictional/truncated. Monthly closes and summaries reconcile to complete posted events; saved trajectory scope remains explicitly labeled.
- Cache/reference/view optimizations cannot conflate contexts, lose unchanged metadata, change tax rounding, erase small unpaid debts or detach retained buffers.
- Funds/basis/principal/total-asset cents stay exact within approved supported range. Runtime overflow is reported, not silently converted into negative balances or capped net worth.

## 8. Gate B additions and future work

1. Approve output-sensitive compile/scheduling/funding/audit contracts; sparse atomic quoting and safe-cent/gross-net solver strategy.
2. Specify named-context invalidation/cache ownership, request revision/cancellation and optional background runner/chunk interfaces without changing financial ordering.
3. Decide compact audit retention/query/storage and comparison snapshot scope; measure serialized config before choosing localStorage-only vs asynchronous artifact/backend storage.
4. Specify table/planner/audit windowing and account-chart sample/hover contracts tied to GUI G01–G40.
5. Implement deterministic synthetic benchmark harness/instrumentation **after implementation approval**, separate from ordinary correctness tests, with operation-count guards and published reference environment.
6. Collect B-P1–P8 measurements, compare financial equivalence, report achieved versus proposed goals, then authorize supported-scale cutover.

**Current conclusion:** suitable architecture direction, with significant scalability gaps now explicitly identified. The lowest-risk wins are indexed account/source access, month-batched recurrence, sparse funding quotes, on-demand named contexts, one compact audit and windowed displays. Worker execution, typed buffers and IndexedDB are conditional choices to validate with full-pipeline measurements, not substitutes for efficient algorithms or correct math.

Supplementary acceptance/ownership follow-up: [testing_correctness_audit.md](testing_correctness_audit.md) defines CA01–CA13 and false-green baseline gaps; [maintainability_documentation_audit.md](maintainability_documentation_audit.md) defines shared owners/default validation. Performance equivalence must compare independently established approved behavior, not only replay snapshots of annual income/debt defects. Correctness/benchmark execution remains pending.
