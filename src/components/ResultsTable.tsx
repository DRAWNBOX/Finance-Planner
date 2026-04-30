import { formatCurrency, formatPercent } from '../engine/projection';
import type { ProjectionYear } from '../types';

interface ResultsTableProps {
  years: ProjectionYear[];
  accountColumns: Array<{ id: string; label: string }>;
}

export const ResultsTable = ({ years, accountColumns }: ResultsTableProps) => (
  <div className="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Age</th>
          <th>Career</th>
          <th>Start</th>
          <th>Salary</th>
          <th>Career Savings</th>
          {accountColumns.map((account) => (
            <th key={`results-account-header-${account.id}`}>{account.label}</th>
          ))}
          <th>Withdrawal</th>
          <th>Extra Cashflow</th>
          <th>Return %</th>
          <th>End</th>
        </tr>
      </thead>
      <tbody>
        {years.map((year) => (
          <tr key={year.age}>
            <td>{year.age}</td>
            <td>{year.careerLabel}</td>
            <td>{formatCurrency(year.startBalance)}</td>
            <td>{formatCurrency(year.salary)}</td>
            <td>{formatCurrency(year.careerContribution)}</td>
            {accountColumns.map((account) => (
              <td key={`results-account-balance-${year.age}-${account.id}`}>
                {formatCurrency(Math.max(0, year.accountBalancesById[account.id] ?? 0))}
              </td>
            ))}
            <td>{formatCurrency(year.withdrawal)}</td>
            <td>{formatCurrency(year.extraCashflow)}</td>
            <td>{formatPercent(year.annualReturnRate)}</td>
            <td>{formatCurrency(year.endBalance)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
