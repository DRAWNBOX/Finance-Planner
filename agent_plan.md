# Finance Planner — Agent Implementation and Architecture Plan

## Mission
Review the current finance planner implementation, document and preserve its existing features, and continue designing a reliable account-based cashflow and long-horizon projection architecture. Refactoring and architectural changes are permitted, but **do not silently remove, simplify away, or change existing user-facing functionality**. Treat the architecture described here as an agreed direction, **not a complete specification**.

## Mandatory Pre-Step 0 — Inspect the Existing Codebase Before Designing or Editing

1. Inventory the repository: application entry points, finance calculation modules, data models, persistence, UI, tests, fixtures, migrations, and reporting.
2. Trace the current end-to-end calculation path from user inputs and starting balances through monthly simulation, yearly aggregation, and charts/warnings. Locate and inspect (or identify equivalents for):
   - `netWorth.history` and seeded starting snapshots
   - `monthlyTakeHome` and payroll deductions
   - `processIncomeWaterfall`
   - `monthAvailableIncome` and `availableIncome`
   - `accountBalancesById` / `ledgerAccounts`
   - `applyNetTargetWithdrawal`, retirement source priorities, and `monthlyRetirementLines`
   - `applyMonthlyGrowth` and APY handling
   - Credit card payment modes (`autopay`, `minimum`, `payInFull`, `fixedPlusLump`) and end dates
   - Housing, mortgages, rent, taxes, insurance, HOA, maintenance, PMI, home sales
   - Loans, amortization, down payments
   - Large/long-term planned expenses, cashflow items, life events, rental income
   - Retirement/HSA deposits, employer matching, career contributions
   - `MonthlySnapshot`, `ProjectionYear`, charts, tables, and warnings
3. For every identified feature, document its input fields, configuration, calculation logic, execution timing, affected accounts, outputs, dependencies, and edge cases. Distinguish observed behavior from intended behavior and suspected defects.
4. Identify all places that mutate account balances or independently calculate income available to spend. Trace potential double-counting, bypasses, and timing differences; **do not presume the diagram proves a bug**.
5. Run existing tests and baseline sample projections before making changes. Preserve representative inputs/outputs as regression fixtures. Record failures that predate the refactor.
6. If the repository or needed code is unavailable, stop at an explicit access/request checkpoint rather than inventing findings.

### Required Pre-Step Deliverable — `refactor/feature_specification.md`
Create a detailed **Existing Feature Inventory, Specifications, and Preservation Checklist** from the actual code, before implementation. Include:

- Feature ID, name, purpose, current behavior, relevant files/functions, user-configurable inputs/defaults, and output/reporting behavior.
- Dependencies and financial assumptions, including order of operations, date handling, rounding, tax treatment, and funding eligibility.
- Feature status: **confirmed in code / partially implemented / unclear / missing / suspected defect**.
- Preservation decision: **retain unchanged / retain with corrected behavior / redesign with equivalent capability / proposed removal requiring approval**.
- Test cases and acceptance criteria for each feature, including existing edge cases.
- A traceability matrix linking each current feature to the proposed module, migration action, and regression test.
- A separate section for newly agreed requirements from this plan, distinguishing them from observed existing functionality.
- Explicit open questions and discrepancies for user validation; do not infer answers from incomplete evidence.

**Gate A:** Review and validate the feature specification and the preservation matrix before destructive rewrites. Do not treat a missing item in this plan as permission to delete a feature.

## Confirmed Product Rules and Scope

1. This is a **projection-oriented account-based financial planner**, not a transaction-level personal purchase tracker.
2. Income goes **directly into configured accounts**. There is no independent spendable monthly/yearly income reservoir and no general-purpose inter-account transfer workflow.
3. Scheduled expenses, planned large expenses, obligations, and payments are **funded from a designated purchase/payment account** with eligible fallback accounts. **Split funding is allowed**: one obligation can debit multiple accounts in priority order.
4. There are **no simulated individual credit-card purchases**. Ordinary credit cards represent expected recurring monthly payments, continuing until their configured end date; their actual balances and purchase activity are not tracked.
5. A separate **0%-interest credit card** type has a fixed initial balance, zero interest, and a target payoff/end date. Its scheduled payment is initially a linear payoff (balance divided by remaining scheduled months). Track its remaining liability; only actual funded payments reduce it. Recalculate remaining required payments after a shortfall to aim for the original target date; if unpaid at the deadline, retain the liability and warn rather than deleting it.
6. **Include the outstanding 0% card balance as a liability in net worth.** If already represented in the starting snapshot, do not create a duplicate liability.
7. Other existing features (retirement, HSA, employer matching, housing, mortgages, loans, cashflow/life events, rental income, growth, taxes, reporting, etc.) must be audited and retained or explicitly reconciled with the new design.
8. Do not implement a full general-purpose double-entry bookkeeping product unless code review shows it is necessary. Maintain reliable, auditable account and liability changes instead.

