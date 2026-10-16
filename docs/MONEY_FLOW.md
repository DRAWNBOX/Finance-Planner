# Money Flow

How money moves through the projection engine. Entry point:
`projectFeatureScenario` (`src/engine/featureHandlers.ts`), which composes the
streams and delegates to `projectScenario` (`src/engine/projection.ts`).

There is **no income reservoir or pool**. Payroll posts net pay into its
configured destination accounts, and obligations are then funded from live
account balances in the same ordered, partial way. Every value is integer cents,
and every mutation is exactly one `state.commitChanges` call.

```mermaid
flowchart TB
  classDef src fill:#e8f5e9,stroke:#2e7d32,color:#000;
  classDef route fill:#e3f2fd,stroke:#1565c0,color:#000;
  classDef acct fill:#f3e5f5,stroke:#6a1b9a,color:#000;
  classDef debt fill:#ffebee,stroke:#c62828,color:#000;
  classDef out fill:#eceff1,stroke:#546e7a,color:#000;
  classDef res fill:#fffde7,stroke:#f9a825,color:#000,stroke-width:2px;

  subgraph IN["1. Money in"]
    direction TB
    S1["Opening observation<br/>resolveOpening - opening.ts"]:::src
    S2["Payroll net pay<br/>income.ts: gross - tax/benefits - employee 401k/HSA"]:::src
    S3["Employer 401k/HSA + ordered net allocations + remainder<br/>income.ts"]:::src
    S4["Other income + rental income / sale proceeds"]:::src
    S5["Account growth at close<br/>valuation.ts - exact APY"]:::src
  end

  subgraph ST["Live state (integer cents)"]
    PL["accounts / liabilities / properties / held deposits<br/>state.ts - mutated only via state.commitChanges"]:::res
  end

  subgraph ROUTE["2. Routing"]
    W["Funding kernel - quoteFunding / commitFunding<br/>ordered primary-first account sources"]:::route
    R["Retirement: pinned explicit ordered list<br/>source account -> per-source fallbacks -> global retirement fallbacks"]:::route
  end

  subgraph SINK["3. Money out"]
    D1["Cards - cards.ts<br/>ordinary expected-payment / permanent-0%"]:::debt
    D2["Loans + mortgage - loans.ts<br/>interest-first, nominal APR/12"]:::debt
    D3["Housing groups - housing.ts<br/>P&I/rent, tax+ins, HOA/maint, PMI"]:::debt
    D4["Planner / living / long-term - planner.ts, spending.ts"]:::out
    D5["Retirement spending - retirement.ts"]:::out
    D6["Purchases + cashflow / life-event outflows"]:::out
    D7["Tax + penalty on withdrawals (withheld once)"]:::out
  end

  S1 --> PL
  S2 --> PL
  S3 --> PL
  S4 --> PL
  PL --> S5
  S5 --> PL
  PL --> W
  PL --> R
  W --> D1
  W --> D2
  W --> D3
  W --> D4
  W --> D6
  R --> D5
  W --> D7
  PL --> OUT["Cents-only ProjectionRun -> one ProjectionReport<br/>charts, table, warnings"]:::out
```

## Reading the Diagram

- **Money in.** The opening observation seeds the accounts. Payroll posts net pay
  directly to destination accounts (employee/employer retirement and HSA lines
  post separately; ordered net allocations and the remainder follow the active
  plan). Other income, rental income and sale proceeds deposit to their
  configured accounts. Accounts grow at month close by the exact APY.
- **No reservoir.** Net pay never lands in a monthly or yearly income pool. A
  spending obligation is funded from account balances through the funding kernel.
- **Routing.** `quoteFunding` selects eligible sources in configured order,
  primary first and deduplicated; `commitFunding` posts one sparse change set
  through `state.commitChanges`. Retirement uses a fully pinned explicit ordered
  list and never consults the global policy.
- **Money out.** Each stream owns its obligation. Partial and unfunded outcomes
  are reported, never retried; tax and penalty are withheld from gross once.
- **Reporting.** The frozen run's postings are read once to build one report.

## Blocks to Code

| Block | Code | Notes |
| --- | --- | --- |
| One projection path | `projectFeatureScenario`, `src/engine/featureHandlers.ts` | Selects one timeline, composes four streams, builds one report |
| Kernel facade | `projectScenario`, `src/engine/projection.ts` | Kernel-only; returns a cents-only `ProjectionRun` |
| Opening observation | `resolveOpening`, `src/engine/opening.ts` | Seeds state; start date is the observation date |
| State mutation | `commitChanges`, `src/engine/state.ts` | Sole mutation route; revision-checked, all-or-none |
| Scheduler | `createScheduler`, `src/engine/scheduler.ts` | Lazy month batches in `accrual → income → cap → mandatory → discretionary → close` |
| Payroll / net allocations | `src/engine/income.ts` | Posts net pay to destination accounts; date-based raises |
| Spending / planner / retirement | `src/engine/spending.ts`, `planner.ts`, `retirement.ts` | Obligations + retirement withdrawals |
| Cards / loans / housing | `src/engine/cards.ts`, `loans.ts`, `housing.ts` | Debt and property obligations |
| Ordered funding | `quoteFunding` / `commitFunding`, `src/engine/funding.ts` | Primary-first, eligible, deduplicated, partial; no sweep/borrow/retry |
| Tax / penalty | `src/engine/taxes.ts` | Gross = net + tax + penalty, withheld once |
| Valuation | `src/engine/valuation.ts` | Exact-APY account growth, nominal debt accrual, appreciation |
| Report | `buildProjectionReport`, `src/engine/reporting.ts` | One immutable report read once from the run |
