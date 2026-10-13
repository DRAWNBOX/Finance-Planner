# Maintainability and Documentation Audit

## Status and scope

Supplementary source/document inspection complete. Findings and future changes recorded; no runtime cleanup, general-doc rewrite, test rename or new quality tool implemented by this report. Account-only refactor contracts remain Gate B drafts unless specifically accepted/implemented in the ADR log.

This extends existing architecture/GUI/performance audits rather than repeating their financial findings. Rough module sizes at inspection: App ~5,422 lines, projection ~2,022, storage ~1,016; large files indicate ownership concentration, not automatically incorrect code.

## Findings

| ID / priority | Evidence | Proposed change and preservation check |
|---|---|---|
| MD01 / High | App owns editors, load/update normalization, timeline resolution, markers/chains, two scenario variants, financial previews, flags, funding tooltips, deflation and snapshots. Engine monolith owns scheduling, account changes, debt logic, reporting/warning accumulation. | Assign a single owner/contract for each rule before extracting files. Keep projection facade and reusable UI; no file split that leaves duplicate financial authority. F01–F26/G01–G40. |
| MD02 / High | normalizeCareerEntries exists in App and storage; career/housing/date/source rules are also re-derived in editors/helpers. App reconstructs accounts/loans/history differently from load normalizers. | Shared canonical validation/default/config/dependency functions for load/edit/save, one scheduler/reference registry, shared calculation/result selectors. Test new fields and chain behavior through all entry paths. |
| MD03 / High | Career/Card/Housing/Planner local estimates can differ from actual funded engine output. Result transforms/income warnings use hard-coded old maps/strings. | Separate nominal contract quotes from actual projection previews; query authoritative selected context/audit. Extract shared format/measurement/outcome view logic; do not duplicate engine math in new components. G10/G19/G21/G24/G26/G33–G36. |
| MD04 / Medium | Shared types contain legacy sourceType/pool/sourceId/paymentSourceAccount, salary-named net contribution mode, flat/granular payroll and pool-era career fields. Raw JSON casts do not validate structures. | New account-only schema with explicit money units/source IDs/version and canonical runtime validation. Prune approved obsolete fields after consumers converted; preserve actual payroll kinds, date links, history and feature intent. |
| MD05 / Medium | `getCareerContribution` appears only as declaration in projection; getDefaultBankAccountIdForPool is duplicated in financeModel and App. TS config is strict but lacks unused-symbol checks; package scripts show no dedicated lint command. | Verify dead helper consumers then remove superseded paths in approved cleanup; centralize retained helpers. Consider unused-symbol/static checks without asserting an existing lint suite; no new tooling dependency required just by audit. |
| MD06 / High | Defaults are exported singleton objects; first-launch/catch/no-window load and reset reuse them. Normalizers use length/truthiness for some collections and broad fallback on thrown errors. | Fresh factories, deliberate absent/invalid/empty semantics, record-local validation/error results and shared entry paths. TC05–08/CA11; new-save tolerance does not justify resetting unrelated supported values. |
| MD07 / Medium | Tests use long repeated legacy fixtures, some obsolete fields; “4%” test does not exercise source percentage; depletion title contradicts assertions. | Small canonical factories and explicit overrides, clear feature/behavior names and independent expected values. Keep archival fixtures as evidence, not current correctness promises. Do not abstract fixtures until they hide the relevant setup. |
| MD08 / Medium | General docs ARCHITECTURE/STATE_PERSISTENCE describe migration absence, while storage retains adapters. TEST_MAP references historical mode/net-worth imports and lists two suites; CODEMAP/AGENTS reference nonexistent bankImport/test modules. | Reconcile current-code documentation with real files/commands and seven suites. Label dated plans historical/superseded; new target remains visibly unimplemented. This phase records tasks inside refactor/, not edits older unrelated docs. |
| MD09 / Medium | Root README was minimal at the initial read-only inspection; it now includes architecture/money-flow/UI diagrams on recheck. Setup/verification commands and refactor status remain dispersed; its diagram routes Tracking to ExpensesPlanner although current App displays a placeholder. | Keep the new overview, reconcile diagram routes against runtime source and add actual install/dev/test/build commands, doc/refactor index, as-of/schema/current scope. Initial three-line finding is superseded; do not overwrite existing README changes or introduce a documentation platform. |
| MD10 / Medium | Historical baseline/plan references can retain old line numbers/paths; root parent plan still has assumptions superseded by user decisions and ADRs. | Establish authority order and traceability below; explicitly mark superseded portions rather than treating all plans as equally current. Refactor README/status index points to authoritative decisions. |
| MD11 / Medium | No `.github` workflow found; test/build are local scripts. No measured target acceptance/performance CI evidence. | Proposed quality gate: deterministic relevant tests + full test/build before cutover; benchmark/environment reports distinct. Adding CI is future work if desired, not a claimed requirement already enforced. |