## Proposed Target Architecture — Continue to Design

The following is a starting decomposition, not a finalized implementation contract:

- **Configuration and event scheduler:** Convert careers, income, recurring payments, retirement, housing, loans, large planned expenses, and life events into time-stamped/month-scoped events.
- **Income processor:** Calculate gross pay, payroll taxes/benefits/employee retirement/HSA deductions, net pay, employer contributions, rental/other income, and direct deposits to designated accounts. Avoid counting pre-payroll deductions twice or subtracting living expenses from net paycheck.
- **Account state manager:** Authoritative runtime balances for cash, savings, brokerage, retirement, HSA, and relevant assets; separate liabilities for loans/mortgages and 0% card payoff balances. Preserve opening balance provenance and historical snapshots.
- **Scheduled payment engine:** Generate obligations for ordinary expected credit-card payments, 0% card payoff, housing, loans, recurring expenses, planned large expenses, and other existing outflows. No credit-card purchase ledger.
- **Split-funding resolver:** Plan account debits against a primary payment account and ordered eligible fallbacks, honoring restrictions, liquidity, taxes, penalties, and availability. Calculate gross withdrawal versus net spendable proceeds where relevant. Record allocation breakdown and shortfalls.
- **Balance and valuation engine:** Investment growth, savings interest, property valuation, debt interest/amortization, and other non-cash changes. Use the correct effective monthly rate for APY: `(1 + APY)^(1/12) - 1`, if APY is an effective annual yield.
- **Projection and reporting:** Generate monthly account snapshots, annual aggregations, net worth, cashflow summaries, and warnings from authoritative state. Annual views must never independently spend the same income already used in monthly calculations.

### Critical Implementation Semantics to Design Explicitly

- **No intermediate transfers for ordinary funding:** Each allocation directly reduces its funding account; any special withdrawal/payment mechanics must be modeled clearly without fictitious duplicate income.
- **Atomic funding:** First calculate and validate the full funding plan; then commit debits and related liability changes together. If an all-or-nothing obligation cannot be funded, do not partially debit accounts. Define which obligations can accept partial payments.
- **Primary-first fallback:** Use available funds from the selected account, then ordered eligible fallback accounts, possibly splitting one payment among several sources. No silent negative balances, implicit borrowing, or use of restricted accounts.
- **Taxes/penalties:** Distinguish gross account withdrawal, net amount applied to payment, withholding, and additional tax/penalty expense. Model retirement and brokerage rules according to existing requirements and explicit assumptions; do not apply a blanket tax to all brokerage withdrawal proceeds.
- **Debt accounting:** A funded loan/0%-card principal payment reduces both cash assets and the corresponding liability. Interest and fees reduce net worth separately. An ordinary expected credit-card payment is a cash expense because its actual balance is not modeled.
- **0% card timing:** Define inclusive/exclusive end-date behavior, payment month count, rounding/final cents, early payoff, missed payments, funding shortfalls, and what happens after the target payoff date.
- **Event order:** Define monthly (and, if needed, within-month) ordering for opening balances, growth/accruals, income, mandatory obligations, fallback withdrawals, discretionary payments/deposits, closing state, and snapshots. Do not allow a convenient processing order to override real due dates or produce impossible cash availability.
- **Net worth:** Assets minus liabilities; include 0% card outstanding balance exactly once. Separate transfers/principal repayment from income, expenses, and valuation changes.
- **Audit trail:** For each simulated event, retain source, date, requested amount, executed amount, funding allocations, taxes/penalties, resulting balance changes, shortfall, and any warnings.
- **Determinism:** Identical inputs and assumptions must yield identical results, including stable ordering and rounding rules.

## Suggested Interfaces (Illustrative, Not Final)

```ts
interface FundingRequest {
  id: string;
  amount: number;
  primaryAccountId: string;
  fallbackAccountIds: string[];
  allowPartialFunding: boolean;
  category: string;
}

interface FundingAllocation {
  accountId: string;
  grossDebit: number;
  netFunded: number;
  taxes: number;
  penalties: number;
}

interface FundingResult {
  requestedAmount: number;
  fundedAmount: number;
  shortfall: number;
  allocations: FundingAllocation[];
  status: 'funded' | 'partial' | 'unfunded';
}
```

Revise these interfaces after code review. Prefer the project's existing language, types, and conventions. Monetary calculations should use an explicit precision and rounding policy.

## Architectural Work Still Required — Do Not Skip

