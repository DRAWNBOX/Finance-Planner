import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DateMarker } from '../types';
import { DateMarkersEditor } from './DateMarkersEditor';

const markers: DateMarker[] = [
  { id: 'm1', label: 'Move', date: '2030-06-15' },
  { id: 'm2', label: 'Sell', date: '2031-03-10' }
];

afterEach(cleanup);

describe('DateMarkersEditor', () => {
  it('shows the empty state and the labelled add control when there are no markers', () => {
    const onAdd = vi.fn();
    render(<DateMarkersEditor markers={[]} onAdd={onAdd} onChange={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getByText('No date markers yet. Add one to start linking dates together.')).toBeInTheDocument();
    const add = screen.getByRole('button', { name: '+ Date Marker' });
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('exposes a labelled Name text input and a labelled Date input per marker', () => {
    render(<DateMarkersEditor markers={markers} onAdd={vi.fn()} onChange={vi.fn()} onRemove={vi.fn()} />);

    expect(screen.getAllByLabelText('Name')).toHaveLength(2);
    const dates = screen.getAllByLabelText('Date');
    expect(dates).toHaveLength(2);
    expect(dates[0]).toHaveAttribute('type', 'date');
    expect(dates[0]).toHaveValue('2030-06-15');
    expect(dates[1]).toHaveValue('2031-03-10');
  });

  it('commits a label change through onChange for the edited marker only', () => {
    const onChange = vi.fn();
    render(<DateMarkersEditor markers={markers} onAdd={vi.fn()} onChange={onChange} onRemove={vi.fn()} />);

    fireEvent.change(screen.getAllByLabelText('Name')[0], { target: { value: 'Relocate' } });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ ...markers[0], label: 'Relocate' });
  });

  it('commits a date-input change through onChange with the same marker id', () => {
    const onChange = vi.fn();
    render(<DateMarkersEditor markers={markers} onAdd={vi.fn()} onChange={onChange} onRemove={vi.fn()} />);

    fireEvent.change(screen.getAllByLabelText('Date')[1], { target: { value: '2032-01-05' } });

    expect(onChange).toHaveBeenLastCalledWith({ ...markers[1], date: '2032-01-05' });
  });

  it('calls onRemove with the marker id of the clicked Remove button', () => {
    const onRemove = vi.fn();
    render(<DateMarkersEditor markers={markers} onAdd={vi.fn()} onChange={vi.fn()} onRemove={onRemove} />);

    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    fireEvent.click(removeButtons[1]);

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith('m2');
  });
});
