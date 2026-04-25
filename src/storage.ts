import { defaultScenario } from './defaultScenario';
import type { Scenario } from './types';

const STORAGE_KEY = 'finance-planner-scenario';

export const loadScenario = (): Scenario => {
  if (typeof window === 'undefined') {
    return defaultScenario;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return defaultScenario;
    }

    const parsed = JSON.parse(raw) as Scenario;

    return {
      ...defaultScenario,
      ...parsed,
      profile: { ...defaultScenario.profile, ...parsed.profile },
      portfolio: { ...defaultScenario.portfolio, ...parsed.portfolio },
      contribution: { ...defaultScenario.contribution, ...parsed.contribution },
      withdrawal: { ...defaultScenario.withdrawal, ...parsed.withdrawal },
      manualReturns: { ...defaultScenario.manualReturns, ...parsed.manualReturns },
      cashflowItems: parsed.cashflowItems ?? []
    };
  } catch {
    return defaultScenario;
  }
};

export const saveScenario = (scenario: Scenario) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scenario));
};
