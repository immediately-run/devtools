// G-TOOL-6 at the hook: a write to a covered path marks the run stale (after the
// debounce), a write elsewhere does not, `refreshDiff` runs on any write, and a new
// run is fresh by definition.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type StalenessPorts, changedSinceRun, useStaleness } from './useStaleness';

function fakeWatch() {
  const listeners = new Set<(paths: string[]) => void>();
  const refreshDiff = vi.fn(async () => {});
  const ports: StalenessPorts = {
    watch: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    refreshDiff,
  };
  return { ports, refreshDiff, write: (paths: string[]) => listeners.forEach((l) => l(paths)), listeners };
}

describe('useStaleness', () => {
  it('marks the run stale when a COVERED path is written, after the debounce', () => {
    vi.useFakeTimers();
    const w = fakeWatch();
    const covered = ['src/a.ts', 'src/b.ts'];
    const { result } = renderHook(() => useStaleness(covered, w.ports, 100));
    expect(result.current).toEqual([]);
    act(() => w.write(['/src/b.ts']));
    expect(result.current).toEqual([]); // not yet — debounced
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toEqual(['src/b.ts']);
    expect(w.refreshDiff).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a write OUTSIDE the covered set does not stale the run, but still refreshes the diff', () => {
    vi.useFakeTimers();
    const w = fakeWatch();
    const covered = ['src/a.ts'];
    const { result } = renderHook(() => useStaleness(covered, w.ports, 100));
    act(() => w.write(['src/other.ts']));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toEqual([]);
    expect(w.refreshDiff).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('coalesces a burst into one flush and dedupes the hits', () => {
    vi.useFakeTimers();
    const w = fakeWatch();
    // Hoisted: the hook keys its hits by the covered array's IDENTITY (a new run is a
    // new array), so an inline literal would read as a new run on every render.
    const covered = ['src/a.ts', 'src/b.ts'];
    const { result } = renderHook(() => useStaleness(covered, w.ports, 100));
    act(() => {
      w.write(['src/a.ts']);
      vi.advanceTimersByTime(50);
      w.write(['src/a.ts', 'src/b.ts']);
      vi.advanceTimersByTime(99);
    });
    expect(result.current).toEqual([]);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toEqual(['src/a.ts', 'src/b.ts']);
    expect(w.refreshDiff).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a new run (new covered identity) is fresh; the old hits do not carry over', () => {
    vi.useFakeTimers();
    const w = fakeWatch();
    let covered = ['src/a.ts'];
    const { result, rerender } = renderHook(() => useStaleness(covered, w.ports, 100));
    act(() => w.write(['src/a.ts']));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toEqual(['src/a.ts']);
    covered = ['src/a.ts'];
    rerender();
    expect(result.current).toEqual([]);
    vi.useRealTimers();
  });

  it('unsubscribes on unmount and never fires without a run or ports', () => {
    const w = fakeWatch();
    const covered = ['src/a.ts'];
    const { unmount } = renderHook(() => useStaleness(covered, w.ports));
    expect(w.listeners.size).toBe(1);
    unmount();
    expect(w.listeners.size).toBe(0);
    const none = renderHook(() => useStaleness(null, w.ports));
    expect(none.result.current).toEqual([]);
    expect(w.listeners.size).toBe(0);
  });
});

// R3-442 — the leg that survives a remount. On desktop both Tools frames are unmounted
// while the user edits, so no watcher exists at the moment of the write; the run is
// re-validated against the host's changed set instead of observed.
describe('changedSinceRun', () => {
  const covered = ['src/a.ts', 'src/b.ts'];

  it('marks a covered file that BECAME changed since the run', () => {
    expect(changedSinceRun(covered, [], ['/src/b.ts'])).toEqual(['src/b.ts']);
  });

  it('ignores a file that was ALREADY changed when the run happened', () => {
    // The run checked it in that state; nothing says it moved since.
    expect(changedSinceRun(covered, ['src/b.ts'], ['src/b.ts'])).toEqual([]);
  });

  it('ignores a change outside the run scope', () => {
    expect(changedSinceRun(covered, [], ['src/elsewhere.ts'])).toEqual([]);
  });

  it('normalizes both snapshots, so the leading slash never decides the answer', () => {
    expect(changedSinceRun(['/src/a.ts'], ['/src/a.ts'], ['src/a.ts'])).toEqual([]);
    expect(changedSinceRun(['src/a.ts'], undefined, ['/src/a.ts'])).toEqual(['src/a.ts']);
  });

  it('is empty with no run, no changes, or an older sibling that sent no baseline', () => {
    expect(changedSinceRun(null, [], ['src/a.ts'])).toEqual([]);
    expect(changedSinceRun(covered, [], [])).toEqual([]);
    expect(changedSinceRun(covered, undefined, undefined)).toEqual([]);
  });
});
