# Account Cashflow Refactor

Planning documents and historical baseline evidence created during this session.

Start with [audit coverage and readiness](audit_status.md) for all six requested audit areas, verified evidence and priority follow-up. Incremental implementation is authorized by [ADR-022](architecture_decisions.md#adr-022--incremental-implementation-authorized-intermediate-breakage-permitted); inspection and authorization do not mean target implementation/acceptance is complete.

Use [the manual review checklist](review.md) for accepted product rules, implementation authorization and the separate final-release sign-off.

RV01–RV31/clarifications recorded in review/ADR-019/020: home partial payments held as deposits until fully funded; taxable gain20% gross/default editable LTCG15%; user withdrawals/residual0% lump sum/twelve ordinary payments/view-only occurred imports/net-worth graph/responsive eighty years. Prior acquisition/tax ambiguities resolved; target implementation/verification still pending.

ADR-021 records the later accepted exact-cent quote, residual and 0% installment rules, the HSA age-65 penalty treatment, and a **user-configurable initial-balance withdrawal percentage** (new-item default 4%) on each retirement source. These remain target contracts, not current runtime behavior.

## Plans and specifications

Start implementation with [the consolidated parallel implementation plan](implementation_plan.md): nine phases, task-level dependencies and ownership, reusable code/ideas, feature and audit coverage, and verification gates. ADR-022 authorizes incremental work and temporary intermediate breakage; no target-runtime implementation or release is claimed by this index.

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
11. [Frozen contracts](frozen_contracts.md)
12. [Coverage register](coverage_register.md)
13. [Phase 1 task breakdown](phase1_plan.md)

## Target architecture (draft)

These diagrams show the **target** account-only architecture from [the frozen contracts](frozen_contracts.md) and the [implementation plan](implementation_plan.md), not the current pool-based code. They describe where the refactor is headed; none of this is implemented in `src/` yet.

### Target code architecture

`App.tsx` becomes a thin composition/commands/context boundary instead of a monolith. The engine splits into a kernel (dates, money, state, taxes, funding, scheduler), feature processors (income, obligations, valuation), and reporting, each with a single owner.

```mermaid
flowchart TD
  classDef entry fill:#ede7f6,stroke:#4527a0,color:#000;
  classDef schema fill:#e8f5e9,stroke:#2e7d32,color:#000;
  classDef kernel fill:#fff3e0,stroke:#ef6c00,color:#000;
  classDef stream fill:#e3f2fd,stroke:#1565c0,color:#000;
  classDef report fill:#f3e5f5,stroke:#6a1b9a,color:#000;
  classDef ui fill:#fce4ec,stroke:#ad1457,color:#000;
  classDef perf fill:#eceff1,stroke:#546e7a,color:#000;

  Main["main.tsx — ReactDOM.createRoot"]:::entry
  App["App.tsx — composition root:<br/>commands, named contexts, tab rendering"]:::ui

  subgraph Schema["Schema, persistence, commands (S)"]
    Types["types.ts — canonical config + result contracts"]:::schema
    Defaults["defaultScenario.ts — independent factories +<br/>structural validation"]:::schema
    Storage["storage.ts — versioned allowlisted codec,<br/>diagnostics, durable storage"]:::schema
    Commands["commands — active-timeline writes,<br/>deep clone, marker/reference registry"]:::schema
  end

  subgraph Kernel["Deterministic kernel (K)"]
    Dates["engine/dates.ts — date-only calendar"]:::kernel
    Money["engine/money.ts — cents, rounding, safe range"]:::kernel
    State["engine/state.ts — private state,<br/>sole atomic commitChanges"]:::kernel
    Taxes["engine/taxes.ts — eligibility + gross-net solver"]:::kernel
    Funding["engine/funding.ts — ordered split,<br/>partial allocations"]:::kernel
    Scheduler["engine/scheduler.ts — month batches,<br/>stable event order"]:::kernel
  end

  subgraph Streams["Feature processors"]
    Income["engine/income.ts + paycheck.ts<br/>(I) payroll + allocations"]:::stream
    Obligations["engine/obligations.ts<br/>(O) cards, loans, housing, planner"]:::stream
    Valuation["engine/valuation.ts<br/>(O) account APY, appreciation, debt accrual"]:::stream
  end

  subgraph Report["Configuration + reporting (K/R)"]
    Config["engine/configuration.ts — compile named context"]:::report
    Reporting["engine/reporting.ts — audit, monthly closes,<br/>outcomes, warnings"]:::report
    Facade["engine/projection.ts — projectScenario facade"]:::kernel
  end

  subgraph Views["Views + runner (U/P)"]
    Adapters["view adapters / selectors / funding editor"]:::report
    Runner["runner / cache + perfTools.ts"]:::perf
  end

  Main --> App
  App --> Commands
  App --> Config
  App --> Adapters
  App --> Runner

  Commands --> Storage
  Commands --> Defaults
  Storage --> Defaults
  Storage --> Types
  Defaults --> Types

  Config --> Types

  Facade --> Config
  Facade --> Scheduler
  Facade --> Income
  Facade --> Obligations
  Facade --> Valuation
  Facade --> Reporting

  Income --> State
  Obligations --> State
  Valuation --> State
  Income --> Funding
  Obligations --> Funding
  Income --> Taxes
  Income --> Scheduler
  Obligations --> Scheduler
  Valuation --> Scheduler

  Funding --> State
  Funding --> Money
  Taxes --> Money
  State --> Money
  Scheduler --> Dates

  Reporting -. "read-only, frozen output" .-> State
  Reporting --> Types
  Adapters --> Reporting
  Adapters --> Types
  Runner --> Facade
```

**Reading the diagram**

- **`main.tsx` → `App.tsx`.** `App.tsx` no longer holds normalization/rebuilds; it issues **commands** and selects **named result contexts**. All state changes route through canonical commands so unrelated edits never drop new fields.
- **Schema/persistence (S).** `types.ts` is the only leaf contract module; `defaultScenario.ts` exposes independent factories; `storage.ts` is a versioned allowlisted codec with diagnostics — no financial math.
- **Kernel (K).** `dates.ts` and `money.ts` are pure primitives. `state.ts` owns the private account/liability/property/deposit state and is the **sole** atomic mutation point. `taxes.ts` and `funding.ts` are pure quote/commit logic; `scheduler.ts` batches months and orders events without mutating balances.
- **Feature processors** (`income.ts`, `obligations.ts`, `valuation.ts`) call the kernel — they never maintain separate ledgers. `paycheck.ts` stays the shared payroll compiler.
- **Reporting (R).** `reporting.ts` reads `state.ts` only (read-only) and returns **deep-frozen** result/snapshot objects, so no view can alias or mutate engine state outside `commitChanges`. `configuration.ts` compiles the selected named context from already-hydrated config — it has no dependency on `storage.ts`. `projection.ts` stays the public `projectScenario` facade orchestrating the rest.
- **Views (U) + runner (P).** Editors and charts consume only adapters/selectors (no local financial simulations). The runner/cache invokes the `projectScenario` facade (`Runner → Facade`) on demand, guarded by revision IDs, cancellation, and stale-result rejection.

### Target money flow

Income posts **once, directly to accounts** — there is no monthly/yearly income reservoir. Obligations debit accounts through a primary-first, ordered, eligible split funding policy; all obligations are partial.

```mermaid
flowchart TB
  classDef src fill:#e8f5e9,stroke:#2e7d32,color:#000;
  classDef acct fill:#f3e5f5,stroke:#6a1b9a,color:#000;
  classDef fund fill:#e3f2fd,stroke:#1565c0,color:#000;
  classDef debt fill:#ffebee,stroke:#c62828,color:#000;
  classDef state fill:#fff3e0,stroke:#ef6c00,color:#000,stroke-width:2px;
  classDef out fill:#eceff1,stroke:#546e7a,color:#000;

  subgraph SRC["1. Income — posts ONCE, directly to accounts"]
    direction TB
    Open["Opening snapshot<br/>accounts + liabilities + property"]:::src
    Pay["Payroll net pay → ordered allocations<br/>+ explicit remainder destination"]:::src
    Match["Employer retirement match + HSA deposit"]:::src
    Other["Cashflow / life-events / rent /<br/>pension / sale proceeds"]:::src
  end

  subgraph STORE["Account + liability + property store (integer cents)"]
    direction LR
    Accts["Accounts<br/>rate + retirement override +<br/>withdrawal policy"]:::acct
    Liab["Liabilities<br/>loan / mortgage / 0% card /<br/>sale deficiency"]:::state
    Prop["Property + held acquisition deposit<br/>pending / owned / sold"]:::state
  end

  subgraph FUND["2. Funding — primary-first, ordered, eligible, partial"]
    direction TB
    FP["FundingPolicy<br/>primary → ordered fallbacks<br/>(retirement has its own list)"]:::fund
    TX["taxes.ts — taxable 20% gain /<br/>LTCG 15% gross-net"]:::fund
  end

  subgraph OUT["3. Obligations — all partial, same-date phases"]
    direction TB
    Ret["Retirement spending<br/>(net target, tax-aware gross debit)"]:::debt
    Cards["Cards — ordinary 12 payments /<br/>0% adaptive payoff"]:::debt
    House["Housing — down (held deposit) /<br/>P+I, tax+ins, HOA, PMI, rent"]:::debt
    Loans["Loans — interest accrual +<br/>funded principal only"]:::debt
    Buy["Purchases / long-term / planner"]:::out
  end

  subgraph CLOSE["4. Close + report"]
    direction TB
    Val["Month-close valuation — per-account APY"]:::src
    Audit["Compact audit → monthly closes →<br/>net worth = assets − liabilities"]:::out
  end

  Open --> Accts
  Open --> Liab
  Open --> Prop
  Pay --> Accts
  Match --> Accts
  Other --> Accts

  FP --> TX
  FP -. "insufficient → next fallback" .-> Accts

  Ret --> FP
  Cards --> FP
  House --> FP
  Loans --> FP
  Buy --> FP

  FP --> Accts
  FP --> Liab
  House --> Prop

  Val --> Accts
  Val --> Prop
  Val --> Liab

  Accts --> Audit
  Liab --> Audit
  Prop --> Audit
```

**Reading the diagram**

- **No reservoirs.** Net pay (`Pay`) is allocated straight into accounts; the remainder goes to an explicit destination. There is no monthly or yearly income pool — this removes the root README's "annual income is re-spent" defect (R01).
- **Funding is a policy, not a pool sweep.** `FundingPolicy` (`FP`) lists a primary account and ordered fallbacks; retirement has its own explicit list. Every allocation is partial (`executed ≤ requested`), and `taxes.ts` computes exact gross-net for taxable withdrawals.
- **Liabilities and property are first-class.** Debt reduction happens only for actually funded principal; a partial home down-payment becomes a held acquisition deposit (`Prop`) until completion; net worth is `assets − liabilities`.
- **Retirement is spending, not income.** Each source can use a fixed amount or user-configured initial-balance percentage (4% new-item default) at its selected valuation date; its net spending target results in a tax-aware gross account debit, never a deposit into another reservoir. Qualified HSA medical expenses and non-qualified age-65 penalties follow ADR-021.
- **Close and report.** Valuation applies per-account effective APY at month close; a single compact audit feeds monthly closes, annual totals, and warnings.

## Improvements over the root README

The root `README.md` diagrams describe the **current** pool-based engine. The diagrams above describe the **target** and fix the defects the root README already flags under "Suspected defects".

**Code architecture**

| Root (current) | Target | Why |
|---|---|---|
| `App.tsx` is a monolith: state, tabs, timelines, deflation, and duplicate normalizers | `App.tsx` = commands + named contexts; normalization lives in `commands`/`storage` | Unrelated edits currently drop new fields (`App.updateScenario` rebuild) — G01/MD02 |
| One `projection.ts` monolith + `financeModel.ts` pool helpers | Kernel (`dates/money/state/taxes/funding/scheduler`) + processors (`income/obligations/valuation`) + `reporting` | Single owner per rule; pool-first lookup removed — MD01/MD04 |
| `storage.ts` embedded legacy adapters + a broad whole-load `try/catch` | Versioned allowlisted codec with record-local diagnostics | One malformed item no longer resets the whole plan — TC07/ADR-018 |
| `BankAccountDefinition.poolId` ties accounts to pools | `AccountDefinition` owns its own rate/override/withdrawal policy | Rates/policies belong to accounts, not pools — ADR-014 |

**Money flow**

| Root (current) | Target | Why |
|---|---|---|
| Two income reservoirs (monthly + yearly pools) alongside `ledgerAccounts` | Income posts once, directly to accounts; no reservoir | The yearly pool lets the same dollar fund monthly *and* annual spending (R01) |
| Pool-priority fallback with pool tax/penalty rates | Per-account rates; `FundingPolicy` primary-first ordered split, partial | Explicit eligibility/order; no pool sweep — ADR-007/ADR-014 |
| Net worth is asset-only; debt/property reported separately | Liabilities + property + held deposit are first-class; net worth = assets − liabilities | Signed net worth; debt only reduced by funded payments — R05/R02 |
| Retirement withdrawals are income; debt amortizes regardless of funding | Retirement = spending; funded-only debt reduction; held deposit for partial down payments | No fabricated principal reduction / no second down-payment charge — ADR-003/ADR-011/ADR-020 |
| Implicit same-date ordering | Explicit phases: accrual → income → cap → mandatory → discretionary → close | No future income/gains funding earlier requests — RV23/ADR-010 |

The root README documents the **pre-refactor baseline**; this `refactor/README.md` documents the target account-only codebase. Under ADR-022 intermediate code may be incomplete or broken, so neither diagram should be read as proof that a partially migrated build runs.

## Evidence and references

- [Original Pre-Step 0 projection baselines](fixtures/projection.pre-refactor.snap) — full inputs/outputs, including behavior subsequently changed with approval.
- [Parent agent plan](../agent_plan.md)
- [General project documentation](../docs/INDEX.md)

The approved standalone-contribution removal is implemented. The broader account-only rearchitecture is **authorized for phased implementation** (ADR-022) but not yet implemented or verified; final release remains gated on complete integration, tests/build, measurements and sign-off.
