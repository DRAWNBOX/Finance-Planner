# Account Cashflow Refactor

Planning documents and historical baseline evidence created during this session.

Start with [audit coverage and readiness](audit_status.md) for all six requested audit areas, verified evidence, pending contracts and priority follow-up. Inspection complete does not mean target implementation/acceptance complete.

Use [the manual review checklist](review.md) to record decisions on the unresolved points before implementation.

RV01–RV31/clarifications recorded in review/ADR-019/020: home partial payments held as deposits until fully funded; taxable gain20% gross/default editable LTCG15%; user withdrawals/residual0% lump sum/twelve ordinary payments/view-only occurred imports/net-worth graph/responsive eighty years. Prior acquisition/tax ambiguities resolved; target implementation/verification still pending.

## Plans and specifications

Start implementation planning with [the consolidated parallel implementation plan](implementation_plan.md): nine phases, task-level dependencies and ownership, reusable code/ideas, feature and audit coverage, and verification gates. It consolidates the records below without marking runtime work authorized or complete.

1. [Existing feature specification and preservation matrix](feature_specification.md)
2. [Phases and sub-plans](account_cashflow_refactor_plan.md)
3. [Architecture specification](architecture_specification.md)
4. [Architecture decisions](architecture_decisions.md)
5. [Save format transition](migration_plan.md)
6. [Account-only / pool removal sub-plan](account_only_subplan.md)
7. [GUI compatibility audit](gui_compatibility_audit.md)
8. [Performance and scalability audit](performance_scalability_audit.md)
9. [Testing and correctness audit](testing_correctness_audit.md)
10. [Maintainability and documentation audit](maintainability_documentation_audit.md)

## Evidence and references

- [Original Pre-Step 0 projection baselines](fixtures/projection.pre-refactor.snap) — full inputs/outputs, including behavior subsequently changed with approval.
- [Parent agent plan](../agent_plan.md)
- [General project documentation](../docs/INDEX.md)

The approved standalone-contribution removal is implemented. The broader account-only rearchitecture remains in planning/review; the documents distinguish accepted requirements from proposals.
