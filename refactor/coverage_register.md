# Coverage Register — Account-Only Finance Planner

Single authoritative per-item completion register for the refactor. Created by Phase 0 (P0.2). Rows map every audit/acceptance ID to an owner (workstream), implementation task, test/evidence, and status. This document **does not declare any audit row passing**; status reflects evidence actually produced.

`Test/Evidence` names a **planned check or source of proof**, not a completed result. Previously open finance-rule choices are now settled in ADR-021; execute their specific assertions before upgrading a row's status. Execution results belong in the status/evidence record when the relevant task runs.

Status legend:
- `baseline` — historical/current-suite evidence only, not target proof.
- `reproduced` — baseline defect reproduced with a fixed fixture (Phase 0).
- `P0.6-done` — Phase 0 test edit applied; branch/warning genuinely exercised/asserted.
- `contract-frozen` — contract pinned by Phase 0; no implementation/test yet.
- `implemented` — code exists in the current baseline.
- `not-started` — no implementation yet (Phases 1+).
- `blocked` — contract unresolved; implementation cannot proceed.

Owners (workstreams, refactor/implementation_plan.md §2): S=Schema/config, K=Kernel, I=Income, O=Obligations, R=Reporting, U=UI, P=Performance, Q=Quality.

---

## F01–F26 — Features (refactor/feature_specification.md)

| ID | Owner | Task | Test/Evidence | Status |
|---|---|---|---|---|
| F01 | S+K | P1.1/P1.5/P5.1 | CA08/CA11/CA12, GUI-A01/A02/A09 | not-started |
| F02 | K | P2.1/P5.1 | CA08 | not-started |
| F03 | I | P3I.1/P3I.3 | CA01/CA11, GUI-A03/A09 | not-started |
| F04 | I | P3I.2/P3I.3 | CA01, GUI-A03 | not-started |
| F05 | I | P3I.2 | CA01/CA11, GUI-A03 | not-started |
| F06 | I | P3I.3/P3I.4 | CA01/CA11 | not-started |
| F07 | O | P3S.1 | CA03/CA10 | not-started |
| F08 | K+O | P2.4/P3S.1 | CA03/CA04/CA12 | not-started |
| F09 | K | P2.3 | CA04/CA12 | not-started |
| F10 | O | P3S.2 | CA07, GUI-A02/A08 | not-started |
| F11 | O+K | P3H.1/P3S.2/P4.2 | CA08/CA13 | not-started |
| F12 | O | P3S.1 | CA03/CA10, GUI-A04 | not-started |
| F13 | O | P3S.1 | CA03/CA10 | not-started |
| F14 | O | P3D.3 | CA05/CA06 | not-started |
| F15 | O | P3D.1 | CA05/CA06, GUI-A05/A06 | not-started |
| F16 | O | P3D.2 | CA05/CA06, GUI-A05/A06 | not-started |
| F17 | O | P3H.1/P3H.3 | CA05/CA09, GUI-A05 | not-started |
| F18 | O | P3H.1/P3H.4 | CA05/CA09, GUI-A05 | not-started |
| F19 | I+O | P3I.5/P3S.1 | CA01/CA10 | not-started |
| F20 | I | P3I.5 | CA01 | not-started |
| F21 | S | P1/P7 (retain removal) | CA11, existing removal regressions | implemented (baseline) |
| F22 | O | P3S.3/P3S.4 | CA10/CA11, GUI-A07 | not-started |
| F23 | S | P1.4 | CA08/CA11/CA12, GUI-A09 | not-started |
| F24 | R | P4.1/P4.3 | CA02/CA12 | not-started |
| F25 | R+U | P4.4/P4.5 | CA02/CA12, GUI-A08/A10 | not-started |
| F26 | S | P1.3/P5.3 | CA11, GUI-A01/A09/A10 | not-started |

## R01–R26 — Risks (refactor/feature_specification.md §issue-risk-register)

