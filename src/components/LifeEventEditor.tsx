import { BufferedNumberInput } from './BufferedNumberInput';
import type { LifeEvent } from '../types';

interface LifeEventEditorProps {
  event: LifeEvent;
  retirementEndAge: number;
  onChange: (next: LifeEvent) => void;
  onRemove: (id: string) => void;
}

const numberFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

export const LifeEventEditor = ({ event, retirementEndAge, onChange, onRemove }: LifeEventEditorProps) => {
  const isRecurring = event.cadence === 'recurring';
  const isJobChange = event.type === 'job_change';
  const isBreak = event.type === 'career_break';
  const isCashflowStyle = !isJobChange && !isBreak;

  return (
    <div className="cashflow-editor">
      <div className="cashflow-editor-header">
        <strong>{event.label}</strong>
        <button type="button" className="text-button" onClick={() => onRemove(event.id)}>
          Remove
        </button>
      </div>
      <div className="cashflow-grid">
        <label className="full-span">
          <span>Label</span>
          <input type="text" value={event.label} onChange={(e) => onChange({ ...event, label: e.target.value })} />
        </label>
        <label>
          <span>Start Age</span>
          <BufferedNumberInput value={event.startAge} min={18} max={retirementEndAge} onCommit={(next) => onChange({ ...event, startAge: next })} />
        </label>
        {isRecurring ? (
          <label>
            <span>End Age</span>
            <BufferedNumberInput value={event.endAge} min={event.startAge} max={retirementEndAge} onCommit={(next) => onChange({ ...event, endAge: next })} />
          </label>
        ) : null}
        {isCashflowStyle ? (
          <label>
            <span>Amount</span>
            <BufferedNumberInput value={event.amount} min={0} max={1000000} step={500} onCommit={(next) => onChange({ ...event, amount: next })} />
          </label>
        ) : null}
        {isJobChange ? (
          <label>
            <span>New Salary</span>
            <BufferedNumberInput value={event.newSalary} min={0} max={2000000} step={1000} onCommit={(next) => onChange({ ...event, newSalary: next })} />
          </label>
        ) : null}
        {isJobChange ? (
          <label>
            <span>Next Raise %</span>
            <BufferedNumberInput
              value={event.annualSalaryGrowthOverride}
              min={0}
              max={20}
              step={0.1}
              onCommit={(next) => onChange({ ...event, annualSalaryGrowthOverride: next })}
            />
          </label>
        ) : null}
        {isCashflowStyle ? (
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={event.inflationAdjusted}
              onChange={(e) => onChange({ ...event, inflationAdjusted: e.target.checked })}
            />
            <span>Adjust for inflation</span>
          </label>
        ) : null}
      </div>
      <div className="event-meta">
        <span>{isJobChange ? 'Salary change from this age onward.' : isBreak ? 'Salary pauses during the break period.' : numberFormat.format(event.amount)}</span>
      </div>
    </div>
  );
};
