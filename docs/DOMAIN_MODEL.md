# Domain Model

Primary interfaces live in `src/types.ts`.

## Scenario

`Scenario` is the top-level planning object. It includes:

- `profile`: current age, retirement age, retirement years
- `options`: date-based age options
- `portfolio`: base portfolio settings
- `contribution`: non-career yearly contribution plan
- `careerPlan`: timeline entries
- `savingsTracker`: APY for each account
- `netWorth`: starting balances + as-of date
- `futureRetirement`, `withdrawal`, `manualReturns`
- `cashflowItems`, `lifeEvents`

## CareerEntry

Each career entry represents a timeline segment:

- Ages and label: `startAge`, `endAge`, `label`, `enabled`
- Income behavior: salary, raises, bonus, employer match
- Account source lines (`sourceLines`) define contribution/withdrawal behavior for dynamic pools/accounts.
- Legacy per-pool fields are retained only for backward compatibility with older saved states.

## Projection Outputs

- `ProjectionYear`: per-age computed data (balances, salary, withdrawals, account balances, returns)
- `ProjectionResult`: list of years + summary, depletion info, end-age, and per-career ending account balances
- `ProjectionYear.accountBalancesById` is the primary runtime account output map.
