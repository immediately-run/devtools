// Keep the two halves in step over their one IPC edge (R3-391; protocol in
// `lib/sync.ts`). Pure over injected ports so the tests drive both ends with an
// in-memory bus and never touch the SDK.
//
// Semantics, both directions symmetric:
//   - on mount, send `hello`; on receiving `hello`, reply with the current run (if any)
//     and the current selection — a late-mounting half (the runner is unmounted while
//     another activity is active) catches up without re-running anything;
//   - a completed run is broadcast in full; an inbound one REPLACES ours only when it is
//     newer (`startedAt`), so two halves that both ran converge on the latest;
//   - a selection change is broadcast by id; an inbound id that is not in the run we
//     hold is ignored (the runs converge a moment later and the next select lands).
import { useCallback, useEffect, useRef } from 'react';
import { type SyncMessage, accept } from '../lib/sync';
import type { RunResult } from '../lib/run';

export interface SiblingPorts {
  /** This frame's region id (`getRegion()`); `null` standalone. */
  self: string | null;
  /** Post to the sibling; rejects `forbidden` when the edge/target is absent. */
  post(data: SyncMessage): Promise<void>;
  /** Inbound messages (the SDK's `onRegionMessage`); returns an unsubscribe. */
  onMessage(cb: (msg: { from: string; data: unknown }) => void): () => void;
}

export interface SiblingState {
  result: RunResult | null;
  stale: string[];
  selectedId: string | null;
}

export interface UseSiblingSyncOptions {
  ports: SiblingPorts | null;
  /** The current local state, read when a `hello` arrives. */
  state: SiblingState;
  /** Apply an inbound run (already validated and newer than ours). */
  onRunResult: (result: RunResult | null, stale: string[]) => void;
  /** Apply an inbound selection. */
  onSelect: (id: string | null) => void;
}

export function useSiblingSync({ ports, state, onRunResult, onSelect }: UseSiblingSyncOptions) {
  // Latest state/handlers for the subscription to read, updated after commit (never
  // during render — the React compiler rule), so a `hello` answered between renders
  // sees the last committed values.
  const stateRef = useRef(state);
  const handlers = useRef({ onRunResult, onSelect });
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    handlers.current = { onRunResult, onSelect };
  }, [onRunResult, onSelect]);

  const send = useCallback(
    (data: SyncMessage) => {
      // Fire-and-forget: `forbidden` here means the sibling is not mounted, which is
      // the normal state whenever the activity is not the active one.
      if (ports) void ports.post(data).catch(() => {});
    },
    [ports],
  );

  useEffect(() => {
    if (!ports || !ports.self) return;
    const self = ports.self;
    const off = ports.onMessage((raw) => {
      const msg = accept(raw, self);
      if (!msg) return;
      if (msg.kind === 'hello') {
        const s = stateRef.current;
        if (s.result) send({ v: 1, kind: 'run-result', result: s.result, stale: s.stale });
        send({ v: 1, kind: 'select', id: s.selectedId });
        return;
      }
      if (msg.kind === 'run-result') {
        const mine = stateRef.current.result;
        if (msg.result === null) {
          if (mine !== null) handlers.current.onRunResult(null, []);
          return;
        }
        if (mine === null || msg.result.startedAt > mine.startedAt) handlers.current.onRunResult(msg.result, msg.stale);
        return;
      }
      if (msg.kind === 'select') handlers.current.onSelect(msg.id);
    });
    send({ v: 1, kind: 'hello' });
    return off;
  }, [ports, send]);

  return {
    /** Broadcast a completed run. */
    announceRun: useCallback((result: RunResult | null, stale: string[]) => send({ v: 1, kind: 'run-result', result, stale }), [send]),
    /** Broadcast a selection. */
    announceSelect: useCallback((id: string | null) => send({ v: 1, kind: 'select', id }), [send]),
  };
}
