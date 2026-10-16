import { useRef, useState } from 'react';
import { createConfigurationCommands } from '../commands';
import type { Scenario } from '../types';
import './TimelineManager.css';

const commands = createConfigurationCommands();

export interface TimelineManagerProps {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
}

export default function TimelineManager({ scenario, onChange }: TimelineManagerProps) {
  const timelines = scenario.timelines ?? [];
  const stale = Boolean(scenario.activeTimelineId && !timelines.some((item) => item.id === scenario.activeTimelineId));
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  const change = (next: Scenario) => onChange(next);
  const beginRename = (id: string, label: string) => { setRenamingId(id); setDraft(label); };
  const commitRename = () => {
    if (!renamingId) return;
    const label = draft.trim();
    if (label) change(commands.renameTimeline(scenario, renamingId, label));
    setRenamingId(null);
  };

  return <section className="timeline-manager" aria-label="Timeline manager">
    <div className="timeline-manager__topline">
      <div><p className="timeline-manager__eyebrow">PLAN VERSIONS</p><h2>Timelines</h2></div>
      <button className="timeline-manager__add" type="button" onClick={() => change(commands.addTimeline(scenario))}>＋ Add timeline</button>
    </div>
    {stale && <p className="timeline-manager__alert" role="alert">The selected timeline is no longer available. No timeline is selected; choose Default or a named timeline to continue.</p>}
    <div className="timeline-manager__rail" role="group" aria-label="Choose a timeline">
      <button type="button" className={`timeline-manager__chip ${scenario.activeTimelineId === null && !stale ? 'is-active' : ''}`} aria-pressed={scenario.activeTimelineId === null && !stale} onClick={() => change(commands.switchTimeline(scenario, null))}>
        <span className="timeline-manager__dot" />Default<span className="timeline-manager__chip-note">Original plan</span>
      </button>
      {timelines.map((timeline) => <div className={`timeline-manager__item ${scenario.activeTimelineId === timeline.id ? 'is-active' : ''}`} key={timeline.id}>
        <button type="button" className="timeline-manager__chip" aria-pressed={scenario.activeTimelineId === timeline.id} onClick={() => change(commands.switchTimeline(scenario, timeline.id))}>
          <span className="timeline-manager__dot" />{timeline.label}<span className="timeline-manager__chip-note">Plan variation</span>
        </button>
        <div className="timeline-manager__actions">
          <button type="button" aria-label={`Rename ${timeline.label}`} title="Rename" onClick={() => beginRename(timeline.id, timeline.label)}>✎</button>
          <button type="button" aria-label={`Duplicate ${timeline.label}`} title="Duplicate" onClick={() => change(commands.duplicateTimeline(scenario, timeline.id))}>⧉</button>
          <button type="button" className="is-danger" aria-label={`Delete ${timeline.label}`} title="Delete" onClick={() => setConfirmId(timeline.id)}>×</button>
        </div>
        {renamingId === timeline.id && <form className="timeline-manager__rename" onSubmit={(event) => { event.preventDefault(); commitRename(); }}>
          <label htmlFor={`timeline-name-${timeline.id}`}>Timeline name</label><input id={`timeline-name-${timeline.id}`} autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setRenamingId(null); }} />
          <button type="submit">Save</button><button type="button" onClick={() => setRenamingId(null)}>Cancel</button>
        </form>}
      </div>)}
    </div>
    <p className="timeline-manager__status" aria-live="polite">{scenario.activeTimelineId === null ? 'Showing the original plan' : stale ? 'Selection needs attention' : `Showing ${timelines.find((item) => item.id === scenario.activeTimelineId)?.label}`}</p>
    {timelines.length === 0 && <div className="timeline-manager__empty"><span aria-hidden="true">◇</span><p><strong>One plan, with room to explore.</strong><br/>Add a timeline to make an independent copy of your current plan.</p></div>}
    {confirmId && <div className="timeline-manager__backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmId(null); }}>
      <div className="timeline-manager__dialog" role="dialog" aria-modal="true" aria-labelledby="timeline-delete-title" ref={dialogRef} tabIndex={-1} onKeyDown={(event) => { if (event.key === 'Escape') setConfirmId(null); }}>
        <span className="timeline-manager__dialog-mark">!</span><h3 id="timeline-delete-title">Delete this timeline?</h3>
        <p><strong>{timelines.find((item) => item.id === confirmId)?.label}</strong> will be removed. Its plan will not affect Default or other timelines.</p>
        <div className="timeline-manager__dialog-actions"><button type="button" onClick={() => setConfirmId(null)}>Keep timeline</button><button type="button" className="is-danger" onClick={() => { change(commands.deleteTimeline(scenario, confirmId)); setConfirmId(null); }}>Delete timeline</button></div>
      </div>
    </div>}
  </section>;
}