| ID | Owner | Task | Test/Evidence | Status |
|---|---|---|---|---|
| R01 | K+O | P3I.3/P3S.1/P5.1 | CA01/CA02 | not-started |
| R02 | O | P3D.3/P3H.1 | CA05 | not-started |
| R03 | S | P1/P7 | existing removal regressions | implemented (baseline) |
| R04 | I | P3I.3 | CA01 | not-started |
| R05 | S | P1.1/P1.5 | CA11/CA09 | not-started |
| R06 | O+U | P3D.1/P3D.2/P3D.4 | CA06, GUI-A06 | not-started |
| R07 | R | P4.1/P4.2 | CA02 | not-started |
| R08 | U+R | P4.5/P5.2 | CA12 | not-started |
| R09 | O | P3S.3/P3S.4 | CA10 | not-started |
| R10 | K | P2.3 | CA04 | not-started |
| R11 | I | P3I.1/P3I.2 | CA01 | not-started |
| R12 | K | P2.1 | CA08/CA13 | not-started |
| R13 | R | P4.1/P4.3 | CA02 | not-started |
| R14 | O | P3H.2/P3H.4 | CA09 | not-started |
| R15 | Q | P0.1 (repro only) | TC01 baseline | reproduced (see P0.1) |
| R16 | S | P1.3 | CA11 | not-started |
| R17 | R+U | P4.4 | CA12 | not-started |
| R18 | S+K | P1.1/P7.1 | CA11 | not-started |
| R19 | U | P1.6/P5.2 | GUI-A01–A10 | not-started |
| R20 | P | P6.1–P6.6 | PS01–PS20 | not-started |
| R21 | K+P | P2.1/P2.3 | CA08/PS20/CA13 | not-started |
| R22 | Q | P0.6 | TC02/TC03; CA07 editable percentage and later-start basis pending | P0.6-done (target implementation pending) |
| R23 | S | P1.3 | CA11/TC05–TC08 | not-started |
| R24 | S+K | P7.5 | MD01–MD11 | not-started |
| R25 | O | P3H.2 | CA09 | contract-frozen (ADR-020) |
| R26 | K | P2.3 | CA04 | contract-frozen (ADR-020) |

## G01–G40 — GUI compatibility (refactor/gui_compatibility_audit.md)

| ID | Owner | Task | Test/Evidence | Status |
|---|---|---|---|---|
| G01 | S | P1.3/P1.6 | CA11, GUI-A01 | not-started |
| G02 | U | P5.2 | GUI-A02 | not-started |
| G03 | U+S | P7.2 | GUI-A01 | not-started |
| G04 | S+U | P1.1/P1.6 | GUI-A01 | not-started |
| G05 | U | P3S.5 | GUI-A02 | not-started |
| G06 | U+R | P4.5 | GUI-A02 | not-started |
| G07 | U | P3I.6/P3S.5 | GUI-A01 | not-started |
| G08 | S | P1.1/P1.5 | GUI-A08 | not-started |
| G09 | U | P3I.6 | GUI-A03 | not-started |
| G10 | U+R | P4.5 | GUI-A03 | not-started |
| G11 | U | P3I.6 | GUI-A03 | not-started |
| G12 | U | P3I.6 | GUI-A03 | not-started |
| G13 | U | P1.4/P3I.6 | GUI-A09 | not-started |
| G14 | U | P3I.6 | GUI-A04 | not-started |
| G15 | U | P3S.5 | GUI-A03 | not-started |
| G16 | U+S | P1.6/P3S.5/P3D.4/P3H.5 | GUI-A04 | not-started |
| G17 | U+R | P4.5 | GUI-A04 | not-started |
| G18 | U+R | P4.5 | GUI-A05 | not-started |
| G19 | U | P3D.4 | GUI-A05 | not-started |
| G20 | U | P3H.5 | GUI-A05 | not-started |
| G21 | U+R | P4.5/P3H.5 | GUI-A05 | not-started |
| G22 | U | P3H.5 | GUI-A05 | not-started |
| G23 | U | P3D.4 | GUI-A06 | not-started |
| G24 | U+R | P4.5/P3D.4 | GUI-A06 | not-started |
| G25 | U | P3S.5 | GUI-A07 | not-started |
| G26 | U+R | P4.5/P3S.5 | GUI-A07 | not-started |
| G27 | U | P3S.5 | GUI-A07 | not-started |
| G28 | U | P3S.4/P3S.5 | GUI-A07 | not-started |
| G29 | U | P4.5 | GUI-A08 | not-started |
| G30 | U | P4.5 | GUI-A08 | not-started |
| G31 | U+R | P4.3/P4.5 | GUI-A02/A08 | not-started |
| G32 | U+R | P4.5 | GUI-A08 | not-started |
| G33 | U+R | P4.5 | GUI-A08 | not-started |
| G34 | U+R | P4.4 | GUI-A08 | not-started |
| G35 | U+R | P4.5 | GUI-A08 | not-started |
| G36 | U+R | P4.6 | GUI-A10 | not-started |
| G37 | U | P1.4/P5.2 | GUI-A09 | not-started |
| G38 | U | P1.4/P5.2 | GUI-A09 | not-started |
| G39 | U | P4.5/P5.2 | GUI-A02/A09 | not-started |
| G40 | U | P4.5 | GUI-A10 | not-started |

