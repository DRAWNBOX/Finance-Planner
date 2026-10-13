This is the Finance Planner repository. When implementing changes, follow the schema-change playbook and keep the projection deterministic.

Schema change playbook (any persisted field addition or shape change):
1. Add/adjust types in `src/types.ts`.
2. Add defaults in `src/defaultScenario.ts`.
3. Add load-time normalization in `src/storage.ts`.
4. Ensure runtime usage in `src/App.tsx` and/or `src/engine/projection.ts`.
5. Add or update tests for both engine and UI flow when behavior changes.

Rules:
- Keep projection/account math deterministic and side-effect free. The runtime source of truth for account-led math is `accountBalancesById`.
- Do not break documented invariants (ledger-based depletion, exact-APY monthly compounding, income waterfall ordering, net-pay-as-income).
- New income-funded withdrawals must route through `processIncomeWaterfall` with the pool context or they will not be validated.
- After editing, run `npm run test -- --run` and `npm run build` and fix any failures.
- Types, defaults, and storage must stay aligned.
