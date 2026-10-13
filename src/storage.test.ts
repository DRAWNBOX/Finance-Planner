import { beforeEach, describe, expect, it } from 'vitest';
import { defaultScenario } from './defaultScenario';
import { loadAppState, saveAppState } from './storage';

describe('removed standalone contributions', () => {
  beforeEach(() => window.localStorage.clear());

  it('discards obsolete contribution configuration while retaining career allocations and other income', () => {
    const original = structuredClone(defaultScenario);
    original.cashflowItems = [{ id: 'other-income', category: 'pension_1', label: 'Other income', enabled: true, cadence: 'recurring', direction: 'inflow', amount: 1200, startAge: 65, endAge: 90, accountId: 'investments-account-default' }];
    const savedScenario = { ...original, contribution: { yearlyContribution: 17500, yearlyIncreaseRate: 2.9 } };

    for (const stored of [{ scenario: savedScenario }, savedScenario]) {
      window.localStorage.setItem('finance-planner-state', JSON.stringify(stored));
      const state = loadAppState();
      expect(state.scenario).not.toHaveProperty('contribution');
      expect(state.scenario.careerPlan.entries[0].sourceLines).toEqual(expect.arrayContaining(original.careerPlan.entries[0].sourceLines!.map((line) => expect.objectContaining(line))));
      expect(state.scenario.cashflowItems).toEqual(expect.arrayContaining([expect.objectContaining(original.cashflowItems[0])]));
      saveAppState(state);
      expect(JSON.parse(window.localStorage.getItem('finance-planner-state')!).scenario).not.toHaveProperty('contribution');
    }
  });

  it('prunes the obsolete field from direct saves without mutating the supplied state', () => {
    const state = structuredClone(loadAppState());
    Object.assign(state.scenario, { contribution: { yearlyContribution: 5000, yearlyIncreaseRate: 1 } });
    saveAppState(state);

    expect(state.scenario).toHaveProperty('contribution');
    expect(JSON.parse(window.localStorage.getItem('finance-planner-state')!).scenario).not.toHaveProperty('contribution');
  });

  it('does not restore the removed defaults on first launch', () => {
    expect(defaultScenario).not.toHaveProperty('contribution');
    expect(loadAppState().scenario).not.toHaveProperty('contribution');
  });
});
