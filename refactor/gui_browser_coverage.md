# GUI Browser Coverage Ledger — G01–G40

Owner: docs/evidence lane. This is the **per-G browser coverage ledger** for the
account-only Phase-5 candidate. It records, for each GUI-compatibility row in
`refactor/gui_compatibility_audit.md`, what the **real Chromium** `e2e/**` suite
actually asserts today, and the exact assertion that is still missing.

## Scope and honesty

- **Source of row definitions:** `refactor/gui_compatibility_audit.md` §2 (G01–G40)
  and the "Acceptance checklist linked to GUI IDs" (GUI-A01–A10, lines 183–196).
- **Evidence source:** the `e2e/**` Playwright specs (26 spec files, **45 tests**)
  run with `npm run test:e2e -- --project=chromium` against the real Vite dev
  server. Expected values are hand-computed from fixed inputs, never read back
  from report output.
- **This ledger is not certification.** The browser suite is a **bounded local
  gate**: it is **not** CI-wired, it is **not** run row by row, and it does
  **not** certify the GUI-A01–A10 / G01–G40 or CA01–CA13 matrices. Vitest
  remains the per-item owner (see `refactor/coverage_register.md`). When the
  ledger says "browser slice exercised", it means one real Chromium flow covers
  part of the row — not that the whole row passed.
- A row is **never** marked complete merely because a component mounted.

### Status legend

| Status | Meaning |
|---|---|
| `browser slice exercised` | A real Chromium spec asserts a meaningful slice of this row (specific value/behaviour), but the row's full acceptance is not covered. |
| `partial` | Browser evidence only touches part of the row; a substantial declared capability is still unasserted in-browser. |
| `unasserted` | No Chromium assertion exists for this row (Vitest/RTL may cover it; browser does not). |
| `deferred by accepted monthly-resolution/placeholder` | The row's browser behaviour is intentionally not a funded forecast or is a known placeholder, per an accepted decision. |

### Spec inventory (26 files / 45 tests)

| Spec | Tests |
|---|---|
| `smoke.spec.ts` | 3 |
| `accounts-careers.spec.ts` | 3 |
| `trajectory-accessibility.spec.ts` | 2 |
| `obligations-planner.spec.ts` | 3 |
| `cards-d16.spec.ts` | 2 |
| `display-consistency.spec.ts` | 2 |
| `housing-outcomes.spec.ts` | 2 |
| `markers-timelines.spec.ts` | 2 |
| `trajectory-legacy.spec.ts` | 2 |
| `account-reference-guards.spec.ts` | 2 |
| `cards-crud.spec.ts` | 1 |
| `networth-signed.spec.ts` | 1 |
| `purchases-partial.spec.ts` | 2 |
| `planner-editing.spec.ts` | 2 |
| `account-policy-order.spec.ts` | 1 (new) |
| `career-payroll-destinations.spec.ts` | 1 (new) |
| `housing-group-policy.spec.ts` | 2 (new) |
| `retirement-controls.spec.ts` | 2 (new) |
| `loan-results.spec.ts` | 2 (new) |
| `loan-interest-payoff.spec.ts` | 1 (new) |
| `funding-order-editor.spec.ts` | 2 (new) |
| `opening-snapshot-history.spec.ts` | 1 (new) |
| `report-activity.spec.ts` | 1 (new) |
| `cards-adaptive-payoff.spec.ts` | 1 (new) |
| `retirement-outcomes.spec.ts` | 1 (new) |
| `report-account-activity.spec.ts` | 1 (new) |

**Recorded data gaps (named, not hidden):**

- **G26** — accepted **monthly resolution**: there is no weekly funded balance
  curve; the planner exposes planned weekly items plus actual selected-account
  **monthly** closes only.
- **G28** — Expenses → Tracking now renders an **"Expense history"** route that
  mounts the canonical selected-account planner (expense grid plus occurred/
  imported expenses kept view-only and separate from the projection plan). It is
  a limited route, **not** a full transaction-tracking product, and it has **no
  Chromium assertion** — browser status `unasserted`.
