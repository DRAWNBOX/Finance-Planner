import { formatCurrency, formatPercent } from '../engine/projection';
import type { ProjectionYear } from '../types';

interface ResultsTableProps {
  years: ProjectionYear[];
}

export const ResultsTable = ({ years }: ResultsTableProps) => (
  <div className="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Age</th>
          <th>Start</th>
          <th>Contribution</th>
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
            <td>{formatCurrency(year.startBalance)}</td>
            <td>{formatCurrency(year.contribution)}</td>
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
