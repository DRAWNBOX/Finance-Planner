import type { DateMarker } from '../types';
import { formatYearMonthLabel, yearMonthFromMarkerDate } from '../utils/dateMarkers';
import { YearMonthInput } from './YearMonthInput';

interface DateOrMarkerInputProps {
  label: string;
  value: string;
  markerId?: string | null;
  markers: DateMarker[];
  mode?: 'yearMonth' | 'date';
  disabled?: boolean;
  onChange: (value: string, markerId: string | null) => void;
}

const formatMarkerDate = (date: string) => {
  if (!date) {
    return 'No date';
  }
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
};

export const DateOrMarkerInput = ({
  label,
  value,
  markerId,
  markers,
  mode = 'yearMonth',
  disabled = false,
  onChange
}: DateOrMarkerInputProps) => {
  const usingMarker = Boolean(markerId);
  const selectedMarker = markers.find((marker) => marker.id === markerId) ?? null;
  const markerResolvedLabel = selectedMarker
    ? mode === 'date'
      ? formatMarkerDate(selectedMarker.date)
      : formatYearMonthLabel(yearMonthFromMarkerDate(selectedMarker.date))
    : '';

  return (
    <div className="date-or-marker-input">
      <div className="date-or-marker-toggle" role="group" aria-label={`${label} date source`}>
        <button
          type="button"
          className={usingMarker ? 'date-or-marker-option' : 'date-or-marker-option active'}
          disabled={disabled}
          onClick={() => onChange(value, null)}
        >
          Date
        </button>
        <button
          type="button"
          className={usingMarker ? 'date-or-marker-option active' : 'date-or-marker-option'}
          disabled={disabled || markers.length === 0}
          title={markers.length === 0 ? 'Create a date marker first' : 'Use a date marker'}
          onClick={() => onChange(value, selectedMarker?.id ?? markers[0]?.id ?? null)}
        >
          Marker
        </button>
      </div>
      {usingMarker ? (
        <div className="date-or-marker-body">
          <select
            aria-label={`${label} Marker`}
            value={markerId ?? ''}
            disabled={disabled}
            onChange={(event) => onChange(value, event.target.value || null)}
          >
            {markers.map((marker) => (
              <option key={marker.id} value={marker.id}>
                {marker.label}
              </option>
            ))}
          </select>
          {markerResolvedLabel ? <span className="date-or-marker-resolved">{markerResolvedLabel}</span> : null}
        </div>
      ) : mode === 'date' ? (
        <input
          type="date"
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value, null)}
        />
      ) : (
        <YearMonthInput label={label} value={value} disabled={disabled} onChange={(next) => onChange(next, null)} />
      )}
    </div>
  );
};