- **G06/G33** — **partial**: retirement-source controls and a report-backed first
  July $333.33 withdrawal share are browser-asserted (G05), but a retirement-boundary
  asset/first-year expense aggregate is not exposed in the report/UI (G06). G33 now
  shows lazy per-account audit on focus, but the 960-month tooltip-volume benchmark
  is still unmeasured. **G10**'s old local career forecast fields
  were removed by design; the browser asserts the one report's account closes.

Rows: 40 (G01–G40), each listed once under its primary GUI-A group; cross-group
references are noted in the evidence column.

---

## GUI-A01 — G01/G03/G04/G07 (accounts, rates, policies, display order)

| G ID | Chromium spec / test evidence | Status | Exact remaining assertion |
|---|---|---|---|
| G01 | `account-policy-order.spec.ts` — Checking display colour + `allowAutomaticFallback` + a Move-down display-order swap persist through `pagehide` + reload with the input-derived $300 close unchanged; `accounts-careers.spec.ts` "two account return rates and a funding-order edit survive an unrelated edit and reload" (4.5% / 7.25% base + 5.5% retirement override + global primary survive a label edit); `account-reference-guards.spec.ts` removes HSA and clears global + inactive-timeline refs, and preserves newer-version bytes through an auto edit + `pagehide` | browser slice exercised | Loan funding policies / liability snapshots / account-only source fields are not yet round-tripped through every unrelated edit (loan/name/timeline/category) at the browser level, and "no rate inheritance" is not asserted. |
| G03 | `account-policy-order.spec.ts` asserts the Accounts region has **no** "Add pool" button and **no** Pool membership combobox (anchored to the audit's own control names, never a bare word match) | browser slice exercised | None in the Accounts region; residual: confirm no pool-derived control survives elsewhere in the app (removed-by-design). |
| G04 | `accounts-careers.spec.ts` — two base `Annual return` fields + one `Retirement return` edit survive reload; `account-policy-order.spec.ts` — Checking display colour and `Allow automatic fallback=false` survive `pagehide`/reload | browser slice exercised | Other withdrawal tax/penalty and account-type eligibility settings and their funded results are not browser-asserted; per-account colour/rate controls are present. |
| G07 | `account-policy-order.spec.ts` — the Move-down swap persists and the Timeline closing net worth stays the input-derived $300 before and after reordering (display-only, does not change funding) | browser slice exercised | Separate deposit / payment / fallback order controls and the "chart/table reorder cannot change funding" rule beyond net-worth-unchanged are not asserted. |

## GUI-A02 — G02/G05/G06/G31/G39 (availability, retirement assets, summary, empty states)

| G ID | Chromium spec / test evidence | Status | Exact remaining assertion |
|---|---|---|---|
| G02 | `accounts-careers.spec.ts` "seeded plan with no enabled career still renders chart, table and warnings without crashes"; `smoke.spec.ts` navigates all four sections plus Warnings/Date markers | browser slice exercised | A retirement-only / other-income plan (no enabled career but live benefit/planner obligations) that still renders, and explicit named-context / what-if labelling, are not asserted. |
| G05 | `retirement-controls.spec.ts` — 4% default, explicit 0%/6%, account/date/valuation/payment-day controls survive reload; `retirement-outcomes.spec.ts` — selected $100,000 401K 4%-rule source shows the input-derived July $333.33 requested/committed paid from the one report without a local balance preview | browser slice exercised | Start-age/marker, HSA qualification tax/penalty and all source/basis combinations remain unasserted; no post-close balance is claimed as the 4% starting basis. |
| G06 | `retirement-controls.spec.ts` — yearly minimum $1,200 and maximum $4,800 controls persist; `retirement-outcomes.spec.ts` — one actual first-month $333.33 source share | partial | Retirement-boundary assets and first-year-expenses aggregate are not derivable from current report metadata; min/max funded effect for a two-source scenario remains unasserted. Never infer a July share from a yearly table cell. |
| G31 | `accounts-careers.spec.ts` renders chart/table/warnings on a no-income plan; `cards-d16.spec.ts` shows the D16 summary wording | partial | The summary "runs out of money" / ending-balance selector semantics versus retained liability are not asserted in-browser. |
| G39 | `markers-timelines.spec.ts` asserts no stale `dialog` and the selected housing entry stays `active` after clone/switch; `account-reference-guards.spec.ts` shows no stale selection after account removal | partial | Empty → populated → empty hook/range transitions and an active-modal deletion are not asserted in-browser. |

## GUI-A03 — G09–G15 (career, paycheck, allocations, plan copy)

| G ID | Chromium spec / test evidence | Status | Exact remaining assertion |
|---|---|---|---|
| G09 | `career-payroll-destinations.spec.ts` — the July payroll posts a percent allocation (Emergency Fund $170) and a fixed allocation (HSA $30), remainder to Checking ($1,500), with a distinct employer-match destination (Investments $50) and employee 401K ($100); `accounts-careers.spec.ts` — a dated pay-plan cap/overflow persists | browser slice exercised | Per-line source editor, raise base and "no duplicate deposit through pool conversion" beyond distinct destinations are not asserted. |
| G10 | `career-payroll-destinations.spec.ts` reads the one report's per-account closes for 2026 and the zero-payroll 2027 negative control | partial | Old local 'Starting Balance / From previous career / Balance at end of period' forecasts were removed with the pool-era editor; do not demand their revival. Named career-boundary report detail is not separately asserted in-browser. |
| G11 | `career-payroll-destinations.spec.ts` — paycheck modal `Gross / period $2,000` + `Net / period $1,700` + `Taxes $2,400`, plus the distinct per-account posting in the table | browser slice exercised | Granular per-line deposit-account editing and employee/employer identity inside the paycheck modal are not driven. |
| G12 | `career-payroll-destinations.spec.ts` — remainder lands in Checking ($1,500); `accounts-careers.spec.ts` — cap and overflow-account edit | partial | The net-pay remainder destination + requested/posted/unallocated summary and the optional deposit-day control are not asserted. |
| G13 | `accounts-careers.spec.ts` adds a dated pay plan and clones it into a timeline; `cards-crud.spec.ts` clones a timeline | partial | "Copy Pay from Previous" / duplicate-career-plan metadata clone correctness is not asserted. |
| G14 | `funding-order-editor.spec.ts` — reorders global fallbacks, changes the $100 purchase's actual $40+$60 source order, persists across reload, removes/re-adds a source without duplicates; `obligations-planner.spec.ts` pins a primary + two fallbacks | browser slice exercised | Per-obligation policy inheritance/override and restricted-account eligibility are not driven through every editor. |
| G15 | `accounts-careers.spec.ts` sets `Maximum account balance 1 = 1000` and `Overflow account 1 = HSA` and they persist | partial | Monthly-withdrawal expense rows + shortfall display and the "cap is a special policy, not an ordinary transfer" semantics are not asserted. |

## GUI-A04 — G16/G17/G35 (funding policy, purchase outcome, warnings; G14 under GUI-A03)

| G ID | Chromium spec / test evidence | Status | Exact remaining assertion |
|---|---|---|---|
| G16 | `obligations-planner.spec.ts` — the committed $200 split with exactly two "Fallback used" badges and no shortfall; `purchases-partial.spec.ts` — a $500 zero-fund purchase skips with no debit | browser slice exercised | The shared funding-policy editor (per-obligation override, eligibility list, retained-invalid reference) is not asserted. |
| G17 | `purchases-partial.spec.ts` — the $500 skip shows "Skipped · no funds debited" with no phantom `-$500`; the long-term August occurrence commits $50 of $100 with an explicit unfunded note | browser slice exercised | "Account Balance After Purchase" using the actual occurrence across all used accounts, and the compact primary + allocation detail, are not asserted. |
| G35 | `cards-d16.spec.ts` — the Warnings tab leads with the D16 shortfall and fabricates no "Fallback used" banner; `purchases-partial.spec.ts` — the first shortfall severity | browser slice exercised | A common per-obligation outcome summary (primary/fallback account, net/gross, unpaid cents, deadlines, skipped atomic events) across all obligation types is not asserted. |

## GUI-A05 — G18–G22 (loans, housing outcomes, property/debt)

| G ID | Chromium spec / test evidence | Status | Exact remaining assertion |
|---|---|---|---|
| G18 | `purchases-partial.spec.ts` — the two-month long-term plan shows July fully funded and August's $50 partial per occurrence | browser slice exercised | The final scheduled occurrence's total requested/paid/unpaid and the first fallback/shortfall split by allocation are not asserted; inclusive duration/end synchronisation is not browser-checked. |
| G19 | `loan-results.spec.ts` — linked APR-0 $1,000 debt requests $200, pays $100, shows $100 unpaid and $900 retained with −$900 signed net worth; unlinked loan shows no fabricated result; `loan-interest-payoff.spec.ts` — APR-6% loan posts $5.00 then $2.50 nominal interest and an observed August payoff | browser slice exercised | Extra-payment/down-payment UI rows and alternative term/interest shortfalls remain unasserted; no config-derived phantom payoff is claimed. |
| G20 | `housing-group-policy.spec.ts` — an explicit per-group override (Checking primary + Emergency Fund fallback) funds a $150 rent as $100 + $50 with a "Fallback used" warning and no shortfall; `obligations-planner.spec.ts` — a property-free $1,500 rent funds from Checking | browser slice exercised | Common household/group outcome aggregation across all source types and the requested/paid/shortfall + allocation tooltip are not asserted. |
| G21 | `housing-outcomes.spec.ts` — unfunded pending acquisition and underwater sale; `obligations-planner.spec.ts` — rental obligation rows | partial | The "Estimated Monthly" local quote versus the selected month's engine requested/paid/PMI/payoff comparison is not asserted. |
| G22 | `housing-group-policy.spec.ts` — clearing the rent override to explicit empty leaves the rent unpaid although the global default could pay, and the override persists through `pagehide`/reload; `housing-outcomes.spec.ts` — pending acquisition stays pending at $0 and the underwater sale retains a positive deficiency + signed negative net worth | browser slice exercised | Sale-proceeds/debt-deficiency controls and opening property/mortgage entry flows are not driven; the acquired-then-sold neutral status remains a synthetic-report unit fixture, not an end-to-end App projection. |

## GUI-A06 — G23/G24/G30/G38 (cards, chart measure, date references)

| G ID | Chromium spec / test evidence | Status | Exact remaining assertion |
|---|---|---|---|
| G23 | `cards-crud.spec.ts` — an ordinary expected-payment plan survives add/duplicate/edit/remove as the only stored plan with no fabricated `zeroInterestCard` liability, then stays isolated in a named timeline; `cards-d16.spec.ts` — a permanent-0% plan | browser slice exercised | The two-type editor discriminants (ordinary expected-payment vs permanent-0% liability identity/start/target) and obsolete-field removal are not asserted. |
| G24 | `cards-d16.spec.ts` — July 334¢ shortfall leads D16 warnings with no fabricated fallback; `cards-adaptive-payoff.spec.ts` — August's unfunded 3_333¢ installment remains owed until a dated September 6_666¢ inflow clears the 0% liability with one observed payoff (no duplicate) | browser slice exercised | The UI exposes aggregated card schedule and warning-per-unfunded occurrence, not per-month target cents; ordinary-card 12-month report requested/paid/debt alignment remains partially unasserted in-browser. |
| G30 | `display-consistency.spec.ts` — the measure selector swaps net worth ↔ account assets and the key follows; `networth-signed.spec.ts` — signed net worth with a real debt overlay | browser slice exercised | The age slider/flags and executed/skipped flag state plus aligned monthly liability dates are not asserted. |
| G38 | `markers-timelines.spec.ts` — a shared marker propagates to the base plan **and** a cloned named timeline with month/day precision; `trajectory-accessibility.spec.ts` — Date/Marker toggle | browser slice exercised | The card `introEnd`/`autopayEnd` and new ordinary/0% date-reference registry scan/delete/list are not asserted. |

## GUI-A07 — G25–G28 (planner selectors, weekly curve, recurrence, tracking)

| G ID | Chromium spec / test evidence | Status | Exact remaining assertion |
|---|---|---|---|
| G25 | `obligations-planner.spec.ts` and `planner-editing.spec.ts` use one designated funding account per planned item (`fundingSource` ordered source) | partial | The three competing account selectors (Account / Payment Account / Pay From) reconciliation and category-track vs primary-payment distinctness are not asserted. |
| G26 | `obligations-planner.spec.ts` asserts a quoted planner week $25 requested/$25 paid-all/$15 paid from selected Checking and October close $85; `planner-editing.spec.ts` moves/copies exact-date outcomes without adding a second debit; both distinguish monthly funded closes from the planned weekly grid | deferred by accepted monthly-resolution/placeholder | A true daily/weekly funded balance curve remains intentionally absent under the accepted monthly-resolution rule; threshold colouring and a recurring-exhaustion display are not browser-asserted. Do not call quoted weekly outcomes a weekly funded balance. |
| G27 | `planner-editing.spec.ts` — a keyboard move rewrites the original planned occurrence (no duplicate), a keyboard copy adds a distinct planned id, occurred imports stay view-only/unquoted, and a planned copy persists `sourceSign: null` | browser slice exercised | Drag moves/copies (only keyboard is covered) and day-31 / inclusive-date recurrence parity are not asserted. |
| G28 | none | unasserted | Expenses → Tracking renders an "Expense history" section mounting the canonical selected-account planner (expense grid plus occurred/imported expenses kept view-only and separate from the projection plan). It is a limited route, **not** a full transaction-tracking product, and no Chromium flow asserts it. |

## GUI-A08 — G08/G29/G32–G34/G36 (snapshot, charts, table, dollars, trajectory; G35 under GUI-A04)

| G ID | Chromium spec / test evidence | Status | Exact remaining assertion |
|---|---|---|---|
| G08 | `opening-snapshot-history.spec.ts` — captures exact account/liability IDs/date/measurement, records observed $0 debt over configured $300 and keeps legacy asset-only history asset-only; `networth-signed.spec.ts` — −$100 signed NW vs $0 assets | browser slice exercised | Opening property/deposit identity and history measured-on-multiple-dates remain unasserted; no legacy asset-only entry is reinterpreted. |
| G29 | `display-consistency.spec.ts` — the stacked account series and its tooltip deflate together; `networth-signed.spec.ts` — the chart key follows the measure | browser slice exercised | Same-type accounts summed once and legend/visibility reconciliation to visible accounts are not asserted. |
| G32 | `display-consistency.spec.ts` — results table Assets/Closing net worth and fixed 6% deflation; `networth-signed.spec.ts` — a $100 liability keeps the signed column at −$100 (not clamped) while assets remain $0 | browser slice exercised | Broader account/activity cents conversion and a stable row date key across clipped months are not asserted in-browser. |
| G33 | `report-activity.spec.ts` — focusable 2026 ResultsTable row reads report-committed gross $2,000/net $1,800/payroll tax $200; `report-account-activity.spec.ts` — focused Checking cell reads an actual −$100 July purchase delta from frozen byAccount, with no unrelated payroll; `networth-signed.spec.ts` keeps signed NW distinct from assets | browser slice exercised | Per-account detail is lazy/on-demand; broader tax/penalty/growth allocations remain focused-unit evidence, and 960-month tooltip-volume performance is unmeasured. |
| G34 | `display-consistency.spec.ts` — the "today's dollars" toggle deflates table + chart + stacked with the fixed 6% factor and leaves the nominal report unchanged when off | browser slice exercised | Current-dollar factor handling for liabilities/property/activity and the comparison transforms are not asserted. |
| G36 | `trajectory-accessibility.spec.ts` — canonical trajectory save/select/rename/delete/reload; `trajectory-legacy.spec.ts` — a legacy asset-only snapshot is archived and refused against canonical net worth | browser slice exercised | Overlay/diff of two canonical trajectories and the signed history-chart axes are not asserted; the legacy entry is never reinterpreted (covered). |

## GUI-A09 — G37 (timelines, clone isolation, stale state; G13/G38/G39 under GUI-A03/A06/A02)

| G ID | Chromium spec / test evidence | Status | Exact remaining assertion |
|---|---|---|---|
| G37 | `account-reference-guards.spec.ts` — HSA deletion clears global + inactive-timeline refs without redirecting to Checking; `cards-crud.spec.ts` — a card-plan clone stays timeline-local; `accounts-careers.spec.ts` — a dated plan rename is isolated; `markers-timelines.spec.ts` — clone switch leaves no stale selection | browser slice exercised | Deep-clone of new nested fallback arrays/policies beyond the card/housing/marker domains and "validate inactive links" are not fully asserted. (G13/G38/G39 are listed under GUI-A03/A06/A02.) |

## GUI-A10 — G40 (trajectory, accessibility; G36 under GUI-A08, G38 under GUI-A06)

| G ID | Chromium spec / test evidence | Status | Exact remaining assertion |
|---|---|---|---|
| G40 | `trajectory-accessibility.spec.ts` — `DateOrMarkerInput` exposes `aria-pressed` and swaps Date/Marker; `BufferedNumberInput` Escape-cancels, Enter-commits and blurs on Tab, and the committed value survives reload | browser slice exercised | Dollar→cent conversion for generic buffered inputs and the colour/category/sort widgets beyond these two controls are not asserted. (G36 is listed under GUI-A08, G38 under GUI-A06.) |

---

## Product note

Driving the new `account-policy-order.spec.ts` reorder flow initially failed on a
**real product bug**: the `AccountManagementEditor` Move up/down controls issued
multiple stale-render updates and lost the reorder. It was fixed at the owner
(`src/components/AccountManagementEditor.tsx` + `src/App.tsx`) with **one
immutable `onReorderAccounts` callback** routed through `applyGlobal`, and covered
by a new `AccountManagementEditor.test.tsx` case (+1). The focused browser retest
then passed 1/1 and that expansion's full Chromium gate 33/33. The later four
specs above added nine tests: two test-only locator/fixture adjustments (exact
withdrawal date/$900 selectors and moving a payroll into the run horizon) were
required before that expansion's full Chromium gate passed **42/42**. Three later
report-only UI slices added per-source July retirement withdrawal, lazy account-cell
activity and adaptive 0% card payoff browser checks. Their first focused run exposed
test-only fixture/locator assumptions (payroll/purchase outside horizon or wrong
source, source label living outside a retirement row, and a "does not estimate"
disclaimer matching an overbroad negative check). Those were corrected without
changing financial rules; focused 3/3, then latest full Chromium **45/45** passed.

## Non-claims

This ledger does **not** claim: a release; row-by-row certification of
GUI-A01–A10/G01–G40 or CA01–CA13; a weekly funded planner curve (G26) or the
tracking view (G28, browser unasserted); or any Phase-6 PS/B-P production-browser benchmark. The
browser suite is a bounded local gate with no CI wiring; Phase 6 owns browser
measurement and Phase 8 owns release verification (ADR-022).
