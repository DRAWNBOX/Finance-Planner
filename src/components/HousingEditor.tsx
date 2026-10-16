import { memo, useState } from 'react';
import { BufferedNumberInput } from './BufferedNumberInput';
import { DateOrMarkerInput } from './DateOrMarkerInput';
import { createCommandId } from '../commands';
import type { AccountDefinition, DateMarker, FundingPolicy, HousingEntry, HousingFundingGroup, LiabilityDefinition, PropertyDefinition } from '../types';
import { FundingPolicyEditor } from './FundingPolicyEditor';
import './HousingEditor.css';
import { useRenderCount } from '../utils/perfTools';

interface HousingEditorProps {
  housing: HousingEntry[];
  selectedHousingId: string;
  onSelectHousing: (id: string) => void;
  onChangeHousing: (housing: HousingEntry) => void;
  onReorderHousing: (fromId: string, toId: string) => void;
  onAddHousing: (type: 'mortgage' | 'rental') => void;
  onDuplicateHousing: (id: string) => void;
  onRemoveHousing: (id: string) => void;
  accountOptions: Array<{ value: string; label: string }>;
  orderedBankAccounts: AccountDefinition[];
  careerOptions: Array<{ id: string; label: string }>;
  dateMarkers?: DateMarker[];
  incomeIndicators?: Record<string, { status: 'warning' | 'invalid'; tooltip: string }>;
  allowReordering?: boolean;
  /** Full ISO date used when creating dated canonical funding events. */
  referenceDate?: string;
  createId?: (prefix: string) => string;
  properties?: PropertyDefinition[];
  liabilities?: LiabilityDefinition[];
  globalFundingPolicy?: FundingPolicy;
  onChangeProperty?: (property: PropertyDefinition) => void;
  onChangeLiability?: (liability: LiabilityDefinition) => void;
}

