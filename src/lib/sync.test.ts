// The sibling protocol's validation (R3-391). The host attaches an unspoofable `from`,
// but the PAYLOAD is data from another frame: everything that reaches a file read or
// an allocation is bounded and re-normalized here, and anything not ours is dropped
// silently (a version skew is not an error to show).
import { describe, expect, it } from 'vitest';
import { PANEL_REGION, RUNNER_REGION, accept, siblingOf } from './sync';
import type { RunResult } from './run';

const RESULT: RunResult = {
  scope: 'changed',
  startedAt: 1000,
  durationMs: 250,
  files: { count: 2, units: 90 },
  coveredPaths: ['src/a.ts', '/src/b.ts'],
  changedAtRun: ['src/a.ts'],
  diagnostics: [
    { id: 'tsc:src/a.ts:2:24:0', source: 'tsc', severity: 'error', path: '/src/a.ts', line: 2, column: 24, endLine: 2, endColumn: 26, code: 'TS2345', message: 'nope' },
    { id: 'build:-:-:-:0', source: 'build', severity: 'error', path: null, line: null, column: null, message: 'ReferenceError' },
  ],
  partial: [{ kind: 'relative-coverage', count: 1, detail: '1 import was not checked' }],
  failures: [],
  tscTotal: null,
};

describe('siblingOf', () => {
  it('maps each half to the other and nothing else', () => {
    expect(siblingOf(PANEL_REGION)).toBe(RUNNER_REGION);
    expect(siblingOf(RUNNER_REGION)).toBe(PANEL_REGION);
    expect(siblingOf('panel.files')).toBeNull();
  });
});

describe('accept', () => {
  it('takes hello / select / run-result from the sibling, re-normalizing every path', () => {
    expect(accept({ from: RUNNER_REGION, data: { v: 1, kind: 'hello' } }, PANEL_REGION)).toEqual({ v: 1, kind: 'hello' });
    expect(accept({ from: RUNNER_REGION, data: { v: 1, kind: 'select', id: 'x' } }, PANEL_REGION)).toEqual({ v: 1, kind: 'select', id: 'x' });
    expect(accept({ from: RUNNER_REGION, data: { v: 1, kind: 'select', id: null } }, PANEL_REGION)).toEqual({ v: 1, kind: 'select', id: null });
    const m = accept({ from: PANEL_REGION, data: { v: 1, kind: 'run-result', result: RESULT, stale: ['/src/a.ts'] } }, RUNNER_REGION);
    expect(m?.kind).toBe('run-result');
    if (m?.kind !== 'run-result' || !m.result) throw new Error('unreachable');
    expect(m.stale).toEqual(['src/a.ts']);
    expect(m.result.coveredPaths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(m.result.diagnostics[0]).toMatchObject({ path: 'src/a.ts', endLine: 2, endColumn: 26, code: 'TS2345' });
    expect(m.result.diagnostics[1]).toMatchObject({ path: null, line: null, column: null });
    expect(m.result.partial).toEqual(RESULT.partial);
  });

  it('drops anything not from the sibling — the host attaches `from`, so this is the region check', () => {
    expect(accept({ from: 'panel.files', data: { v: 1, kind: 'hello' } }, PANEL_REGION)).toBeNull();
    expect(accept({ from: PANEL_REGION, data: { v: 1, kind: 'hello' } }, PANEL_REGION)).toBeNull();
    expect(accept({ from: RUNNER_REGION, data: { v: 1, kind: 'hello' } }, 'stage.app')).toBeNull();
  });

  it('drops unknown versions, kinds and shapes silently', () => {
    for (const data of [null, 42, 'hello', { v: 2, kind: 'hello' }, { v: 1, kind: 'reset' }, { v: 1, kind: 'select', id: 7 }, { v: 1, kind: 'run-result', result: 'x', stale: [] }, { v: 1, kind: 'run-result', result: null }]) {
      expect(accept({ from: RUNNER_REGION, data }, PANEL_REGION)).toBeNull();
    }
  });

  it('refuses a run whose diagnostics are malformed — a path that could reach a read must be a string', () => {
    const bad = { ...RESULT, diagnostics: [{ ...RESULT.diagnostics[0], path: { toString: () => '../../etc' } }] };
    expect(accept({ from: PANEL_REGION, data: { v: 1, kind: 'run-result', result: bad, stale: [] } }, RUNNER_REGION)).toBeNull();
    const traversal = { ...RESULT, diagnostics: [{ ...RESULT.diagnostics[0], path: '../../etc/passwd' }] };
    const m = accept({ from: PANEL_REGION, data: { v: 1, kind: 'run-result', result: traversal, stale: [] } }, RUNNER_REGION);
    expect(m?.kind === 'run-result' && m.result?.diagnostics[0].path).toBe('etc/passwd'); // clamped at the root
  });

  it('bounds what a sibling can make the receiver allocate', () => {
    const huge = { ...RESULT, diagnostics: Array.from({ length: 2001 }, () => RESULT.diagnostics[0]) };
    expect(accept({ from: PANEL_REGION, data: { v: 1, kind: 'run-result', result: huge, stale: [] } }, RUNNER_REGION)).toBeNull();
    const longMsg = { ...RESULT, diagnostics: [{ ...RESULT.diagnostics[0], message: 'x'.repeat(4001) }] };
    expect(accept({ from: PANEL_REGION, data: { v: 1, kind: 'run-result', result: longMsg, stale: [] } }, RUNNER_REGION)).toBeNull();
  });

  it('a null run-result clears', () => {
    expect(accept({ from: PANEL_REGION, data: { v: 1, kind: 'run-result', result: null, stale: [] } }, RUNNER_REGION)).toEqual({ v: 1, kind: 'run-result', result: null, stale: [] });
  });
});

describe("R3-442 — the run's changed-set baseline crosses the sibling edge", () => {
  const inbound = (result: unknown) =>
    accept({ from: PANEL_REGION, data: { v: 1, kind: 'run-result', result, stale: [] } }, RUNNER_REGION);
  const baselineOf = (m: ReturnType<typeof inbound>) =>
    m?.kind === 'run-result' ? m.result?.changedAtRun : undefined;

  it('carries and normalizes `changedAtRun`', () => {
    expect(baselineOf(inbound({ ...RESULT, changedAtRun: ['/src/a.ts', 'src/b.ts'] }))).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('tolerates a sibling on an older build that sends no baseline', () => {
    const older: Record<string, unknown> = { ...RESULT };
    delete older.changedAtRun;
    expect(baselineOf(inbound(older))).toEqual([]);
  });

  it('treats a malformed baseline as absent rather than half-applying it', () => {
    expect(baselineOf(inbound({ ...RESULT, changedAtRun: ['ok', 42] }))).toEqual([]);
  });
});