## GUI-A01–A10 — GUI acceptance (refactor/gui_compatibility_audit.md)

| ID | Owner | Task | Test/Evidence | Status |
|---|---|---|---|---|
| GUI-A01 | U+Q | P1.6/P5.4 | G01/G03/G04/G07 | not-started |
| GUI-A02 | U+Q | P5.4 | G02/G05/G06/G31/G39 | not-started |
| GUI-A03 | U+Q | P3I.6/P5.4 | G09–G15 | not-started |
| GUI-A04 | U+Q | P3S.5/P5.4 | G14/G16/G17/G35 | not-started |
| GUI-A05 | U+Q | P3D.4/P3H.5/P5.4 | G18–G22 | not-started |
| GUI-A06 | U+Q | P3D.4/P5.4 | G23/G24/G30/G38 | not-started |
| GUI-A07 | U+Q | P3S.5/P5.4 | G25–G28 | not-started |
| GUI-A08 | U+Q | P4.5/P5.4 | G08/G29/G32–G36 | not-started |
| GUI-A09 | U+Q | P1.4/P5.4 | G13/G37/G38/G39 | not-started |
| GUI-A10 | U+Q | P4.6/P5.4 | G36/G38/G40 | not-started |

## TC01–TC13 — Testing/correctness findings (refactor/testing_correctness_audit.md)

| ID | Owner | Task | Test/Evidence | Status |
|---|---|---|---|---|
| TC01 | Q | P0.1 (repro) | App.test.tsx:519 loan-row | reproduced |
| TC02 | Q | P0.6 | projection.test.ts four_percent branch | P0.6-done (branch exercised) |
| TC03 | Q | P0.6 | projection.test.ts minimum-warning | P0.6-done (warning asserted) |
| TC04 | Q | P0.1/P5.5 | B01–B09 archived snapshots | baseline |
| TC05 | S+Q | P1.3/P1.7 | CA11 | not-started |
| TC06 | S+Q | P1.2/P1.7 | CA11 | not-started |
| TC07 | S+Q | P1.3/P1.7 | CA11 | not-started |
| TC08 | S+Q | P1.7 | CA11 | not-started |
| TC09 | Q | P7.4 | CA03–CA06 | not-started |
| TC10 | Q | P2.7/P3 | CA01–CA13 | not-started |
| TC11 | K+Q | P2.1 | CA08 | not-started |
| TC12 | Q | P3S.4/P6.6 | parser/browser evidence | not-started |
| TC13 | K+Q | P2.3/P6.7 | CA04/CA08/CA13 | not-started |

## CA01–CA13 — Correctness acceptance (refactor/testing_correctness_audit.md)

