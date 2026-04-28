# Test Map

## Test Files

- `src/engine/projection.test.ts`
- `src/App.test.tsx`

## Engine Coverage (`projection.test.ts`)

Validates core projection behavior, including:

- pre-retirement growth mechanics
- withdrawal modes (4% rule and specified)
- inflation-adjusted withdrawal progression
- recurring/one-time cashflow behavior
- job change and career break effects
- historical mode determinism
- depletion detection
- account tracking and per-career ending balances
- monthly account withdrawal handling

## App Coverage (`App.test.tsx`)

Validates integration/UI behaviors, including:

- chart and table rendering
- options persistence (DOB age mode)
- tab migration behavior from older UI states
- career timeline normalization and controls
- duplicate/remove workflow
- stacked savings graph controls
- net worth persistence behavior

## Suggested New Tests For Future Work

- careers-only graph behavior when no careers are enabled
- retirement tab graph independence from career toggles
- regression test for age-25 account row math with custom inputs
