import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NetWorthHistoryChart } from './NetWorthHistoryChart';

describe('NetWorthHistoryChart', () => {
  it('labels legacy assets and preserves signed net-worth points', () => {
    const entries = [
      { id: 'a', date: '2024-01-01', accounts: [], totalNetWorth: 1200 },
      { id: 'b', date: '2025-01-01', accounts: [], totalNetWorth: -500, measurement: 'assetsMinusLiabilities' as const }
    ];
    render(<NetWorthHistoryChart entries={entries} />);
    expect(screen.getAllByText(/Net worth history/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/-\$500/).length).toBeGreaterThan(0);
    render(<NetWorthHistoryChart entries={entries} measurement="assetOnly" />);
    expect(screen.getAllByText(/Account\/assets history/).length).toBeGreaterThan(0);
    expect(document.querySelector('svg')?.textContent).toContain('-$');
    expect(entries[1].totalNetWorth).toBe(-500);
  });
  it('renders a no-data state', () => {
    render(<NetWorthHistoryChart entries={[]} />);
    expect(screen.getByText(/No balance history yet/)).toBeTruthy();
  });
});
