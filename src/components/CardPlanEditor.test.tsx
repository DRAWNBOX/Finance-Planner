import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultOrdinaryCardSchedule, createDefaultZeroInterestCardPlan } from '../defaultScenario';
import type { DateMarker, LiabilityDefinition } from '../types';
import { CardPlanEditor } from './CardPlanEditor';

const referenceDate = new Date(2030, 0, 15);
const debt: LiabilityDefinition = { id: 'debt-1', kind: 'zeroInterestCard', label: 'Store card', openingBalance: 0 };

afterEach(cleanup);

describe('CardPlanEditor', () => {
  it('requires an explicit reference date to create either plan kind', () => {
    const onChange = vi.fn();
    render(<CardPlanEditor plan={null} accounts={[]} liabilities={[]} onChange={onChange} />);
    expect(screen.getByRole('button', { name: /expected card payment/i })).toBeDisabled();
    expect(screen.getByText(/reference date is needed/i)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('creates each card kind using the supplied reference date', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CardPlanEditor plan={null} accounts={[]} liabilities={[]} referenceDate={referenceDate} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /expected card payment/i }));
    expect(onChange.mock.calls[0][0]).toMatchObject({ kind: 'expectedPayment', startYearMonth: '2030-01', endYearMonth: '2030-12' });
    rerender(<CardPlanEditor plan={null} accounts={[]} liabilities={[]} referenceDate={referenceDate} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /permanent 0% payoff/i }));
    expect(onChange.mock.calls[1][0]).toMatchObject({ kind: 'zeroInterestPayoff', startYearMonth: '2030-01' });
  });

  it('shows linked zero debt as authoritative and preserves explicit zero', () => {
    const plan = createDefaultZeroInterestCardPlan(referenceDate, { liabilityId: debt.id, initialBalance: 80 });
    render(<CardPlanEditor plan={plan} accounts={[]} liabilities={[debt]} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/linked opening debt/i)).toHaveValue(0);
    expect(screen.getByLabelText(/linked opening debt/i)).toHaveAttribute('readonly');
  });

  it('updates marker-linked month from YYYY-MM-DD and rejects invalid marker dates', () => {
    const markers: DateMarker[] = [
      { id: 'valid', label: 'Move date', date: '2031-04-19' },
      { id: 'invalid', label: 'Bad date', date: '2031-19' }
    ];
    const onChange = vi.fn();
    const plan = createDefaultOrdinaryCardSchedule(referenceDate);
    render(<CardPlanEditor plan={plan} accounts={[]} liabilities={[]} markers={markers} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('First payment month marker'), { target: { value: 'valid' } });
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0]).toMatchObject({ startYearMonth: '2031-04', startMarkerId: 'valid' });
    fireEvent.change(screen.getByLabelText('First payment month marker'), { target: { value: 'invalid' } });
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0].startMarkerId).toBeNull();
  });

  it('warns when the linked liability is missing', () => {
    const plan = createDefaultZeroInterestCardPlan(referenceDate, { liabilityId: 'missing' });
    render(<CardPlanEditor plan={plan} accounts={[]} liabilities={[]} onChange={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/choose an available 0% card liability/i);
  });
});
