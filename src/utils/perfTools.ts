import { useEffect, useMemo, useRef } from 'react';

const isTestEnv = typeof window !== 'undefined' && (window as any).__VITEST__ !== undefined;
const enabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perf') !== null;

const COLOR_CYAN = 'color:#0ea5e9;font-weight:bold';
const COLOR_GREEN = 'color:#22c55e;font-weight:bold';
const COLOR_YELLOW = 'color:#eab308;font-weight:bold';
const COLOR_RED = 'color:#ef4444;font-weight:bold';

const renderCounters = new Map<string, number>();
const timingLogs: Array<{ label: string; duration: number; ts: number }> = [];

export function useRenderCount(componentName: string): void {
  if (!enabled) return;
  const renderCount = useRef(0);
  renderCount.current += 1;
  useEffect(() => {
    if (isTestEnv) return;
    renderCounters.set(componentName, renderCount.current);
    console.log(
      `%c[perf]%c ${componentName} %crendered %c${renderCount.current}%c time(s)`,
      COLOR_CYAN, '', COLOR_GREEN, COLOR_YELLOW, ''
    );
  });
}

export function useTimedMemo<T>(label: string, fn: () => T, deps: ReadonlyArray<unknown>): T {
  if (!enabled) {
    return useMemo(fn, deps);
  }
  const runCount = useRef(0);
  return useMemo(() => {
    runCount.current += 1;
    const start = performance.now();
    const result = fn();
    const duration = performance.now() - start;
    if (isTestEnv) return result;
    timingLogs.push({ label, duration, ts: Date.now() });
    let color = COLOR_GREEN;
    if (duration > 50) color = COLOR_RED;
    else if (duration > 15) color = COLOR_YELLOW;
    console.log(
      `%c[perf]%c ${label} %ctook %c${duration.toFixed(1)}ms%c (run #${runCount.current})`,
      COLOR_CYAN, '', color, color, ''
    );
    return result;
  }, deps);
}

export function getPerfSummary(): string {
  const lines: string[] = ['=== PERFORMANCE SUMMARY ==='];
  if (renderCounters.size > 0) {
    lines.push('\nRender counts:');
    for (const [name, count] of renderCounters) {
      lines.push(`  ${name}: ${count}`);
    }
  }
  if (timingLogs.length > 0) {
    lines.push('\nTiming logs (last 20):');
    const recent = timingLogs.slice(-20);
    for (const entry of recent) {
      lines.push(`  ${entry.label}: ${entry.duration.toFixed(1)}ms`);
    }
  }
  return lines.join('\n');
}

if (typeof window !== 'undefined') {
  (window as any).__perfSummary = getPerfSummary;
}
