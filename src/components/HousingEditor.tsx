import { memo, useState } from 'react';
import { BufferedNumberInput } from './BufferedNumberInput';
import { YearMonthInput } from './YearMonthInput';
import { formatCurrency } from '../engine/projection';
import type { BankAccountDefinition, HousingEntry } from '../types';
import { useRenderCount } from '../utils/perfTools';

interface HousingEditorProps {
  housing: HousingEntry[];
  selectedHousingId: string;
  onSelectHousing: (id: string) => void;
  onChangeHousing: (housing: HousingEntry) => void;
  onReorderHousing: (fromId: string, toId: string) => void;
  onAddHousing: (type: 'mortgage' | 'rental') => void;
  onDuplicateHousing: (id: string) => void;
  onRemoveHousing: (id: string) => void;
  accountOptions: Array<{ value: string; label: string }>;
  orderedBankAccounts: BankAccountDefinition[];
  careerOptions: Array<{ id: string; label: string }>;
  allowReordering?: boolean;
}

export const HousingEditor = memo(({
  housing,
  selectedHousingId,
  onSelectHousing,
  onChangeHousing,
  onReorderHousing,
  onAddHousing,
  onDuplicateHousing,
  onRemoveHousing,
  accountOptions,
  orderedBankAccounts,
  careerOptions,
  allowReordering = true
}: HousingEditorProps) => {
  useRenderCount('HousingEditor');
  const [dragHousingId, setDragHousingId] = useState<string | null>(null);
  const selected = housing.find((h) => h.id === selectedHousingId) ?? housing[0];
  const selectedIndex = selected ? housing.findIndex((h) => h.id === selected.id) : -1;
  const previous = selectedIndex > 0 ? housing[selectedIndex - 1] : undefined;
  const previousEnd = previous
    ? (previous.housingType === 'mortgage' ? previous.sellYearMonth : previous.endYearMonth)
    : '';
  const canUsePreviousEnd = Boolean(previous && previousEnd && previousEnd.length > 0);
  const hasCareers = careerOptions.length > 0;
  const startLinked = Boolean(selected?.linkedCareerStartId);
  const endLinked = Boolean(selected?.linkedCareerEndId);

  const renderPaymentSourceSelect = (
    value: string | undefined,
    onChange: (value: string) => void,
    ariaLabel: string
  ) => (
    <select
      aria-label={ariaLabel}
      value={value ?? 'income'}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="income">Income</option>
      {accountOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  const commitSource = (raw: string) => (raw === 'income' ? 'income' : (raw as `account:${string}`));

  const totalMonthly = selected
    ? (() => {
        const isMortgage = selected.housingType === 'mortgage';
        const loanAmount = Math.max(0, selected.purchasePrice - selected.downPayment);
        const totalTermMonths = Math.max(1, selected.loanTermYears * 12);
        const monthlyRate = selected.annualInterestRate / 100 / 12;
        const monthlyPI = loanAmount > 0
          ? (monthlyRate > 0
            ? loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, totalTermMonths)) / (Math.pow(1 + monthlyRate, totalTermMonths) - 1)
            : loanAmount / totalTermMonths)
          : 0;
        return isMortgage
          ? monthlyPI + selected.extraMonthlyPayment + selected.propertyTaxYearly / 12 + selected.homeInsuranceYearly / 12 + selected.hoaMonthly + selected.maintenanceMonthly + selected.pmiMonthly
          : selected.monthlyRent + selected.propertyTaxYearly / 12 + selected.homeInsuranceYearly / 12 + selected.hoaMonthly + selected.maintenanceMonthly;
      })()
    : 0;

  return (
    <div className="housing-editor">
      <div className="career-tabs">
        {housing.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`career-tab${entry.id === selected?.id ? ' active' : ''}${dragHousingId === entry.id ? ' dragging' : ''}`}
            draggable={allowReordering}
            onClick={() => onSelectHousing(entry.id)}
            onDragStart={() => allowReordering && setDragHousingId(entry.id)}
            onDragOver={(event) => allowReordering && event.preventDefault()}
            onDrop={() => {
              if (allowReordering && dragHousingId) {
                onReorderHousing(dragHousingId, entry.id);
              }
            }}
            onDragEnd={() => allowReordering && setDragHousingId(null)}
          >
            {entry.label}
          </button>
        ))}
        <button type="button" className="career-tab add" onClick={() => onAddHousing('mortgage')}>
          + Mortgage
        </button>
        <button type="button" className="career-tab add" onClick={() => onAddHousing('rental')}>
          + Rental
        </button>
      </div>

      {selected ? (
        <>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={selected.enabled}
              onChange={(e) => onChangeHousing({ ...selected, enabled: e.target.checked })}
            />
            <span>Estimate this housing expense</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={selected.showOnGraph}
              onChange={(e) => onChangeHousing({ ...selected, showOnGraph: e.target.checked })}
            />
            <span>Show flag on graph</span>
          </label>

          <div className="career-grid">
            <label className="full-span">
              <span>Name</span>
              <input type="text" value={selected.label} onChange={(e) => onChangeHousing({ ...selected, label: e.target.value })} />
            </label>
            <label>
              <span>Start Year-Month</span>
              <YearMonthInput
                label="Start"
                value={selected.startYearMonth}
                disabled={Boolean(selected.usePreviousEndAsStart) || startLinked}
                onChange={(next) => onChangeHousing({ ...selected, startYearMonth: next })}
              />
            </label>
            <label className="full-span checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(selected.usePreviousEndAsStart)}
                disabled={!canUsePreviousEnd || startLinked}
                onChange={(e) => onChangeHousing({
                  ...selected,
                  usePreviousEndAsStart: e.target.checked,
                  linkedCareerStartId: e.target.checked ? null : selected.linkedCareerStartId
                })}
              />
              <span>Use the month after the previous housing end date as the start date</span>
            </label>
            <label className="full-span checkbox-row">
              <input
                type="checkbox"
                checked={startLinked}
                disabled={!hasCareers}
                onChange={(e) => onChangeHousing({
                  ...selected,
                  linkedCareerStartId: e.target.checked ? (selected.linkedCareerStartId ?? careerOptions[0]?.id ?? null) : null,
                  usePreviousEndAsStart: e.target.checked ? false : selected.usePreviousEndAsStart
                })}
              />
              <span>Link start date to a career</span>
            </label>
            {startLinked ? (
              <label>
                <span>Start Career</span>
                <select
                  aria-label="Start Career"
                  value={selected.linkedCareerStartId ?? ''}
                  onChange={(e) => onChangeHousing({ ...selected, linkedCareerStartId: e.target.value || null })}
                >
                  {careerOptions.map((career) => <option key={career.id} value={career.id}>{career.label}</option>)}
                </select>
              </label>
            ) : null}

            {selected.housingType === 'mortgage' ? (
              <>
                <label>
                  <span>Purchase Price</span>
                  <BufferedNumberInput value={selected.purchasePrice} min={0} max={50000000} step={1000} onCommit={(v) => onChangeHousing({ ...selected, purchasePrice: v })} />
                </label>
                <label>
                  <span>Down Payment</span>
                  <BufferedNumberInput value={selected.downPayment} min={0} max={50000000} step={1000} onCommit={(v) => onChangeHousing({ ...selected, downPayment: v })} />
                </label>
                <label>
                  <span>Down Payment Source</span>
                  {renderPaymentSourceSelect(selected.downPaymentSource ?? selected.paymentSource, (v) => onChangeHousing({ ...selected, downPaymentSource: commitSource(v) }), 'Down Payment Source')}
                </label>
                <label>
                  <span>APR %</span>
                  <BufferedNumberInput value={selected.annualInterestRate} min={0} max={80} step={0.1} onCommit={(v) => onChangeHousing({ ...selected, annualInterestRate: v })} />
                </label>
                <label>
                  <span>Loan Term (years)</span>
                  <BufferedNumberInput value={selected.loanTermYears} min={1} max={50} step={1} onCommit={(v) => onChangeHousing({ ...selected, loanTermYears: v })} />
                </label>
                <label>
                  <span>Extra Monthly Payment</span>
                  <BufferedNumberInput value={selected.extraMonthlyPayment} min={0} max={50000} step={50} onCommit={(v) => onChangeHousing({ ...selected, extraMonthlyPayment: v })} />
                </label>
                <label>
                  <span>PMI/mo</span>
                  <BufferedNumberInput value={selected.pmiMonthly} min={0} max={10000} step={10} onCommit={(v) => onChangeHousing({ ...selected, pmiMonthly: v })} />
                </label>
                <label>
                  <span>PMI Source</span>
                  {renderPaymentSourceSelect(selected.pmiSource ?? selected.paymentSource, (v) => onChangeHousing({ ...selected, pmiSource: commitSource(v) }), 'PMI Source')}
                </label>
                <label>
                  <span>Appreciation Rate %</span>
                  <BufferedNumberInput value={selected.appreciationRate} min={0} max={30} step={0.1} onCommit={(v) => onChangeHousing({ ...selected, appreciationRate: v })} />
                </label>
                <label>
                  <span>Sell Year-Month</span>
                  <YearMonthInput label="Sell" value={selected.sellYearMonth} disabled={endLinked} onChange={(next) => onChangeHousing({ ...selected, sellYearMonth: next })} />
                </label>
                <label>
                  <span>Sale Proceeds Account</span>
                  <select value={selected.saleProceedsAccountId ?? ''} onChange={(e) => onChangeHousing({ ...selected, saleProceedsAccountId: e.target.value || undefined })}>
                    <option value="">-</option>
                    {orderedBankAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  <span>Monthly Rent</span>
                  <BufferedNumberInput value={selected.monthlyRent} min={0} max={100000} step={50} onCommit={(v) => onChangeHousing({ ...selected, monthlyRent: v })} />
                </label>
                <label>
                  <span>End Year-Month</span>
                  <YearMonthInput label="End" value={selected.endYearMonth} disabled={endLinked} onChange={(next) => onChangeHousing({ ...selected, endYearMonth: next })} />
                </label>
              </>
            )}

            <label className="full-span checkbox-row">
              <input
                type="checkbox"
                checked={endLinked}
                disabled={!hasCareers}
                onChange={(e) => onChangeHousing({
                  ...selected,
                  linkedCareerEndId: e.target.checked ? (selected.linkedCareerEndId ?? careerOptions[0]?.id ?? null) : null
                })}
              />
              <span>Link end date to a career</span>
            </label>
            {endLinked ? (
              <label>
                <span>End Career</span>
                <select
                  aria-label="End Career"
                  value={selected.linkedCareerEndId ?? ''}
                  onChange={(e) => onChangeHousing({ ...selected, linkedCareerEndId: e.target.value || null })}
                >
                  {careerOptions.map((career) => <option key={career.id} value={career.id}>{career.label}</option>)}
                </select>
              </label>
            ) : null}

            <label>
              <span>Property Tax/yr</span>
              <BufferedNumberInput value={selected.propertyTaxYearly} min={0} max={500000} step={100} onCommit={(v) => onChangeHousing({ ...selected, propertyTaxYearly: v })} />
            </label>
            <label>
              <span>Home Insurance/yr</span>
              <BufferedNumberInput value={selected.homeInsuranceYearly} min={0} max={100000} step={50} onCommit={(v) => onChangeHousing({ ...selected, homeInsuranceYearly: v })} />
            </label>
            <label>
              <span>Taxes &amp; Insurance Source</span>
              {renderPaymentSourceSelect(selected.taxesInsuranceSource ?? selected.paymentSource, (v) => onChangeHousing({ ...selected, taxesInsuranceSource: commitSource(v) }), 'Taxes & Insurance Source')}
            </label>
            <label>
              <span>HOA/mo</span>
              <BufferedNumberInput value={selected.hoaMonthly} min={0} max={50000} step={10} onCommit={(v) => onChangeHousing({ ...selected, hoaMonthly: v })} />
            </label>
            <label>
              <span>Maintenance/mo</span>
              <BufferedNumberInput value={selected.maintenanceMonthly} min={0} max={50000} step={10} onCommit={(v) => onChangeHousing({ ...selected, maintenanceMonthly: v })} />
            </label>
            <label>
              <span>HOA &amp; Maintenance Source</span>
              {renderPaymentSourceSelect(selected.hoaMaintenanceSource ?? selected.paymentSource, (v) => onChangeHousing({ ...selected, hoaMaintenanceSource: commitSource(v) }), 'HOA & Maintenance Source')}
            </label>
            <label>
              <span>Rental Income/mo</span>
              <BufferedNumberInput value={selected.rentalIncomeMonthly} min={0} max={100000} step={50} onCommit={(v) => onChangeHousing({ ...selected, rentalIncomeMonthly: v })} />
            </label>
            <label>
              <span>Rental Income Account</span>
              <select value={selected.rentalIncomeAccountId ?? ''} onChange={(e) => onChangeHousing({ ...selected, rentalIncomeAccountId: e.target.value || undefined })}>
                <option value="">-</option>
                {orderedBankAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>
            <label>
              <span>Pay From (P&amp;I / Rent + default)</span>
              {renderPaymentSourceSelect(selected.paymentSource, (v) => onChangeHousing({ ...selected, paymentSource: commitSource(v) }), 'Pay From')}
            </label>
          </div>

          <div className="career-summary">
            <p>Total monthly cost: <strong>{formatCurrency(totalMonthly)}</strong></p>
          </div>

          <div className="career-actions">
            <button type="button" className="secondary-button" onClick={() => onDuplicateHousing(selected.id)}>
              Duplicate Housing
            </button>
            <button type="button" className="secondary-button danger-button" onClick={() => onRemoveHousing(selected.id)}>
              Remove Housing
            </button>
          </div>
        </>
      ) : (
        <p className="subtle">Add a mortgage or rental to get started.</p>
      )}
    </div>
  );
});
