# Refactor Manual Review

## Purpose

This checklist records manual decisions for the broader rearchitecture. RV01–RV31 responses have been received. The response table below is authoritative; the original recommendation tables are retained as the review record, not current instructions where overridden.

- **Approve** — accept the recommendation.
- **Change** — specify different behavior.
- **Defer** — leave unresolved; affected implementation remains blocked.

You can respond using the review IDs, for example:

> RV01: Approve  
> RV06: Change — use actual paycheck dates  
> RV19: Defer

The three financial clarifications below have now been answered. Approval of contracts is not a passing test/benchmark or final cutover sign-off; engineering/schema/date/source details must remain explicit during implementation.

## Recorded responses

| Review | Response | Recorded contract / status |
|---|---|---|
| RV01 | Approve | Accepted: per-account base annual rate plus optional retirement override. |
| RV02 | Approve | Accepted: missing base rate 0%, override none; no inheritance from removed pools. |
| RV03 | Approve | Accepted: $0 opening balances, designated cash/payment account, no hidden scalar assets. |
| RV04 | Approve | Accepted: account/rate/planner configuration global; careers/purchases/loans/cards/housing timeline-local. |
| RV05 | Fund allocations in explicit configured order until net pay is exhausted; report unmet allocations. | Accepted: ordered bounded net-pay allocations, no proportional scaling or invented deposits. |
| RV06 | Approve | Accepted: configurable monthly income posting day; frequency annualizes, exact paycheck calendar requires a separate anchor. |
| RV07 | Approve | Accepted: remainder goes directly to configured account; missing/deleted destination visibly unresolved. |
| RV08 | Approve | Accepted: incoming cap overflow routed directly; existing-balance rerouting only through explicit audited cap policy. |
| RV09 | Approve | Accepted: real payroll deductions once; living spending separate; no legacy-label inference. |
| RV10 | Approve | Accepted: global payment fallback defaults, per-payment overrides, separate retirement ordered list; no implicit sweep. |
| RV11 | Change – All obligations should allow for partial spending | Accepted: every obligation partial. Clarified home case: funded down payment held as acquisition-deposit asset; full home/mortgage only after required funding complete. |
| RV12 | Approve | Reconciled with clarified RV11: zero-fund request debits nothing/is visibly unfunded, no silent postponement/retry. Partial funds are committed; incomplete acquisition remains pending with deposit, not a discarded debit or full home. |
| RV13 | Approve | Accepted: requested/paid/unpaid visible; no implicit expense debt or retry; existing liabilities retained. |
| RV14 | Approve | Accepted: cash/savings/taxable ordinarily eligible; retirement/Roth/HSA require explicit eligibility/source rules. |
| RV15 | Change - disclosed20% gain/LTCG; clarified20% of proceeds and15%, editable | Accepted:20% of gross withdrawal/debit is assumed gain,80% assumed cost; default LTCG rate15% editable per account. Effective tax3% of gross before penalties/rounding. No actual basis/statutory bracket inference. |
| RV16 | Approve | Accepted: account-level tax/penalty/age/purpose settings and explicit HSA medical qualification. |
| RV17 | Approve | Accepted: retirement spending additional to separately configured housing/card/planner obligations; clear labels, no guessed offset. |
| RV18 | Change – The user should be able to select when money withdrawal occurs | Accepted: user-controlled withdrawal timing; no forced global retirement-date schedule for every account row. See timing/basis detail below. |
| RV19 | Assume the user will have to make a lump sum payment | Accepted: unpaid 0% debt requires a lump-sum payoff obligation, not silently cleared/converted into interest. Scheduling detail below must prevent duplicate final principal payments. |
| RV20 | twelve payments, ending at start + 11 | Accepted: default ordinary card twelve inclusive payments; end=start+11 months. |
| RV21 | Agree; clarified hold deposit | Accepted: observed opening assets/debt, atomic acquisition completion/retained deficiency. Pending partial down payment is a separate valued deposit; no full home/mortgage/implicit borrowing until required funding complete. |
| RV22 | Imported historical transactions should be view only and have no effect on the planner if they have already occurred. | Accepted: occurred imported transactions are view-only, excluded from future obligations/income/assets changes. Preserve actual source date/sign; never clamp past transactions into projected future expenses. |
| RV23 | Agree | Accepted: stated same-date phases, no funding with future deposits; income-before-payment same-date assumption. |
| RV24 | Agree | Accepted: month-close post-event effective-APY growth and proportional partial months; disclosed approximation. |
| RV25 | Agree | Accepted: inclusive end months, day31 clamp, snapshot-before-events convention and stated end-age boundary. |
| RV26 | Agree | Accepted: calendar-year totals derived from months; any age-period view separately labeled. |
| RV27 | Use “eligible funding accounts exhausted” only when those accounts actually run out. Main graph: Net worth, with an account-assets view available. Separate warning: “Some scheduled payments could not be fully funded, beginning in [month].” | Accepted exactly: net-worth default graph, optional account assets, actual eligible-account exhaustion separate from unmet-payment warning. |
| RV28 | Agree | Accepted: integer cents/explicit rounding, no erased debt or silent saturation/overflow; unsupported range reported or approved exact representation. |
| RV29 | Agree | Accepted: record-local malformed recovery/diagnostics, valid siblings preserved; fully invalid JSON fresh defaults; no silent autosave loss. |
| RV30 | Agree | Accepted: async browser storage permitted when measured scale needs it; no silent data dropping. Backend choice remains engineering work. |
| RV31 | I expect 80 years of projection, with a responsive UI | Accepted requirement: support an 80-year projection (960 full months) with responsive UI. Earlier 50-year typical profile is insufficient; numeric latency/heap budgets remain measurement goals, not accepted measured promises. |