1. Produce `refactor/architecture_specification.md`: existing architecture, proposed architecture, data ownership, account/liability schemas, event lifecycle, component contracts, and flow diagrams.
2. Specify how direct deposits and account-designated payments replace `monthAvailableIncome` / `availableIncome`, while preserving any useful budgeting/reporting metrics as **derived values**.
3. Decide account eligibility, liquidity rules, fallback priorities, retirement source exhaustion, tax-aware withdrawal calculations, and whether fallback priorities are global or per obligation.
4. Specify ordinary credit-card schedules versus 0%-card liability payoff; reconcile any legacy card modes discovered in the code with user-facing feature preservation.
5. Define handling for failed/partial payments, postponed or indivisible planned expenses, negative balances, missed loan payments, and warnings.
6. Define exact timing of income, accruals, growth, housing transactions, taxes, and withdrawals; monthly aggregation and year boundaries.
7. Design opening snapshot migration, legacy configuration compatibility, existing saved plans, output schema compatibility, and rollback strategy.
8. Record tradeoffs and unresolved decisions in `refactor/architecture_decisions.md`; present substantive changes in financial behavior for validation before implementation.

**Gate B:** Validate the architecture, behavior changes, and migration plan against the feature specification. Continue architectural iteration until gaps are resolved; do not jump straight from this plan into wholesale rewrites.

## Implementation Sequence (After Gates A and B)

1. Add baseline characterization tests and financial invariants for existing behavior.
2. Introduce authoritative account/liability state and event/obligation types behind compatibility adapters.
3. Implement direct income deposits and remove independent spendable pool behavior, preserving derived reporting metrics.
4. Implement atomic, split-account funding with eligibility, tax-aware gross/net calculations, and shortfall reporting.
5. Migrate ordinary credit-card expected-payment schedules and 0%-card payoff/liability behavior.
6. Integrate existing retirement/HSA, housing, loans, large planned expenses, life events, rental income, and valuation calculations through the new interfaces.
7. Rebuild monthly snapshots and annual reports from the new state; preserve charts, warnings, and user-facing outputs.
8. Migrate persisted plans/snapshots, verify backwards compatibility, and remove superseded paths only after tests and review.
9. Update documentation, diagrams, and the feature traceability matrix with actual implementation status.

## Required Verification and Acceptance Tests

- A dollar of income is deposited/allocated once; payroll deductions, employee retirement/HSA contributions, and employer matching are not duplicated.
- Monthly and yearly reports reconcile; annual income is not independently available for a second round of spending.
- One payment can split across primary and multiple fallbacks; exact funding allocations sum to the net amount paid.
- All-or-nothing obligations do not partially debit accounts when funding fails; partial-allowed obligations debit only what is funded.
- Unfunded obligations create visible shortfalls; no silent negative balances or phantom transfers.
- Tax-aware withdrawals correctly distinguish gross debit from net funded amount and record applicable tax/penalty effects.
- Ordinary credit cards produce scheduled expenses until the configured end date without creating fictitious tracked balances.
- 0% cards begin with the correct liability, reduce it only by actual funded payments, adapt remaining payments after shortfalls, and retain/warn about unpaid balances after the deadline.
- A 0% card already included in the opening snapshot is not double-counted.
- Debt principal payments do not create a second net-worth expense; interest/fees do.
- Investment gains update account value but are not automatically treated as spendable deposited income.
- Existing housing, retirement, loans, cashflow/life events, career, rental, planned expense, tax, and reporting features retain validated functionality.
- Historical snapshots and saved plans remain usable or have a tested migration path.
- Reconciliation holds each month: closing balances = opening balances + applicable posted changes; net worth = assets − liabilities.
- Deterministic projections and edge-case tests: zero balances, insufficient funds, account exhaustion, leap years/date boundaries, early payoff, rounding, and long projection horizons.

## Agent Working Rules and Deliverables

- **Inspect first, specify second, architect third, implement fourth, verify fifth.**
- Do not assume this conversation's Mermaid flowchart is a complete or perfectly accurate representation of code; use it as a hypothesis to verify.
- Maintain a running issue/risk register and a current-vs-target feature mapping.
- Do not delete legacy behaviors merely because they are absent from this summary. Surface conflicts and obtain decisions.
- Favor incremental changes with tests and reversible migrations over a single unvalidated rewrite.
- Required artifacts: `refactor/feature_specification.md`, `refactor/architecture_specification.md`, `refactor/architecture_decisions.md`, regression/acceptance tests, migration plan, and updated system flow diagrams.
- At the end of each phase, summarize verified findings, decisions, unresolved questions, affected files, test status, and the next architectural or implementation step.

## First Action for the Agent

**Begin with Pre-Step 0. Read the current repository and create `refactor/feature_specification.md` grounded in actual code. Do not begin implementation yet. After validating the feature inventory, continue architecting the software and produce the detailed architecture specification and decision log for review.**
