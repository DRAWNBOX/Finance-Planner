import { useEffect, useMemo, useState } from 'react';
import type {
  BankAccountDefinition,
  Paycheck,
  PaycheckCategory,
  PaycheckDepositBucket,
  PaycheckLine
} from '../types';
import { BufferedNumberInput } from './BufferedNumberInput';
import { PAY_FREQUENCY_LABELS, createPaycheckLine, getPaycheckTotals } from '../paycheck';

interface PaycheckEditorModalProps {
  paycheck: Paycheck;
  bankAccounts: BankAccountDefinition[];
  onClose: () => void;
  onSave: (paycheck: Paycheck) => void;
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);

const round2 = (value: number) => Math.round(value * 100) / 100;

const clonePaycheck = (paycheck: Paycheck): Paycheck => ({
  ...paycheck,
  categories: paycheck.categories.map((category) => ({
    ...category,
    lines: category.lines.map((line) => ({ ...line }))
  }))
});

const bucketForAccount = (account: BankAccountDefinition | undefined): PaycheckDepositBucket | null => {
  if (!account) return null;
  if (account.accountType === 'hsa') return 'hsa';
  if (account.accountType === 'retirement401k' || account.accountType === 'roth') return 'retirement';
  return null;
};

const isEarning = (category: PaycheckCategory) => category.kind === 'earning';