| ID | Owner | Task | Test/Evidence | Status |
|---|---|---|---|---|
| CA01 | I+Q | P3I.3/P5.5 | Planned: fixed-date paycheck totals, distinct employee/employer destinations, ordered net allocations and remainder; oversubscription and career breaks reconcile to actual postings (F03–F07/R01/R04). | contract-frozen (P0) |
| CA02 | R+Q | P4.2/P4.7 | Planned: each account close = opening + postings; annual flows = sum of actual months; total assets − liabilities = signed net worth (R07/R13). | contract-frozen (P0) |
| CA03 | K+Q | P2.4/P2.7 | Planned: primary/fallback order, deduplication, eligibility and replenishment; partial, zero-funded, invalid and stale atomic commits; held deposit only for actual funding (CA09). | contract-frozen (P0) |
| CA04 | K+Q | P2.3/P2.7 | Planned: independent taxable $1,000 gross→$970 net, $1,000 net→$1,030.93 gross, $0.17→$0.01 tax; separate rounded gross-based penalty, minimal/partial quote with ≤256 candidates or explicit diagnostic; qualified HSA, retired under-65 versus working 65+, custom penalty and birthday boundary (ADR-021). | contract-frozen (P0) |
| CA05 | O+Q | P3D.3/P3H.1 | Planned: fixed-date debt interest/principal examples with full, partial and zero funding; principal reduces cash and debt equally, interest remains due, excess payment capped (R02). | contract-frozen (P0) |
| CA06 | O+Q | P3D.1/P3D.2 | Planned: ordinary start through start+11 = twelve expenses/no debt; $100 0% over three fully funded dates = $33.34/$33.33/$33.33, recompute after partial payment, residual payoff once and retained debt (ADR-021). | contract-frozen (P0) |
| CA07 | O+Q | P3S.2 | Planned: per-source rate new-item 4%, editable 0/6%, $100k observed balance→$4k/$6k initial target; later-start source uses own selected-date balance, min/max/inflation and warning versus depletion (ADR-021). | contract-frozen (P0) |
| CA08 | K+Q | P2.1/P2.7 | Planned: independent account APYs/override, partial-month exponent, leap/day-31 and inclusive horizon cases; 960-month safe-cent and aggregate overflow diagnostics (PS20). | contract-frozen (P0) |
| CA09 | O+Q | P3H.2 | Planned: independent $30k held toward $60k, then explicit $30k completion into $300k property/$240k mortgage; no pending ownership costs or duplicate deposit/property, retained sale deficiency. | contract-frozen (P0) |
| CA10 | O+Q | P3S.1/P3S.3 | Planned: one obligation per dated manual/recurring occurrence, inclusive day-31 dates and partial unpaid; occurred imports remain view-only with older anchor or moved display date. | contract-frozen (P0) |
| CA11 | S+Q | P1.7 | Planned: storage/App factory and reset isolation, absent versus empty/0/false/null, local malformed recovery, future-version block without overwrite, round-trip/pruning, inactive plans, reference cleanup and liability IDs (TC05–TC08). | contract-frozen (P0) |
| CA12 | R+U+Q | P4.4/P4.5 | Planned: App/context checks for net-worth default, account-assets view, exact shortage warning versus eligible exhaustion, actual-funded previews, consistent current-dollar tooltips and frozen comparisons (GUI-A08/A10). | contract-frozen (P0) |
| CA13 | P+Q | P6.7 | Planned: fixed-date deterministic/reference-versus-optimized ordered IDs, sources, cents and closes; cancelled/stale revisions never replace accepted results (B-P1–B-P8). | contract-frozen (P0) |

## MD01–MD11 — Maintainability/documentation (refactor/maintainability_documentation_audit.md)

