// The run state machine behind the panel. Manual runs (§7.1) plus ONE automatic run
// when the activity is first opened — the user paid the cold cost by clicking the rail
// entry, and it is what stops the panel being blank. Per-save and per-idle runs stay
// out (§12).
//
// The auto-run waits briefly for the host's vcs push before choosing a scope: the
// channel's initial value is empty, and an empty `changed` scope would fall back to
// the whole project on every first open — an expensive run that also lies about why.
import { useCallback, useEffect, useRef, useState } from 'react';
import { type RunPorts, type RunResult, runTools } from '../lib/run';
import type { ScopeId } from '../lib/scope';

export type RunStatus =
  | { state: 'idle' }
  | { state: 'running'; scope: ScopeId; startedAt: number }
  | { state: 'done'; result: RunResult }
  | { state: 'failed'; error: string };

export interface UseProblemsRunOptions {
  ports: RunPorts | null;
  /** Fires the first automatic run (default true; tests turn it off). */
  autoRun?: boolean;
  /** Resolves when the host has pushed vcs state at least once, or on a deadline. */
  awaitHost?: () => Promise<void>;
  defaultScope?: ScopeId;
}

export function useProblemsRun({ ports, autoRun = true, awaitHost, defaultScope = 'changed' }: UseProblemsRunOptions) {
  const [status, setStatus] = useState<RunStatus>({ state: 'idle' });
  const [last, setLast] = useState<RunResult | null>(null);
  const inflight = useRef(0);
  const autoFired = useRef(false);

  const run = useCallback(
    async (scope: ScopeId = defaultScope): Promise<void> => {
      if (!ports) return;
      const token = ++inflight.current;
      setStatus({ state: 'running', scope, startedAt: Date.now() });
      try {
        const result = await runTools(scope, ports);
        if (token !== inflight.current) return; // a newer run superseded this one
        setLast(result);
        setStatus({ state: 'done', result });
      } catch (e) {
        if (token !== inflight.current) return;
        setStatus({ state: 'failed', error: e instanceof Error ? e.message : String(e) });
      }
    },
    [ports, defaultScope],
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

  return { status, last, run, running: status.state === 'running' };
}