export const PaycheckEditorModal = ({ paycheck, bankAccounts, onClose, onSave }: PaycheckEditorModalProps) => {
  const [draft, setDraft] = useState<Paycheck>(() => clonePaycheck(paycheck));

  useEffect(() => {
    setDraft(clonePaycheck(paycheck));
  }, [paycheck]);

  const totals = useMemo(() => getPaycheckTotals(draft), [draft]);

  const updateCategory = (categoryId: string, transform: (category: PaycheckCategory) => PaycheckCategory) => {
    setDraft((prev) => ({
      ...prev,
      categories: prev.categories.map((category) => (category.id === categoryId ? transform(category) : category))
    }));
  };

  const updateLine = (categoryId: string, lineId: string, patch: Partial<PaycheckLine>) => {
    updateCategory(categoryId, (category) => ({
      ...category,
      lines: category.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line))
    }));
  };

  const addLine = (categoryId: string) => {
    updateCategory(categoryId, (category) => ({
      ...category,
      lines: [...category.lines, createPaycheckLine('New Item', 0, category.kind)]
    }));
  };

  const removeLine = (categoryId: string, lineId: string) => {
    updateCategory(categoryId, (category) => ({
      ...category,
      lines: category.lines.filter((line) => line.id !== lineId)
    }));
  };

  const removeCategory = (categoryId: string) => {
    setDraft((prev) => ({ ...prev, categories: prev.categories.filter((category) => category.id !== categoryId) }));
  };

  const setAccountForLine = (categoryId: string, lineId: string, accountId: string) => {
    const account = bankAccounts.find((candidate) => candidate.id === accountId);
    updateLine(categoryId, lineId, {
      accountId: accountId || null,
      bucket: bucketForAccount(account)
    });
  };

  const updateEarning = (categoryId: string, line: PaycheckLine, patch: Partial<PaycheckLine>) => {
    const next = { ...line, ...patch };
    const rate = next.rate ?? 0;
    const hours = next.hours ?? 0;
    if ((patch.rate !== undefined || patch.hours !== undefined) && rate > 0 && hours > 0) {
      next.amount = round2(rate * hours);
    }
    updateLine(categoryId, line.id, next);
  };

  return (
    <div className="expense-modal-backdrop">
      <div className="expense-modal paycheck-modal">
        <div className="expense-modal-header">
          <h3>Configure Paycheck</h3>
          <button type="button" className="text-button" onClick={onClose}>
            Cancel
          </button>
        </div>

        <div className="paycheck-frequency-row">
          <label>
            <span>Pay Frequency</span>
            <select
              aria-label="Pay Frequency"
              value={draft.payFrequency}
              onChange={(event) => setDraft((prev) => ({ ...prev, payFrequency: event.target.value as Paycheck['payFrequency'] }))}
            >
              {(Object.keys(PAY_FREQUENCY_LABELS) as Array<Paycheck['payFrequency']>).map((frequency) => (
                <option key={frequency} value={frequency}>
                  {PAY_FREQUENCY_LABELS[frequency]}
                </option>
              ))}
            </select>
          </label>
          <span className="subtle">{totals.periodsPerYear} periods / year</span>
        </div>

        <div className="paycheck-categories">
          {draft.categories.map((category) => (
            <section key={category.id} className="paycheck-category">
              <div className="paycheck-category-header">
                <span className="paycheck-category-label">{category.label}</span>
                <span className="paycheck-category-kind">{category.kind}</span>
                {!isEarning(category) && (
                  <button type="button" className="text-button" onClick={() => removeCategory(category.id)}>
                    Remove
                  </button>
                )}
              </div>

              {isEarning(category) ? (
                <div className="paycheck-lines">
                  <div className="paycheck-line-row paycheck-line-head paycheck-earning-row">
                    <span>Label</span>
                    <span>Rate</span>
                    <span>Hours</span>
                    <span>This Period</span>
                    <span>YTD</span>
                    <span />
                  </div>
                  {category.lines.map((line) => (
                    <div key={line.id} className="paycheck-line-row paycheck-earning-row">
                      <input
                        aria-label={`Earning label ${line.id}`}
                        value={line.label}
                        onChange={(event) => updateLine(category.id, line.id, { label: event.target.value })}
                      />
                      <BufferedNumberInput value={line.rate ?? 0} min={0} max={100000} step={0.01} onCommit={(rate) => updateEarning(category.id, line, { rate })} />
                      <BufferedNumberInput value={line.hours ?? 0} min={0} max={1000} step={0.5} onCommit={(hours) => updateEarning(category.id, line, { hours })} />
                      <BufferedNumberInput value={line.amount} min={0} max={10000000} step={1} commitOnChange onCommit={(amount) => updateLine(category.id, line.id, { amount })} />
                      <BufferedNumberInput value={line.ytd ?? 0} min={0} max={100000000} step={1} onCommit={(ytd) => updateLine(category.id, line.id, { ytd })} />
                      <button type="button" className="text-button" onClick={() => removeLine(category.id, line.id)}>
                        ×
                      </button>
                    </div>
                  ))}
                  <button type="button" className="secondary-button" onClick={() => addLine(category.id)}>
                    + Earning
                  </button>
                </div>
              ) : (
                <div className="paycheck-lines">
                  <div className="paycheck-line-row paycheck-line-head">
                    <span>Label</span>
                    <span>Amount</span>
                    <span>Mode</span>
                    {(category.kind === 'pretax' || category.kind === 'employer') && <span>Deposit Account</span>}
                    <span>YTD</span>
                    <span />
                  </div>
                  {category.lines.map((line) => (
                    <div key={line.id} className="paycheck-line-row">
                      <input
                        aria-label={`Line label ${line.id}`}
                        value={line.label}
                        onChange={(event) => updateLine(category.id, line.id, { label: event.target.value })}
                      />
                      <BufferedNumberInput
                        value={line.amount}
                        min={0}
                        max={10000000}
                        step={line.mode === 'percentOfGross' ? 0.1 : 1}
                        commitOnChange
                        onCommit={(amount) => updateLine(category.id, line.id, { amount })}
                      />
                      <button
                        type="button"
                        className={`lock-btn${line.mode === 'percentOfGross' ? ' locked' : ''}`}
                        title={line.mode === 'percentOfGross' ? 'Percent of gross pay' : 'Dollar amount'}
                        onClick={() => updateLine(category.id, line.id, { mode: line.mode === 'percentOfGross' ? 'amount' : 'percentOfGross' })}
                      >
                        {line.mode === 'percentOfGross' ? '%' : '$'}
                      </button>
                      {(category.kind === 'pretax' || category.kind === 'employer') && (
                        <select
                          aria-label={`Deposit account ${line.id}`}
                          value={line.accountId ?? ''}
                          onChange={(event) => setAccountForLine(category.id, line.id, event.target.value)}
                        >
                          <option value="">No deposit</option>
                          {bankAccounts.map((account) => (
                            <option key={`${line.id}-${account.id}`} value={account.id}>
                              {account.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <BufferedNumberInput value={line.ytd ?? 0} min={0} max={100000000} step={1} onCommit={(ytd) => updateLine(category.id, line.id, { ytd })} />
                      <button type="button" className="text-button" onClick={() => removeLine(category.id, line.id)}>
                        ×
                      </button>
                    </div>
                  ))}
                  <button type="button" className="secondary-button" onClick={() => addLine(category.id)}>
                    + Item
                  </button>
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="paycheck-totals">
          <span>Gross / period: <strong>{formatCurrency(totals.grossPerPeriod)}</strong></span>
          <span>Annual gross: <strong>{formatCurrency(totals.grossAnnual)}</strong></span>
          <span>Taxes: <strong>{formatCurrency(totals.taxAnnual)}</strong></span>
          <span>Pre-tax: <strong>{formatCurrency(totals.pretaxAnnual)}</strong></span>
          <span>Post-tax: <strong>{formatCurrency(totals.posttaxAnnual)}</strong></span>
          <span>Employer: <strong>{formatCurrency(totals.employerAnnual)}</strong></span>
          <span>Net / period: <strong>{formatCurrency(totals.netPerPeriod)}</strong></span>
        </div>

        <div className="expense-modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="secondary-button" onClick={() => onSave(clonePaycheck(draft))}>
            Save Paycheck
          </button>
        </div>
      </div>
    </div>
  );
};
