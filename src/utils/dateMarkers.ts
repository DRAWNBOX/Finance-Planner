import type { DateMarker, Scenario } from '../types';
import { ageFromYearMonth } from './ageDate';

export const makeDateMarkerId = () => `marker-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;

export const isIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value);

export const isYearMonth = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

export const normalizeMarkerDate = (value: unknown): string => (isIsoDate(value) ? value : '');

export const yearMonthFromMarkerDate = (date: string): string => (isIsoDate(date) ? date.slice(0, 7) : '');

export const formatYearMonthLabel = (yearMonth: string): string => {
  const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
  if (!match) {
    return yearMonth;
  }
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  if (Number.isNaN(parsed.getTime())) {
    return yearMonth;
  }
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
};

export interface DateMarkerContext {
  dateOfBirth: string;
  currentAge: number;
}

type MarkerLookup = Map<string, DateMarker>;

const getMarker = (markerId: unknown, lookup: MarkerLookup): DateMarker | null => {
  if (typeof markerId !== 'string' || markerId.length === 0) {
    return null;
  }

  return lookup.get(markerId) ?? null;
};

const clearRef = <T>(record: T, markerIdKey: string): T =>
  ({ ...(record as Record<string, unknown>), [markerIdKey]: null }) as T;

const resolveYearMonthRef = <T>(record: T, markerIdKey: string, yearMonthKey: string, lookup: MarkerLookup): T => {
  const raw = record as Record<string, unknown>;
  const markerId = raw[markerIdKey];
  if (typeof markerId !== 'string' || markerId.length === 0) {
    return record;
  }

  const marker = getMarker(markerId, lookup);
  if (!marker) {
    return clearRef(record, markerIdKey);
  }

  const yearMonth = yearMonthFromMarkerDate(marker.date);
  return {
    ...raw,
    [markerIdKey]: marker.id,
    [yearMonthKey]: yearMonth || raw[yearMonthKey]
  } as T;
};

const resolveDateRef = <T>(record: T, markerIdKey: string, dateKey: string, lookup: MarkerLookup): T => {
  const raw = record as Record<string, unknown>;
  const markerId = raw[markerIdKey];
  if (typeof markerId !== 'string' || markerId.length === 0) {
    return record;
  }

  const marker = getMarker(markerId, lookup);
  if (!marker) {
    return clearRef(record, markerIdKey);
  }

  return {
    ...raw,
    [markerIdKey]: marker.id,
    [dateKey]: marker.date
  } as T;
};

const hasRef = (record: Record<string, unknown>, key: string) => typeof record[key] === 'string' && (record[key] as string).length > 0;

export const resolveDateMarkers = (
  scenario: Scenario,
  context: DateMarkerContext = {
    dateOfBirth: scenario.options?.dateOfBirth ?? '',
    currentAge: scenario.profile?.currentAge ?? 0
  }
): Scenario => {
  const markers = Array.isArray(scenario.dateMarkers) ? scenario.dateMarkers : [];
  const lookup: MarkerLookup = new Map(markers.map((marker) => [marker.id, marker]));

  const resolveAgeCoupled = <T extends { startAge: number; endAge: number; startYearMonth?: string; endYearMonth?: string }>(
    record: T,
    startMonthKey: string,
    endMonthKey: string
  ): T => {
    const raw = record as unknown as Record<string, unknown>;
    if (!hasRef(raw, 'startMarkerId') && !hasRef(raw, 'endMarkerId')) {
      return record;
    }

    let next = resolveYearMonthRef(record, 'startMarkerId', startMonthKey, lookup);
    next = resolveYearMonthRef(next, 'endMarkerId', endMonthKey, lookup);
    const nextRaw = next as unknown as Record<string, unknown>;

    if (hasRef(raw, 'startMarkerId')) {
      const age = ageFromYearMonth((nextRaw[startMonthKey] as string) ?? '', context.dateOfBirth, context.currentAge, 18, 110);
      if (age !== null) {
        next = { ...next, startAge: age, endAge: Math.max(next.endAge, age) };
      }
    }

    if (hasRef(raw, 'endMarkerId')) {
      const age = ageFromYearMonth((nextRaw[endMonthKey] as string) ?? '', context.dateOfBirth, context.currentAge, 18, 110);
      if (age !== null) {
        next = { ...next, endAge: Math.max(next.startAge, age) };
      }
    }

    return next;
  };

  const resolvePurchase = <T>(purchase: T) => resolveYearMonthRef(purchase, 'yearMonthMarkerId', 'yearMonth', lookup);
  const resolveLongTerm = <T>(purchase: T) => {
    let next = resolveYearMonthRef(purchase, 'startMarkerId', 'startYearMonth', lookup);
    next = resolveYearMonthRef(next, 'endMarkerId', 'endYearMonth', lookup);
    return next;
  };
  const resolveCareerEntry = <T extends { startAge: number; endAge: number; startYearMonth?: string; endYearMonth?: string }>(entry: T): T => {
    const resolved = resolveAgeCoupled(entry, 'startYearMonth', 'endYearMonth');
    const plans = (resolved as unknown as { payPlans?: unknown }).payPlans;
    if (!Array.isArray(plans) || plans.length === 0) {
      return resolved;
    }

    return {
      ...resolved,
      payPlans: plans.map((plan) => resolveYearMonthRef(plan, 'effectiveMarkerId', 'effectiveYearMonth', lookup))
    } as T;
  };
  const resolveLoan = <T>(loan: T) => resolveYearMonthRef(loan, 'startMarkerId', 'startYearMonth', lookup);
  const resolveCreditCard = <T>(card: T) => {
    let next = resolveYearMonthRef(card, 'introEndMarkerId', 'introEndYearMonth', lookup);
    next = resolveYearMonthRef(next, 'autopayEndMarkerId', 'autopayEndYearMonth', lookup);
    return next;
  };
  const resolveHousing = (entry: Scenario['housing'][number]) => {
    let next = resolveYearMonthRef(entry, 'startMarkerId', 'startYearMonth', lookup);
    next = resolveYearMonthRef(next, 'sellMarkerId', 'sellYearMonth', lookup);
    next = resolveYearMonthRef(next, 'endMarkerId', 'endYearMonth', lookup);
    return next;
  };
  const resolveExpense = (entry: Scenario['expenses']['entries'][number]) => {
    let next = resolveDateRef(entry, 'startMarkerId', 'startDate', lookup);
    next = resolveDateRef(next, 'endMarkerId', 'endDate', lookup);
    return next;
  };
  const resolveRecurring = (event: Scenario['expenses']['recurringEvents'][number]) => {
    let next = resolveDateRef(event, 'startMarkerId', 'startDate', lookup);
    next = resolveDateRef(next, 'endMarkerId', 'endDate', lookup);
    return next;
  };

  return {
    ...scenario,
    careerPlan: {
      ...scenario.careerPlan,
      entries: scenario.careerPlan.entries.map(resolveCareerEntry)
    },
    largePurchases: scenario.largePurchases.map(resolvePurchase),
    longTermPurchases: scenario.longTermPurchases.map(resolveLongTerm),
    loans: scenario.loans.map(resolveLoan),
    creditCards: scenario.creditCards.map(resolveCreditCard),
    housing: scenario.housing.map(resolveHousing),
    cashflowItems: scenario.cashflowItems.map((item) => resolveAgeCoupled(item, 'startYearMonth', 'endYearMonth')),
    lifeEvents: scenario.lifeEvents.map((event) => resolveAgeCoupled(event, 'startYearMonth', 'endYearMonth')),
    timelines: (scenario.timelines ?? []).map((timeline) => ({
      ...timeline,
      purchases: timeline.purchases.map(resolvePurchase),
      longTermPurchases: timeline.longTermPurchases.map(resolveLongTerm),
      loans: timeline.loans.map(resolveLoan),
      creditCards: timeline.creditCards.map(resolveCreditCard),
      housing: timeline.housing.map(resolveHousing),
      careerPlan: {
        ...timeline.careerPlan,
        entries: timeline.careerPlan.entries.map(resolveCareerEntry)
      }
    })),
    expenses: {
      ...scenario.expenses,
      entries: scenario.expenses.entries.map(resolveExpense),
      recurringEvents: scenario.expenses.recurringEvents.map(resolveRecurring)
    }
  };
};
