import { useState } from 'react';
import type { AnyTrajectorySnapshot, CanonicalTrajectorySnapshot } from '../types';
import { compareTrajectorySnapshots, isCanonical } from '../trajectoryFreeze';
import './TrajectoryManager.css';

export interface TrajectoryManagerProps {
  snapshots: readonly AnyTrajectorySnapshot[];
  selectedId: string;
  namedContextLabel: string;
  createSnapshot?: (label: string, frozenDate: string) => CanonicalTrajectorySnapshot | null;
  onSave: (snapshot: CanonicalTrajectorySnapshot) => void;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}

export function TrajectoryManager({ snapshots, selectedId, namedContextLabel, createSnapshot, onSave, onRename, onRemove, onSelect }: TrajectoryManagerProps) {
  const [name, setName] = useState('');
  const [freezeDate, setFreezeDate] = useState('');
  const selected = snapshots.find((item) => item.id === selectedId) ?? null;
  const canCompare = !!selected && snapshots.some((item) => item.id !== selected.id && compareTrajectorySnapshots(item, selected).comparable);
  const save = () => {
    if (!createSnapshot || !name.trim() || !freezeDate) return;
    const snapshot = createSnapshot(name.trim(), freezeDate);
    if (snapshot) { onSave(snapshot); setName(''); }
  };

  return <section className="trajectory-manager" aria-labelledby="trajectory-manager-title">
    <header className="tm-header"><div><span className="tm-kicker">PROJECTION ARCHIVE</span><h2 id="trajectory-manager-title">Trajectory manager</h2><p>Keep a dated record of a measured projection, then compare only like with like.</p></div><span className="tm-count">{snapshots.length} saved</span></header>
    <div className="tm-context"><span className="tm-context-dot" aria-hidden="true"/><div><small>Current named context</small><strong>{namedContextLabel || 'No named context selected'}</strong></div></div>
    <div className="tm-save">
      <h3>Save this projection</h3>
      {!createSnapshot ? <p className="tm-unavailable" role="status"><strong>Save unavailable.</strong> This projection run has no prepared report data to freeze; no values or dates are inferred.</p> : <>
        <label>Snapshot name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Current plan" /></label>
        <label>Freeze date<input type="date" value={freezeDate} onChange={(e) => setFreezeDate(e.target.value)} /></label>
        <button type="button" className="tm-save-button" disabled={!name.trim() || !freezeDate} onClick={save}>Save measured trajectory</button>
      </>}
    </div>
    <div className="tm-list"><div className="tm-list-heading"><h3>Saved trajectories</h3><span>Choose one to compare</span></div>
      {!snapshots.length ? <div className="tm-empty"><span aria-hidden="true">↗</span><strong>No trajectories saved yet</strong><p>Once reporting data is available, save a named projection here. Your current plan stays untouched.</p></div> : <ul>{snapshots.map((snapshot) => {
          const canonical = isCanonical(snapshot);
          const compatibility = selected ? compareTrajectorySnapshots(snapshot, selected) : null;
          const comparable = !!compatibility?.comparable;
        return <li key={snapshot.id} className={`tm-item ${snapshot.id === selectedId ? 'is-selected' : ''}`}>
           <label className="tm-select"><input type="radio" name="trajectory-selection" checked={snapshot.id === selectedId} onChange={() => onSelect(snapshot.id)} /><span><input aria-label={`Rename ${snapshot.label}`} className="tm-name" value={snapshot.label} onChange={(e) => onRename(snapshot.id, e.target.value)} /><small>{canonical ? `${snapshot.context.measurement} · ${snapshot.createdAt}${snapshot.id === selectedId ? '' : comparable ? ' · compatible' : ` · incompatible: ${compatibility?.reasons.join(', ') ?? 'select a comparison'}`}` : `Legacy · ${snapshot.context?.measurement ?? 'asset-only'} · not comparable`}</small></span></label>
          <button type="button" className="tm-remove" aria-label={`Remove ${snapshot.label}`} onClick={() => { if (window.confirm(`Remove “${snapshot.label}”? This cannot be undone.`)) onRemove(snapshot.id); }}>Remove</button>
        </li>;
      })}</ul>}
       {selected && <p className="tm-compare" role="status">{!isCanonical(selected) ? 'This legacy snapshot is archived as asset-only data and cannot be compared with canonical net worth.' : canCompare ? `Ready to compare “${selected.label}” with a compatible saved context.` : 'No compatible saved comparison is available. Format, measurement, engine revision, and schema must all match.'}</p>}
    </div>
  </section>;
}
