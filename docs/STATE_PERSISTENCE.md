# State Persistence

Two modules own persistence:

- `src/codec.ts` — pure, allowlist-only structural encode/decode (schema v3).
- `src/storage.ts` — the localStorage boundary and save guard.

localStorage key: `finance-planner-state`.

## Load Path

- `loadAppState(referenceDate?)` reads the key and calls `decodeAppState`.
- `decodeAppState` normalizes the payload against the schema-v3 allowlist, merges
  it with `defaultScenario` defaults, upgrades older (v1/v2) payloads losslessly,
  and re-derives fields (for example the flat `paycheckInfo` is rebuilt from the
  granular `paycheck`).
- The decode result carries `blocked` (written by a newer schema) and `corrupt`
  flags.
- A missing or invalid payload loads defaults. The reference date is an explicit
  input; the codec never reads the wall clock.

## Save Path

- `saveAppState(state, options?)` encodes through `encodeAppState` and writes.
- The guard preserves bytes:
  - a newer-version payload blocks automatic writes (`future-version`);
  - corrupt bytes are not overwritten on automatic saves;
  - only an explicit user reset (`{ reset: true, explicitCanonical: true }`) may
    replace them.
- A blocking save diagnostic (for example an unconvertible legacy flat
  `paycheckInfo`) aborts the write so no edits are silently lost.

## Autosave

- `src/autosave.ts` `createAutosaveController` coalesces rapid edits into one
  deferred write and funnels every write through the guarded `saveAppState`.
- The app skips the hydrated load ("never save on load"), flushes from a
  `pagehide` handler, and surfaces blocked/corrupt/quota diagnostics.

## Schema v3

- `CURRENT_SCHEMA_VERSION = 3` (`src/codec.ts`).
- The codec is allowlist-only: obsolete or derived fields (the flat
  `CareerEntry.paycheckInfo` cache, canvas caches, calculated balances) are pruned
  by construction.
- v3 adds the ordered per-group `HousingEntry.fundingPolicies` override map. The
  field is optional, so older payloads load losslessly.
- `CANONICAL_TRAJECTORY_FORMAT_VERSION = 2` marks a cents-only trajectory
  snapshot. A higher value is refused rather than reinterpreted.

## Practical Rule For New Fields

1. Add the field to `src/types.ts`.
2. Add a default in `src/defaultScenario.ts`.
3. Add load-time normalization to the codec (`src/codec.ts`).
4. Use it in `src/commands.ts` and/or the engine compile step.
5. Add engine and UI tests when behavior changes.
