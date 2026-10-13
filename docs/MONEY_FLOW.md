# Money Flow

How money moves through the projection engine (`src/engine/projection.ts`, entry point `projectScenario`, `projection.ts:509`).

The whole flow below repeats **once per month** for every simulated age. Each month starts with fresh income and draws down the same running `ledgerAccounts`.

```mermaid
flowchart TB
  classDef src fill:#e8f5e9,stroke:#2e7d32,color:#000;
  classDef route fill:#e3f2fd,stroke:#1565c0,color:#000;
  classDef acct fill:#f3e5f5,stroke:#6a1b9a,color:#000;
  classDef debt fill:#ffebee,stroke:#c62828,color:#000;
  classDef out fill:#eceff1,stroke:#546e7a,color:#000;
  classDef res fill:#fffde7,stroke:#f9a825,color:#000,stroke-width:2px;

  subgraph IN["1. Money In - sources"]
    direction TB
    S1["Starting balances<br/>seeded from netWorth.history snapshot"]:::src
    S2["Paycheck net pay = monthlyTakeHome<br/>gross - taxes - benefits - retirement - HSA - living"]:::src
    S3["Employer retirement match + HSA deposit"]:::src
    S4["Retirement withdrawals<br/>monthlyRetirementLines"]:::src
    S5["Cashflow items + life-event income"]:::src
    S6["Rental income + home-sale proceeds"]:::src
    S7["Investment growth<br/>applyMonthlyGrowth - exact APY"]:::src
  end

  subgraph RES["Reservoirs"]
    direction TB
    PM["Monthly income pool<br/>monthAvailableIncome - resets each month"]:::res
    PY["Yearly income pool<br/>availableIncome = net income x periodMonths"]:::res
    PL["ledgerAccounts<br/>accountBalancesById - runtime source of truth"]:::res
  end

  subgraph ROUTE["2. Routing"]
    direction TB
    W["Income waterfall - processIncomeWaterfall<br/>pool -> fallback acct 1 -> fallback acct 2 -> shortfall"]:::route
    WD["Account / pool withdrawal - applyNetTargetWithdrawal<br/>debit account or pool, apply tax + penalty"]:::route
    PF["Pool-priority fallback<br/>retirement source exhausted -> next pool"]:::route
  end

  subgraph SINK["3. Money Out - destinations"]
    direction TB
    D1["Retirement / HSA deposits +<br/>career source-line contributions"]:::acct
    D2["Monthly-withdrawal expenses"]:::acct
    D3["Credit cards<br/>autopay / minimum / payInFull / fixedPlusLump"]:::debt
    D4["Housing<br/>down payment + P&I/rent, tax+ins, HOA/maint, PMI"]:::debt
    D5["Loans<br/>down payment + amortized payments"]:::debt
    D6["Large + long-term purchases"]:::out
    D7["Cashflow / life-event outflows"]:::out
    D8["Taxes + penalties on withdrawals"]:::out
  end

  S1 --> PL
  S3 --> PL
  S6 --> PL
  S7 --> PL
  PL --> S7

  S2 --> PM
  S2 --> PY
  S5 --> PM

  PM --> W
  PY --> W
  S4 --> WD
  PL --> WD

  W --> D1
  W --> D3
  W --> D4
  W --> D6
  W -. "income short -> fallback accounts" .-> PL
  PY --> D5
  PY --> D6
  WD --> D2
  WD --> D5
  WD --> D8

  S4 --> PF
  PF --> WD

  D1 --> PL
  PL --> OUT["MonthlySnapshot -> ProjectionYear<br/>charts, table, warnings"]:::out
```

## Reading the diagram

- **Two reservoirs.** Net pay (`S2`) never lands in an account directly — it fills the **monthly income pool** (`PM`) and the **yearly income pool** (`PY`). Everything else accumulates in `ledgerAccounts` (`PL`), the runtime source of truth for account math.
- **Income-funded spending** (credit cards, housing, monthly purchases) draws the monthly pool through the **income waterfall** (`W`). Loans and age-only purchases draw the yearly pool.
- **Account-funded spending** (monthly-withdrawal expenses, account/pool-funded payments, retirement spending) debits the ledger through `applyNetTargetWithdrawal` (`WD`).
- **The waterfall falls back to the ledger.** When income is short, `processIncomeWaterfall` debits `incomeFallbackAccountId` then `incomeFallbackAccountId2`; if still short it records a shortfall (`incomeValidation`). That is the dotted edge `W --> PL`.
- **Retirement withdrawals** go through `WD` and, if their source pool is exhausted, hop across pools by priority (`PF`).

## Blocks to code

| Block | Code | Notes |
| --- | --- | --- |
| `projectScenario` yearly loop | `projection.ts:741` | Per age; the month loop inside is `projection.ts:837` |
| Net pay is income | `projection.ts:908` | `monthlyTakeHome = max(0, gross - deductions) / 12`; all amounts scale by `raiseFactor` |
| Retirement / HSA deposits | `projection.ts:934` | `applyAccountDeposit` to `retirementAccountId` / `hsaAccountId` |
| Career source-line contributions | `projection.ts:955` | percent of **net income**, or fixed per pay period |
| Monthly-withdrawal expenses | `projection.ts:972` | account-funded; never reduces income |
| Cashflow / life-event in-out | `projection.ts:1011` | monthly deposit to / withdrawal from `accountId` |
| Retirement withdrawals | `projection.ts:1076` | spread `planned / periodMonths`; spread across pools |
| Credit cards | `projection.ts:1121` | autopay pays `fixedPaymentAmount` through `autopayEndYearMonth` |
| Housing | `projection.ts:1381` | down payment + grouped sources (P&I/rent, tax+ins, HOA/maint, PMI) |
| Loans | `projection.ts:1615` | down payment, then monthly amortization |
| Large + long-term purchases | `projection.ts:1226`, `projection.ts:1752` | income-funded run monthly; age-only run in the yearly pool |
| Income waterfall | `processIncomeWaterfall`, `projection.ts:667` | pool clamped at 0 -> fallback 1 -> fallback 2 -> shortfall |
| Account / pool withdrawal | `applyNetTargetWithdrawal`, `projection.ts:321` | applies `taxRate` / `penaltyRate`; returns net cash |
| Pool-priority fallback | `projection.ts:1085` | retirement source exhausted -> next pool by `priority` |
| Growth | `applyMonthlyGrowth`, `projection.ts:223` | `monthlyRate = (1 + rate)^(1/12) - 1` |
| Depletion | `projection.ts:1855` | `currentLedgerSum <= 0` (ledger-based) is the only depletion trigger |
| Aggregation | `projection.ts:1538`, `projection.ts:1876` | `MonthlySnapshot` -> `ProjectionYear` |
