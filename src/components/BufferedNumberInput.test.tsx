import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BufferedNumberInput } from './BufferedNumberInput';

afterEach(cleanup);

describe('BufferedNumberInput', () => {
  it('takes its accessible name from the wrapping label', () => {
    render(
      <label>
        Amount
        <BufferedNumberInput value={10} min={0} max={100} onCommit={vi.fn()} />
      </label>
    );

    expect(screen.getByLabelText('Amount')).toHaveValue(10);
  });

  it('buffers edits until blur and clamps the committed value to the max', () => {
    const onCommit = vi.fn();
    render(<BufferedNumberInput value={10} min={0} max={50} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '75' } });
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith(50);
    expect(input).toHaveValue(50);
  });

  it('clamps the committed value up to the min', () => {
    const onCommit = vi.fn();
    render(<BufferedNumberInput value={10} min={0} max={100} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.blur(input);

    expect(onCommit).toHaveBeenCalledWith(0);
    expect(input).toHaveValue(0);
  });

  it('discards an empty draft on blur without committing', () => {
    const onCommit = vi.fn();
    render(<BufferedNumberInput value={10} min={0} max={100} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);

    expect(onCommit).not.toHaveBeenCalled();
    expect(input).toHaveValue(10);
  });

  it('commits a valid value immediately when commitOnChange is set', () => {
    const onCommit = vi.fn();
    render(<BufferedNumberInput value={10} min={0} max={100} commitOnChange onCommit={onCommit} />);

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '42' } });

    expect(onCommit).toHaveBeenCalledWith(42);
  });

  it('ignores an empty draft when commitOnChange is set', () => {
    const onCommit = vi.fn();
    render(<BufferedNumberInput value={10} min={0} max={100} commitOnChange onCommit={onCommit} />);

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '' } });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits and blurs on Enter', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<BufferedNumberInput value={10} min={0} max={100} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '42');
    expect(onCommit).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');

    expect(onCommit).toHaveBeenCalledWith(42);
    expect(input).not.toHaveFocus();
  });

  it('cancels a dirty draft on Escape, blurs without committing, and can be edited again', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<BufferedNumberInput value={10} min={0} max={100} onCommit={onCommit} />);

    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    await user.click(input);
    await user.clear(input);
    await user.type(input, '42');
    await user.keyboard('{Escape}');

    expect(input).toHaveValue(10);
    expect(input).not.toHaveFocus();
    expect(onCommit).not.toHaveBeenCalled();

    await user.click(input);
    await user.clear(input);
    await user.type(input, '23');
    await user.keyboard('{Enter}');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(23);
    expect(input).not.toHaveFocus();
  });

  it('syncs the draft when the value prop changes', () => {
    const { rerender } = render(<BufferedNumberInput value={10} min={0} max={100} onCommit={vi.fn()} />);

    const input = screen.getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99' } });
    expect(input).toHaveValue(99);

    rerender(<BufferedNumberInput value={25} min={0} max={100} onCommit={vi.fn()} />);

    expect(input).toHaveValue(25);
  });

  it('disables the input', () => {
    render(<BufferedNumberInput value={10} min={0} max={100} disabled onCommit={vi.fn()} />);

    expect(screen.getByRole('spinbutton')).toBeDisabled();
  });
});
