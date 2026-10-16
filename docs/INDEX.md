# Finance Planner Docs Index

Entry point for humans and LLMs. Keep the authority hierarchy in mind: **the runtime
files are the source of truth**; several docs in this folder are partly historical or
describe target state.

## Authority Hierarchy

1. **Runtime (source of truth).** `src/` — `App.tsx`, `commands.ts`, `codec.ts`,
   `storage.ts`, `types.ts`, `defaultScenario.ts`, and `src/engine/*`.
2. **Current status and evidence.** In `refactor/`:
   - [Phase 5 Handoff](../refactor/phase5_handoff.md) — state, local gates, explicit non-claims.
   - [Coverage Register](../refactor/coverage_register.md) — per-item evidence and status.
   - [Frozen Contracts](../refactor/frozen_contracts.md) — frozen interfaces/invariants.
   - [GUI Browser Coverage](../refactor/gui_browser_coverage.md) — per-G01–G40 Chromium ledger.
3. **Guides in this folder (not the runtime authority).** Useful orientation, but partly
   historical/target-state. Read them for context, not as a contract.

## Start Here

- [Architecture](./ARCHITECTURE.md)
- [Domain Model](./DOMAIN_MODEL.md)
- [Calc Engine](./CALC_ENGINE.md)
- [Money Flow](./MONEY_FLOW.md)
- [Feature Map](./FEATURE_MAP.md)
- [State Persistence](./STATE_PERSISTENCE.md)
- [Test Map](./TEST_MAP.md)

## Planning / Historical Notes

- [Legacy 4-Account Removal](./LegacyRemoval.md)
- [Manual Contribution Leak Plan](./ManualContributionLeakPlan.md)
- [Plan: Date-based Careers](./PLAN_DATE_BASED_CAREERS.md)

## Refactor Review Gates (planning; not runtime authority)

- [Refactor Documentation Index](../refactor/README.md)
- [Existing Feature Specification and Preservation Matrix](../refactor/feature_specification.md)
- [Phases and Sub-Plans](../refactor/account_cashflow_refactor_plan.md)
- [Architecture Specification](../refactor/architecture_specification.md)
- [Architecture Decisions](../refactor/architecture_decisions.md)
- [Save Format Transition](../refactor/migration_plan.md)
- [Account-Only / Pool Removal Sub-Plan](../refactor/account_only_subplan.md)
- [GUI Compatibility Audit](../refactor/gui_compatibility_audit.md)
- [Performance and Scalability Audit](../refactor/performance_scalability_audit.md)

## Cross-Repo Navigation

- [Root Code Map](../CODEMAP.md)
- [Root README](../README.md)
- [Agent/Contributor Guide](../AGENTS.md)

## Core Runtime Files

- `src/App.tsx` — composition root (commands + one projection + rendering)
- `src/commands.ts`
- `src/codec.ts` + `src/storage.ts` + `src/autosave.ts`
- `src/engine/featureHandlers.ts` + `src/engine/projection.ts`
- `src/engine/reporting.ts` + `src/engine/configuration.ts`
- `src/types.ts` + `src/defaultScenario.ts`
