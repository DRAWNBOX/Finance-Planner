This is the Finance Planner repository. When scouting the codebase, start from the project's own map rather than reading blindly.

Start with:
- `docs/INDEX.md` — the doc map.
- `CODEMAP.md` — root code map.
- `AGENTS.md` — invariants, high-risk areas, and test focus map.

Runtime entry points (read first for orientation):
- `src/App.tsx` — composition root + tab orchestration.
- `src/engine/projection.ts` — core deterministic simulation.
- `src/financeModel.ts` — small helper set.
- `src/storage.ts` — localStorage load/save + normalizers.
- `src/types.ts`, `src/defaultScenario.ts` — schema and defaults.

High-risk areas to note when exploring: retirement withdrawal funding, monthly vs yearly conversion, career timeline/source-line normalization, housing/career/credit-card funding shortfalls, `processIncomeWaterfall`, `PaycheckInfo` net-pay math, and timeline resolution via `applyToActiveTimeline`.
