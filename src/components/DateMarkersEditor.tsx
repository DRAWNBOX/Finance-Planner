import { memo } from 'react';
import type { DateMarker } from '../types';
import { useRenderCount } from '../utils/perfTools';

interface DateMarkersEditorProps {
  markers: DateMarker[];
  onAdd: () => void;
  onChange: (marker: DateMarker) => void;
  onRemove: (markerId: string) => void;
}

export const DateMarkersEditor = memo(({ markers, onAdd, onChange, onRemove }: DateMarkersEditorProps) => {
  useRenderCount('DateMarkersEditor');

  return (
    <div className="date-markers-editor">
      <p className="subtle">
        Define named dates and reuse them as the start or end date of housing, careers, purchases, loans, credit cards,
        add-ons, and expenses. Changing a marker moves every field that references it.
      </p>

      {markers.length === 0 ? (
        <p className="subtle">No date markers yet. Add one to start linking dates together.</p>
      ) : (
        <div className="date-markers-list">
          {markers.map((marker) => (
            <div className="date-marker-row" key={marker.id}>
              <label>
                <span>Name</span>
                <input
                  type="text"
                  value={marker.label}
                  onChange={(event) => onChange({ ...marker, label: event.target.value })}
                />
              </label>
              <label>
                <span>Date</span>
                <input
                  type="date"
                  value={marker.date}
                  onChange={(event) => onChange({ ...marker, date: event.target.value })}
                />
              </label>
              <button type="button" className="secondary-button danger-button" onClick={() => onRemove(marker.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="career-actions">
        <button type="button" className="secondary-button" onClick={onAdd}>
          + Date Marker
        </button>
      </div>
    </div>
  );
});
