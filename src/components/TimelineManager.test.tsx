import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TimelineManager from './TimelineManager';
import { createConfigurationCommands } from '../commands';
import { createDefaultScenario } from '../defaultScenario';

const commands = createConfigurationCommands();
const scenario = () => createDefaultScenario(new Date('2026-01-01T00:00:00Z'));

describe('TimelineManager', () => {
  it('renders empty state, adds and switches to a named timeline', () => {
    const base = scenario(); const onChange = vi.fn();
    render(<TimelineManager scenario={base} onChange={onChange} />);
    expect(screen.getByText(/One plan, with room to explore/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add timeline/ }));
    const added = onChange.mock.calls[0][0];
    expect(added.timelines).toHaveLength(1); expect(added.activeTimelineId).toBe(added.timelines[0].id);
  });

  it('isolates base and timeline data, including nested paycheck and pay plans on duplicate', () => {
    const base = scenario();
    const added = commands.addTimeline(base, { id: 't1', label: 'Plan A' });
    const career = added.timelines[0].careerPlan.entries[0];
    expect(added.timelines[0].careerPlan).not.toBe(base.careerPlan);
    if (career) {
      expect(added.timelines[0].careerPlan.entries[0]).not.toBe(base.careerPlan.entries[0]);
      expect(added.timelines[0].careerPlan.entries[0].paycheck).not.toBe(base.careerPlan.entries[0].paycheck);
      const copy = commands.duplicateTimeline(added, 't1', { id: 't2' });
      expect(copy.timelines[1].careerPlan.entries[0]).not.toBe(copy.timelines[0].careerPlan.entries[0]);
      expect(copy.timelines[1].careerPlan.entries[0].payPlans).not.toBe(copy.timelines[0].careerPlan.entries[0].payPlans);
    }
    expect(added.activeTimelineId).toBe('t1');
  });

  it('renames and requires explicit confirmation before deleting the active timeline to Default', () => {
    let value = commands.addTimeline(scenario(), { id: 't1', label: 'Plan A' });
    const onChange = (next: ReturnType<typeof scenario>) => { value = next; };
    const view = render(<TimelineManager scenario={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename Plan A' }));
    fireEvent.change(screen.getByLabelText('Timeline name'), { target: { value: 'New plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(value.timelines[0].label).toBe('New plan');
    view.rerender(<TimelineManager scenario={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete New plan' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete timeline' }));
    expect(value.activeTimelineId).toBeNull(); expect(value.timelines).toHaveLength(0);
  });

  it('reports stale selected IDs rather than treating them as Default', () => {
    const base = scenario(); base.activeTimelineId = 'missing';
    render(<TimelineManager scenario={base} onChange={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toMatch(/no timeline is selected/i);
    expect(screen.getByText('Selection needs attention')).toBeTruthy();
  });
});
