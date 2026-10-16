import { describe, expect, it } from 'vitest';
import expenseImportSourceText from './expenseImport.ts?raw';
import type { AccountDefinition, ExpenseCategory } from '../types';
import {
  buildImportSource,
  isViewOnlyImport,
  parseExpenseCsvText,
  parseExpenseImportFiles,
  type ImportedExpenseEntry
} from './expenseImport';

const makeAccount = (
  overrides: Partial<AccountDefinition> & Pick<AccountDefinition, 'id' | 'label'>
): AccountDefinition => ({
  accountType: 'checking',
  openingBalance: 0,
  annualReturnRate: 0,
  retirementAnnualReturnRate: null,
  displayOrder: 0,
  withdrawalPolicy: {
    allowAutomaticFallback: false,
    withdrawalTaxRate: 0,
    penaltyRate: 0,
    restrictionNote: ''
  },
  ...overrides
});

const context = (overrides: Partial<Parameters<typeof parseExpenseCsvText>[1]> = {}) => ({
  sourceId: 'src-1',
  batchId: 'batch-1',
  accounts: [] as AccountDefinition[],
  asOf: '2025-03-06',
  ...overrides
});

describe('expense CSV header/date/amount parsing', () => {
  it('parses an ISO date, amount and sign from a standard header', () => {
    const csv = [
      'Date,Description,Account,Amount',
      '2025-03-04,Whole Foods,Groceries Checking,-45.67',
      '2025-03-05,Refund,Checking,20.00'
    ].join('\n');

    const outcome = parseExpenseCsvText(
      csv,
      context({ accounts: [makeAccount({ id: 'acct-checking', label: 'Checking' })] })
    );

    expect(outcome.parseNotes).toEqual([]);
    expect(outcome.entries).toHaveLength(2);

    const debit = outcome.entries[0];
    expect(debit.sourceDate).toBe('2025-03-04');
    expect(debit.startDate).toBe('2025-03-04');
    expect(debit.endDate).toBe('2025-03-04');
    expect(debit.amount).toBe(45.67);
    expect(debit.sourceSign).toBe('debit');
    expect(debit.accountId).toBe('acct-checking');
    expect(debit.label).toBe('Whole Foods');

    const credit = outcome.entries[1];
    expect(credit.amount).toBe(20);
    expect(credit.sourceSign).toBe('credit');
    expect(credit.accountId).toBe('acct-checking');
  });

  it('skips preamble rows and finds the real header', () => {
    const csv = [
      'Account Statement',
      'Generated 2025-01-01',
      'Date,Description,Amount',
      '2025-01-05,Store,-7.00'
    ].join('\n');

    const outcome = parseExpenseCsvText(csv, context({ asOf: '2025-02-01' }));

    expect(outcome.entries).toHaveLength(1);
    expect(outcome.entries[0].label).toBe('Store');
    expect(outcome.entries[0].amount).toBe(7);
  });

  it('parses US-style dates', () => {
    const csv = ['Date,Description,Amount', '03/04/2025,Coffee,-4.50'].join('\n');

    const outcome = parseExpenseCsvText(csv, context());

    expect(outcome.entries[0].sourceDate).toBe('2025-03-04');
  });

  it('reads separate debit/credit columns and preserves direction', () => {
    const csv = [
      'Date,Description,Debit,Credit',
      '2025-01-02,Coffee,4.50,',
      '2025-01-03,Paycheck,,2500.00'
    ].join('\n');

    const outcome = parseExpenseCsvText(csv, context({ asOf: '2025-02-01' }));

    expect(outcome.entries).toHaveLength(2);
    expect(outcome.entries[0].sourceSign).toBe('debit');
    expect(outcome.entries[0].amount).toBe(4.5);
    expect(outcome.entries[1].sourceSign).toBe('credit');
    expect(outcome.entries[1].amount).toBe(2500);
  });
});

