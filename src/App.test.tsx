import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('switches between graph and table results', () => {
    render(<App />);

    expect(screen.getByRole('img', { name: /portfolio value over time/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));

    expect(screen.getByRole('columnheader', { name: 'Contribution' })).toBeInTheDocument();
  });

  it('shows an inline editor when an add-on checkbox is enabled', () => {
    render(<App />);

    fireEvent.click(screen.getAllByLabelText('Social Security')[0]);

    expect(screen.getAllByText('Social Security').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('24000')).toBeInTheDocument();
  });

  it('persists scenario changes to local storage', () => {
    render(<App />);

    const currentAgeInput = screen.getAllByDisplayValue('45')[0];
    fireEvent.change(currentAgeInput, { target: { value: '46' } });

    const stored = window.localStorage.getItem('finance-planner-scenario');

    expect(stored).toContain('"currentAge":46');
  });
});