### Clarifications received

1. **Partial acquisition:** user selected “Hold deposit.” Commit funded money as an acquisition-deposit asset, keep acquisition pending, create full property/mortgage only when required funding complete. No automatic retry/additional borrowing; future funding explicitly scheduled. RV12's no-debit applies when nothing funds or transaction validation fails, not to discarding actual partial funding.
2. **Gain denominator:** user selected “20% of proceeds.” A $1,000 gross withdrawal has $200 assumed gain/$800 assumed cost; not a20% return relative to cost and not an observed basis ledger.
3. **LTCG rate:** user selected “15%, editable.” Default tax on that $200 gain is $30, leaving $970 net before penalties. A $1,000 net spending request needs approximately $1,030.93 gross/$30.93 tax under cent rounding. Editable account rate, not an inferred jurisdiction/filing bracket.

### Follow-up decisions: exact execution and withdrawal percentage

The user accepted recommendations 1–5 on minimal gross-debit quoting, penalty rounding, cumulative annual-allocation residuals, adaptive 0% card cents, and HSA age-65 treatment. The user also requires the formerly fixed “4% rule” withdrawal **rate to be configurable per source**. [ADR-021](architecture_decisions.md#adr-021--exact-cents-hsa-age-rule-and-configurable-initial-balance-withdrawal-rate) records exact testable contracts and a 4% **new-item default**, not a mandatory rate. This approval is for target behavior; none of the new finance paths or acceptance tests has been implemented merely by recording it.

HSA non-qualified spending retains configured income tax, defaults to a configurable 20% extra penalty before age 65, and has **no extra penalty from age 65 regardless of retirement status**. Explicit qualified medical spending remains tax/penalty-free. Percentage retirement spending uses the user-selected rate on that source's observed balance at its selected valuation date, which defaults to its **own first withdrawal date** (including later-start sources).

### Scheduling details (accepted defaults; implementation pending)

- **RV18:** user-selectable first withdrawal date/month/day, optional retirement/marker link and explicit percentage-rule valuation date defaulting to that source's first withdrawal date. The rate is editable per source (new-item default 4%); no forced global retirement basis or invented unavailable observation. Net-spending target versus gross/tax separate.
- **RV19:** explicit payoff date/source defaulting to final scheduled date/regular funding policy. Coincident final installment/payoff is one remaining-principal request. A user-selected later lump date pays only then-outstanding debt; retain unpaid/overdue balance, no recurring retry/duplicate principal/new income.
- **RV31:** at least 80-year support, not an assumed hard cap/default for every plan. Benchmark 960-month household/large profiles; input/scroll/cancellation must stay responsive. Account/schedule counts and reference hardware are benchmark parameters, not invented user commitments.

## Status of the original prompts

The tables below preserve the recommendations the user reviewed. Their blank decision cells are superseded by the recorded response table above. In particular, old all-or-nothing, tax-free unknown-basis, thirteen-payment and optional imported-history promotion proposals are not the current product direction.

## Already decided

These points do not need to be reviewed again unless you want to change them:

- Income deposits directly into configured accounts.
- Payments use designated accounts and eligible ordered fallbacks; split funding is allowed.
- No independent spendable monthly/yearly income reservoir.
- No general-purpose transfer workflow or individual credit-card purchase simulation.
- Ordinary cards represent expected recurring payments.
- Separate permanent-0% cards track debt, reduce it only through funded payments, and retain unpaid balances after the deadline.
- Net worth includes liabilities exactly once.
- Expense-planner entries become projected obligations.
- Retirement withdrawals represent spending.
- Standalone manual contribution controls are removed.
- Pools are removed; interest/return rates belong to accounts.
- A new save is acceptable. Obsolete fields may be pruned; missing fields receive fresh-item defaults.

---

## 1. Accounts and defaults

| Review | Decision needed | Recommendation | Your decision |
|---|---|---|---|
| **RV01** | One lifetime return rate per account, or an optional retirement override? | One base annual rate plus an optional retirement override. This preserves the existing capability without pools. | |
| **RV02** | What happens when a saved account lacks the new rate fields? | Base rate defaults to **0%**, retirement override to **none**. Do not silently inherit deleted pool settings. | |
| **RV03** | How should new plans initialize opening assets and the payment account? | Opening balances default to **$0**, with a designated cash/payment account. No hidden scalar asset balance. Final initial account list needs confirmation. | |
| **RV04** | Are accounts, account rates, and planner entries shared across timelines? | Preserve current scope: accounts/rates and planner entries are global; careers, purchases, loans, cards, and housing remain timeline-specific. Making planner entries timeline-specific would expand scope. | |

**References:** [ADR-014](architecture_decisions.md#adr-014--remove-pools-rates-and-policies-belong-to-accounts); [account-only sub-plan](account_only_subplan.md); [save plan](migration_plan.md).

## 2. Income and allocations

| Review | Decision needed | Recommendation | Your decision |
|---|---|---|---|
| **RV05** | What happens when configured savings allocations exceed net pay? | Fund allocations in explicit configured order until net pay is exhausted; report unmet allocations. Alternative: proportional scaling. Never create unfunded deposits. | |
| **RV06** | Use a monthly income posting day or simulate exact paycheck dates? | Initially use a configurable monthly posting day. Pay frequency annualizes amounts but does not imply exact weekly/biweekly dates without an anchor. | |
| **RV07** | What happens to net pay remaining after savings allocations? | Deposit it directly into a configured remainder/payment account. Missing or deleted destinations remain visibly unresolved rather than silently redirecting money. | |
| **RV08** | Should an account cap reroute only incoming deposits, or existing excess balances too? | Route incoming excess directly. Retain existing-balance rerouting only as an explicitly configured, separately audited cap policy. | |
| **RV09** | How should ordinary living expenses interact with paycheck deductions? | Actual payroll deductions reduce net pay once. Ordinary living expenses become separate account-funded obligations. Do not infer meaning from legacy line labels. | |

**References:** ADR-009/010/013 in [architecture decisions](architecture_decisions.md); CA01 in the [testing audit](testing_correctness_audit.md).

## 3. Payment funding and restrictions

| Review | Decision needed | Recommendation | Your decision |
|---|---|---|---|
| **RV10** | Global fallbacks, per-payment fallbacks, and retirement fallback order? | Global payment defaults with explicit per-payment overrides. Retirement has its own ordered account list. No automatic sweep through every account. | |
| **RV11** | Which obligations may accept partial funding? | Recurring expenses, retirement spending, and debt installments: partial allowed. Large indivisible purchases and home acquisition/down payments: all-or-nothing by default. | |
| **RV12** | What happens after an indivisible purchase cannot be funded? | Skip that occurrence with a visible shortfall; debit nothing. Do not silently postpone it. | |
| **RV13** | What happens to unpaid ordinary expenses? | Record requested, paid, and unpaid amounts. Do not automatically create debt or retry later unless explicitly modeled. Existing loan/card liabilities remain. | |
| **RV14** | Which accounts are eligible for automatic fallback? | Checking/savings/taxable accounts ordinarily eligible; retirement/Roth/HSA require explicit eligibility/source configuration. Exact account rules remain configurable. | |
| **RV15** | How should brokerage withdrawals work when cost basis is unknown? | Never tax all proceeds as gains. Choose either an explicit gain assumption/required basis, or a clearly disclosed no-inferred-tax assumption. Current draft proposes the latter. | |
| **RV16** | Confirm retirement/HSA tax, penalty, purpose, and age rules. | Account-level configurable assumptions. Explicit medical qualification for HSA spending; no qualification inferred solely from a category label. Existing age-related behavior must be reconciled deliberately. | |

**References:** ADR-007/008 in [architecture decisions](architecture_decisions.md); CA03–CA05 in the [testing audit](testing_correctness_audit.md).

## 4. Retirement, cards, housing, and imports

| Review | Decision needed | Recommendation | Your decision |
|---|---|---|---|
| **RV17** | Does retirement spending include separately scheduled housing/cards/planner expenses? | Treat them as additional configured obligations. Label retirement spending clearly so users can reduce that budget when necessary; no automatic offset guessing. | |
| **RV18** | When is an initial 4% retirement target calculated for a source that starts later? | Current draft calculates at the retirement target date and escalates afterward. Confirm this versus calculating at each source's withdrawal start date. | |
| **RV19** | Should a 0% card continue payments automatically after its target date? | Retain debt and warn, but require extending the target or adding an explicit payoff obligation. No automatic interest or fees. | |
| **RV20** | What is the default ordinary-card duration? | Choose an explicit payment count. The current draft's `start month + 12` end produces **13 inclusive monthly payments**. Suggested default: twelve payments, ending at `start + 11`. | |
| **RV21** | How should existing property/mortgage balances and underwater sales work? | Enter observed opening property value/debt instead of assuming all past payments occurred. Acquisition is atomic. An underwater sale retains an explicit deficiency liability. | |
| **RV22** | Should imported historical transactions become obligations automatically? | No. Manual planner entries project by default; imported history remains review/tracking data until explicitly promoted. Preserve source dates/signs and use explicit links for duplicated views. | |

**References:** ADR-003/004/006/011 in [architecture decisions](architecture_decisions.md); CA06/CA07/CA09/CA10 in the [testing audit](testing_correctness_audit.md).

## 5. Timing and reporting

| Review | Decision needed | Recommendation | Your decision |
|---|---|---|---|
| **RV23** | What is the same-date execution order? | Contractual accruals, income, explicit cap policy, mandatory obligations, discretionary/extra payments, then closing valuation. Future deposits cannot fund earlier payments. Same-day income-before-payment is an explicit approximation. | |
| **RV24** | When should account growth be applied? | Current draft: month close on post-event balances, effective monthly APY, with proportional partial-month treatment. This excludes spent funds but gives deposits full active-period growth. Confirm this approximation. | |
| **RV25** | How should date boundaries work? | Inclusive scheduled end months; monthly day 31 clamps to month end; opening snapshots precede modeled events on their date. Confirm these conventions and the end-age/horizon boundary. | |
| **RV26** | Calendar-year reports or age-based periods? | Calendar-year totals from actual monthly results. Keep age-based grouping only as a separately labeled view over the same data. | |
| **RV27** | What should the primary graph and “runs out of money” summary mean? | Distinguish account assets, net worth, liquidity exhaustion, and unmet obligations. Do not use negative net worth or positive property equity as interchangeable measures of spendable money. Primary metric/summary wording needs selection. | |
| **RV28** | Confirm precision and unsupported-range behavior. | Integer-cent postings with explicit rounding. Never erase residual debt or silently cap/wrap large balances. Report unsupported numeric range unless an exact larger-number representation is approved. | |

**References:** ADR-010/012/016 in [architecture decisions](architecture_decisions.md); CA02/CA08/CA12/CA13 in the [testing audit](testing_correctness_audit.md).

## 6. Persistence and performance

| Review | Decision needed | Recommendation | Your decision |
|---|---|---|---|
| **RV29** | What happens when one saved record is malformed? | Recover/default the affected record with diagnostics; preserve valid siblings. Entirely invalid JSON receives fresh defaults. Autosave must not silently overwrite a valid plan with a broad fallback. | |
| **RV30** | May large saves/audit artifacts use asynchronous storage? | Retain simple storage where measured sizes permit it; allow IndexedDB or another asynchronous browser store when needed. Do not silently drop valid data to satisfy a storage limit. | |
| **RV31** | What scale and responsiveness should be supported? | Review household and large-plan profiles before adopting the proposed budgets: household fresh result ≤250 ms, large plan ≤2 s, with responsive input. Specify target hardware and expected account/schedule/timeline counts. These are not measured promises. | |

**References:** ADR-018 in [architecture decisions](architecture_decisions.md); [save plan](migration_plan.md); [performance audit](performance_scalability_audit.md).

---

## Engineering work—not additional product decisions

The agent should perform these after the relevant contracts and implementation phase are approved:

- Exercise the actual percentage branch in the 4% test.
- Reproduce and correctly classify the existing loan-row failure.
- Add financial acceptance CA01–CA13.
- Implement independent defaults and consistent load/edit/save/reset normalization.
- Ensure new account settings survive unrelated GUI edits.
- Replace independent financial previews with authoritative results.
- Deep-clone new nested timeline/plan policies.
- Preserve chronological ordering, atomicity, exact funding, and the complete audit.
- Remove superseded helpers only after consumer verification.
- Refresh runtime documentation after the corresponding code is implemented.
- Execute GUI and performance checks and report actual results.

## Manual sign-off after implementation

- [ ] Representative paycheck, allocation, and retirement scenarios produce the expected account changes.
- [ ] Failed purchases and partial debt payments are displayed correctly.
- [ ] Ordinary and 0% card behavior matches the reviewed rules.
- [ ] Planner expenses and imported data behave as intended.
- [ ] Assets, liabilities, net worth, and liquidity warnings are clearly distinguished.
- [ ] Dates, current-dollar displays, and saved comparisons are understandable and consistent.
- [ ] Save/reload/reset preserves intended values and reports recovery failures.
- [ ] The application is responsive at the agreed scale.
- [ ] Intentional financial changes from the original baselines are documented.
- [ ] Required tests/build pass, and any remaining exceptions are explicitly reviewed.

## Implementation authorization

Resolving review items does not mark tests or benchmarks as passed.

- [x] Required decisions above are recorded in the decision log.
- [x] Corresponding architecture/default/test contracts are updated (Phase 0: frozen_contracts.md, coverage_register.md, projection.test.ts P0.6 edits).
- [x] Incremental implementation is authorized (ADR-022, 2026-10-14); current consumers may be removed and intermediate App/build/tests may be broken until all phases complete. Record every check's actual result.
- [ ] Final cutover is authorized only after required verification and manual sign-off.

Phase 0 authorization (2026-10-13): readiness, baseline triage and contract freeze (P0.1–P0.7) are authorized and complete; no financial math replaced. Baseline loan-row failure reproduced and left unresolved (Phase 5). Frozen contracts: refactor/frozen_contracts.md (9 blockers **at Phase-0 close**, subsequently addressed in D1–D4/ADR-021). Coverage register: refactor/coverage_register.md. Phase 1+ implementation was still gated **at that time**.

Implementation authorization (2026-10-14): the user permits direct removal of current consumers and temporary program/build/test breakage through the dependent implementation phases. Phase 1 may begin under `implementation_plan.md` and `phase1_plan.md`; full product behavior, exact verification and a working release remain the Phase-8 sign-off, not a claim made by this authorization.