describe('local malformed-row recovery', () => {
  it('recovers per row without aborting the batch', () => {
    const csv = [
      'Date,Description,Amount',
      'not-a-date,Broken Row,12.00',
      '2025-02-01,No Amount,',
      '2025-02-02,Good Row,9.99'
    ].join('\n');

    const outcome = parseExpenseCsvText(csv, context({ asOf: '2025-03-01' }));

    expect(outcome.entries).toHaveLength(2);
    expect(outcome.entries[0].label).toBe('Broken Row');
    // Invalid date falls back to the observation date, not a future window.
    expect(outcome.entries[0].sourceDate).toBe('2025-03-01');
    expect(outcome.entries[0].sourceDate).toBe(outcome.entries[0].startDate);
    expect(outcome.entries[1].label).toBe('Good Row');

    expect(outcome.parseNotes).toHaveLength(2);
    expect(outcome.parseNotes.some((note) => note.includes('invalid date'))).toBe(true);
    expect(outcome.parseNotes.some((note) => note.includes('invalid amount'))).toBe(true);
  });

  it('marks a recovered source as needs_review', () => {
    const source = buildImportSource({
      sourceId: 'src-1',
      batchId: 'batch-1',
      fileName: 'broken.csv',
      fileType: 'csv',
      previewText: '',
      entries: [],
      parseNotes: ['Row 2: missing or invalid amount; row skipped (local recovery, batch preserved).'],
      asOf: '2025-03-01'
    });

    expect(source.status).toBe('needs_review');
    expect(source.confidence).toBe(0);
  });
});

describe('account and category matching', () => {
  it('resolves accounts by stable id and by label and leaves unknown rows unassigned', () => {
    const accounts = [
      makeAccount({ id: 'a1', label: 'Main Checking' }),
      makeAccount({ id: 'a2', label: 'Savings' })
    ];
    const csv = [
      'Date,Description,Amount,Account',
      '2025-01-01,Grocery,-10,Main Checking',
      '2025-01-02,By Id,-3,a2',
      '2025-01-03,Mystery,-5,Unknown Account'
    ].join('\n');

    const outcome = parseExpenseCsvText(csv, context({ accounts, asOf: '2025-02-01' }));

    expect(outcome.entries[0].accountId).toBe('a1');
    expect(outcome.entries[1].accountId).toBe('a2');
    expect(outcome.entries[2].accountId).toBeNull();
    expect(outcome.parseNotes.some((note) => note.includes('no matching account'))).toBe(true);
  });

  it('assigns a matched per-account category without inferring HSA qualification', () => {
    const accounts = [makeAccount({ id: 'a1', label: 'Checking', accountType: 'hsa' })];
    const categoriesByAccountId: Record<string, ExpenseCategory[]> = {
      a1: [{ id: 'cat-food', label: 'Groceries' }]
    };
    const csv = ['Date,Description,Amount,Account', '2025-01-01,Whole Foods Groceries,-20,Checking'].join('\n');

    const outcome = parseExpenseCsvText(
      csv,
      context({ accounts, categoriesByAccountId, asOf: '2025-02-01' })
    );

    const entry = outcome.entries[0] as ImportedExpenseEntry & Record<string, unknown>;
    expect(entry.categoryId).toBe('cat-food');
    // Category labels never imply tax treatment.
    expect(entry).not.toHaveProperty('hsa');
    expect(entry).not.toHaveProperty('hsaQualified');
    expect(entry).not.toHaveProperty('qualifiedMedical');
  });
});

