// Two halves over an in-memory bus: a late mount catches up (hello → run + select),
// runs converge on the newest, selections cross, and a stranger on the bus is ignored.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type SiblingPorts, type SiblingState, useSiblingSync } from './useSiblingSync';
import { PANEL_REGION, RUNNER_REGION } from '../lib/sync';
import type { RunResult } from '../lib/run';

const result = (startedAt: number): RunResult => ({
  scope: 'changed',
  startedAt,
  durationMs: 1,
  files: { count: 1, units: 10 },
  coveredPaths: ['src/a.ts'],
  diagnostics: [{ id: `d${startedAt}`, source: 'tsc', severity: 'error', path: 'src/a.ts', line: 1, column: 1, message: 'm' }],
  partial: [],
  failures: [],
  tscTotal: null,
});

/** An in-memory bus with the host's rule: delivery only to a MOUNTED region, with
 *  `from` attached by the bus, never by the sender. */
function bus() {
  const mounted = new Map<string, (m: { from: string; data: unknown }) => void>();
  const ports = (self: string): SiblingPorts => {
    const sibling = self === PANEL_REGION ? RUNNER_REGION : PANEL_REGION;
    return {
      self,
      post: async (data) => {
        const target = mounted.get(sibling);
        if (!target) throw Object.assign(new Error('target-absent'), { code: 'forbidden' });
        target({ from: self, data });
      },
      onMessage: (cb) => {
        mounted.set(self, cb);
        return () => mounted.delete(self);
      },
    };
  };
  return { ports, inject: (to: string, from: string, data: unknown) => mounted.get(to)?.({ from, data }) };
}

function half(ports: SiblingPorts, initial: SiblingState) {
  const onRunResult = vi.fn();
  const onSelect = vi.fn();
  const hook = renderHook((state: SiblingState) => useSiblingSync({ ports, state, onRunResult, onSelect }), { initialProps: initial });
  return { hook, onRunResult, onSelect };
}

describe('useSiblingSync', () => {
  it('a late-mounting half asks and receives the current run and selection', async () => {
    const b = bus();
    const panel = half(b.ports(PANEL_REGION), { result: result(100), stale: ['src/a.ts'], selectedId: 'd100' });
    const runner = half(b.ports(RUNNER_REGION), { result: null, stale: [], selectedId: null });
    await act(async () => {});
    expect(runner.onRunResult).toHaveBeenCalledWith(expect.objectContaining({ startedAt: 100 }), ['src/a.ts']);
    expect(runner.onSelect).toHaveBeenCalledWith('d100');
    // The panel's own hello went to nobody (the runner was not mounted yet) — harmless.
    expect(panel.onRunResult).not.toHaveBeenCalled();
  });

  it('announceRun / announceSelect cross the edge; an older run does not overwrite a newer one', async () => {
    const b = bus();
    const panel = half(b.ports(PANEL_REGION), { result: result(200), stale: [], selectedId: null });
    const runner = half(b.ports(RUNNER_REGION), { result: null, stale: [], selectedId: null });
    await act(async () => {});
    runner.onRunResult.mockClear();
    await act(async () => {
      panel.hook.result.current.announceRun(result(300), []);
      panel.hook.result.current.announceSelect('d300');
    });
    expect(runner.onRunResult).toHaveBeenCalledWith(expect.objectContaining({ startedAt: 300 }), []);
    expect(runner.onSelect).toHaveBeenCalledWith('d300');
    // The runner now holds 300; the panel re-announcing 200 is ignored.
    runner.hook.rerender({ result: result(300), stale: [], selectedId: 'd300' });
    runner.onRunResult.mockClear();
    await act(async () => {
      panel.hook.result.current.announceRun(result(200), []);
    });
    expect(runner.onRunResult).not.toHaveBeenCalled();
  });

  it('a null run-result clears a held run', async () => {
    const b = bus();
    const runner = half(b.ports(RUNNER_REGION), { result: result(1), stale: [], selectedId: null });
    const panel = half(b.ports(PANEL_REGION), { result: null, stale: [], selectedId: null });
    await act(async () => {});
    runner.onRunResult.mockClear();
    await act(async () => {
      panel.hook.result.current.announceRun(null, []);
    });
    expect(runner.onRunResult).toHaveBeenCalledWith(null, []);
  });

  it('ignores messages that are not from the sibling, whatever they say', async () => {
    const b = bus();
    const runner = half(b.ports(RUNNER_REGION), { result: null, stale: [], selectedId: null });
    await act(async () => {
      b.inject(RUNNER_REGION, 'panel.files', { v: 1, kind: 'run-result', result: result(9), stale: [] });
      b.inject(RUNNER_REGION, 'stage.app', { v: 1, kind: 'select', id: 'x' });
    });
    expect(runner.onRunResult).not.toHaveBeenCalled();
    expect(runner.onSelect).not.toHaveBeenCalled();
  });

  it('with no ports (standalone) it is inert', () => {
    const { result: r } = renderHook(() => useSiblingSync({ ports: null, state: { result: null, stale: [], selectedId: null }, onRunResult: vi.fn(), onSelect: vi.fn() }));
    expect(() => r.current.announceSelect('x')).not.toThrow();
  });
});
