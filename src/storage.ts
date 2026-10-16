import {
  CURRENT_SCHEMA_VERSION,
  createDefaultUiState,
  decodeAppState,
  encodeAppState,
  hasBlockingSaveDiagnostic,
  type AppUiState,
  type CareersSubTab,
  type DecodeResult,
  type ExpensesSubTab,
  type PersistedAppState,
  type StorageDiagnostic
} from './codec';

export type { AppUiState, CareersSubTab, ExpensesSubTab, PersistedAppState, StorageDiagnostic } from './codec';
export { CURRENT_SCHEMA_VERSION, createDefaultUiState, decodeAppState, encodeAppState } from './codec';

/**
 * Storage boundary (P1.3). All structural work lives in `./codec`; this module
 * only owns the localStorage key, the reference-date boundary, and the save
 * guard that prevents overwriting unreadable/future-version bytes.
 */
const STORAGE_KEY = 'finance-planner-state';

export interface StorageStatus {
  schemaVersion: number;
  blocked: boolean;
  blockedReason: string | null;
  corrupt: boolean;
  diagnostics: StorageDiagnostic[];
}

let lastStatus: StorageStatus = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  blocked: false,
  blockedReason: null,
  corrupt: false,
  diagnostics: []
};

/**
 * `future-version`: automatic saves never write (preserve newer bytes); only an
 * explicit user reset may replace them.
 * `corrupt`: automatic saves are suppressed until an explicit canonical save.
 */
let saveGuard: 'future-version' | 'corrupt' | null = null;

/** Reference date used by the most recent load; reused for canonical saves. */
let lastReferenceDate: Date | null = null;

const readRaw = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

const recordSaveFailure = (): void => {
  lastStatus = {
    ...lastStatus,
    diagnostics: [
      ...lastStatus.diagnostics,
      { code: 'save-failed', severity: 'error', message: 'Could not write the plan to local storage.' }
    ]
  };
};

/**
 * Loads + normalizes the stored app state. The reference date is an explicit
 * boundary input (no wall clock inside the codec); it only affects fresh
 * defaults and missing date fields.
 */
export const loadAppState = (referenceDate: Date = new Date()): PersistedAppState => {
  lastReferenceDate = referenceDate;
  const raw = readRaw();
  const result: DecodeResult = decodeAppState(raw, referenceDate);

  lastStatus = {
    schemaVersion: result.schemaVersion,
    blocked: result.blocked,
    blockedReason: result.blockedReason ?? null,
    corrupt: result.corrupt,
    diagnostics: result.diagnostics
  };

  if (result.blocked) saveGuard = 'future-version';
  else if (result.corrupt) saveGuard = 'corrupt';
  else saveGuard = null;

  return { scenario: result.scenario, ui: result.ui };
};

export interface SaveAppStateOptions {
  /**
   * Explicit canonical save (user-initiated). Only such a save is allowed to
   * replace bytes that previously failed to parse.
   */
  explicitCanonical?: boolean;
  /**
   * Explicit user reset. Only a reset may replace bytes written by a
   * newer-schema version; automatic saves never overwrite them.
   */
  reset?: boolean;
}

export const saveAppState = (state: PersistedAppState, options: SaveAppStateOptions = {}): void => {
  if (typeof window === 'undefined') return;

  const reset = options.reset === true;
  const explicitCanonical = options.explicitCanonical === true || reset;

  // Preserve newer-version bytes unless the user explicitly resets.
  if (saveGuard === 'future-version' && !reset) return;
  // Do not overwrite corrupt bytes on automatic saves.
  if (saveGuard === 'corrupt' && !explicitCanonical) return;

  const { json, diagnostics } = encodeAppState(state, lastReferenceDate ?? undefined);

  // A payload the codec refuses to convert (e.g. an unusable legacy flat
  // paycheckInfo) must not overwrite the stored bytes: surface the diagnostics
  // and abort the write so no user edits are silently lost (D24).
  if (hasBlockingSaveDiagnostic(diagnostics)) {
    lastStatus = {
      ...lastStatus,
      diagnostics: [...lastStatus.diagnostics, ...diagnostics]
    };
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, json);
    if (reset || (saveGuard === 'corrupt' && explicitCanonical)) {
      lastStatus = {
        ...lastStatus,
        blocked: false,
        blockedReason: null,
        corrupt: false,
        diagnostics: [...lastStatus.diagnostics, ...diagnostics]
      };
    }
    saveGuard = null;
  } catch {
    recordSaveFailure();
  }
};

/** Diagnostics/block status for the most recent load or save (for tests + UI). */
export const getStorageStatus = (): StorageStatus => ({
  ...lastStatus,
  diagnostics: [...lastStatus.diagnostics]
});
