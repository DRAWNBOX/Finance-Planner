import { memo, useEffect, useState } from 'react';
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

const activityDetail = (row: ReportRow, report: ProjectionReport, rate: number, enabled: boolean): string => {
  const flow = row.flow;
  const date = 'closingDate' in row
    ? row.closingDate
    : report.months.find((month) => month.yearMonth === row.lastYearMonth)?.closingDate ?? report.metadata.endDate;
  const items: Array<[string, number]> = [
    ['Gross earnings', flow.grossEarningsCents], ['Net pay', flow.netPayCents],
    ['Payroll tax', flow.payrollTaxCents], ['Withdrawal tax', flow.withdrawalTaxCents],
    ['Withdrawal penalty', flow.withdrawalPenaltyCents], ['Account growth', flow.accountGrowthCents],
    ['Spending requested', flow.requestedSpendingCents], ['Spending paid', flow.executedSpendingCents],
    ['Debt interest paid', flow.debtInterestPaidCents], ['Debt interest accrued', flow.debtInterestAccruedCents],
    ['Debt principal paid', flow.debtPrincipalPaidCents]
  ];
  return items.filter(([, cents]) => cents !== 0)
    .map(([label, cents]) => `${label}: ${currency(cents, date, report, rate, enabled)}`).join(' · ')
    || 'No recorded activity for this period.';
};

export const ResultsTable = memo(({ report, displayContext, inflationRatePercent, inflationEnabled, showMonths = false, rowTooltip, cellTooltip }: ResultsTableProps) => {
  const [activeCell, setActiveCell] = useState<{ key: string; detail: string | undefined; report: ProjectionReport; rate: number; enabled: boolean; startDate: string } | null>(null);
  const detailIsCurrent = activeCell?.report === report && activeCell.rate === inflationRatePercent && activeCell.enabled === inflationEnabled && activeCell.startDate === report.metadata.startDate;
  useEffect(() => {
    setActiveCell((current) => current && (current.report !== report || current.rate !== inflationRatePercent || current.enabled !== inflationEnabled || current.startDate !== report.metadata.startDate) ? null : current);
  }, [report, inflationRatePercent, inflationEnabled]);
  const rows: ReportRow[] = showMonths ? [...report.months] : [...report.years];
  const accountIds = [...new Set(report.months.flatMap((month) => month.accounts.map((account) => account.accountId)))].sort();
  const labels = new Map(accountIds.map((id) => [id, id]));
  const observationDate = (row: ReportRow) => 'closingDate' in row
    ? row.closingDate
    : report.months.find((month) => month.yearMonth === row.lastYearMonth)?.closingDate ?? displayContext.endDate;
  const value = (cents: number, row: ReportRow) => currency(cents, observationDate(row), report, inflationRatePercent, inflationEnabled);
  const moneyCell = (id: string, cents: number, row: ReportRow, index: number) => <td key={id} title={cellTooltip?.(id, row, index)}>{value(cents, row)}</td>;
  const accountActivity = (accountId: string, row: ReportRow): string | undefined => {
    if (typeof report.byAccount !== 'function') return undefined;
    const first = 'yearMonth' in row ? row.yearMonth : row.firstYearMonth;
    const last = 'yearMonth' in row ? row.yearMonth : row.lastYearMonth;
    const changes = report.byAccount(accountId).filter((posting) => posting.yearMonth >= first && posting.yearMonth <= last)
      .flatMap((posting) => posting.accountChanges.filter((change) => change.accountId === accountId).map((change) => ({ posting, change })));
    if (changes.length === 0) return 'No recorded account activity for this period.';
    const delta = changes.reduce((total, item) => total + item.change.deltaCents, 0);
    const items = [`Account change: ${currency(delta, observationDate(row), report, inflationRatePercent, inflationEnabled)}`];
    for (const { posting, change } of changes) {
      const amount = currency(change.deltaCents, posting.date, report, inflationRatePercent, inflationEnabled);
      let detail = `${posting.date} · ${posting.purpose} · ${posting.kind} · ${amount}`;
      const allocations = posting.plan?.plan.allocations.filter((allocation) => allocation.accountId === accountId) ?? [];
      for (const allocation of allocations) {
        detail += ` (gross ${currency(allocation.grossDebitCents, posting.date, report, inflationRatePercent, inflationEnabled)}, net ${currency(allocation.netFundedCents, posting.date, report, inflationRatePercent, inflationEnabled)}, tax ${currency(allocation.withheldTaxCents, posting.date, report, inflationRatePercent, inflationEnabled)}, penalty ${currency(allocation.penaltyCents, posting.date, report, inflationRatePercent, inflationEnabled)})`;
      }
      items.push(detail);
    }
    return items.join(' · ');
  };
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
        const detail = activityDetail(row, report, inflationRatePercent, inflationEnabled);
        const label = 'yearMonth' in row ? row.yearMonth : row.label;
        const description = rowTooltip ? rowTooltip(row, index) : detail;
        return <tr key={label} title={description} tabIndex={0} aria-label={description ?? label}>
          <th scope="row">{label}</th>
          {showMonths && <td>{date}</td>}
          {moneyCell('opening-net-worth', row.opening.netWorthCents, row, index)}{moneyCell('closing-net-worth', row.closing.netWorthCents, row, index)}
          {moneyCell('assets', row.closing.assetsCents, row, index)}{moneyCell('liabilities', row.closing.liabilityCents, row, index)}
          {accountIds.map((id) => {
            const key = `${label}:${id}`;
            const active = detailIsCurrent && activeCell?.key === key;
            const text = active ? activeCell?.detail : undefined;
            const activate = () => {
              const override = cellTooltip?.(id, row, index);
              setActiveCell({ key, detail: override !== undefined ? override : cellTooltip ? undefined : accountActivity(id, row), report, rate: inflationRatePercent, enabled: inflationEnabled, startDate: report.metadata.startDate });
            };
            return <td key={id} title={text} tabIndex={0} aria-describedby={active && text ? `account-activity-${index}-${accountIds.indexOf(id)}` : undefined} onPointerEnter={activate} onFocus={activate} onPointerLeave={() => setActiveCell((current) => current?.key === key ? null : current)} onBlur={() => setActiveCell((current) => current?.key === key ? null : current)}>
              {value(byId.find((account) => account.accountId === id)?.closingCents ?? 0, row)}
              {active && text && <span id={`account-activity-${index}-${accountIds.indexOf(id)}`} className="sr-only">{text}</span>}
            </td>;
          })}
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