| ID | Owner | Task | Test/Evidence | Status |
|---|---|---|---|---|
| MD01 | S+K | P7.1/P7.3 | Planned: module/dependency review confirms one rule owner, one projection facade and one atomic state writer; search for competing financial authorities. | not-started |
| MD02 | S | P1.3 | Planned: load/edit/save/reset and marker/chain tests share one normalizer/reference registry; unrelated edits preserve fields (CA11/GUI-A09). | not-started |
| MD03 | U+R | P4.5/P5.2 | Planned: compare card/career/housing/planner previews with the same context/revision's audit and selectors (CA12/GUI-A03/A05/A07). | not-started |
| MD04 | S | P1.1 | Planned: canonical type/codec review for account IDs, units and version; consumer search and build after obsolete pool/source aliases are removed (CA11). | not-started |
| MD05 | S+K | P7.3 | Planned: search all callers before deleting duplicate/dead helpers, then compile/build and inspect remaining consumers; no assumed lint suite. | not-started |
| MD06 | S | P1.2 | Planned: two independent factory/load/reset instances plus absent/empty/0/false/null and local-error recovery tests (CA11). | not-started |
| MD07 | Q | P0.6/P7.4 | P0.6 four-percent branch and minimum-warning tests; planned independently calculated CA fixtures and review of obsolete titles/legacy setup (TC02–TC04). | not-started |
| MD08 | S+Q | P7.5 | Planned: cross-check AGENTS/CODEMAP/TEST_MAP paths and listed suites against actual runtime files after cutover; correct obsolete migration/import claims. | not-started |
| MD09 | S+Q | P7.5 | Planned: compare README diagrams and tracking route with runtime; verify documented install/dev/test/build commands and current-versus-target status. | not-started |
| MD10 | S+Q | P7.5 | Planned: source-path/link review and ADR authority/supersession audit for dated plans, snapshots and implementation docs. | not-started |
| MD11 | Q | P8.1/P8.4 | Planned: record relevant and full test/build commands and results separately from production-browser benchmarks; CI only if separately adopted. | not-started |

## PS01–PS20 — Performance/scalability (refactor/performance_scalability_audit.md)

| ID | Owner | Task | Test/Evidence | Status |
|---|---|---|---|---|
| PS01 | P | P6.2 | Planned: B-P8 run counts and cache hits for financial versus view-only edits; named-context correctness and bounded cache. | not-started |
| PS02 | S+P | P1.3/P6.2 | Planned: B-P6 timeline-count scaling, localized reference invalidation and CA11 inactive-plan preservation; no eager all-timeline recomputation. | not-started |
| PS03 | P+K | P2.6/P6.3 | Planned: B-P3 sparse date seeking and B-P4 dense E/active-schedule counts; no pre-anchor expansion. | not-started |
| PS04 | K | P2.4/P2.5 | Planned: B-P5 candidate checks K for 1/2/10/100 sources; CA03 eligibility and replenishment after earlier exhaustion. | not-started |
| PS05 | K | P2.2 | Planned: B-P5 touched-entity/sparse-overlay counts with no full-ledger copy per quote; CA03 invalid/stale atomic no-op. | not-started |
| PS06 | K | P2.3 | Planned: CA04/TC13 minimal-gross, separately rounded penalty and reconciliation properties; B-P5 high-safe inputs prove rounding-error bracket checks ≤256 candidates or emit explicit unsupported diagnostic (ADR-021). | not-started |
| PS07 | R | P4.1 | Planned: B-P2/B-P4 audit bytes per emitted event E; query full trace by source/account/month without truncation (CA02). | not-started |
| PS08 | P | P6.3 | Planned: B-P2/B-P4 worker transport latency/bytes, main+worker peak heap and paged complete-audit retrieval. | not-started |
| PS09 | P | P6.3 | Planned: B-P8 rapid revisions measure cancellation-to-stop and stale rejection; B-P1/B-P2 input responsiveness, no partial commit. | not-started |
| PS10 | S | P5.3/P6.5 | Planned: B-P6 load/edit/save size/time, quota/error/final-flush handling; assert no generated audit/cache persisted. | not-started |
| PS11 | U | P6.4 | Planned: B-P7 visible table/audit cell counts, scroll and focus latency, keyboard navigation and full-data export. | not-started |
| PS12 | U | P6.4 | Planned: B-P7 chart geometry/hover/paint latency; preserved extrema and flags, coordinated stack totals and exact detail values. | not-started |
| PS13 | U | P6.4 | Planned: B-P7 planner account/category/week index and visible-cell counts; scroll cost as weeks/categories grow. | not-started |
| PS14 | K | P2.5 | Planned: B-P2 compilation counts per career/pay-plan boundary and account rate; CA08 unchanged date/rate results. | not-started |
| PS15 | R | P4.3 | Planned: B-P2/B-P4 warning deduplication and reconciliation operation counts; CA02 monthly closing identity. | not-started |
| PS16 | U+R | P4.4/P6.4 | Planned: B-P7 current-dollar toggle/visible-window cost and reused nominal result; CA12 date/units match chart, table and tooltip. | not-started |
| PS17 | U | P6.2 | Planned: B-P8 UI-only edits reuse financial result; count React commits and recalculations without deep JSON comparisons. | not-started |
| PS18 | P | P6.3/P6.5 | Planned: B-P6 import/history/trajectory payload and parse/preview time; retained original provenance and bounded displayed preview. | not-started |
| PS19 | P | P6.1 | Planned: B-P8 hundred-edit bounded diagnostic log; B-P1/B-P2 stage metrics with p50/p95/sample count. | not-started |
| PS20 | K | P2.1/P6.7 | Planned: CA08/CA13 long-growth runtime and aggregate safe-cent cases; B-P5 high-safe inputs and explicit unsupported-range diagnostics. | not-started |

