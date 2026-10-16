import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrajectorySnapshot } from '../types';
import { TrajectoryManager } from './TrajectoryManager';

const snapshot = (overrides: Partial<TrajectorySnapshot> = {}): TrajectorySnapshot => ({
  id: 'old', label: 'Old plan', createdAt: '2025-01-01', survivesToEnd: true, depletedAge: null,
  endAge: 90, endingBalance: 12, summary: 'Saved', years: [],
  context: { measurement: 'assetOnly', startDate: '2025-01-01', endDate: '2060-01-01', schemaVersion: 1, engineRevision: 'r1' },
  ...overrides
});
const props = (overrides: Partial<React.ComponentProps<typeof TrajectoryManager>> = {}) => ({
  snapshots: [], selectedId: '', namedContextLabel: 'Base plan', onSave: vi.fn(), onRename: vi.fn(), onRemove: vi.fn(), onSelect: vi.fn(), ...overrides
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('TrajectoryManager', () => {
  it('shows empty/no-career state and does not invent a saved projection when adapter is missing', () => {
    const input = props();
    const { container } = render(<TrajectoryManager {...input} />);
    expect(screen.getByText('No trajectories saved yet')).toBeInTheDocument();
    expect(screen.getByText(/Save unavailable/)).toBeInTheDocument();
    expect(input.onSave).not.toHaveBeenCalled();
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it('preserves legacy measurement and marks it incompatible with signed net worth', () => {
    const legacy = snapshot({ context: undefined });
    render(<TrajectoryManager {...props({ snapshots: [legacy], selectedId: legacy.id })} />);
    expect(screen.getByText(/Legacy · asset-only · not comparable/)).toBeInTheDocument();
    expect(screen.getByText(/legacy snapshot is archived as asset-only/)).toBeInTheDocument();
  });

  it('renames without mutating inputs, preserves selection, and confirms deletion', () => {
    const item = snapshot();
    const onRename = vi.fn(); const onRemove = vi.fn(); const onSelect = vi.fn();
    vi.stubGlobal('confirm', vi.fn(() => true));
    render(<TrajectoryManager {...props({ snapshots: [item], selectedId: item.id, onRename, onRemove, onSelect })} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Rename Old plan' }), { target: { value: 'Revised' } });
    expect(onRename).toHaveBeenCalledWith('old', 'Revised');
    expect(item.label).toBe('Old plan');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Old plan' }));
    expect(onRemove).toHaveBeenCalledWith('old');
    expect(onSelect).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('requires explicit name and date before invoking the prepared frozen-snapshot adapter', () => {
    const createSnapshot = vi.fn(() => null);
    const onSave = vi.fn();
    render(<TrajectoryManager {...props({ createSnapshot, onSave })} />);
    const save = screen.getByRole('button', { name: 'Save measured trajectory' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Snapshot name'), { target: { value: 'Spring plan' } });
    fireEvent.change(screen.getByLabelText('Freeze date'), { target: { value: '2026-10-14' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(createSnapshot).toHaveBeenCalledWith('Spring plan', '2026-10-14');
    expect(onSave).not.toHaveBeenCalled();
  });
});
