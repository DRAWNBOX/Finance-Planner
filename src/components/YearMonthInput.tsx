import { useEffect, useState } from 'react';

interface YearMonthInputProps {
  value: string;
  label: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}

const MONTH_OPTIONS = [
  { value: '01', label: 'January' },
  { value: '02', label: 'February' },
  { value: '03', label: 'March' },
  { value: '04', label: 'April' },
  { value: '05', label: 'May' },
  { value: '06', label: 'June' },
  { value: '07', label: 'July' },
  { value: '08', label: 'August' },
  { value: '09', label: 'September' },
  { value: '10', label: 'October' },
  { value: '11', label: 'November' },
  { value: '12', label: 'December' }
];

const parseYearMonth = (value: string) => {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    return null;
  }

  const year = match[1];
  const month = match[2];
  if (Number(month) < 1 || Number(month) > 12) {
    return null;
  }

  return { year, month };
};

export const YearMonthInput = ({ value, label, disabled = false, onChange }: YearMonthInputProps) => {
  const parsed = parseYearMonth(value);
  const [yearDraft, setYearDraft] = useState(parsed?.year ?? '');
  const [month, setMonth] = useState(parsed?.month ?? '01');

  useEffect(() => {
    const nextParsed = parseYearMonth(value);
    setYearDraft(nextParsed?.year ?? '');
    setMonth(nextParsed?.month ?? '01');
  }, [value]);

  const commitYear = () => {
    if (!/^\d{4}$/.test(yearDraft)) {
      const fallback = parseYearMonth(value);
      setYearDraft(fallback?.year ?? '');
      return;
    }

    onChange(`${yearDraft}-${month}`);
  };

  const stepYear = (delta: number) => {
    if (disabled) {
      return;
    }

    const fallbackYear = parsed?.year ?? String(new Date().getFullYear()).padStart(4, '0');
    const baseYear = /^\d{4}$/.test(yearDraft) ? Number(yearDraft) : Number(fallbackYear);
    const nextYear = Math.min(Math.max(baseYear + delta, 0), 9999);
    const nextYearString = String(nextYear).padStart(4, '0');

    setYearDraft(nextYearString);
    onChange(`${nextYearString}-${month}`);
  };

  return (
    <div className="year-month-input">
      <div className="year-input-with-arrows">
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{4}"
          maxLength={4}
          aria-label={`${label} Year`}
          value={yearDraft}
          disabled={disabled}
          onChange={(event) => {
            const nextYear = event.target.value.replace(/\D/g, '').slice(0, 4);
            setYearDraft(nextYear);

            if (/^\d{4}$/.test(nextYear)) {
              onChange(`${nextYear}-${month}`);
            }
          }}
          onBlur={commitYear}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            }

            if (event.key === 'ArrowUp') {
              event.preventDefault();
              stepYear(1);
            }

            if (event.key === 'ArrowDown') {
              event.preventDefault();
              stepYear(-1);
            }
          }}
        />
        <div className="year-stepper">
          <button type="button" aria-label={`${label} Year Up`} disabled={disabled} onClick={() => stepYear(1)}>
            ▲
          </button>
          <button type="button" aria-label={`${label} Year Down`} disabled={disabled} onClick={() => stepYear(-1)}>
            ▼
          </button>
        </div>
      </div>
      <select
        aria-label={`${label} Month`}
        value={month}
        disabled={disabled}
        onChange={(event) => {
          const nextMonth = event.target.value;
          setMonth(nextMonth);

          if (/^\d{4}$/.test(yearDraft)) {
            onChange(`${yearDraft}-${nextMonth}`);
          }
        }}
      >
        {MONTH_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
};