## Proposed ownership map

The existing architecture module map is retained; these boundaries refine ownership, not add a framework:

| Concern | Single target owner | Consumers |
|---|---|---|
| Persisted structure/defaults/version/pruning | Shared canonical normalizers/factories, storage codec | App commands/load/save/reset; input validation tests. |
| Active timeline/opening/marker/chain resolution | Configuration/dependency resolver | Named projection preparation and editor display selectors. |
| Calendar recurrence/phase/order/pay-plan boundaries | Scheduler/date-reference registry | Engine execution, GUI recurrence preview/marker deletion/reference lists. |
| Gross/net payroll and individual deposit destinations | Income processor/paycheck compiler contract | Paycheck totals editor and actual engine deposit/posting. |
| Eligibility/basis/withdrawal quote | Account policy/tax/funding contracts | Shared funding editor/options, quote/commit and warnings. |
| Account/debt/property mutation | Private state manager/atomic commit | Income, obligations and valuation; no UI/persistence balance mutation. |
| Monthly/annual/outcome/warning previews | Reporting/audit selectors | Chart/table/career/card/loan/planner, all bound to named context. |
| Display money/date/measurement/deflation | Shared view adapter/formatters | GUI only; never financial posting. |
| Snapshot/copy lifecycle | Canonical clone/freeze/snapshot codec | Active/inactive timelines/pay plans/history/trajectory operations. |

Extract a rule only after identifying current behavior, intended correction, consumer list and acceptance tests. Module creation alone does not resolve drift. Do not introduce full double-entry/transaction tracking/general transfers or a state framework to address naming/ownership problems.

## Documentation authority and status conventions

1. Latest explicit user requirements/approved decisions control scope: direct account funding, new-save/default/prune, planner obligations, retirement spending, standalone contribution removal and pool removal. Writing a report is not financial implementation approval.
2. `architecture_decisions.md` records which requirements are accepted, implemented, open or proposed and which earlier assumptions are superseded. Do not silently rewrite historical parent/audit evidence as approved target behavior.
3. `feature_specification.md` is an **observed baseline inventory** with explicit later decision notes; it intentionally contains historical pool/annual-income findings. Current code remains authority for observed behavior, target specs for proposed behavior.
4. `architecture_specification.md`, account-only and save plans are **target contracts pending validation**, except the marked implemented contribution removal.
5. Testing/GUI/performance audit acceptance lists are **pending checks**, not passing tests. Preserve exact last executed test/build status separately from static inspection and theoretical estimates.
6. Archived baseline snapshots/dates/old plans are historical evidence; valid ordinary documentation references use current paths, while historical changelog creation paths may remain historical.

Each new implemented change should record F/R/ADR IDs, financial/input/output semantics, affected consumers/defaults, test IDs/results and intentional numeric differences. Current-vs-target behavior should never be inferred solely from an old test title or passing snapshot.

## Documentation work to carry into future implementation

- Refresh general code map/architecture/domain/calc/feature/persistence/test docs against actual runtime **after respective module cutover**, not prematurely declare pool removal or new income math live.
- Update TEST_MAP for all seven current suites and subsequently added acceptance suites; remove nonexistent import/historical-mode coverage claims or add accurately scoped tests.
- Record local/default validation/money/date/precision contracts where their owning modules are specified; feature docs reference them rather than replicate formulas inconsistently.
- Label historical Money Flow/manual contribution/date career/legacy removal notes with status/context when revised; respect the user's rule that only this-session documents move into refactor/.
- Remove dead/superseded helpers/types only after consumer search/build/tests; preserve unrelated current user work and archived evidence.
- Keep report paths/README/index/decision coverage synchronized; add a simple link/reference verification process if warranted, not a new documentation tool solely to check one move.

## Maintainability exit criteria

- One owner for each canonical structure, financial formula, scheduler/dependency and result selector; no UI-side competing balance simulation.
- Fresh independent defaults and shared load/edit/save/reset behavior, preserving intentional valid empty values.
- No runtime pool/source aliases or deprecated standalone contribution authority after approved cutover; no phantom compatibility maps.
- Tests describe the branches/contracts they exercise, meaningful independent assertions for money/state outcomes, and a traceable failure/coverage record.
- General docs describe actual implemented code, refactor docs distinguish proposed/accepted/implemented/historical, and nonexistent modules/coverage claims are removed.
- Full test/build and target acceptance/performance gates accurately recorded; no claim a documentation/code-organization cleanup alone proves financial correctness.