## B-P1–B-P8 — Benchmark profiles (refactor/performance_scalability_audit.md)

| ID | Owner | Task | Test/Evidence | Status |
|---|---|---|---|---|
| B-P1 | P+Q | P6.1/P6.6 | Planned: fixed-date 960-month household (12 accounts, 6 debts, 2 properties, ~30 monthly + 10 weekly items, 5 career/pay plans); production-browser echo/result/paint/cancel p50/p95, heap and CA13 reference comparison. | contract-frozen (P0.7) |
| B-P2 | P+Q | P6.1/P6.6 | Planned: fixed-date 960-month large plan (100 accounts, 50 debts, 20 properties, 250 monthly + 100 weekly items, 50 career/pay plans); E/L/K, audit/transport/render bytes, latency and peak heap. | contract-frozen (P0.7) |
| B-P3 | P+Q | P6.1/P6.6 | Planned: 1,824 months, 10,000 mostly inactive dated schedules; direct seek/active-E counts and runtime scaling as inactive definitions grow. | contract-frozen (P0.7) |
| B-P4 | P+Q | P6.1/P6.6 | Planned: 960 months with 1,000 weekly schedules; full emitted-event/audit count, peak heap, transport and cancellation under dense stress. | contract-frozen (P0.7) |
| B-P5 | P+Q | P6.1/P6.6 | Planned: 100 accounts, source lists of 1/2/10/100, zero/replenished/restricted/taxable balances and high safe amounts; K, solver iterations and CA03/CA04 correctness. | contract-frozen (P0.7) |
| B-P6 | P+Q | P6.1/P6.6 | Planned: 1/10/100 inactive timelines and 0/10/100 frozen trajectories plus history/import data; load/edit/save bytes/time, cache eviction and no eager inactive runs. | contract-frozen (P0.7) |
| B-P7 | P+Q | P6.1/P6.6 | Planned: B-P2 GUI with monthly tables, charts, planner and audit paging; DOM cells, input/hover/scroll/paint latency, view-only edits without financial rerun. | contract-frozen (P0.7) |
| B-P8 | P+Q | P6.1/P6.6 | Planned: 100 rapid sequential edits, timeline switches and cancellations; cache correctness, stale rejection, bounded logs and memory plateau. | contract-frozen (P0.7) |
