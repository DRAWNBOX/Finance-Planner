# State Persistence

Persistence is handled by `src/storage.ts` with local storage key:

- `finance-planner-state`

## Load Path

- `loadAppState()`:
  - reads from local storage
  - supports older payload shapes (`scenario` wrapper or direct)
  - merges with defaults from `defaultScenario`
  - normalizes career entries (age ordering, flags, contribution fields, start-balance modes, monthly withdrawals)
  - normalizes active tab values (`events`/`futureRetirement` -> `careers`)

## Save Path

- `saveAppState(state)` writes full `scenario` + `ui`.

## Backward Compatibility Principles

- New fields should be optional in type until normalized.
- Normalize missing numeric fields with safe defaults.
- Keep migrations in `storage.ts` as deterministic pure transforms.

## Practical Rule For New Fields

When adding a new persisted field:

1. Add to `types.ts`.
2. Add default in `defaultScenario.ts`.
3. Add normalization fallback in `storage.ts`.
4. Add normalization in runtime path if needed (`App.tsx`).
