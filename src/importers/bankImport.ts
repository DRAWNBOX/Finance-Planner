import type {
  BankImportParseResult,
  NetWorthImportRecord,
  NetWorthImportSourceAccount
} from '../types';

const currencyRegex = /-?\$?\(?\d[\d,]*(?:\.\d{2})?\)?/g;
const isoDateRegex = /\b(20\d{2}|19\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g;
const usDateRegex = /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-]((?:20|19)?\d{2})\b/g;
const longDateRegex =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([0-3]?\d),\s*((?:20|19)\d{2})\b/gi;

const genericAccountKeywords = [
  'emergency',
  'cash reserve',
  'checking',
  'savings',
  'hsa',
  'health savings',
  'health account',
  'investment',
  'investments',
  'brokerage',
  'broker',
  '401k',
  '401(k)',
  'retirement',
  'ira',
  'roth'
];

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();
const makeImportId = () => `networth-import-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;

const sanitizePreview = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .slice(0, 30)
    .join('\n');

const readFileAsText = async (file: File): Promise<string> => {
  const anyFile = file as File & { text?: () => Promise<string> };
  if (typeof anyFile.text === 'function') {
    return anyFile.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read file as text.'));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });
};

const readFileAsArrayBuffer = async (file: File): Promise<ArrayBuffer> => {
  const anyFile = file as File & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof anyFile.arrayBuffer === 'function') {
    return anyFile.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
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

const normalizeYear = (yearText: string) => {
  if (yearText.length === 2) {
    const numericYear = Number(yearText);
    return numericYear >= 70 ? 1900 + numericYear : 2000 + numericYear;
  }

  return Number(yearText);
};

export const parseStatementDate = (text: string): string => {
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

  const longMatch = longDateRegex.exec(text);
  longDateRegex.lastIndex = 0;
  if (longMatch) {
    const parsed = new Date(`${longMatch[1]} ${longMatch[2]}, ${longMatch[3]}`);
    if (!Number.isNaN(parsed.getTime())) {
      const year = parsed.getFullYear();
      const month = String(parsed.getMonth() + 1).padStart(2, '0');
      const day = String(parsed.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  }

  return '';
};

const pickBalanceFromText = (text: string): number | null => {
  const keywordRegex =
    /(?:ending\s+balance|current\s+balance|available\s+balance|balance)\s*[:\-]?\s*(-?\$?\(?\d[\d,]*(?:\.\d{2})?\)?)/gi;
  const keywordMatches = [...text.matchAll(keywordRegex)];
  if (keywordMatches.length > 0) {
    const parsed = parseCurrencyValue(keywordMatches[keywordMatches.length - 1][1] ?? '');
    if (parsed !== null) {
      return parsed;
    }
  }

  const amountMatches = [...text.matchAll(currencyRegex)];
  if (amountMatches.length === 0) {
    return null;
  }

  const parsedAmounts = amountMatches
    .map((match) => parseCurrencyValue(match[0]))
    .filter((value): value is number => value !== null);
  if (parsedAmounts.length === 0) {
    return null;
  }

  return parsedAmounts[parsedAmounts.length - 1];
};

const pickBalanceFromCsv = (rows: string[][]): number | null => {
  if (rows.length === 0) {
    return null;
  }

  const header = rows[0].map((cell) => cell.toLowerCase());
  const balanceColumnIndex = header.findIndex(
    (name) =>
      name.includes('ending balance') ||
      name.includes('current balance') ||
      name === 'balance' ||
      name.includes('available balance')
  );

  if (balanceColumnIndex >= 0) {
    for (let index = rows.length - 1; index > 0; index -= 1) {
      const parsed = parseCurrencyValue(rows[index][balanceColumnIndex] ?? '');
      if (parsed !== null) {
        return parsed;
      }
    }
  }

  return pickBalanceFromText(rows.flat().join(' '));
};

export const detectAccountFromText = (
  text: string,
  accounts: NetWorthImportSourceAccount[]
): { detectedAccountId: string | null; confidence: number } => {
  const haystack = ` ${text.toLowerCase()} `;
  let detectedAccountId: string | null = null;
  let bestScore = 0;

  accounts.forEach((account) => {
    let score = 0;
    const labelTokens = account.label.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
    labelTokens.forEach((token) => {
      if (haystack.includes(` ${token} `)) {
        score += 2;
      }
    });

    const keywordMatches = genericAccountKeywords.filter((keyword) => account.label.toLowerCase().includes(keyword));
    keywordMatches.forEach((keyword) => {
      if (haystack.includes(keyword.toLowerCase())) {
        score += 3;
      }
    });

    if (score > bestScore) {
      bestScore = score;
      detectedAccountId = account.id;
    }
  });

  if (!detectedAccountId || bestScore <= 0) {
    return { detectedAccountId: null, confidence: 0 };
  }

  return { detectedAccountId, confidence: Math.min(1, Number((bestScore / 12).toFixed(2))) };
};

const decodePdfLikeText = (buffer: ArrayBuffer): string => {
  const latin1 = new TextDecoder('latin1').decode(buffer);
  const tokenMatches = [...latin1.matchAll(/\(([^()]*)\)/g)].map((match) => match[1] ?? '');
  if (tokenMatches.length > 0) {
    return normalizeWhitespace(tokenMatches.join(' '));
  }

  return normalizeWhitespace(latin1);
};

const parseCsvContent = (
  text: string,
  accounts: NetWorthImportSourceAccount[]
): BankImportParseResult => {
  const rows = parseCsvRows(text);
  const collapsedText = rows.flat().join(' ');
  const statementDate = parseStatementDate(collapsedText);
  const balance = pickBalanceFromCsv(rows);
  const { detectedAccountId, confidence } = detectAccountFromText(collapsedText, accounts);
  const parseNotes: string[] = [];

  if (!statementDate) {
    parseNotes.push('Statement date not detected.');
  }
  if (balance === null) {
    parseNotes.push('Balance not detected.');
  }
  if (!detectedAccountId) {
    parseNotes.push('Account match not detected.');
  }

  return {
    detectedAccountId,
    detectedBalance: balance,
    statementDate,
    confidence,
    status: balance === null ? 'needs_review' : 'ready',
    parseNotes,
    previewText: sanitizePreview(text)
  };
};

const parsePdfContent = (
  text: string,
  accounts: NetWorthImportSourceAccount[]
): BankImportParseResult => {
  const statementDate = parseStatementDate(text);
  const balance = pickBalanceFromText(text);
  const { detectedAccountId, confidence } = detectAccountFromText(text, accounts);
  const parseNotes: string[] = [];

  if (!statementDate) {
    parseNotes.push('Statement date not detected.');
  }
  if (balance === null) {
    parseNotes.push('Balance not detected.');
  }
  if (!detectedAccountId) {
    parseNotes.push('Account match not detected.');
  }

  return {
    detectedAccountId,
    detectedBalance: balance,
    statementDate,
    confidence,
    status: balance === null ? 'needs_review' : 'ready',
    parseNotes,
    previewText: sanitizePreview(text)
  };
};

const getFileType = (fileName: string): NetWorthImportRecord['fileType'] => {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) {
    return 'csv';
  }
  if (lower.endsWith('.pdf')) {
    return 'pdf';
  }

  return 'unknown';
};

export const parseBankImportFile = async (
  file: File,
  accounts: NetWorthImportSourceAccount[]
): Promise<NetWorthImportRecord> => {
  const fileType = getFileType(file.name);
  let parseResult: BankImportParseResult;

  if (fileType === 'csv') {
    const text = await readFileAsText(file);
    parseResult = parseCsvContent(text, accounts);
  } else if (fileType === 'pdf') {
    const buffer = await readFileAsArrayBuffer(file);
    const text = decodePdfLikeText(buffer);
    parseResult = parsePdfContent(text, accounts);
  } else {
    parseResult = {
      detectedAccountId: null,
      detectedBalance: null,
      statementDate: '',
      confidence: 0,
      status: 'error',
      parseNotes: ['Unsupported file type.'],
      previewText: ''
    };
  }

  return {
    id: makeImportId(),
    fileName: file.name,
    fileType,
    previewText: parseResult.previewText,
    detectedAccountId: parseResult.detectedAccountId,
    detectedBalance: parseResult.detectedBalance,
    statementDate: parseResult.statementDate,
    selectedAccountId: parseResult.detectedAccountId,
    status: parseResult.status,
    confidence: parseResult.confidence,
    parseNotes: parseResult.parseNotes,
    applied: false,
    appliedAt: ''
  };
};

export const parseBankImportFiles = async (
  files: File[],
  accounts: NetWorthImportSourceAccount[]
): Promise<NetWorthImportRecord[]> => {
  const supportedFiles = files.filter((file) => {
    const lowerName = file.name.toLowerCase();
    return lowerName.endsWith('.csv') || lowerName.endsWith('.pdf');
  });

  const records = await Promise.all(supportedFiles.map((file) => parseBankImportFile(file, accounts)));
  return records;
};
