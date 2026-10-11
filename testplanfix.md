# Test Fix Plan

> **Resolved 2026-08-14.** The original baseline was 20 failing tests and 102 passing tests. After grouping the failures and applying the fixes below, the full suite reports 122 passing tests across 4 files, and the production build succeeds.

## Original Baseline

| Test file | Failed | Passed | Total |
|---|---:|---:|---:|
| `src/App.test.tsx` | 4 | 50 | 54 |
| `src/engine/projection.test.ts` | 16 | 41 | 57 |
| Other test files | 0 | 11 | 11 |
| **Total** | **20** | **102** | **122** |

## Resolved Result

| Command | Result |
|---|---|
| `npm run test -- --run` | 122 passed, 0 failed |
| `npm run build` | Passed |

The App import test still emits jsdom's expected `window.confirm` not-implemented stderr while passing.

## Changes Applied

1. Converted failing purchase and long-term purchase fixtures from `sourceAmounts` to current `sourceLines`, with explicit account funding sources and current-month scheduling.
2. Converted account-funded loan fixtures to `paymentSource` and `downPaymentSource` account IDs.
3. Added current `paycheckInfo` salary data to career fixtures and corrected zero-growth pool configurations where exact balances were being asserted.
4. Preserved retirement withdrawal fallback behavior and updated minimum-withdrawal expectations to distinguish fallback success from true depletion.
5. Corrected the projection engine so a scheduled large purchase is recorded as first affordable only when its full requested amount is covered. Partial funding no longer overwrites the affordability result.
6. Updated the App inflation tests to use the current Options tab and global inflation controls.
7. Corrected ResultsTable test indexes for the current Salary, Career Savings, account, Taxes, Penalties, Return %, and End columns.

## Accuracy Audit

The passing suite was reviewed for tests that could pass without exercising the intended projection path. The following weaknesses were corrected:

- Long-term purchase funding no longer defaults a missing shortfall record to zero; it now requires a recorded zero shortfall and an exact remaining balance after six monthly withdrawals.
- The separate loan down-payment test no longer uses a historical start date that skips the down payment. It now schedules the loan in the active month, disables unrelated pool growth, and verifies the selected account is reduced by the down payment.
- The career contribution verification now uses six-decimal precision instead of tolerances that allowed a $50 balance error.
- Purchase and loan scenarios that depend on scheduled monthly processing use the current year-month rather than a historical month that could silently skip the event.
- Zero-return configurations remain only where exact cash movement is being tested; the dedicated APY test still uses a non-zero return and checks the expected growth range.

Remaining zero assertions are intentional negative-path or timing checks, such as no withdrawal before a source line's start age, no inflation when inflation is disabled, and no depletion when the configured fallback plan succeeds.

## Historical Failure Groups

The groups below document the original failure analysis and the corresponding resolution. They are retained as a regression map.

### Group 1: Current Persisted Shapes

The projection engine intentionally reads current `sourceLines` and `paymentSource` fields. It does not migrate removed legacy fields at runtime.

Affected tests:

- `returns the first future age when a non-viable purchase becomes affordable` (`projection.test.ts:1360`)
- `treats purchases as affordable when selected source accounts can cover the amount in total` (`projection.test.ts:1467`)
- `records post-purchase balances at the scheduled purchase age` (`projection.test.ts:1533`)
- `applies long-term monthly purchases over the scheduled duration` (`projection.test.ts:1599`)
- `reports loan funding shortfalls when the selected payment account runs empty` (`projection.test.ts:1735`)
- `applies loan payments and interest to projection balances` (`projection.test.ts:1665`)
- `applies loan down payment from the selected payment source account at loan start` (`projection.test.ts:1866`)

Actions:

1. Replace purchase and long-term-purchase `sourceAmounts` fixtures with enabled `sourceLines` using the correct pool/account IDs and amount mode.
2. Replace loan `paymentSourceAccount` fixtures with `paymentSource: 'account:<bank-account-id>'` where account funding is intended. Use `downPaymentSource` when the down payment source is being tested separately.
3. Keep the income-funded loan test explicitly on `paymentSource: 'income'`.
4. Assert shortfalls only for scenarios that actually contain a current-format source line and are expected to exhaust that source.
5. Recheck the post-purchase snapshot against current account IDs and the engine's documented post-purchase timing.

### Group 2: Career Fixtures

The current career formula obtains salary from `careerEntry.paycheckInfo.grossSalary`. Several older fixtures only define top-level legacy career rate fields, so the engine correctly produces a zero salary and zero contribution.

Affected tests:

