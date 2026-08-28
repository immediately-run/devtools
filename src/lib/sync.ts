// The sibling protocol between the two halves (TOOLS_ACTIVITY_SPEC §2 / §8.2, R3-391).
//
// `panel.tools` and `mainpane.tools` are two sandboxed frames of one program with NO
// shared memory. The host gives them one §5.6 IPC edge to each other (and to nothing
// else — the explorer reveal stays a consequence, G-TOOL-8a). Over it they keep three
// things in step: the last run, the selected diagnostic, and a hello handshake so a
// half that mounts later (the runner is unmounted while another activity is active)
// gets the current state without re-running anything.
//
// The payload is UNTRUSTED on arrival even though the host attaches an unspoofable
// `from`: `accept()` checks the sender is the sibling and the shape is one of ours, and
// the diagnostics are re-validated field by field — a run result that reaches the code
// frame drives file reads, so a malformed `path` must never get that far.

import { type Diagnostic, type Severity, type Source, normalizePath } from './diagnostics';
import type { PartialKind, PartialReason, RunResult, ServiceFailure } from './run';
import type { ScopeId } from './scope';

export const PANEL_REGION = 'panel.tools';
export const RUNNER_REGION = 'mainpane.tools';

/** The other half, given which one this frame is. */
export const siblingOf = (region: string): string | null =>
  region === PANEL_REGION ? RUNNER_REGION : region === RUNNER_REGION ? PANEL_REGION : null;

export type SyncMessage =
  /** "I just mounted — send me what you have." The reply is a `run-result` (when there
   *  is one) followed by a `select`. */
  | { v: 1; kind: 'hello' }
  /** A completed run, in full. `null` clears (the sender reset). */
  | { v: 1; kind: 'run-result'; result: RunResult | null; stale: string[] }
  /** The selected diagnostic id, or `null` for none. The id is enough: both halves hold
   *  the same run, so the receiver resolves it locally and ignores an unknown id. */
  | { v: 1; kind: 'select'; id: string | null };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isStr = (v: unknown): v is string => typeof v === 'string';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const SOURCES = new Set<string>(['tsc', 'eslint', 'build']);
const SEVERITIES = new Set<string>(['error', 'warning', 'note']);
const NOTES = new Set<string>(['relative', 'asset', 'bundled', 'other']);
const SCOPES = new Set<string>(['changed', 'open', 'project']);
const PARTIAL_KINDS = new Set<string>([
  'scope-truncated',
  'tsc-truncated',
  'eslint-truncated',
  'eslint-skipped',
  'relative-coverage',
  'service-error',
]);
/** Bounds so a hostile sibling cannot make the receiver allocate without limit. */
const MAX_DIAGS = 2000;
const MAX_PATHS = 5000;
const MAX_TEXT = 4000;

function diagnostic(v: unknown): Diagnostic | null {
  if (!isRecord(v)) return null;
  if (!isStr(v.id) || v.id.length > 200) return null;
  if (!isStr(v.source) || !SOURCES.has(v.source)) return null;
  if (!isStr(v.severity) || !SEVERITIES.has(v.severity)) return null;
  if (!isStr(v.message) || v.message.length > MAX_TEXT) return null;
  const located = v.path !== null;
  if (located && (!isStr(v.path) || v.path.length > 1000)) return null;
  if (located ? !isInt(v.line) || (v.line as number) < 1 : v.line !== null) return null;
  if (located ? !isInt(v.column) || (v.column as number) < 1 : v.column !== null) return null;
  const d: Diagnostic = {
    id: v.id,
    source: v.source as Source,
    severity: v.severity as Severity,
    // Re-normalized: the sibling's path is data, and a `..` in it must not reach a read.
    path: located ? normalizePath(v.path as string) : null,
    line: located ? (v.line as number) : null,
    column: located ? (v.column as number) : null,
    message: v.message,
  };
  if (isInt(v.endLine) && v.endLine >= 1) d.endLine = v.endLine;
  if (isInt(v.endColumn) && v.endColumn >= 1) d.endColumn = v.endColumn;
  if (isStr(v.code) && v.code.length <= 200) d.code = v.code;
  if (isStr(v.note) && NOTES.has(v.note)) d.note = v.note as Diagnostic['note'];
  return d;
}

