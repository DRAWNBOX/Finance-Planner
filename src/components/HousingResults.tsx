import type { HousingEntry, PropertyDefinition } from '../types';
import type { ProjectionReport } from '../engine/reporting';
import { parseHousingDefinitionId, standaloneRentalPlanId } from '../engine/housing';

const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);

/** Read-only housing facts selected from the one projection report. */
export function HousingResults({ housing, property, report }: { housing: HousingEntry; property?: PropertyDefinition; report: ProjectionReport }) {
  const propertyId = property?.id;
  const reportPropertyId = propertyId ?? (housing.housingType === 'rental' ? standaloneRentalPlanId(housing.id) : null);
  const belongs = (id: string) => {
    const parsed = parseHousingDefinitionId(id);
    return Boolean(reportPropertyId && parsed?.propertyId === reportPropertyId);
  };
  const outcomes = report.outcomes.filter(row => belongs(row.definitionId));
  const schedules = report.schedules.filter(row => belongs(row.definitionId));
  const last = report.months[report.months.length - 1];
  const propertyClose = propertyId ? last?.properties.find(row => row.propertyId === propertyId) : undefined;
  const propertyAudit = propertyId ? report.audit.filter(row => row.definitionId !== null && belongs(row.definitionId)) : [];
  const observedCompletion = propertyAudit.some(row => row.propertyChanges.some(change => change.status === 'owned') || row.purpose === 'housingAcquisitionCompletion');
  const observedDisposition = propertyAudit.some(row => row.purpose === 'housingDisposition' || row.propertyChanges.some(change => change.status === 'sold'));
  const acquisitionNotReached = Boolean(property?.acquisitionYearMonth && property.acquisitionYearMonth > report.metadata.endYearMonth);
  const debtId = property?.debtLink ?? null;
  const debtClose = debtId ? last?.liabilities.find(row => row.liabilityId === debtId) : undefined;
  const deficiencyId = propertyId ? `housing:${propertyId}:saleDeficiency` : null;
  const deficiencyClose = deficiencyId ? last?.liabilities.find(row => row.liabilityId === deficiencyId) : undefined;
  const deficiency = deficiencyClose ? deficiencyClose.closingPrincipalCents + deficiencyClose.closingInterestCents + deficiencyClose.closingFeesCents : 0;
  const propertyStatus = propertyClose?.closingValueCents && propertyClose.closingValueCents > 0
    ? 'Property held at projection close'
    : propertyClose?.closingDepositCents && propertyClose.closingDepositCents > 0
      ? 'Acquisition still pending'
      : acquisitionNotReached
        ? 'Acquisition not reached in this projection'
        : property?.status === 'pending' && !observedCompletion && !observedDisposition && !acquisitionNotReached
          ? 'Acquisition still pending'
          : 'No property held at projection close';
  const observedPayoff = debtClose ? schedules.find(row => row.liabilityIds.includes(debtClose.liabilityId) && row.payoffYearMonth !== null)?.payoffYearMonth : null;

  return <section className="housing-results" aria-labelledby="housing-results-title">
    <p className="housing-results__eyebrow">ONE PROJECTION · OBSERVED ONLY</p>
    <h2 id="housing-results-title">{housing.label || 'Housing'} results</h2>
    {housing.housingType === 'rental' && !property ? <p className="housing-results__note">Rental costs are included below. This rental has no linked property or mortgage.</p> : null}
    {property && propertyClose ? <div className="housing-results__status"><strong>{propertyStatus}</strong><span>Observed property value {money(propertyClose.closingValueCents)} · held deposit {money(propertyClose.closingDepositCents)}</span></div> : property ? <p className="housing-results__note">No property close is available in this projection window.</p> : null}
    {schedules.length ? <div className="housing-results__table-wrap"><table><caption>Observed housing obligations</caption><thead><tr><th scope="col">Cost</th><th scope="col">Requested</th><th scope="col">Paid</th><th scope="col">Unpaid</th></tr></thead><tbody>{schedules.map(row => <tr key={row.definitionId}><th scope="row">{row.purpose.replace(/^housing/, '').replace(/([A-Z])/g, ' $1').trim() || 'Housing'}</th><td>{money(row.requestedCents)}</td><td>{money(row.executedCents)}</td><td>{money(row.shortfallCents)}</td></tr>)}</tbody></table></div> : <p className="housing-results__note">No housing obligations were observed in this projection window.</p>}
    {outcomes.some(row => row.shortfallCents > 0) ? <p className="housing-results__warning">Some housing costs were only partly paid or went unpaid. The amounts above are from observed funding results.</p> : null}
    {debtClose ? <p className="housing-results__note">Mortgage balance at projection close: {money(debtClose.closingPrincipalCents + debtClose.closingInterestCents + debtClose.closingFeesCents)}{observedPayoff ? ` · observed payoff ${observedPayoff}` : ''}</p> : null}
    {deficiency > 0 ? <p className="housing-results__warning">Sale deficiency retained as debt: {money(deficiency)}. Signed net worth at projection close: {money(last?.closing.netWorthCents ?? 0)}.</p> : null}
    {!property && housing.housingType !== 'rental' ? <p className="housing-results__note">No linked property record is available, so ownership and mortgage results cannot be shown.</p> : null}
  </section>;
}
