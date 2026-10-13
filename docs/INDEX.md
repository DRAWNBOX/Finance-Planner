# Finance Planner Docs Index

This folder is the fast entry point for humans and LLMs.

## Start Here

1. [Architecture](./ARCHITECTURE.md)
2. [Domain Model](./DOMAIN_MODEL.md)
3. [Calc Engine](./CALC_ENGINE.md)
4. [Money Flow](./MONEY_FLOW.md)
5. [Feature Map](./FEATURE_MAP.md)
6. [State Persistence](./STATE_PERSISTENCE.md)
7. [Test Map](./TEST_MAP.md)

## Account Cashflow Refactor (Review Gates)

- [Refactor documentation index](../refactor/README.md)
- [Existing Feature Specification and Preservation Matrix](../refactor/feature_specification.md) — code audit, baseline evidence, risks and Gate A questions.
- [Phases and Sub-Plans](../refactor/account_cashflow_refactor_plan.md) — architecture, migration, implementation and verification work after validation.
- [Architecture Specification](../refactor/architecture_specification.md) — proposed state ownership, event lifecycle, funding and reporting contracts; Gate B draft.
- [Architecture Decisions](../refactor/architecture_decisions.md) — accepted user rules, approved manual-contribution removal, and remaining proposals.
- [Save Format Transition](../refactor/migration_plan.md) — new-save/default/pruning policy and opening liability identity.
- [Account-Only / Pool Removal Sub-Plan](../refactor/account_only_subplan.md) — per-account rates/rules, account funding priorities, reports and obsolete-field cutover; planning only.
- [GUI Compatibility Audit](../refactor/gui_compatibility_audit.md) — GUI/engine write/read trace, 40 at-risk elements, proposed integration boundary and acceptance checklist; planning only.
- [Performance and Scalability Audit](../refactor/performance_scalability_audit.md) — complexity/heap/recomputation risks, design refinements and proposed benchmark profiles/budgets; planning only.

## Cross-Repo Navigation

- [Root Code Map](../CODEMAP.md)
- [Agent/Contributor Guide](../AGENTS.md)

## Core Runtime Files

- `src/App.tsx`
- `src/engine/projection.ts`
- `src/financeModel.ts`
- `src/components/CareerPlanEditor.tsx`
- `src/components/ExpensesPlanner.tsx`
- `src/storage.ts`
- `src/types.ts`