function runResult(v: unknown): RunResult | null {
  if (!isRecord(v)) return null;
  if (!isStr(v.scope) || !SCOPES.has(v.scope)) return null;
  if (!isInt(v.startedAt) || !isInt(v.durationMs)) return null;
  if (!isRecord(v.files) || !isInt(v.files.count) || !isInt(v.files.units)) return null;
  if (!Array.isArray(v.coveredPaths) || v.coveredPaths.length > MAX_PATHS || !v.coveredPaths.every(isStr)) return null;
  if (!Array.isArray(v.diagnostics) || v.diagnostics.length > MAX_DIAGS) return null;
  const diagnostics: Diagnostic[] = [];
  for (const raw of v.diagnostics) {
    const d = diagnostic(raw);
    if (!d) return null;
    diagnostics.push(d);
  }
  if (!Array.isArray(v.partial) || v.partial.length > 50) return null;
  const partial: PartialReason[] = [];
  for (const p of v.partial) {
    if (!isRecord(p) || !isStr(p.kind) || !PARTIAL_KINDS.has(p.kind) || !isStr(p.detail) || p.detail.length > MAX_TEXT) return null;
    partial.push({ kind: p.kind as PartialKind, detail: p.detail, ...(isInt(p.count) ? { count: p.count } : {}) });
  }
  if (!Array.isArray(v.failures) || v.failures.length > 10) return null;
  const failures: ServiceFailure[] = [];
  for (const f of v.failures) {
    if (!isRecord(f) || (f.source !== 'tsc' && f.source !== 'eslint') || !isStr(f.code) || !isStr(f.message)) return null;
    failures.push({ source: f.source, code: f.code.slice(0, 100), message: f.message.slice(0, MAX_TEXT) });
  }
  return {
    scope: v.scope as ScopeId,
    ...(isStr(v.fellBackFrom) && SCOPES.has(v.fellBackFrom) ? { fellBackFrom: v.fellBackFrom as ScopeId } : {}),
    startedAt: v.startedAt,
    durationMs: v.durationMs,
    files: { count: v.files.count, units: v.files.units },
    coveredPaths: (v.coveredPaths as string[]).map(normalizePath),
    diagnostics,
    partial,
    failures,
    tscTotal: isInt(v.tscTotal) ? v.tscTotal : null,
  };
}

/**
 * Validate an inbound region message. Returns the typed message, or `null` for anything
 * that is not from the sibling or not one of ours — silently, because an unknown
 * message from a region we accept is at worst a version skew, never an error to show.
 */
export function accept(msg: { from: string; data: unknown }, self: string): SyncMessage | null {
  if (msg.from !== siblingOf(self)) return null;
  const d = msg.data;
  if (!isRecord(d) || d.v !== 1 || !isStr(d.kind)) return null;
  if (d.kind === 'hello') return { v: 1, kind: 'hello' };
  if (d.kind === 'select') {
    if (d.id === null) return { v: 1, kind: 'select', id: null };
    return isStr(d.id) && d.id.length <= 200 ? { v: 1, kind: 'select', id: d.id } : null;
  }
  if (d.kind === 'run-result') {
    if (!Array.isArray(d.stale) || d.stale.length > MAX_PATHS || !d.stale.every(isStr)) return null;
    const stale = (d.stale as string[]).map(normalizePath);
    if (d.result === null) return { v: 1, kind: 'run-result', result: null, stale };
    const result = runResult(d.result);
    return result ? { v: 1, kind: 'run-result', result, stale } : null;
  }
  return null;
}
