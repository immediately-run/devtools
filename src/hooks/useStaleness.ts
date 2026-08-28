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
