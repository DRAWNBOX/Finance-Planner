import {
  getStorageStatus,
  saveAppState,
  type PersistedAppState,
  type SaveAppStateOptions,
  type StorageStatus
} from './storage';

/**
 * P5.3 / D24 coalesced autosave controller.
 *
 * Coalesces rapid edits into a single write and funnels *every* write through
 * the guarded `saveAppState` boundary (never a bare `localStorage.setItem`), so
 * the future-version/corrupt byte-preservation guard always applies. The App
 * wires the controller later: `schedule(state)` on state change, `flush()` from
 * a `pagehide`/`unload` handler, `dispose()` on unmount. A user-confirmed reset
 * is passed through from the App as `{ reset: true, explicitCanonical: true }`,
 * which is the only path `saveAppState` allows to replace newer-version bytes.
 */

export interface AutosaveController {
  /** Queue the latest state for writing; repeated calls coalesce into one write. */
  schedule(state: PersistedAppState, options?: SaveAppStateOptions): void;
  /** Write any pending state immediately (pagehide/unload). No-op when clean. */
  flush(): void;
  /** Cancel pending writes and stop this controller. Does not write. */
  dispose(): void;
  /** Storage status (blocked/corrupt/diagnostics) for visible save diagnostics. */
  getStatus(): StorageStatus;
  /** True while a deferred write is queued. */
  hasPending(): boolean;
}

export interface AutosaveControllerOptions {
  /** Debounce window before a scheduled write runs. Default 500ms. */
  delayMs?: number;
}

const DEFAULT_DELAY_MS = 500;

export const createAutosaveController = (options: AutosaveControllerOptions = {}): AutosaveController => {
  const delayMs = Number.isFinite(options.delayMs) && (options.delayMs as number) >= 0 ? (options.delayMs as number) : DEFAULT_DELAY_MS;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingState: PersistedAppState | null = null;
  let pendingOptions: SaveAppStateOptions = {};
  let disposed = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const writePending = (): void => {
    if (pendingState === null) return;
    const state = pendingState;
    const writeOptions = pendingOptions;
    pendingState = null;
    pendingOptions = {};
    saveAppState(state, writeOptions);
  };

  const schedule: AutosaveController['schedule'] = (state, writeOptions = {}) => {
    if (disposed) return;
    // Coalesce: keep only the newest state, and only arm one timer.
    pendingState = state;
    pendingOptions = writeOptions;
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      writePending();
    }, delayMs);
  };

  const flush: AutosaveController['flush'] = () => {
    clearTimer();
    writePending();
  };

  const dispose: AutosaveController['dispose'] = () => {
    clearTimer();
    pendingState = null;
    pendingOptions = {};
    disposed = true;
  };

  return {
    schedule,
    flush,
    dispose,
    getStatus: () => getStorageStatus(),
    hasPending: () => pendingState !== null
  };
};
