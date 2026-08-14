import { memo } from 'react';
import type { CashflowItem } from '../types';
import { ageFromYearMonth, formatYearMonthFromAge } from '../utils/ageDate';
import { useRenderCount } from '../utils/perfTools';
import { YearMonthInput } from './YearMonthInput';

interface CashflowItemEditorProps {
  item: CashflowItem;
  retirementEndAge: number;
  dateOfBirth: string;
  currentAge: number;
  accounts: Array<{ id: string; label: string }>;
  onChange: (item: CashflowItem) => void;
  onRemove: (id: string) => void;
}

const numberValue = (value: string) => Number(value) || 0;

export const CashflowItemEditor = memo(({
  item,
  retirementEndAge,
  dateOfBirth,
  currentAge,
  accounts,
  onChange,
  onRemove
}: CashflowItemEditorProps) => {
  useRenderCount('CashflowItemEditor');
  return (
  <div className="cashflow-editor">
    <div className="cashflow-editor-header">
      <strong>{item.label}</strong>
      <button type="button" className="text-button" onClick={() => onRemove(item.id)}>
        Remove
      </button>
    </div>
    <div className="cashflow-grid">
      <label>
        <span>Direction</span>
        <select
          value={item.direction}
          onChange={(event) => onChange({ ...item, direction: event.target.value as CashflowItem['direction'] })}
        >
          <option value="inflow">Inflow</option>
          <option value="outflow">Outflow</option>
        </select>
      </label>
      <label>
        <span>Amount</span>
        <input
          type="number"
          value={item.amount}
          onChange={(event) => onChange({ ...item, amount: numberValue(event.target.value) })}
        />
      </label>
      <label>
        <span>Account</span>
        <select
          value={item.accountId ?? ''}
          onChange={(event) => onChange({ ...item, accountId: event.target.value || null })}
        >
          <option value="">-</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.label}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{item.cadence === 'one_time' ? 'Age' : 'Start Age'}</span>
        <input
          type="number"
          min={18}
          max={retirementEndAge}
          value={item.startAge}
          onChange={(event) => onChange({ ...item, startAge: numberValue(event.target.value), endAge: item.cadence === 'one_time' ? numberValue(event.target.value) : item.endAge })}
        />
      </label>
      <label>
        <span>{item.cadence === 'one_time' ? 'Year-Month' : 'Start (Year-Month)'}</span>
        <YearMonthInput
          label={item.cadence === 'one_time' ? 'Age' : 'Start'}
          value={item.startYearMonth ?? formatYearMonthFromAge(item.startAge, dateOfBirth, currentAge)}
          onChange={(nextValue) => {
            const derivedAge = ageFromYearMonth(nextValue, dateOfBirth, currentAge, 18, retirementEndAge);

            if (derivedAge === null) {
              return;
            }

            onChange({
              ...item,
              startAge: derivedAge,
              startYearMonth: nextValue,
              endAge: item.cadence === 'one_time' ? derivedAge : Math.max(item.endAge, derivedAge)
            });
          }}
        />
      </label>
      {item.cadence === 'recurring' ? (
        <>
          <label>
            <span>End Age</span>
            <input
              type="number"
              min={item.startAge}
              max={retirementEndAge}
              value={item.endAge}
              onChange={(event) => onChange({ ...item, endAge: numberValue(event.target.value) })}
            />
          </label>
          <label>
            <span>End (Year-Month)</span>
            <YearMonthInput
              label="End"
              value={item.endYearMonth ?? formatYearMonthFromAge(item.endAge, dateOfBirth, currentAge)}
              onChange={(nextValue) => {
                const derivedAge = ageFromYearMonth(
                  nextValue,
                  dateOfBirth,
                  currentAge,
                  item.startAge,
                  retirementEndAge
                );

                if (derivedAge === null) {
                  return;
                }

                onChange({ ...item, endAge: derivedAge, endYearMonth: nextValue });
              }}
            />
          </label>
        </>
      ) : null}
    </div>
  </div>
  );
});
