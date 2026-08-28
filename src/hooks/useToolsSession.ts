// One session model for BOTH halves (R3-391): the last run, the selection, staleness,
// and the sibling sync that keeps the other frame in step. The panel and the runner
// render different views of this one hook; neither owns state the other cannot see.
//
// Ownership of a run: whichever half ran it. The result is broadcast; the receiver
// keeps the newer of the two. The panel does the one automatic first-open run (§7.1);
// the runner never auto-runs — it asks the panel for the current state instead.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RunPorts, RunResult } from '../lib/run';
import { runTools } from '../lib/run';
import type { ScopeId } from '../lib/scope';
import { type StalenessPorts, useStaleness } from './useStaleness';
import { type SiblingPorts, useSiblingSync } from './useSiblingSync';

export type RunStatus =
  | { state: 'idle' }
  | { state: 'running'; scope: ScopeId; startedAt: number }
  | { state: 'done'; result: RunResult }
  | { state: 'failed'; error: string };

export interface ToolsSession {
  status: RunStatus;
  /** The run both halves currently hold (ours or the sibling's, whichever is newer). */
  last: RunResult | null;
  running: boolean;
  run: (scope?: ScopeId) => Promise<void>;
  /** Covered paths written since the run — non-empty means STALE (§7.3). */
  stale: string[];
  selectedId: string | null;
  select: (id: string | null) => void;
  /** `undefined` while the working tree resolves; `null` when there is none. */
  ports: RunPorts | null | undefined;
}

export interface UseToolsSessionOptions {
  ports: RunPorts | null | undefined;
  staleness?: StalenessPorts | null;
  sibling?: SiblingPorts | null;
  /** Fire the one automatic run on mount (the panel does; the runner does not). */
  autoRun?: boolean;
  /** Resolves when the host has pushed vcs state, or on a deadline. */
  awaitHost?: () => Promise<void>;
  defaultScope?: ScopeId;
  /** The staleness debounce (tests shorten it; the default is `STALE_DEBOUNCE_MS`). */
  staleDebounceMs?: number;
}

export function useToolsSession({
  ports,
  staleness = null,
  sibling = null,
  autoRun = false,
  awaitHost,
  defaultScope = 'changed',
  staleDebounceMs,
}: UseToolsSessionOptions): ToolsSession {
  const [status, setStatus] = useState<RunStatus>({ state: 'idle' });
  const [last, setLast] = useState<RunResult | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Stale paths that arrived WITH a sibling's run (their watcher saw the writes before
  // we held the run); merged with what our own watcher sees from here on.
  const [inheritedStale, setInheritedStale] = useState<string[]>([]);
  const inflight = useRef(0);
  const autoFired = useRef(false);

  const covered = useMemo(() => last?.coveredPaths ?? null, [last]);
  const ownStale = useStaleness(covered, staleness, staleDebounceMs);
  const stale = useMemo(() => [...new Set([...inheritedStale, ...ownStale])].sort(), [inheritedStale, ownStale]);

  const state = useMemo(() => ({ result: last, stale, selectedId }), [last, stale, selectedId]);
  const { announceRun, announceSelect } = useSiblingSync({
    ports: sibling,
    state,
    onRunResult: (result, inherited) => {
      setLast(result);
      setInheritedStale(inherited);
      setStatus(result ? { state: 'done', result } : { state: 'idle' });
    },
    onSelect: (id) => setSelectedId(id),
  });

  const run = useCallback(
    async (scope: ScopeId = defaultScope): Promise<void> => {
      if (!ports) return;
      const token = ++inflight.current;
      setStatus({ state: 'running', scope, startedAt: Date.now() });
      try {
        const result = await runTools(scope, ports);
        if (token !== inflight.current) return; // a newer run superseded this one
        setLast(result);
        setInheritedStale([]);
        setStatus({ state: 'done', result });
        announceRun(result, []);
      } catch (e) {
        if (token !== inflight.current) return;
        setStatus({ state: 'failed', error: e instanceof Error ? e.message : String(e) });
      }
    },
    [ports, defaultScope, announceRun],
  );

  const select = useCallback(
    (id: string | null) => {
      setSelectedId(id);
      announceSelect(id);
    },
    [announceSelect],
  );

  useEffect(() => {
    if (!autoRun || !ports || autoFired.current) return;
    autoFired.current = true;
    let cancelled = false;
    (async () => {
      if (awaitHost) await awaitHost();
      if (!cancelled) void run(defaultScope);
    })();
    return () => {
      cancelled = true;
    };
  }, [autoRun, ports, awaitHost, run, defaultScope]);

  return { status, last, running: status.state === 'running', run, stale, selectedId, select, ports };
}
