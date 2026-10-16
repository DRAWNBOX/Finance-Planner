import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DateMarker } from '../types';
import { DateOrMarkerInput } from './DateOrMarkerInput';

const markers: DateMarker[] = [
  { id: 'grad', label: 'Graduation', date: '2030-05-12' },
  { id: 'retire', label: 'Retirement', date: '2045-01-01' }
];

afterEach(cleanup);

describe('DateOrMarkerInput', () => {
  it('exposes the date-source group and labelled year-month controls', () => {
    render(<DateOrMarkerInput label="Acquisition" value="2030-05" markerId={null} markers={markers} onChange={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'Acquisition date source' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Date' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Marker' })).toBeEnabled();
    expect(screen.getByLabelText('Acquisition Year')).toHaveValue('2030');
    expect(screen.getByLabelText('Acquisition Month')).toHaveValue('05');
  });

  it('clears a marker back to the current date value without changing it', () => {
    const onChange = vi.fn();
    render(<DateOrMarkerInput label="Acquisition" value="2030-05" markerId="grad" markers={markers} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Date' }));

    expect(onChange).toHaveBeenLastCalledWith('2030-05', null);
  });

  it('exposes which date source is selected and updates pressed state as it switches', () => {
    const { rerender } = render(<DateOrMarkerInput label="Acquisition" value="2030-05" markerId={null} markers={markers} onChange={vi.fn()} />);
    const dateButton = screen.getByRole('button', { name: 'Date' });
    const markerButton = screen.getByRole('button', { name: 'Marker' });
    expect(dateButton).toHaveAttribute('aria-pressed', 'true');
    expect(markerButton).toHaveAttribute('aria-pressed', 'false');

    rerender(<DateOrMarkerInput label="Acquisition" value="2030-05" markerId="grad" markers={markers} onChange={vi.fn()} />);
    expect(dateButton).toHaveAttribute('aria-pressed', 'false');
    expect(markerButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('selects the first marker when none is currently selected, keeping the value', () => {
    const onChange = vi.fn();
    render(<DateOrMarkerInput label="Acquisition" value="2030-05" markerId={null} markers={markers} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Marker' }));

    expect(onChange).toHaveBeenLastCalledWith('2030-05', 'grad');
  });

  it('commits a different marker id and shows the month-precision resolved label', () => {
    const onChange = vi.fn();
    render(<DateOrMarkerInput label="Acquisition" value="2030-05" markerId="grad" markers={markers} onChange={onChange} />);

    const select = screen.getByLabelText('Acquisition Marker');
    expect(select).toHaveValue('grad');
    expect(screen.getByText('May 2030')).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'retire' } });

    expect(onChange).toHaveBeenLastCalledWith('2030-05', 'retire');
  });

  it('disables the marker option when there are no markers', () => {
    render(<DateOrMarkerInput label="Acquisition" value="2030-05" markerId={null} markers={[]} onChange={vi.fn()} />);

    const markerButton = screen.getByRole('button', { name: 'Marker' });
    expect(markerButton).toBeDisabled();
    expect(markerButton).toHaveAttribute('title', 'Create a date marker first');
    expect(screen.queryByLabelText('Acquisition Marker')).not.toBeInTheDocument();
  });

  it('keeps the exact day for date mode and passes it through on change', () => {
    const onChange = vi.fn();
    render(
      <DateOrMarkerInput label="Acquisition" mode="date" value="2030-05-12" markerId={null} markers={markers} onChange={onChange} />
    );

    const input = screen.getByLabelText('Acquisition') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input).toHaveValue('2030-05-12');

    fireEvent.change(input, { target: { value: '2031-02-28' } });

    expect(onChange).toHaveBeenLastCalledWith('2031-02-28', null);
  });

  it('shows the day-precision marker label in date mode instead of year-month controls', () => {
    render(
      <DateOrMarkerInput label="Acquisition" mode="date" value="2030-05-12" markerId="grad" markers={markers} onChange={vi.fn()} />
    );

    expect(screen.getByText('May 12, 2030')).toBeInTheDocument();
    expect(screen.queryByLabelText('Acquisition Year')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Acquisition Month')).not.toBeInTheDocument();
  });

  it('renders the marker branch for a dangling marker id with no resolved label and lets Date clear it', () => {
    const onChange = vi.fn();
    render(<DateOrMarkerInput label="Acquisition" value="2030-05" markerId="missing" markers={markers} onChange={onChange} />);

    expect(screen.getByLabelText('Acquisition Marker')).toBeInTheDocument();
    expect(screen.queryByText(/May/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Date' }));

    expect(onChange).toHaveBeenLastCalledWith('2030-05', null);
  });

  it('disables every control when disabled', () => {
    render(<DateOrMarkerInput label="Acquisition" value="2030-05" markerId="grad" markers={markers} disabled onChange={vi.fn()} />);

    expect(screen.getByRole('button', { name: 'Date' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Marker' })).toBeDisabled();
    expect(screen.getByLabelText('Acquisition Marker')).toBeDisabled();
  });

  it('steps and commits the year through keyboard in the year-month branch', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DateOrMarkerInput label="Acquisition" value="2030-05" markerId={null} markers={markers} onChange={onChange} />);

    const year = screen.getByLabelText('Acquisition Year');
    await user.click(year);
    expect(year).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(onChange).toHaveBeenLastCalledWith('2031-05', null);

    await user.keyboard('{ArrowDown}');
    expect(onChange).toHaveBeenLastCalledWith('2030-05', null);

    await user.keyboard('{Enter}');
    expect(year).not.toHaveFocus();
    expect(onChange).toHaveBeenLastCalledWith('2030-05', null);
  });
});