export const HousingEditor = memo(({
  housing,
  selectedHousingId,
  onSelectHousing,
  onChangeHousing,
  onReorderHousing,
  onAddHousing,
  onDuplicateHousing,
  onRemoveHousing,
  orderedBankAccounts,
  careerOptions,
  dateMarkers = [],
  incomeIndicators = {},
  allowReordering = true,
  referenceDate,
  createId = createCommandId,
  properties = [], liabilities = [], onChangeProperty, onChangeLiability, globalFundingPolicy
}: HousingEditorProps) => {
  useRenderCount('HousingEditor');
  const [dragHousingId, setDragHousingId] = useState<string | null>(null);
  const selected = housing.find((h) => h.id === selectedHousingId) ?? housing[0];
  const selectedIndex = selected ? housing.findIndex((h) => h.id === selected.id) : -1;
  const previous = selectedIndex > 0 ? housing[selectedIndex - 1] : undefined;
  const previousEnd = previous
    ? (previous.housingType === 'mortgage' ? previous.sellYearMonth : previous.endYearMonth)
    : '';
  const canUsePreviousEnd = Boolean(previous && previousEnd && previousEnd.length > 0);
  const hasCareers = careerOptions.length > 0;
  const startLinked = Boolean(selected?.linkedCareerStartId);
  const endLinked = Boolean(selected?.linkedCareerEndId);

  const globalPolicy = globalFundingPolicy ?? { primaryAccountId: null, fallbackAccountIds: [] };
  const legacySource = (group: HousingFundingGroup): string | undefined => group === 'payment' ? selected?.paymentSource : group === 'taxesInsurance' ? selected?.taxesInsuranceSource : group === 'hoaMaintenance' ? selected?.hoaMaintenanceSource : group === 'pmi' ? selected?.pmiSource : selected?.downPaymentSource ?? selected?.paymentSource;
  const policyFor = (group: HousingFundingGroup): FundingPolicy => {
    const existing = selected?.fundingPolicies?.[group];
    if (existing) return existing;
    const source = legacySource(group);
    if (source?.startsWith('account:')) return { primaryAccountId: source.slice(8), fallbackAccountIds: [] };
    if (source === 'income') return { primaryAccountId: null, fallbackAccountIds: [] };
    return globalPolicy;
  };
  const setPolicy = (group: HousingFundingGroup, policy: FundingPolicy) => selected && onChangeHousing({ ...selected, fundingPolicies: { ...selected.fundingPolicies, [group]: { ...policy, fallbackAccountIds: [...policy.fallbackAccountIds] } } });
  const groupLabels: Array<[HousingFundingGroup, string]> = [['payment', 'Mortgage payment / rent'], ['taxesInsurance', 'Taxes & insurance'], ['hoaMaintenance', 'HOA & maintenance'], ['pmi', 'PMI'], ['downPayment', 'Down payment']];

  return (
    <div className="housing-editor">
      <div className="career-tabs">
        {housing.map((entry) => {
          const indicator = incomeIndicators[entry.id];
          return (
            <button
              key={entry.id}
              type="button"
              className={`career-tab${entry.id === selected?.id ? ' active' : ''}${dragHousingId === entry.id ? ' dragging' : ''}${indicator ? ` ${indicator.status}` : ''}`}
              title={indicator?.tooltip}
              draggable={allowReordering}
              onClick={() => onSelectHousing(entry.id)}
              onDragStart={() => allowReordering && setDragHousingId(entry.id)}
              onDragOver={(event) => allowReordering && event.preventDefault()}
              onDrop={() => {
                if (allowReordering && dragHousingId) {
                  onReorderHousing(dragHousingId, entry.id);
                }
              }}
              onDragEnd={() => allowReordering && setDragHousingId(null)}
            >
              {entry.label}
              {indicator ? (
                <span className="income-indicator-mark" aria-hidden="true">
                  {indicator.status === 'invalid' ? ' ⚠' : ' •'}
                </span>
              ) : null}
            </button>
          );
        })}
        <button type="button" className="career-tab add" onClick={() => onAddHousing('mortgage')}>
          + Mortgage
        </button>
        <button type="button" className="career-tab add" onClick={() => onAddHousing('rental')}>
          + Rental
        </button>
      </div>

      {selected ? (
        <>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={selected.enabled}
              onChange={(e) => onChangeHousing({ ...selected, enabled: e.target.checked })}
            />
            <span>Estimate this housing expense</span>
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={selected.showOnGraph}
              onChange={(e) => onChangeHousing({ ...selected, showOnGraph: e.target.checked })}
            />
            <span>Show flag on graph</span>
          </label>

          {incomeIndicators[selected.id] && (
            <p
              className={`income-indicator-note ${incomeIndicators[selected.id].status}`}
              title={incomeIndicators[selected.id].tooltip}
            >
              {incomeIndicators[selected.id].status === 'invalid'
                ? 'This housing expense exceeds your available income and could not be fully covered.'
                : 'Part of this housing expense is funded from a fallback account.'}
            </p>
          )}

          <div className="career-grid">
            <section className="full-span housing-funding-groups" aria-label="Housing funding order">
              <h3>Housing funding order</h3><p>Set an account order for each cost. Groups without an override follow the global default.</p>
              {groupLabels.map(([group, label]) => {
                const overridden = selected.fundingPolicies?.[group] !== undefined;
                return <details key={group} className="housing-funding-group" open={group === 'payment' || group === 'downPayment'}>
                  <summary>{label}<span className={`housing-funding-state ${overridden ? 'is-override' : ''}`}>{overridden ? 'Custom order' : 'Inherited'}</span></summary>
                  <label className="checkbox-row housing-funding-toggle"><input type="checkbox" checked={overridden} aria-label={`Override ${label} funding`} onChange={event => {
                    if (event.target.checked) setPolicy(group, policyFor(group));
                    else { const policies = { ...selected.fundingPolicies }; delete policies[group]; onChangeHousing({ ...selected, fundingPolicies: policies }); }
                  }}/><span>Use a custom order for this cost</span></label>
                  <FundingPolicyEditor policy={policyFor(group)} accounts={orderedBankAccounts} mode={overridden ? 'override' : 'inherited'} onChange={policy => setPolicy(group, policy)} />
                </details>;
              })}
            </section>
            {onChangeProperty ? <section className="full-span" aria-label="Canonical property and debt">
              <h3>Property record</h3>
              {(() => {
                const property = properties.find(item => item.sourceConfigId === selected.id);
                const debt = property?.debtLink ? liabilities.find(item => item.id === property.debtLink) : liabilities.find(item => item.sourceConfigId === selected.id && item.kind === 'mortgage');
                return <>
                  <label><span>Linked property</span><select aria-label="Linked property" value={property?.id ?? ''} onChange={event => {
                    const next = properties.find(item => item.id === event.target.value);
                    if (next) onChangeProperty({ ...next, sourceConfigId: selected.id });
                  }}><option value="">Not linked</option>{properties.map(item => <option key={item.id} value={item.id}>{item.label ?? item.id}</option>)}</select></label>
                  {property ? <>
                    <label><span>Property status</span><select value={property.status} onChange={event => onChangeProperty({ ...property, status: event.target.value as PropertyDefinition['status'] })}><option value="pending">Pending acquisition</option><option value="owned">Owned</option><option value="sold">Sold</option></select></label>
                    <label><span>{property.status === 'owned' ? 'Observed property value' : 'Planned property value'}</span><BufferedNumberInput value={property.value} min={0} max={50000000} step={1000} onCommit={value => onChangeProperty({ ...property, value })}/></label>
                    {property.status === 'pending' ? <>
                      <label><span>Required down payment</span><BufferedNumberInput value={property.requiredDownPayment} min={0} max={50000000} step={1000} onCommit={value => onChangeProperty({ ...property, requiredDownPayment: value })}/></label>
                    <div className="housing-date-field"><span>Acquisition date</span><DateOrMarkerInput label="Acquisition" value={property.acquisitionYearMonth ?? ''} markerId={null} markers={dateMarkers} onChange={date => onChangeProperty({ ...property, acquisitionYearMonth: date })}/></div>
                      <div className="full-span"><p>Funding events are dated and explicit. Funds remain a held deposit until the required amount is met and completion is recorded; no ownership costs or appreciation apply while pending.</p>
                        {(property.fundingEvents ?? []).map((event, index) => <div key={event.id}>
                          <label>Funding date <input aria-label={`Funding date ${index + 1}`} type="date" value={event.date} onChange={e => onChangeProperty({ ...property, fundingEvents: (property.fundingEvents ?? []).map((item, i) => i === index ? { ...item, date: e.target.value } : item) })}/></label>
                          <label>Amount <BufferedNumberInput value={event.amount} min={0} max={50000000} step={100} onCommit={amount => onChangeProperty({ ...property, fundingEvents: (property.fundingEvents ?? []).map((item, i) => i === index ? { ...item, amount } : item) })}/></label>
                          <label>From account <select value={event.accountId ?? ''} onChange={e => onChangeProperty({ ...property, fundingEvents: (property.fundingEvents ?? []).map((item, i) => i === index ? { ...item, accountId: e.target.value || null } : item) })}><option value="">Choose account</option>{orderedBankAccounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}{event.accountId && !orderedBankAccounts.some(a => a.id === event.accountId) ? <option value={event.accountId}>Unavailable account ({event.accountId})</option> : null}</select></label>
                          <button type="button" onClick={() => onChangeProperty({ ...property, fundingEvents: (property.fundingEvents ?? []).filter((_, i) => i !== index) })}>Remove event</button>
                        </div>)}
                        <button type="button" onClick={() => onChangeProperty({ ...property, fundingEvents: [...(property.fundingEvents ?? []), { id: createId('property-funding'), date: referenceDate ?? `${property.acquisitionYearMonth ?? selected.startYearMonth}-01`, amount: 0, accountId: null }] })}>Add funding event</button>
                         <div className="housing-date-field"><span>Completion date</span><DateOrMarkerInput label="Completion" value={property.completedDate ?? ''} markerId={null} markers={dateMarkers} onChange={date => onChangeProperty({ ...property, completedDate: date })}/></div>
                      </div>
                    </> : null}
                    <label><span>Linked mortgage</span><select value={debt?.id ?? ''} onChange={event => { const next = liabilities.find(item => item.id === event.target.value); if (next) onChangeProperty({ ...property, debtLink: next.id }); }}><option value="">No linked liability</option>{liabilities.filter(item => item.kind === 'mortgage').map(item => <option key={item.id} value={item.id}>{item.label ?? item.id}</option>)}</select></label>
                    {debt ? <label><span>Observed mortgage balance</span><BufferedNumberInput value={debt.openingBalance} min={0} max={50000000} step={1000} disabled={!onChangeLiability} onCommit={openingBalance => onChangeLiability?.({ ...debt, openingBalance })}/></label> : null}
                    <p className="full-span">Sale proceeds go to the selected destination account. If proceeds do not cover sale costs and linked debt, the remaining deficiency stays as debt.</p>
                  </> : <p>Select an existing canonical property record to link it to this housing entry.</p>}
                  {property && property.debtLink && !debt ? <p role="status">Linked liability “{property.debtLink}” is unavailable. It has not been replaced.</p> : null}
                </>;
              })()}
            </section> : null}
            <label className="full-span">
              <span>Name</span>
              <input type="text" value={selected.label} onChange={(e) => onChangeHousing({ ...selected, label: e.target.value })} />
            </label>
            <div className="housing-date-field">
              <span>Start Year-Month</span>
              <DateOrMarkerInput
                label="Start"
                value={selected.startYearMonth}
                markerId={selected.startMarkerId}
                markers={dateMarkers}
                disabled={Boolean(selected.usePreviousEndAsStart) || startLinked}
                onChange={(next, markerId) =>
                  onChangeHousing({
                    ...selected,
                    startYearMonth: next,
                    startMarkerId: markerId,
                    usePreviousEndAsStart: markerId ? false : selected.usePreviousEndAsStart,
                    linkedCareerStartId: markerId ? null : selected.linkedCareerStartId
                  })
                }
              />
            </div>
            <label className="full-span checkbox-row">
              <input
                type="checkbox"
                checked={Boolean(selected.usePreviousEndAsStart)}
                disabled={!canUsePreviousEnd || startLinked}
                onChange={(e) => onChangeHousing({
                  ...selected,
                  usePreviousEndAsStart: e.target.checked,
                  linkedCareerStartId: e.target.checked ? null : selected.linkedCareerStartId,
                  startMarkerId: e.target.checked ? null : selected.startMarkerId
                })}
              />
              <span>Use the month after the previous housing end date as the start date</span>
            </label>
            <label className="full-span checkbox-row">
              <input
                type="checkbox"
                checked={startLinked}
                disabled={!hasCareers}
                onChange={(e) => onChangeHousing({
                  ...selected,
                  linkedCareerStartId: e.target.checked ? (selected.linkedCareerStartId ?? careerOptions[0]?.id ?? null) : null,
                  usePreviousEndAsStart: e.target.checked ? false : selected.usePreviousEndAsStart,
                  startMarkerId: e.target.checked ? null : selected.startMarkerId
                })}
              />
              <span>Link start date to a career</span>
            </label>
            {startLinked ? (
              <label>
                <span>Start Career</span>
                <select
                  aria-label="Start Career"
                  value={selected.linkedCareerStartId ?? ''}
                  onChange={(e) => onChangeHousing({ ...selected, linkedCareerStartId: e.target.value || null })}
                >
                  {selected.linkedCareerStartId && !careerOptions.some(career => career.id === selected.linkedCareerStartId) ? <option value={selected.linkedCareerStartId}>Unavailable career ({selected.linkedCareerStartId})</option> : null}
                  {careerOptions.map((career) => <option key={career.id} value={career.id}>{career.label}</option>)}
                </select>
              </label>
            ) : null}

            {selected.housingType === 'mortgage' ? (
              <>
                <label>
                  <span>Purchase Price</span>
                  <BufferedNumberInput value={selected.purchasePrice} min={0} max={50000000} step={1000} onCommit={(v) => onChangeHousing({ ...selected, purchasePrice: v })} />
                </label>
                <label>
                  <span>Down Payment</span>
                  <BufferedNumberInput value={selected.downPayment} min={0} max={50000000} step={1000} onCommit={(v) => onChangeHousing({ ...selected, downPayment: v })} />
                </label>
                <label>
                  <span>APR %</span>
                  <BufferedNumberInput value={selected.annualInterestRate} min={0} max={80} step={0.1} onCommit={(v) => onChangeHousing({ ...selected, annualInterestRate: v })} />
                </label>
                <label>
                  <span>Loan Term (years)</span>
                  <BufferedNumberInput value={selected.loanTermYears} min={1} max={50} step={1} onCommit={(v) => onChangeHousing({ ...selected, loanTermYears: v })} />
                </label>
                <label>
                  <span>Extra Monthly Payment</span>
                  <BufferedNumberInput value={selected.extraMonthlyPayment} min={0} max={50000} step={50} onCommit={(v) => onChangeHousing({ ...selected, extraMonthlyPayment: v })} />
                </label>
                <label>
                  <span>PMI/mo</span>
                  <BufferedNumberInput value={selected.pmiMonthly} min={0} max={10000} step={10} onCommit={(v) => onChangeHousing({ ...selected, pmiMonthly: v })} />
                </label>
                <label>
                  <span>Appreciation Rate %</span>
                  <BufferedNumberInput value={selected.appreciationRate} min={0} max={30} step={0.1} onCommit={(v) => onChangeHousing({ ...selected, appreciationRate: v })} />
                </label>
                <div className="housing-date-field">
                  <span>Sell Year-Month</span>
                  <DateOrMarkerInput
                    label="Sell"
                    value={selected.sellYearMonth}
                    markerId={selected.sellMarkerId}
                    markers={dateMarkers}
                    disabled={endLinked}
                    onChange={(next, markerId) =>
                      onChangeHousing({
                        ...selected,
                        sellYearMonth: next,
                        sellMarkerId: markerId,
                        linkedCareerEndId: markerId ? null : selected.linkedCareerEndId
                      })
                    }
                  />
                </div>
                <label>
                  <span>Sale Proceeds Account</span>
                  <select aria-label="Sale Proceeds Account" value={selected.saleProceedsAccountId ?? ''} onChange={(e) => onChangeHousing({ ...selected, saleProceedsAccountId: e.target.value || undefined })}>
                    <option value="">-</option>
                    {orderedBankAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                    {selected.saleProceedsAccountId && !orderedBankAccounts.some(a => a.id === selected.saleProceedsAccountId) ? <option value={selected.saleProceedsAccountId}>Unavailable account ({selected.saleProceedsAccountId})</option> : null}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label>
                  <span>Monthly Rent</span>
                  <BufferedNumberInput value={selected.monthlyRent} min={0} max={100000} step={50} onCommit={(v) => onChangeHousing({ ...selected, monthlyRent: v })} />
                </label>
                <div className="housing-date-field">
                  <span>End Year-Month</span>
                  <DateOrMarkerInput
                    label="End"
                    value={selected.endYearMonth}
                    markerId={selected.endMarkerId}
                    markers={dateMarkers}
                    disabled={endLinked}
                    onChange={(next, markerId) =>
                      onChangeHousing({
                        ...selected,
                        endYearMonth: next,
                        endMarkerId: markerId,
                        linkedCareerEndId: markerId ? null : selected.linkedCareerEndId
                      })
                    }
                  />
                </div>
              </>
            )}

            <label className="full-span checkbox-row">
              <input
                type="checkbox"
                checked={endLinked}
                disabled={!hasCareers}
                onChange={(e) => onChangeHousing({
                  ...selected,
                  linkedCareerEndId: e.target.checked ? (selected.linkedCareerEndId ?? careerOptions[0]?.id ?? null) : null,
                  sellMarkerId: e.target.checked ? null : selected.sellMarkerId,
                  endMarkerId: e.target.checked ? null : selected.endMarkerId
                })}
              />
              <span>Link end date to a career</span>
            </label>
            {endLinked ? (
              <label>
                <span>End Career</span>
                <select
                  aria-label="End Career"
                  value={selected.linkedCareerEndId ?? ''}
                  onChange={(e) => onChangeHousing({ ...selected, linkedCareerEndId: e.target.value || null })}
                >
                  {selected.linkedCareerEndId && !careerOptions.some(career => career.id === selected.linkedCareerEndId) ? <option value={selected.linkedCareerEndId}>Unavailable career ({selected.linkedCareerEndId})</option> : null}
                  {careerOptions.map((career) => <option key={career.id} value={career.id}>{career.label}</option>)}
                </select>
              </label>
            ) : null}

            <label>
              <span>Property Tax/yr</span>
              <BufferedNumberInput value={selected.propertyTaxYearly} min={0} max={500000} step={100} onCommit={(v) => onChangeHousing({ ...selected, propertyTaxYearly: v })} />
            </label>
            <label>
              <span>Home Insurance/yr</span>
              <BufferedNumberInput value={selected.homeInsuranceYearly} min={0} max={100000} step={50} onCommit={(v) => onChangeHousing({ ...selected, homeInsuranceYearly: v })} />
            </label>
            <label>
              <span>HOA/mo</span>
              <BufferedNumberInput value={selected.hoaMonthly} min={0} max={50000} step={10} onCommit={(v) => onChangeHousing({ ...selected, hoaMonthly: v })} />
            </label>
            <label>
              <span>Maintenance/mo</span>
              <BufferedNumberInput value={selected.maintenanceMonthly} min={0} max={50000} step={10} onCommit={(v) => onChangeHousing({ ...selected, maintenanceMonthly: v })} />
            </label>
            <label>
              <span>Rental Income/mo</span>
              <BufferedNumberInput value={selected.rentalIncomeMonthly} min={0} max={100000} step={50} onCommit={(v) => onChangeHousing({ ...selected, rentalIncomeMonthly: v })} />
            </label>
            <label>
              <span>Rental Income Account</span>
              <select value={selected.rentalIncomeAccountId ?? ''} onChange={(e) => onChangeHousing({ ...selected, rentalIncomeAccountId: e.target.value || undefined })}>
                <option value="">-</option>
                {orderedBankAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>
          </div>

          <div className="career-actions">
            <button type="button" className="secondary-button" onClick={() => onDuplicateHousing(selected.id)}>
              Duplicate Housing
            </button>
            <button type="button" className="secondary-button danger-button" onClick={() => onRemoveHousing(selected.id)}>
              Remove Housing
            </button>
          </div>
        </>
      ) : (
        <p className="subtle">Add a mortgage or rental to get started.</p>
      )}
    </div>
  );
});
