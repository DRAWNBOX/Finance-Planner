import { memo } from 'react';
import type { ProjectionReport, ReportMonthClose, ReportYear } from '../engine/reporting';
import { displayObservedCents } from '../utils/viewAdapters';
import type { DisplayContext } from '../utils/viewAdapters';

type ReportRow = ReportMonthClose | ReportYear;
interface ResultsTableProps {
  report: ProjectionReport;
  displayContext: DisplayContext;
  inflationRatePercent: number;
  inflationEnabled: boolean;
  showMonths?: boolean;
  rowTooltip?: (row: ReportRow, index: number) => string | undefined;
  cellTooltip?: (columnId: string, row: ReportRow, index: number) => string | undefined;
}

const currency = (cents: number, date: string, report: ProjectionReport, rate: number, enabled: boolean): string => {
  const result = displayObservedCents({ date: date as `${number}-${number}-${number}`, cents }, report.metadata.startDate, rate, enabled);
  if (!result.ok) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(result.value.displayDollars);
};

export const ResultsTable = memo(({ report, displayContext, inflationRatePercent, inflationEnabled, showMonths = false, rowTooltip, cellTooltip }: ResultsTableProps) => {
  const rows: ReportRow[] = showMonths ? [...report.months] : [...report.years];
  const accountIds = [...new Set(report.months.flatMap((month) => month.accounts.map((account) => account.accountId)))].sort();
  const labels = new Map(accountIds.map((id) => [id, id]));
  const observationDate = (row: ReportRow) => 'closingDate' in row
    ? row.closingDate
    : report.months.find((month) => month.yearMonth === row.lastYearMonth)?.closingDate ?? displayContext.endDate;
  const value = (cents: number, row: ReportRow) => currency(cents, observationDate(row), report, inflationRatePercent, inflationEnabled);
  const moneyCell = (id: string, cents: number, row: ReportRow, index: number) => <td key={id} title={cellTooltip?.(id, row, index)}>{value(cents, row)}</td>;
  return <div className="table-wrap" role="region" aria-label="Projection results" tabIndex={0}>
    <table>
      <thead><tr>
        <th scope="col">{showMonths ? 'Month' : 'Year'}</th>
        {showMonths && <th scope="col">Closing date</th>}
        <th scope="col">Opening net worth</th><th scope="col">Closing net worth</th>
        <th scope="col">Assets</th><th scope="col">Liabilities</th>
        {accountIds.map((id) => <th scope="col" key={id}>Account asset: {labels.get(id) ?? id}</th>)}
        <th scope="col">Net pay</th><th scope="col">Requested</th><th scope="col">Paid</th><th scope="col">Unpaid</th>
        <th scope="col">Payroll withholding</th><th scope="col">Withdrawal taxes</th><th scope="col">Penalties</th>
      </tr></thead>
      <tbody>{rows.map((row, index) => {
        const date = observationDate(row);
        const flow = row.flow;
        const byId = 'accounts' in row ? row.accounts : report.months.find((month) => month.yearMonth === row.lastYearMonth)?.accounts ?? [];
        return <tr key={'yearMonth' in row ? row.yearMonth : row.label} title={rowTooltip?.(row, index)}>
          <th scope="row">{'yearMonth' in row ? row.yearMonth : row.label}</th>
          {showMonths && <td>{date}</td>}
          {moneyCell('opening-net-worth', row.opening.netWorthCents, row, index)}{moneyCell('closing-net-worth', row.closing.netWorthCents, row, index)}
          {moneyCell('assets', row.closing.assetsCents, row, index)}{moneyCell('liabilities', row.closing.liabilityCents, row, index)}
          {accountIds.map((id) => moneyCell(id, byId.find((account) => account.accountId === id)?.closingCents ?? 0, row, index))}
          {moneyCell('net-pay', flow.netPayCents, row, index)}{moneyCell('requested', flow.requestedSpendingCents, row, index)}
          {moneyCell('paid', flow.executedSpendingCents, row, index)}{moneyCell('unpaid', flow.shortfallCents, row, index)}
          {moneyCell('payroll-withholding', flow.payrollTaxCents, row, index)}{moneyCell('withdrawal-taxes', flow.withdrawalTaxCents, row, index)}
          {moneyCell('penalties', flow.withdrawalPenaltyCents, row, index)}
        </tr>;
      })}</tbody>
    </table>
    {rows.length === 0 && <p role="status">No projection results for this period.</p>}
  </div>;
});
