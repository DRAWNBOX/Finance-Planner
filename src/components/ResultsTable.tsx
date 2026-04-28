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
          <th>Career</th>
          <th>Start</th>
          <th>Salary</th>
          <th>Career Savings</th>
          <th>Emergency Fund</th>
          <th>HSA</th>
          <th>Investments</th>
          <th>401K</th>
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
            <td>{formatCurrency(year.savingsBalances.emergencyFund)}</td>
            <td>{formatCurrency(year.savingsBalances.hsa)}</td>
            <td>{formatCurrency(year.savingsBalances.investments)}</td>
            <td>{formatCurrency(year.savingsBalances.retirement401k)}</td>
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
