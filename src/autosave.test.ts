import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAutosaveController } from './autosave';
import { createDefaultScenario } from './defaultScenario';
import {
  CURRENT_SCHEMA_VERSION,
  createDefaultUiState,
  loadAppState,
  type PersistedAppState
} from './storage';

/**
 * P5.3 / D24 autosave-coalescing controller tests.
 *
 * Every write funnels through the guarded `saveAppState` boundary; these tests
 * cover coalescing, immediate pagehide/unload flush, dispose cancellation, the
 * future/corrupt byte-preservation guard applied to flush, an explicit reset
 * pass-through, and visible write-failure diagnostics.
 */

const STORAGE_KEY = 'finance-planner-state';
const REFERENCE_DATE = new Date('2026-01-15');

const storedBytes = (): string | null => window.localStorage.getItem(STORAGE_KEY);
const writeRaw = (raw: string): void => window.localStorage.setItem(STORAGE_KEY, raw);

const stateWithAge = (age: number): PersistedAppState => {
  const scenario = createDefaultScenario(REFERENCE_DATE);
  scenario.profile.currentAge = age;
  return { scenario, ui: createDefaultUiState() };
};

describe('autosave controller (P5.3 / D24)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    loadAppState(REFERENCE_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('coalesces rapid schedule calls into a single write of the newest state', () => {
    vi.useFakeTimers();
    const controller = createAutosaveController({ delayMs: 100 });
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    controller.schedule(stateWithAge(45));
    controller.schedule(stateWithAge(46));
    controller.schedule(stateWithAge(47));

    expect(controller.hasPending()).toBe(true);
    expect(setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storedBytes()!).scenario.profile.currentAge).toBe(47);
    expect(controller.hasPending()).toBe(false);
  });

  it('flush writes pending state immediately and cancels the deferred write', () => {
    vi.useFakeTimers();
    const controller = createAutosaveController({ delayMs: 1000 });

    controller.schedule(stateWithAge(50));
    controller.flush();

    expect(JSON.parse(storedBytes()!).scenario.profile.currentAge).toBe(50);
    const afterFlush = storedBytes();

    vi.advanceTimersByTime(5000);
    expect(storedBytes()).toBe(afterFlush);
  });

  it('dispose cancels a pending write without writing', () => {
    vi.useFakeTimers();
    const controller = createAutosaveController({ delayMs: 100 });

    controller.schedule(stateWithAge(55));
    controller.dispose();
    vi.advanceTimersByTime(500);

    expect(storedBytes()).toBeNull();
    expect(controller.hasPending()).toBe(false);

    // Scheduling after dispose is a no-op.
    controller.schedule(stateWithAge(56));
    controller.flush();
    expect(storedBytes()).toBeNull();
  });

  it('flush preserves future-version and corrupt bytes through the guarded save', () => {
    const controller = createAutosaveController({ delayMs: 10 });

    const future = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      scenario: {},
      ui: createDefaultUiState()
    });
    writeRaw(future);
    loadAppState(REFERENCE_DATE);
    controller.schedule(stateWithAge(60));
    controller.flush();
    expect(storedBytes()).toBe(future);

    const corrupt = '{ this is not json';
    writeRaw(corrupt);
    loadAppState(REFERENCE_DATE);
    controller.schedule(stateWithAge(61));
    controller.flush();
    expect(storedBytes()).toBe(corrupt);
  });

  it('lets an explicit user reset replace newer-version bytes through the same guard', () => {
    const controller = createAutosaveController({ delayMs: 0 });

    const future = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      scenario: {},
      ui: createDefaultUiState()
    });
    writeRaw(future);
    loadAppState(REFERENCE_DATE);

    controller.schedule(stateWithAge(45), { reset: true, explicitCanonical: true });
    controller.flush();

    expect(storedBytes()).not.toBe(future);
    expect(JSON.parse(storedBytes()!).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('surfaces a visible diagnostic when the guarded write fails', () => {
    const controller = createAutosaveController({ delayMs: 0 });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    try {
      controller.schedule(stateWithAge(45));
      controller.flush();
    } finally {
      setItem.mockRestore();
    }

    const status = controller.getStatus();
    expect(status.diagnostics.some((entry) => entry.code === 'save-failed')).toBe(true);
  });
});
