# Manual Contribution Leak Plan

## The Problem

In `src/engine/projection.ts`, the manual yearly contribution from `scenario.contribution.yearlyContribution` is fed into the portfolio-level `balance` variable (line 1093-1095) but is **never deposited into the `ledgerAccounts`**. This means:

- The graph and table output use `currentLedgerSum` (line 1109), so **manual contributions are invisible** in the UI
- The portfolio `balance` gets inflated relative to the real account money
- The depletion check (`rawEndBalance <= 0` at line 1101) uses the inflated `balance`, making the survival summary too optimistic

## Root Cause

The projection engine has two parallel cashflow tracks:

| Track | Variables | Includes manual contrib? | Used for output? |
|---|---|---|---|
| Portfolio balance | `balance`, `rawEndBalance` | Yes (line 1094) | Depletion check only |
| Ledger accounts | `ledgerAccounts`, `currentLedgerSum` | **No** | Graph, table, endBalance |

The month loop (lines 637-661) only processes `careerSourceLines`. The manual `contribution` is added to `balance` at line 1094 but never distributed to `ledgerAccounts`.

## Fix Options

### Option A: Deposit manual contribution into ledger accounts (Recommended)

During the month loop, distribute the proportional monthly manual contribution across accounts (e.g., by pool allocation or evenly).

**Changes needed:**
1. In the month loop (around line 637), add a distribution of `scenario.contribution.yearlyContribution / 12` across `ledgerAccounts` proportional to some allocation
2. Remove the separate `contribution` addition to `balance` at line 1093 to avoid double-counting

**Pros:** Manual contributions actually appear in the graph/table
**Cons:** Need to decide allocation strategy (proportional to balance? even split? pool-based?)

### Option B: Remove manual contribution from the projection entirely

Treat `scenario.contribution.yearlyContribution` as legacy/deprecated now that career-based contributions exist. Remove it from the `balance` calculation at line 1093.

**Changes needed:**
1. Remove `contribution` from `totalContribution` at line 1093
2. Remove or deprecate the UI for manual contribution in Options tab

**Pros:** Simplest fix, eliminates the leak
**Cons:** Existing users relying on manual contributions lose that feature

### Option C: Use manual contribution as a fallback when no careers are active

Only add `contribution` to `balance` (and distribute to ledger accounts) during years when no career is active.

**Changes needed:**
1. Check if career is active for the current year
2. If no career, distribute manual contribution to ledger accounts
3. Add to `balance` only when distributed to ledger accounts

**Pros:** Backward compatible, fills gap when user has no career plan
**Cons:** More complex logic

## Recommendation

**Option A** is the correct long-term fix. The allocation should follow the same pattern as career contributions: distribute to accounts based on their pool's equity/fixed ratio, or let the user configure a distribution.

## Status

**Not yet implemented.** Marked for separate handling per user request.
