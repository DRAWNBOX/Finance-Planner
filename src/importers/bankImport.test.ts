import { describe, expect, it } from 'vitest';
import { detectAccountFromText, parseBankImportFile, parseStatementDate } from './bankImport';
import type { NetWorthImportSourceAccount } from '../types';

const accountOptions: NetWorthImportSourceAccount[] = [
  { id: 'emergencyFund', label: 'Emergency Fund', balance: 0 },
  { id: 'hsa', label: 'HSA', balance: 0 },
  { id: 'investments', label: 'Investments', balance: 0 },
  { id: 'retirement401k', label: '401K', balance: 0 },
  { id: 'custom-account-1', label: 'Vacation Savings', balance: 0 }
];

describe('bank import parser', () => {
  it('extracts statement date in multiple formats', () => {
    expect(parseStatementDate('Statement Date: 2026-04-05')).toBe('2026-04-05');
    expect(parseStatementDate('Period ending 04/21/2026')).toBe('2026-04-21');
    expect(parseStatementDate('As of April 2, 2026')).toBe('2026-04-02');
  });

  it('detects account labels from text', () => {
    const result = detectAccountFromText('Brokerage investments account ending balance', accountOptions);
    expect(result.detectedAccountId).toBe('investments');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('returns null account when text has no signal', () => {
    const result = detectAccountFromText('Document reference code only', accountOptions);
    expect(result.detectedAccountId).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('parses csv statement with detected account, date, and balance', async () => {
    const csv = `Account Name,Ending Balance,Statement Date\nBrokerage Investments,12500.42,2026-03-31`;
    const file = new File([csv], 'brokerage.csv', { type: 'text/csv' });
    const result = await parseBankImportFile(file, accountOptions);

    expect(result.fileType).toBe('csv');
    expect(result.detectedAccountId).toBe('investments');
    expect(result.statementDate).toBe('2026-03-31');
    expect(result.detectedBalance).toBeCloseTo(12500.42, 2);
    expect(result.status).toBe('ready');
  });

  it('parses text pdf payload and extracts balance/date heuristically', async () => {
    const pdfLikeText = '%PDF-1.4\n(Balance Summary) (HSA Account) (Ending Balance $4,210.77) (Statement Date 04/30/2026)';
    const file = new File([pdfLikeText], 'hsa.pdf', { type: 'application/pdf' });
    const result = await parseBankImportFile(file, accountOptions);

    expect(result.fileType).toBe('pdf');
    expect(result.detectedAccountId).toBe('hsa');
    expect(result.statementDate).toBe('2026-04-30');
    expect(result.detectedBalance).toBeCloseTo(4210.77, 2);
  });
});