describe('view-only occurred provenance and source removal', () => {
  const fakeFile = (name: string, content: string) =>
    ({ name, text: async () => content }) as unknown as File;

  it('preserves sourceDate/sign/asOf/batch and links entries to a removable source', async () => {
    const csv = [
      'Date,Description,Account,Amount',
      '2025-05-01,Rent,Checking,-1500.00',
      '2025-05-02,Groceries,Checking,-60.00'
    ].join('\n');

    const results = await parseExpenseImportFiles(
      [fakeFile('may.csv', csv)],
      [makeAccount({ id: 'acct-checking', label: 'Checking' })],
      {},
      { asOf: '2025-06-01', batchId: 'batch-may' }
    );

    expect(results).toHaveLength(1);
    const { source, entries } = results[0];
    const typedEntries = entries as ImportedExpenseEntry[];

    expect(source.batchId).toBe('batch-may');
    expect(source.status).toBe('ready');
    expect(source.entryIds).toEqual(typedEntries.map((entry) => entry.id));
    expect(typedEntries.every((entry) => entry.importSourceId === source.id)).toBe(true);
    expect(typedEntries.every((entry) => entry.importBatchId === 'batch-may')).toBe(true);

    typedEntries.forEach((entry) => {
      // Occurred transaction: original date preserved, no future clamping.
      expect(entry.provenance).toBe('imported');
      expect(entry.planningStatus).toBe('occurred');
      expect(entry.sourceDate).toBe(entry.startDate);
      expect(entry.endDate).toBe(entry.startDate);
      expect(entry.asOf).toBe('2025-06-01');
      expect(isViewOnlyImport(entry)).toBe(true);
    });

    // Source removal drops exactly its entries.
    const remaining = typedEntries.filter((entry) => entry.importSourceId !== source.id);
    expect(remaining).toHaveLength(0);
  });

  it('stays view-only after the display date is moved or the anchor is earlier', async () => {
    const csv = ['Date,Description,Amount', '2025-05-01,Rent,-1500.00'].join('\n');

    const results = await parseExpenseImportFiles([fakeFile('may.csv', csv)], [], {}, { asOf: '2025-06-01' });
    const entry = results[0].entries[0] as ImportedExpenseEntry;

    const moved = { ...entry, startDate: '2030-01-01', endDate: '2030-01-01' };
    expect(isViewOnlyImport(moved)).toBe(true);
    expect(moved.sourceDate).toBe('2025-05-01');
  });

  it('never auto-promotes a future-dated row to a projected obligation', async () => {
    const csv = ['Date,Description,Amount', '2025-12-01,Planned Gym,-50.00'].join('\n');

    const results = await parseExpenseImportFiles([fakeFile('future.csv', csv)], [], {}, { asOf: '2025-06-01' });
    const { source, entries } = results[0];
    const entry = entries[0] as ImportedExpenseEntry;

    expect(entry.provenance).toBe('imported');
    expect(entry.planningStatus).toBe('occurred');
    expect(entry.sourceDate).toBe('2025-12-01');
    expect(entry.startDate).toBe('2025-12-01');
    expect(source.status).toBe('needs_review');
    expect(source.parseNotes.some((note) => note.includes('future-dated'))).toBe(true);
  });
});

describe('no legacy grouping references and no raw mutation', () => {
  it('never emits a legacy grouping field on entries', () => {
    const csv = ['Date,Description,Amount', '2025-01-01,Store,-7.00'].join('\n');
    const outcome = parseExpenseCsvText(csv, context());
    expect(outcome.entries[0]).not.toHaveProperty('poolId');
  });

  it('contains no legacy grouping identifiers in the module source', () => {
    expect(/\bpool/i.test(expenseImportSourceText)).toBe(false);
    expect(expenseImportSourceText).not.toContain('PoolDefinition');
  });

  it('does not mutate caller-owned input', () => {
    const accounts = [makeAccount({ id: 'a1', label: 'Checking' })];
    const categoriesByAccountId: Record<string, ExpenseCategory[]> = {
      a1: [{ id: 'cat-food', label: 'Groceries' }]
    };
    const accountsSnapshot = JSON.stringify(accounts);
    const categoriesSnapshot = JSON.stringify(categoriesByAccountId);
    const csv = ['Date,Description,Amount', '2025-01-01,Whole Foods Groceries,-20'].join('\n');

    parseExpenseCsvText(csv, context({ accounts, categoriesByAccountId }));

    expect(JSON.stringify(accounts)).toBe(accountsSnapshot);
    expect(JSON.stringify(categoriesByAccountId)).toBe(categoriesSnapshot);
  });
});
