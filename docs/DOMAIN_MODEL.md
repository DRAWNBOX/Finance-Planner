# Domain Model

Primary interfaces live in `src/types.ts`.

## Scenario

`Scenario` is the top-level planning object. It includes:

- `profile`: current age, retirement age, retirement years
- `options`: date-based age options
- `portfolio`: base portfolio settings
- `contribution`: non-career yearly contribution plan
- `careerPlan`: timeline entries
- `netWorth`: starting balances + as-of date
- `futureRetirement`, `withdrawal`, `manualReturns`
- `cashflowItems`, `lifeEvents`

## CareerEntry

Each career entry represents a timeline segment:

- Ages and label: `startAge`, `endAge`, `label`, `enabled`
- Income behavior: salary, raises, bonus
- Account source lines (`sourceLines`) define contribution/withdrawal behavior for dynamic pools/accounts.
- `taxInfo` drives income-funded purchases/loans:
  - `untaxedBenefits`, `taxRate`, `leftoverIncome` — tax/savings math
  - `otherExpenses` — subtracted from leftoverIncome before computing `monthlyTakeHome`
  - `monthlyTakeHome = max(0, (leftoverIncome - otherExpenses) / 12)`

## Projection Outputs

- `ProjectionYear`: per-age computed data (balances, salary, withdrawals, account balances, returns)
- `ProjectionResult`: list of years + summary, depletion info, end-age, and per-career ending account balances
- `ProjectionYear.accountBalancesById` is the primary runtime account output map.
