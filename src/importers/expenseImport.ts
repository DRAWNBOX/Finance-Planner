import type {
  AccountDefinition,
  ExpenseCategory,
  ExpenseEntry,
  ExpenseImportSource,
  PlannerSourceSign
} from '../types';

/**
 * P3S.4 — headless expense import adapters.
 *
 * Canonical shape rules this module owns:
 * - Accounts are resolved to their stable `AccountDefinition.id`; there is no
 *   legacy grouping map or per-account derived group field.
 * - Occurred transactions preserve the original `sourceDate`, `sourceSign` and
 *   `asOf` provenance and are permanently view-only. They are never clamped
 *   into a future window and never auto-promoted by date/anchor.
 * - Future scheduled spending requires an explicit new record; importing a
 *   future-dated row does not promote it. The row is still stored as an occurred
 *   (view-only) observation and flagged for review so a separate planned record
 *   can be created deliberately.
 * - Malformed rows recover locally (skipped/unassigned + `parseNotes`); a bad
 *   row never aborts the batch.
 *
 * `planningStatus` is canonical in `PlannerProvenanceFields`. This narrowed
 * return type guarantees import adapters emit an explicit status; no `any`
 * and no mutation of caller-owned input.
 */
export type ImportPlanningStatus = 'occurred' | 'planned';
export type ImportedExpenseEntry = ExpenseEntry & { planningStatus: ImportPlanningStatus };

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();
const currencyRegex = /-?\$?\(?\d[\d,]*(?:\.\d{2})?\)?/g;
const isoDateRegex = /\b(20\d{2}|19\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g;
const usDateRegex = /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-]((?:20|19)?\d{2})\b/g;

