import type { CashflowItem } from '../types';

interface CashflowItemEditorProps {
  item: CashflowItem;
  retirementEndAge: number;
  onChange: (item: CashflowItem) => void;
  onRemove: (id: string) => void;
}

const numberValue = (value: string) => Number(value) || 0;

export const CashflowItemEditor = ({ item, retirementEndAge, onChange, onRemove }: CashflowItemEditorProps) => (
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
        <span>{item.cadence === 'one_time' ? 'Age' : 'Start Age'}</span>
        <input
          type="number"
          min={18}
          max={retirementEndAge}
          value={item.startAge}
          onChange={(event) => onChange({ ...item, startAge: numberValue(event.target.value), endAge: item.cadence === 'one_time' ? numberValue(event.target.value) : item.endAge })}
        />
      </label>
      {item.cadence === 'recurring' ? (
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
      ) : null}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={item.inflationAdjusted}
          onChange={(event) => onChange({ ...item, inflationAdjusted: event.target.checked })}
        />
        <span>Adjust for inflation</span>
      </label>
    </div>
  </div>
);
