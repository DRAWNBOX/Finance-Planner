import { type KeyboardEvent, useEffect, useState } from 'react';

interface BufferedNumberInputProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  commitOnChange?: boolean;
  onCommit: (value: number) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const BufferedNumberInput = ({
  value,
  min,
  max,
  step = 1,
  disabled = false,
  commitOnChange = false,
  onCommit
}: BufferedNumberInputProps) => {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const commitDraft = () => {
    if (draftValue.trim() === '' || Number.isNaN(Number(draftValue))) {
      setDraftValue(String(value));
      return;
    }

    const nextValue = clamp(Number(draftValue), min, max);
    setDraftValue(String(nextValue));
    onCommit(nextValue);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === 'Escape') {
      if (event.key === 'Escape') {
        setDraftValue(String(value));
      }

      event.currentTarget.blur();
    }
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      disabled={disabled}
      value={draftValue}
      onChange={(event) => {
        const nextDraft = event.target.value;
        setDraftValue(nextDraft);
        if (!commitOnChange) {
          return;
        }
        if (nextDraft.trim() === '' || Number.isNaN(Number(nextDraft))) {
          return;
        }
        onCommit(clamp(Number(nextDraft), min, max));
      }}
      onBlur={commitDraft}
      onKeyDown={handleKeyDown}
    />
  );
};
