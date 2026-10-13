This is the Finance Planner repository. Before advising on architecture, refactors, or trade-offs, ground yourself in the project's own source of truth.

Load-bearing references (read as needed, in this order):
- `AGENTS.md` — core invariants and high-risk areas.
- `docs/CALC_ENGINE.md`, `docs/MONEY_FLOW.md`, `docs/DOMAIN_MODEL.md`, `docs/ARCHITECTURE.md`.
- For the account-cashflow refactor specifically: `refactor/architecture_decisions.md`, `refactor/feature_specification.md`, and the ADRs under `refactor/review/`.

Rules that are load-bearing and must not be violated by any recommendation:
- Account-led math is driven by `accountBalancesById`; the projection is deterministic and side-effect free.
- Depletion is ledger-based only (`currentLedgerSum <= 0`) — there is no net-worth floor.
- Growth compounds monthly using exact APY: `monthlyRate = Math.pow(1 + rate, 1/12) - 1`, so `(1 + monthlyRate)^12 === 1 + rate`.
- The paycheck's net pay (`monthlyTakeHome`) is the income base; every income-funded item routes through `processIncomeWaterfall`, which must preserve its per-month ordering (career contributions, credit cards, housing, loans, large purchases, long-term purchases).
- New income-funded withdrawals must carry the pool context (`monthly`/`yearly`, period key, label, budget) or they will not be validated.
- Schema changes require the playbook: `src/types.ts` -> `src/defaultScenario.ts` -> `src/storage.ts` -> `src/App.tsx`/`src/engine/projection.ts` -> tests.
