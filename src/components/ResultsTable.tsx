import { memo } from 'react';
import { formatCurrency, formatPercent } from '../engine/projection';
import type { MonthlySnapshot, ProjectionYear } from '../types';
import { useRenderCount } from '../utils/perfTools';

interface ResultsTableProps {
  years: ProjectionYear[];
  accountColumns: Array<{ id: string; label: string }>;
  showMonths?: boolean;
  monthlySnapshots?: MonthlySnapshot[];
  rowTooltip?: (row: ProjectionYear | MonthlySnapshot, index: number) => string | undefined;
  cellTooltip?: (columnId: string, row: ProjectionYear | MonthlySnapshot, index: number) => string | undefined;
}

export const ResultsTable = memo(({ years, accountColumns, showMonths, monthlySnapshots, rowTooltip, cellTooltip }: ResultsTableProps) => {
  useRenderCount('ResultsTable');
  return (
  <div className="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Year</th>
          {showMonths && <th>Month</th>}
          <th>Age</th>
          <th>Career</th>
          <th>Start</th>
          <th>Salary</th>
          <th>Career Savings</th>
          {accountColumns.map((account) => (
            <th key={`results-account-header-${account.id}`}>{account.label}</th>
          ))}
          <th>Withdrawal</th>
          <th>Taxes</th>
          <th>Penalties</th>
          <th>Return %</th>
          <th>End</th>
        </tr>
      </thead>
      <tbody>
        {(showMonths && monthlySnapshots ? monthlySnapshots : years).map((row, i) => {
          const isMonthly = 'calendarMonth' in row;
          const yr = row as ProjectionYear;
          const snap = row as MonthlySnapshot;
          return (
            <tr key={isMonthly ? `${snap.calendarYear}-${snap.calendarMonth}` : yr.age} title={rowTooltip?.(row, i)}>
              <td>{isMonthly ? snap.calendarYear : yr.calendarYear}</td>
              {showMonths && <td>{isMonthly ? snap.calendarMonth : ''}</td>}
              <td>{isMonthly ? snap.age : yr.age}</td>
              <td>{isMonthly ? snap.careerLabel : yr.careerLabel}</td>
              <td>{formatCurrency(isMonthly ? snap.startBalance : yr.startBalance)}</td>
              <td>{formatCurrency(isMonthly ? snap.salary : yr.salary)}</td>
              <td>{formatCurrency(isMonthly ? snap.careerContribution : yr.careerContribution)}</td>
              {accountColumns.map((account) => (
                <td key={`results-account-balance-${i}-${account.id}`} title={cellTooltip?.(account.id, row, i)}>
                  {formatCurrency(Math.max(0, (isMonthly ? snap.accountBalancesById : yr.accountBalancesById)[account.id] ?? 0))}
                </td>
              ))}
              <td>{formatCurrency(isMonthly ? snap.withdrawal : yr.withdrawal + yr.extraCashflow)}</td>
              <td>{formatCurrency(isMonthly ? snap.taxesPaid : yr.taxesPaid)}</td>
              <td>{formatCurrency(isMonthly ? snap.penaltiesPaid : yr.penaltiesPaid)}</td>
              <td>{formatPercent(isMonthly ? snap.annualReturnRate : yr.annualReturnRate)}</td>
              <td>{formatCurrency(isMonthly ? snap.endBalance : yr.endBalance)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
  );
});
