// Staleness (TOOLS_ACTIVITY_SPEC §7.3, G-TOOL-6). A run records the paths it covered;
// a write to any of them marks the run stale. A stale result STAYS on screen — it is
// still the best information available — dimmed and banner-labelled, never presented
// as current and never silently discarded.
//
// The recipe, all three legs: `onFsChange` (here the mount-scoped projection,
// `MountFs.onChange`) → debounce → `refreshDiff()` → the next run's `changed` scope
// sees the write (`getVcsState().changes`). Holding one without the others gives a
// stale set or no wake-up. Both channels are inert when there is no contribute
// session; the hook then simply never fires, which is correct.
//
// Pure over an injected `watch`, so the tests drive it with a fake change stream.
import { useEffect, useState } from 'react';
import { normalizePath } from '../lib/diagnostics';

export interface StalenessPorts {
  /** Subscribe to written paths, mount-relative; returns an unsubscribe. */
  watch(cb: (paths: string[]) => void): () => void;
  /** Ask the host to recompute the diff (so `changed` scope is fresh next run). */
  refreshDiff?: () => Promise<void>;
}

export const STALE_DEBOUNCE_MS = 400;

/**
 * The second staleness leg (R3-442): covered files the host reports as changed NOW
 * that were not changed when the run happened. Pure set arithmetic over the two
 * snapshots, so it holds across a remount — unlike the live write stream below, which
 * needs a listener to have existed at the moment of the write. On desktop the Tools
 * frames are UNMOUNTED while the user edits (the editor owns the main pane), so for
 * the ordinary edit→return path this is the only leg that can fire.
 *
 * What it does not catch: a second write to a file that was ALREADY changed before the
 * run — the host's change list carries a path and a status, not a content hash, so the
 * two snapshots are identical. The live stream covers that case whenever a frame is
 * mounted, and a run's own scope re-reads the file regardless.
 */
export function changedSinceRun(
  coveredPaths: readonly string[] | null,
  changedAtRun: readonly string[] | undefined,
  changedNow: readonly string[] | undefined,
): string[] {
  if (!coveredPaths || coveredPaths.length === 0 || !changedNow || changedNow.length === 0) return [];
  const covered = new Set(coveredPaths.map(normalizePath));
  const then = new Set((changedAtRun ?? []).map(normalizePath));
  const hits = new Set<string>();
  for (const raw of changedNow) {
    const p = normalizePath(raw);
    if (covered.has(p) && !then.has(p)) hits.add(p);
  }
  return [...hits].sort();
}

/**
 * The covered paths written since `coveredPaths` was last set (i.e. since the run).
 * Keyed by the `coveredPaths` identity, so a new run is fresh by definition without a
 * reset — the previous run's hits are simply for another key. Returned paths are
 * repo-relative, sorted, deduped.
 */
export function useStaleness(
  coveredPaths: readonly string[] | null,
  ports: StalenessPorts | null,
  debounceMs = STALE_DEBOUNCE_MS,
): string[] {
  const [hits, setHits] = useState<{ key: readonly string[] | null; paths: string[] }>({ key: null, paths: [] });

  useEffect(() => {
    if (!coveredPaths || coveredPaths.length === 0 || !ports) return;
    const covered = new Set(coveredPaths.map(normalizePath));
    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (pending.size === 0) return;
      const written = [...pending].filter((p) => covered.has(p));
      pending.clear();
      // Fresh diff for the NEXT run's changed scope, regardless of whether a covered
      // path was hit — the write happened either way.
      void ports.refreshDiff?.().catch(() => {});
      if (written.length === 0) return;
      setHits((prev) => ({
        key: coveredPaths,
        paths: [...new Set([...(prev.key === coveredPaths ? prev.paths : []), ...written])].sort(),
      }));
    };
    const off = ports.watch((paths) => {
      for (const p of paths) pending.add(normalizePath(p));
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, debounceMs);
    });
    return () => {
      off();
      if (timer !== null) clearTimeout(timer);
    };
  }, [coveredPaths, ports, debounceMs]);

  return hits.key === coveredPaths && coveredPaths !== null ? hits.paths : EMPTY;
}

const EMPTY: string[] = [];