- `estimates salary-based career savings before retirement` (`projection.test.ts:704`)
- `tracks savings accounts and records per-career end balances` (`projection.test.ts:1259`)
- `applies monthly account withdrawals against monthly contributions` (`projection.test.ts:2183`)
- `career contribution excludes employer match and bonus savings` (`projection.test.ts:verification`, line 3181)

Actions:

1. Add current `paycheckInfo` to each career fixture, including `grossSalary` and the employee contribution fields required by the scenario.
2. Preserve source-line contribution rates where the test is specifically checking account routing.
3. For the employer-match verification, set `paycheckInfo.grossSalary: 100000` and assert employee contribution only; retain separate employer-match and bonus fields to prove they are excluded.
4. For the monthly-withdrawal case, provide enough salary or direct current-format contribution configuration for the intended $100 monthly contribution before the $50 monthly withdrawal.

### Group 3: Retirement Withdrawal Expectations

Affected tests:

- `honors per-pool withdrawal start age before drawing retirement withdrawals` (`projection.test.ts:179`)
- `marks depletion when retirement withdrawals miss the configured minimum yearly amount` (`projection.test.ts` around line 1020)
- `inflation-adjusts the minimum yearly withdrawal threshold during retirement` (`projection.test.ts` around line 1139)

Validation findings:

- The start-age case receives `10290` rather than `10000` in the second retirement year, consistent with the scenario's enabled 2.9% inflation. Either disable inflation for a flat withdrawal assertion or expect the inflation-adjusted amount.
- The minimum-withdrawal case now survives because retirement withdrawal funding can fall back across eligible pools. The test must either assert the new fallback behavior or construct a scenario where every eligible pool is exhausted.
- The inflation-threshold case no longer depletes under the current fallback withdrawal behavior. Update the fixture to exhaust all fallback pools if depletion is the behavior under test, or change the assertion to the current surviving result.

Do not relax these assertions without first deciding which withdrawal and depletion contract is intended.

### Group 4: Precision And Growth Assertions

Affected tests:

- `keeps careers table balances aligned with the portfolio graph totals` (`App.test.tsx:1379`)
- `applies long-term monthly purchases over the scheduled duration` (`projection.test.ts:1662`)
- `applies per-career max balance and routes overflow to configured fallback account` (`projection.test.ts:2007`)
- `only applies cap rules from the active career` (`projection.test.ts:2108`)

Validation findings:

- The App assertion differs by `$4,586`, which is too large for a simple rounding tolerance. Compare the table's displayed end balance with the graph's account total and identify whether the mismatch is caused by taxes/penalties, withdrawal timing, or a stale column/value selection before changing the tolerance.
- The long-term purchase balance is `$5,325`, not below `$5,000`, because the fixture's account growth exceeds the scheduled withdrawals. Set pool returns to zero for a pure withdrawal assertion or assert the balance using the expected growth calculation.
- The cap tests receive `$15,030.90`; the cap applies to contributions, while existing balance growth can exceed `$15,000`. Set return rates to zero or assert the cap on the contribution/deposit operation rather than the final grown balance.

### Group 5: Inflation UI Expectations

Affected tests:

- `persists the global inflation toggle state` (`App.test.tsx:63`)
- `disables inflation-related controls when global inflation is off` (`App.test.tsx:82`)
- `re-enables inflation controls and preserves checked states` (`App.test.tsx:109`)

Validation findings:

- The tests navigate to `Finances Prediction > Retirement`, but the global inflation panel is rendered in the `Options` tab.
- The current UI exposes `Enable inflation` and `Inflation Rate %` only. The queried `Adjust expenses for inflation` and `Adjust for inflation` checkboxes are no longer rendered there.

Actions:

1. Navigate to the `Options` top tab for global inflation persistence and enable/disable behavior.
2. Assert the current `Inflation Rate %` input is disabled when the global toggle is off and enabled when it is on.
3. Remove assertions for deleted withdrawal/cashflow inflation checkboxes, or add those controls back to production only if that is still a required product behavior.
4. Preserve the existing localStorage assertion for `manualReturns.inflationEnabled`.

## Resolution Sequence

1. Update current-format purchase and loan fixtures.
2. Add `paycheckInfo` to career fixtures.
3. Resolve the intended retirement fallback/depletion contract and adjust or fix the engine accordingly.
4. Reconcile growth and App balance assertions using unrounded account-ledger values.
5. Update the inflation UI tests to the Options layout.
6. Run `npm run test -- --run src/engine/projection.test.ts` and `npm run test -- --run src/App.test.tsx`.
7. Run `npm run test -- --run` and `npm run build`.
