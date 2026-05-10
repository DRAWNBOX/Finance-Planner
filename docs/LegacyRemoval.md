# Legacy 4-Account Removal — Phases 2 & 3

## Phase 2 — Remove account-level legacy fields

### 2a. Remove `accountBalances` from `NetWorthConfig`

**Files:** `src/types.ts`, `src/engine/projection.ts`, `src/storage.ts`, `src/App.tsx`, `src/defaultScenario.ts`

**What:**
- Remove `accountBalances: SavingsBalances` from `NetWorthConfig` (`types.ts:269`)
- Remove `baseBalances` computation in `projection.ts:463-468` (reads 4 legacy keys from `scenario.netWorth.accountBalances`)
- Replace all engine reads of `baseBalances` with dynamic pool totals from `ledgerAccounts`

**Impact:**
- `baseBalances` is passed to: `getPoolAccounts`, `buildPoolBalances`, `applySourceContributions`, `applyNetTargetWithdrawal`, `sourceLineTargetAmount`, `processIncomeWaterfall`
- Each function uses `baseBalances` as a fallback balance source for virtual account creation
- After this change, pools without real bank accounts will get zero balances instead of fallback values
- Remove `seedDefaultBankAccounts` import from `projection.ts`

**Dependencies:**
- `scenario.netWorth.accountBalances` is also read for the baseline-year `savingsBalances` — move to pool totals
- Normalization in `storage.ts` and `App.tsx` writes to it — remove those writes
- `sumSavingsBalances(scenario.netWorth.accountBalances)` in App.tsx — replace with sum of bank account balances

### 2b. Remove `savingsTracker` from `Scenario`

**Files:** `src/types.ts`, `src/engine/projection.ts`, `src/storage.ts`, `src/App.tsx`, `src/defaultScenario.ts`, `src/financeModel.ts`

**What:**
- Remove `SavingsTrackerConfig` type and `savingsTracker` field from `Scenario`
- `seedDefaultBankAccounts` no longer needs `annualInterestRates` param

**Impact:**
- `savingsTracker.annualInterestRates` was the legacy source for per-pool APY before per-account `annualReturnRate` existed
- Now superseded by `BankAccountDefinition.annualReturnRate`

### 2c. Remove `seedDefaultBankAccounts` and `seedDefaultPools`

**Files:** `src/financeModel.ts`, `src/storage.ts`, `src/App.tsx`, `src/engine/projection.ts`, `src/defaultScenario.ts`

**What:**
- Remove `seedDefaultBankAccounts` function (previously replaced with direct BankAccountDefinition array in normalization)
- Remove `seedDefaultPools` function (previously replaced with direct PoolDefinition array in normalization)
- Remove `LEGACY_POOL_LABELS`
- Remove `legacyPoolToPreset`

**Impact:**
- Normalization in `storage.ts` and `App.tsx` must always supply explicit `bankAccounts` and `pools` arrays (they already do)
- Remove the `?? seedDefaultBankAccounts(...)` and `?? seedDefaultPools()` fallbacks

### 2d. Remove `LEGACY_POOL_IDS`, `LegacyPoolId`, `isLegacyPoolId`

**Files:** `src/types.ts`, `src/financeModel.ts`, `src/engine/projection.ts`

**What:**
- Remove `LEGACY_POOL_IDS` constant (both copies: `financeModel.ts:16` and `projection.ts:30`)
- Remove `LegacyPoolId` type
- Remove `isLegacyPoolId` type guard
- Remove all references

**Impact:**
- The `as LegacyPoolId` casts in projection.ts become unnecessary (poolId is already a string)
- `ensureSourceLinesForWithdrawal` migration helper (if still present) uses `isLegacyPoolId`

### 2e. Remove `legacyFallbackId` from `PoolDefinition`

**Files:** `src/types.ts`, `src/components/SavingsStackedChart.tsx`, `src/financeModel.ts`, `src/storage.ts`, `src/App.tsx`

**What:**
- Remove `legacyFallbackId?: LegacyPoolId` from `PoolDefinition`
- Remove fallback to `year.savingsBalances[legacyFallbackId]` in `SavingsStackedChart.tsx:82`
- Remove from seed functions and normalization

**Impact:**
- `SavingsStackedChart` no longer has a fallback for pools without accounts; must resolve pool value from `year.accountBalancesById`
- Pools with zero accounts display as zero in the chart

---

## Phase 3 — Remove engine fallback paths

### 3a. Remove virtual account creation from `getPoolAccounts`

**Files:** `src/engine/projection.ts`

**What:**
- Remove the `LEGACY_POOL_IDS` fallback branch in `getPoolAccounts` (lines 228-247)
- Function returns `[]` when no real accounts match the pool

**Impact:**
- Pools with zero bank accounts contribute zero balance to all projections
- `baseBalances` is no longer needed (already removed in Phase 2a)

### 3b. Remove `isDefaultSeeded` override in ledger initialization

**Files:** `src/engine/projection.ts`

**What:**
- Remove the `isDefaultSeeded` check (line 474) and the conditional `balance` override (line 480)
- Remove the balance override using `scenario.netWorth.accountBalances[legacyPool]`

**Impact:**
- Default-seeded accounts no longer get special treatment
- All accounts use their own `.balance` field

### 3c. Remove `toLegacySavings` and `savingsBalances` from `ProjectionYear`

**Files:** `src/engine/projection.ts`, `src/types.ts`

**What:**
- Remove `toLegacySavings` function
- Remove `savingsBalances: SavingsBalances` from `ProjectionYear`

**Impact:**
- `SavingsStackedChart` relies on `savingsBalances` as fallback (see 2e)
- Must be removed together with 2e
- `careerEndSavingsBalances` in `ProjectionResult` also uses `SavingsBalances` — refactor to `Record<string, number>` keyed by account ID

### 3d. Remove `sourceAmounts` on purchases (separated from engine)

Already done in Phase 1.

### 3e. Remove `firstYearAccountWithdrawals` / `firstYearAccountUseFourPercent` (separated from engine)

Already done in Phase 1.

---

## Rollback Risk

Each phase is designed to be independently revertible if issues arise with saved-state backward compatibility. The key invariant: **after a single save-load cycle with the new code, all legacy fields are removed from persisted state**. Users with existing saved data who upgrade will hit the migration path in `storage.ts` once, after which their data is in the new format.
