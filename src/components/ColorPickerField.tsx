import { useEffect, useRef, useState } from 'react';

interface ColorPickerFieldProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
}

const RAINBOW_PRESETS = [
  '#e74c3c', // red
  '#e67e22', // orange
  '#f1c40f', // yellow
  '#2ecc71', // green
  '#1abc9c', // teal
  '#17a2b8', // cyan
  '#3498db', // blue
  '#2c3e50', // dark blue
  '#6c5ce7', // indigo
  '#8e44ad', // violet
  '#e84393', // pink
  '#fd79a8', // light pink
  '#d63031', // crimson
  '#00b894', // mint
  '#fdcb6e'  // warm yellow
];

export const ColorPickerField = ({ label, value, onChange }: ColorPickerFieldProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [popupPos, setPopupPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleScroll = () => {
      if (isOpen && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setPopupPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(220, rect.width) });
      }
    };

    if (isOpen) {
      handleScroll();
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleScroll);
    }

    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleScroll);
    };
  }, [isOpen]);

  const handleSelect = (color: string) => {
    onChange(color);
    setIsOpen(false);
  };

  const handleOpen = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPopupPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(220, rect.width) });
    }
    setIsOpen(true);
  };

  return (
    <div className="color-picker-field">
      <button
        ref={triggerRef}
        type="button"
        className="color-picker-trigger"
        onClick={() => (isOpen ? setIsOpen(false) : handleOpen())}
      >
        <span className="color-picker-swatch" style={{ backgroundColor: value }} />
        <span className="color-picker-label">{label}</span>
        <span className="color-picker-chevron">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && popupPos ? (
        <div
          ref={popupRef}
          className="color-picker-popup"
          style={{ position: 'fixed', top: popupPos.top, left: popupPos.left, width: popupPos.width }}
        >
          <div className="color-picker-popup-title">Select Color</div>
          <div className="color-picker-grid">
            {RAINBOW_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                className={`color-picker-option${color === value ? ' selected' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => handleSelect(color)}
                aria-label={color}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
};
