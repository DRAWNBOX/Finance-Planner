import type {
  BankAccountDefinition,
  ExpenseEntry,
  ExpenseImportSource,
  PoolDefinition
} from '../types';

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();
const currencyRegex = /-?\$?\(?\d[\d,]*(?:\.\d{2})?\)?/g;
const isoDateRegex = /\b(20\d{2}|19\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g;
const usDateRegex = /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-]((?:20|19)?\d{2})\b/g;

const makeImportSourceId = () => `expense-import-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeExpenseEntryId = () => `expense-entry-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
const makeBatchId = () => `expense-batch-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;

const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);
const todayIsoDate = () => toIsoDate(new Date());
const clampToFutureWindow = (candidate: string) => {
  const base = new Date();
  const min = new Date(base);
  min.setDate(min.getDate() + 7);
  const max = new Date(base);
  max.setDate(max.getDate() + 365);
  const parsed = new Date(candidate);
  if (Number.isNaN(parsed.getTime())) {
    return toIsoDate(min);
  }
  if (parsed < min) {
    return toIsoDate(min);
  }
  if (parsed > max) {
    return toIsoDate(max);
  }
  return toIsoDate(parsed);
};

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

const detectAccount = (text: string, accounts: BankAccountDefinition[]) =>
  accounts.find((account) => text.toLowerCase().includes(account.label.toLowerCase())) ?? accounts[0];

const detectAmount = (text: string) => {
  const amounts = [...text.matchAll(currencyRegex)]
    .map((match) => parseCurrencyValue(match[0]))
    .filter((value): value is number => value !== null)
    .map((value) => Math.abs(value));
  return amounts.length > 0 ? amounts[0] : null;
};

const parseCsvToEntries = (
  text: string,
  sourceId: string,
  batchId: string,
  accounts: BankAccountDefinition[],
  poolsById: ReadonlyMap<string, PoolDefinition>
) => {
  const rows = parseCsvRows(text);
  if (rows.length === 0) {
    return [];
  }

  const headerRowIndex = detectCsvHeaderRowIndex(rows);
  const header = (rows[headerRowIndex] ?? []).map((column) => column.toLowerCase());
  const dateIndex = header.findIndex((name) => name.includes('date'));
  const descIndex = header.findIndex(
    (name) =>
      name.includes('description') ||
      name.includes('merchant') ||
      name.includes('name') ||
      name.includes('memo') ||
      name.includes('payee') ||
      name.includes('details')
  );
  const amountIndex = header.findIndex(
    (name) =>
      name.includes('amount') ||
      name.includes('debit') ||
      name.includes('withdrawal') ||
      name.includes('charge') ||
      name.includes('payment')
  );
  const creditIndex = header.findIndex((name) => name.includes('credit') || name.includes('deposit'));
  const accountIndex = header.findIndex((name) => name.includes('account'));

  const entries: ExpenseEntry[] = [];
  rows.slice(headerRowIndex + 1).forEach((row) => {
    if (row.every((cell) => cell.trim().length === 0)) {
      return;
    }
    const rawDate = dateIndex >= 0 ? row[dateIndex] ?? '' : '';
    const parsedDate = parseDate(rawDate) || '';
    const startDate = clampToFutureWindow(parsedDate || todayIsoDate());
    const label = (descIndex >= 0 ? row[descIndex] : '') || 'Imported Expense';
    const primaryAmount = parseCurrencyValue(amountIndex >= 0 ? row[amountIndex] ?? '' : '');
    const creditAmount = parseCurrencyValue(creditIndex >= 0 ? row[creditIndex] ?? '' : '');
    const fallbackCell = row.find((cell) => currencyRegex.test(cell)) ?? '';
    currencyRegex.lastIndex = 0;
    const fallbackAmount = parseCurrencyValue(fallbackCell);
    const rawAmount = primaryAmount ?? creditAmount ?? fallbackAmount ?? 0;
    const amount = Math.max(0, Math.abs(rawAmount));
    if (amount <= 0) {
      return;
    }
    const accountHint = accountIndex >= 0 ? row[accountIndex] ?? '' : '';
    const detectedAccount = detectAccount(`${accountHint} ${label}`, accounts);
    const poolId = detectedAccount ? detectedAccount.poolId : null;

    entries.push({
      id: makeExpenseEntryId(),
      label: label.trim() || 'Imported Expense',
      amount,
      startDate,
      endDate: startDate,
      accountId: detectedAccount?.id ?? null,
      poolId: poolId && poolsById.has(poolId) ? poolId : null,
      notes: '',
      originType: 'imported' as const,
      importSourceId: sourceId,
      importBatchId: batchId,
      createdAt: todayIsoDate(),
      updatedAt: todayIsoDate()
    });
  });

  return entries;
};

const parsePdfToEntries = (
  text: string,
  sourceId: string,
  batchId: string,
  accounts: BankAccountDefinition[],
  poolsById: ReadonlyMap<string, PoolDefinition>
) => {
  const amount = detectAmount(text);
  const detectedAccount = detectAccount(text, accounts);
  const date = parseDate(text) || todayIsoDate();
  const startDate = clampToFutureWindow(date);

  if (amount === null || amount <= 0) {
    return [];
  }

  return [
    {
      id: makeExpenseEntryId(),
      label: 'Imported Expense (PDF)',
      amount: Math.max(0, amount),
      startDate,
      endDate: startDate,
      accountId: detectedAccount?.id ?? null,
      poolId: detectedAccount && poolsById.has(detectedAccount.poolId) ? detectedAccount.poolId : null,
      notes: '',
      originType: 'imported' as const,
      importSourceId: sourceId,
      importBatchId: batchId,
      createdAt: todayIsoDate(),
      updatedAt: todayIsoDate()
    }
  ];
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

const sanitizeCsvPreview = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .slice(0, 30)
    .join('\n');

const sanitizePreviewLines = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .slice(0, 30)
    .join('\n');

const detectCsvHeaderRowIndex = (rows: string[][]) => {
  const normalizedRows = rows.slice(0, Math.min(rows.length, 15)).map((row) => row.map((cell) => cell.toLowerCase()));
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

export const parseExpenseImportFiles = async (
  files: File[],
  accounts: BankAccountDefinition[],
  pools: PoolDefinition[]
): Promise<Array<{ source: ExpenseImportSource; entries: ExpenseEntry[] }>> => {
  const batchId = makeBatchId();
  const poolsById = new Map(pools.map((pool) => [pool.id, pool]));
  const supportedFiles = files.filter((file) => {
    const lowerName = file.name.toLowerCase();
    return lowerName.endsWith('.csv') || lowerName.endsWith('.pdf');
  });

  const results = await Promise.all(
    supportedFiles.map(async (file) => {
      const sourceId = makeImportSourceId();
      const fileType = getFileType(file.name);
      let previewText = '';
      let entries: ExpenseEntry[] = [];
      const parseNotes: string[] = [];

      if (fileType === 'csv') {
        const text = await readFileAsText(file);
        previewText = sanitizeCsvPreview(text);
        entries = parseCsvToEntries(text, sourceId, batchId, accounts, poolsById);
      } else if (fileType === 'pdf') {
        const pdfBuffer = await readFileAsArrayBuffer(file);
        const text = decodePdfLikeText(pdfBuffer);
        previewText = sanitizePreviewLines(text);
        entries = parsePdfToEntries(text, sourceId, batchId, accounts, poolsById);
      } else {
        parseNotes.push('Unsupported file type.');
      }

      if (entries.length === 0 && parseNotes.length === 0) {
        parseNotes.push('No expense entries could be parsed from this source.');
      }

      const source: ExpenseImportSource = {
        id: sourceId,
        batchId,
        fileName: file.name,
        fileType,
        previewText,
        status: entries.length > 0 ? 'ready' : 'needs_review',
        parseNotes,
        confidence: entries.length > 0 ? 0.8 : 0,
        importedAt: todayIsoDate(),
        appliedAt: '',
        entryIds: entries.map((entry) => entry.id)
      };

      return { source, entries };
    })
  );

  return results;
};