const makeImportSourceId = () => `expense-import-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeExpenseEntryId = () => `expense-entry-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeBatchId = () => `expense-batch-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);
const todayIsoDate = () => toIsoDate(new Date());
/** `asOf` may be a full timestamp; occurrence/date comparisons are date-only. */
const dateOnly = (value: string) => value.slice(0, 10);

const parseCurrencyValue = (value: string): number | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const isNegativeByParens = trimmed.startsWith('(') && trimmed.endsWith(')');
  const normalized = trimmed.replace(/[$,()\s]/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
    return null;
  }

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return isNegativeByParens ? -Math.abs(numeric) : numeric;
};

/**
 * Original transaction direction. Imports preserve the sign they observed and
 * never infer it from an absolute value; explicit Debit/Credit columns win, a
 * bare positive value is a credit and a negative/parenthesised value a debit.
 */
const signOfAmountText = (text: string, value: number): PlannerSourceSign => {
  const trimmed = text.trim();
  if (value < 0 || trimmed.startsWith('-') || (trimmed.startsWith('(') && trimmed.endsWith(')'))) {
    return 'debit';
  }
  return 'credit';
};

const normalizeYear = (yearText: string) => {
  if (yearText.length === 2) {
    const numericYear = Number(yearText);
    return numericYear >= 70 ? 1900 + numericYear : 2000 + numericYear;
  }
  return Number(yearText);
};

const parseDate = (text: string): string => {
  const isoMatch = isoDateRegex.exec(text);
  isoDateRegex.lastIndex = 0;
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const usMatch = usDateRegex.exec(text);
  usDateRegex.lastIndex = 0;
  if (usMatch) {
    const month = String(Number(usMatch[1])).padStart(2, '0');
    const day = String(Number(usMatch[2])).padStart(2, '0');
    const year = String(normalizeYear(usMatch[3])).padStart(4, '0');
    return `${year}-${month}-${day}`;
  }

  return '';
};

const parseCsvRows = (text: string): string[][] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];
    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentCell += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && character === ',') {
      currentRow.push(currentCell);
      currentCell = '';
      continue;
    }
    if (!inQuotes && (character === '\n' || character === '\r')) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
      continue;
    }
    currentCell += character;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows.map((row) => row.map((cell) => cell.trim()));
};

const readFileAsText = async (file: File) => {
  const anyFile = file as File & { text?: () => Promise<string> };
  if (typeof anyFile.text === 'function') {
    return anyFile.text();
  }

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read file as text.'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });
};

const readFileAsArrayBuffer = async (file: File) => {
  const anyFile = file as File & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof anyFile.arrayBuffer === 'function') {
    return anyFile.arrayBuffer();
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read file as array buffer.'));
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error('Unexpected file reader result.'));
    };
    reader.readAsArrayBuffer(file);
  });
};

const decodePdfLikeText = (buffer: ArrayBuffer) => {
  const latin1 = new TextDecoder('latin1').decode(buffer);
  const tokenMatches = [...latin1.matchAll(/\(([^()]*)\)/g)].map((match) => match[1] ?? '');
  if (tokenMatches.length > 0) {
    return normalizeWhitespace(tokenMatches.join(' '));
  }
  return normalizeWhitespace(latin1);
};

/**
 * Resolve an account by its stable ID when the source names one, otherwise by
 * the longest label substring match. There is no silent "first account"
 * fallback: an unresolved row stays unassigned and is surfaced for review.
 */
const matchAccount = (
  rawAccountHint: string,
  description: string,
  accounts: AccountDefinition[]
): AccountDefinition | null => {
  const hint = rawAccountHint.trim();
  if (hint.length > 0) {
    const loweredHint = hint.toLowerCase();
    const byId = accounts.find((account) => account.id.toLowerCase() === loweredHint);
    if (byId) {
      return byId;
    }
    const byLabel = accounts.find((account) => account.label.trim().toLowerCase() === loweredHint);
    if (byLabel) {
      return byLabel;
    }
  }

  const haystack = `${hint} ${description}`.toLowerCase();
  let best: { account: AccountDefinition; labelLength: number } | null = null;
  for (const account of accounts) {
    const label = account.label.trim().toLowerCase();
    if (label.length === 0 || !haystack.includes(label)) {
      continue;
    }
    if (!best || label.length > best.labelLength) {
      best = { account, labelLength: label.length };
    }
  }
  return best ? best.account : null;
};

/**
 * Match a user-defined category by label. Category semantics never infer tax
 * treatment: in particular a matched category is never treated as qualified
 * HSA medical spending.
 */
const matchCategoryId = (
  text: string,
  account: AccountDefinition | null,
  categoriesByAccountId: Record<string, ExpenseCategory[]> | undefined
): string | undefined => {
  if (!account || !categoriesByAccountId) {
    return undefined;
  }
  const categories = categoriesByAccountId[account.id] ?? [];
  const lowered = text.toLowerCase();
  let best: { id: string; labelLength: number } | null = null;
  for (const category of categories) {
    const label = category.label.trim().toLowerCase();
    if (label.length === 0 || !lowered.includes(label)) {
      continue;
    }
    if (!best || label.length > best.labelLength) {
      best = { id: category.id, labelLength: label.length };
    }
  }
  return best ? best.id : undefined;
};

const detectAmount = (text: string) => {
  const amounts = [...text.matchAll(currencyRegex)]
    .map((match) => parseCurrencyValue(match[0]))
    .filter((value): value is number => value !== null)
    .map((value) => Math.abs(value));
  return amounts.length > 0 ? amounts[0] : null;
};

const findCurrencyCell = (row: string[]): string | null => {
  for (const cell of row) {
    if (!cell || cell.trim().length === 0) {
      continue;
    }
    currencyRegex.lastIndex = 0;
    if (currencyRegex.test(cell)) {
      return cell;
    }
  }
  return null;
};

const resolveRowAmount = (
  row: string[],
  indexes: { amountIndex: number; creditIndex: number; debitIndex: number }
): { value: number; sign: PlannerSourceSign } | null => {
  const amountText = indexes.amountIndex >= 0 ? row[indexes.amountIndex] ?? '' : '';
  const parsedAmount = parseCurrencyValue(amountText);
  if (parsedAmount !== null) {
    return { value: parsedAmount, sign: signOfAmountText(amountText, parsedAmount) };
  }

  const debitText = indexes.debitIndex >= 0 ? row[indexes.debitIndex] ?? '' : '';
  const parsedDebit = parseCurrencyValue(debitText);
  if (parsedDebit !== null) {
    return { value: -Math.abs(parsedDebit), sign: 'debit' };
  }

  const creditText = indexes.creditIndex >= 0 ? row[indexes.creditIndex] ?? '' : '';
  const parsedCredit = parseCurrencyValue(creditText);
  if (parsedCredit !== null) {
    return { value: Math.abs(parsedCredit), sign: 'credit' };
  }

  const fallbackCell = findCurrencyCell(row);
  if (fallbackCell !== null) {
    const fallbackValue = parseCurrencyValue(fallbackCell);
    if (fallbackValue !== null) {
      return { value: fallbackValue, sign: signOfAmountText(fallbackCell, fallbackValue) };
    }
  }

  return null;
};

const detectCsvHeaderRowIndex = (rows: string[][]) => {
  const normalizedRows = rows
    .slice(0, Math.min(rows.length, 15))
    .map((row) => row.map((cell) => cell.toLowerCase()));
  let bestIndex = 0;
  let bestScore = -1;

  normalizedRows.forEach((row, rowIndex) => {
    let score = 0;
    if (row.some((cell) => cell.includes('date'))) {
      score += 3;
    }
    if (row.some((cell) => cell.includes('description') || cell.includes('merchant') || cell.includes('payee') || cell.includes('memo'))) {
      score += 2;
    }
    if (row.some((cell) => cell.includes('amount') || cell.includes('debit') || cell.includes('withdrawal') || cell.includes('credit'))) {
      score += 3;
    }
    if (row.some((cell) => cell.includes('transaction'))) {
      score += 1;
    }
    if (row.some((cell) => cell.includes('account'))) {
      score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = rowIndex;
    }
  });

  return bestIndex;
};

const getFileType = (fileName: string): ExpenseImportSource['fileType'] => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) {
    return 'csv';
  }
  if (lower.endsWith('.pdf')) {
    return 'pdf';
  }
  return 'unknown';
};

const sanitizePreview = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .slice(0, 30)
    .join('\n');

export interface ExpenseParseContext {
  sourceId: string;
  batchId: string;
  accounts: AccountDefinition[];
  categoriesByAccountId?: Record<string, ExpenseCategory[]>;
  /** Observation/staging date; defaults to today. Inject for deterministic tests. */
  asOf?: string;
}

export interface ExpenseParseOutcome {
  entries: ImportedExpenseEntry[];
  parseNotes: string[];
}

/**
 * Phase 3 keeps imported transaction provenance permanently view-only:
 * `planningStatus` is always `'occurred'` regardless of the original date, a
 * later simulation anchor or a moved display date. There is deliberately no
 * date-based promotion path here.
 */
export const isViewOnlyImport = (
  entry: Pick<ImportedExpenseEntry, 'provenance' | 'planningStatus'>
): boolean => entry.provenance === 'imported' && entry.planningStatus === 'occurred';

const buildEntry = (params: {
  context: ExpenseParseContext;
  label: string;
  amount: number;
  sourceDate: string;
  sourceSign: PlannerSourceSign | null;
  accountId: string | null;
  categoryId: string | undefined;
  asOf: string;
}): ImportedExpenseEntry => {
  const { context, label, amount, sourceDate, sourceSign, accountId, categoryId, asOf } = params;
  return {
    id: makeExpenseEntryId(),
    label,
    amount,
    startDate: sourceDate,
    endDate: sourceDate,
    accountId,
    notes: '',
    originType: 'imported',
    importSourceId: context.sourceId,
    importBatchId: context.batchId,
    createdAt: asOf,
    updatedAt: asOf,
    ...(categoryId ? { categoryId } : {}),
    provenance: 'imported',
    planningStatus: 'occurred',
    sourceDate,
    sourceSign,
    asOf
  };
};

export const parseExpenseCsvText = (text: string, context: ExpenseParseContext): ExpenseParseOutcome => {
  const asOf = context.asOf ?? todayIsoDate();
  const observationDate = dateOnly(asOf);
  const accounts = context.accounts ?? [];
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return { entries: [], parseNotes: ['No rows found in CSV source.'] };
  }

  const headerRowIndex = detectCsvHeaderRowIndex(rows);
  const header = (rows[headerRowIndex] ?? []).map((column) => column.toLowerCase());
  const dateIndex = header.findIndex((name) => name.includes('date'));
  const descriptionIndex = header.findIndex(
    (name) =>
      name.includes('description') ||
      name.includes('merchant') ||
      name.includes('name') ||
      name.includes('memo') ||
      name.includes('payee') ||
      name.includes('details')
  );
  const amountIndex = header.findIndex((name) => name.includes('amount'));
  const creditIndex = header.findIndex((name) => name.includes('credit') || name.includes('deposit'));
  const debitIndex = header.findIndex(
    (name) => name.includes('debit') || name.includes('withdrawal') || name.includes('charge')
  );
  const accountIndex = header.findIndex((name) => name.includes('account'));

  const entries: ImportedExpenseEntry[] = [];
  const parseNotes: string[] = [];

  rows.slice(headerRowIndex + 1).forEach((row, offset) => {
    const lineNumber = headerRowIndex + offset + 2;
    if (row.every((cell) => cell.trim().length === 0)) {
      return;
    }

    const rawDate = dateIndex >= 0 ? row[dateIndex] ?? '' : '';
    const parsedDate = parseDate(rawDate);
    if (!parsedDate) {
      parseNotes.push(`Row ${lineNumber}: missing or invalid date; using ${observationDate} as the observation date.`);
    }
    const sourceDate = parsedDate || observationDate;

    const rawDescription = descriptionIndex >= 0 ? row[descriptionIndex] ?? '' : '';
    const label = normalizeWhitespace(rawDescription) || 'Imported Expense';

    const resolved = resolveRowAmount(row, { amountIndex, creditIndex, debitIndex });
    if (!resolved || resolved.value === 0) {
      parseNotes.push(`Row ${lineNumber}: missing or invalid amount; row skipped (local recovery, batch preserved).`);
      return;
    }

    const rawAccountHint = accountIndex >= 0 ? row[accountIndex] ?? '' : '';
    const account = matchAccount(rawAccountHint, label, accounts);
    if (!account && accounts.length > 0) {
      parseNotes.push(`Row ${lineNumber}: no matching account; entry left unassigned for review.`);
    }
    const categoryId = matchCategoryId(rawDescription, account, context.categoriesByAccountId);

    if (sourceDate > observationDate) {
      parseNotes.push(
        `Row ${lineNumber}: future-dated transaction imported as occurred (view-only). Create a separate explicit planned record if it should project.`
      );
    }

    entries.push(
      buildEntry({
        context,
        label,
        amount: Math.abs(resolved.value),
        sourceDate,
        sourceSign: resolved.sign,
        accountId: account ? account.id : null,
        categoryId,
        asOf
      })
    );
  });

  if (entries.length === 0 && parseNotes.length === 0) {
    parseNotes.push('No expense entries could be parsed from this source.');
  }

  return { entries, parseNotes };
};

export const parseExpensePdfText = (text: string, context: ExpenseParseContext): ExpenseParseOutcome => {
  const asOf = context.asOf ?? todayIsoDate();
  const observationDate = dateOnly(asOf);
  const amount = detectAmount(text);
  if (amount === null || amount <= 0) {
    return { entries: [], parseNotes: ['No amount could be parsed from this PDF-like source.'] };
  }

  const accounts = context.accounts ?? [];
  const parsedDate = parseDate(text);
  const sourceDate = parsedDate || observationDate;
  const label = 'Imported Expense (PDF)';
  const account = matchAccount('', text, accounts);
  const categoryId = matchCategoryId(text, account, context.categoriesByAccountId);

  const parseNotes: string[] = [];
  if (!account && accounts.length > 0) {
    parseNotes.push('No matching account; entry left unassigned for review.');
  }
  if (sourceDate > observationDate) {
    parseNotes.push(
      'Future-dated transaction imported as occurred (view-only). Create a separate explicit planned record if it should project.'
    );
  }

  // PDF-decoded text has no reliable sign metadata; provenance keeps it null
  // rather than inferring a direction from an absolute value.
  const entry = buildEntry({
    context,
    label,
    amount,
    sourceDate,
    sourceSign: null,
    accountId: account ? account.id : null,
    categoryId,
    asOf
  });

  return { entries: [entry], parseNotes };
};

export const buildImportSource = (params: {
  sourceId: string;
  batchId: string;
  fileName: string;
  fileType: ExpenseImportSource['fileType'];
  previewText: string;
  entries: ImportedExpenseEntry[];
  parseNotes: string[];
  asOf: string;
}): ExpenseImportSource => {
  const { sourceId, batchId, fileName, fileType, previewText, entries, parseNotes, asOf } = params;
  const needsReview = parseNotes.length > 0 || entries.length === 0;
  return {
    id: sourceId,
    batchId,
    fileName,
    fileType,
    previewText,
    status: needsReview ? 'needs_review' : 'ready',
    parseNotes,
    confidence: entries.length === 0 ? 0 : needsReview ? 0.5 : 0.8,
    importedAt: asOf,
    appliedAt: '',
    entryIds: entries.map((entry) => entry.id)
  };
};

export interface ExpenseImportFilesOptions {
  batchId?: string;
  asOf?: string;
}

/**
 * User-facing file import. Signature is as close to the previous API as the
 * canonical types allow: `accounts` is now the canonical `AccountDefinition[]`
 * and the third argument is per-account categories instead of the removed
 * grouping list. The account-only `AccountExpensesPlanner` consumes this
 * canonical import shape; the removed `ExpensesPlanner` is not a caller.
 */
export const parseExpenseImportFiles = async (
  files: File[],
  accounts: AccountDefinition[],
  categoriesByAccountId: Record<string, ExpenseCategory[]> = {},
  options: ExpenseImportFilesOptions = {}
): Promise<Array<{ source: ExpenseImportSource; entries: ExpenseEntry[] }>> => {
  const batchId = options.batchId ?? makeBatchId();
  const asOf = options.asOf ?? todayIsoDate();
  const supportedFiles = files.filter((file) => {
    const lowerName = file.name.toLowerCase();
    return lowerName.endsWith('.csv') || lowerName.endsWith('.pdf');
  });

  return Promise.all(
    supportedFiles.map(async (file) => {
      const sourceId = makeImportSourceId();
      const fileType = getFileType(file.name);
      let previewText = '';
      let outcome: ExpenseParseOutcome = { entries: [], parseNotes: [] };

      if (fileType === 'csv') {
        const text = await readFileAsText(file);
        previewText = sanitizePreview(text);
        outcome = parseExpenseCsvText(text, { sourceId, batchId, accounts, categoriesByAccountId, asOf });
      } else if (fileType === 'pdf') {
        const pdfBuffer = await readFileAsArrayBuffer(file);
        const text = decodePdfLikeText(pdfBuffer);
        previewText = sanitizePreview(text);
        outcome = parseExpensePdfText(text, { sourceId, batchId, accounts, categoriesByAccountId, asOf });
      } else {
        outcome.parseNotes.push('Unsupported file type.');
      }

      const source = buildImportSource({
        sourceId,
        batchId,
        fileName: file.name,
        fileType,
        previewText,
        entries: outcome.entries,
        parseNotes: outcome.parseNotes,
        asOf
      });

      return { source, entries: outcome.entries };
    })
  );
};
