import type { HistoricalYear } from '../types';

// Placeholder local series so the historical mode works offline until sourced data is added later.
const EQUITY_CYCLE = [0.19, -0.11, 0.08, 0.14, 0.03, 0.17, -0.09, 0.21, 0.1, 0.06, -0.13, 0.18];
const INFLATION_CYCLE = [0.022, 0.031, 0.014, 0.012, 0.026, 0.039, 0.019, 0.024, 0.028, 0.011, 0.025, 0.016];
const FIXED_ONE_YEAR_CYCLE = [0.031, 0.024, 0.038, 0.034, 0.022, 0.029, 0.017, 0.041, 0.03, 0.026, 0.019, 0.028];
const FIXED_TEN_YEAR_CYCLE = [0.037, 0.029, 0.044, 0.039, 0.024, 0.033, 0.021, 0.048, 0.034, 0.03, 0.022, 0.031];

const START_YEAR = 1871;
const END_YEAR = 2025;

const normalize = (value: number, wobble: number) => Math.max(-0.35, Math.min(0.35, value + wobble));

const buildSeries = (): HistoricalYear[] => {
  const years: HistoricalYear[] = [];

  for (let year = START_YEAR; year <= END_YEAR; year += 1) {
    const offset = year - START_YEAR;
    const cycleIndex = offset % EQUITY_CYCLE.length;
    const wobble = ((offset % 7) - 3) * 0.0025;
    const fixedWobble = ((offset % 5) - 2) * 0.0015;

    years.push({
      year,
      equityReturn: normalize(EQUITY_CYCLE[cycleIndex], wobble),
      inflationRate: Math.max(-0.01, INFLATION_CYCLE[cycleIndex] + wobble / 3),
      fixedIncomeReturn: normalize(FIXED_ONE_YEAR_CYCLE[cycleIndex], fixedWobble)
    });
  }

  return years;
};

export const HISTORICAL_RETURNS: HistoricalYear[] = buildSeries();

export const getHistoricalWindow = (
  totalYears: number,
  fixedIncomeDuration: 'one_year' | 'ten_year'
): HistoricalYear[] => {
  const source = HISTORICAL_RETURNS.map((entry, index) => ({
    ...entry,
    fixedIncomeReturn:
      fixedIncomeDuration === 'ten_year'
        ? normalize(FIXED_TEN_YEAR_CYCLE[index % FIXED_TEN_YEAR_CYCLE.length], ((index % 5) - 2) * 0.0015)
        : entry.fixedIncomeReturn
  }));

  if (totalYears >= source.length) {
    return source;
  }

  return source.slice(source.length - totalYears);
};
