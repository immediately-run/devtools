// One run: resolve the scope, call both services, normalize, and say honestly what
// was and was not checked (TOOLS_ACTIVITY_SPEC §7.2 — "a truncated run MUST say so
// and name the count it dropped, and is `partial`"; §3.2 — a run carrying any relative
// coverage note is `partial`).
//
// `partial` is a LIST of reasons, not a flag: the banner names each one, and the
// clean-bill-of-health render is gated on the list being empty. Every way a run can
// fall short of "I checked these files and this is everything" is a reason here:
//
//   scope-truncated    the app itself dropped files to stay under the service bound
//   tsc-truncated      the service dropped diagnostics (R3-384 `truncated`/`total`, or
//                      the legacy exact-200 cap with no fields at all)
//   eslint-truncated   same, for lint
//   eslint-skipped     lint did not reach / could not parse a file
//   relative-coverage  a relative import was not in the request — the file it was
//                      imported from was checked with that import as `any`
//   service-error      one service failed outright (timeout, refused, …); the other's
//                      results still show, dimmed by the banner
//
// Pure over ports (the SDK adapters live in `host.ts`), so the whole pipeline runs in
// a unit test with an in-memory tree and canned service replies.

import {
  type Diagnostic,
  type LintResult,
  type TscResult,
  LEGACY_SERVICE_CAP,
  dedupe,
  fromLint,
  fromTsc,
} from './diagnostics';
import { type ResolvedScope, type ScopeId, type ScopePorts, resolveScope } from './scope';

export type PartialKind =
  | 'scope-truncated'
  | 'tsc-truncated'
  | 'eslint-truncated'
  | 'eslint-skipped'
  | 'relative-coverage'
  | 'service-error';

export interface PartialReason {
  kind: PartialKind;
  /** Human text, already phrased for the banner. */
  detail: string;
  /** The number the reason is about (dropped files/diagnostics, unchecked imports). */
  count?: number;
}

export interface ServiceFailure {
  source: 'tsc' | 'eslint';
  code: string;
  message: string;
}

export interface RunResult {
  scope: ScopeId;
  fellBackFrom?: ScopeId;
  startedAt: number;
  durationMs: number;
  /** What was submitted. */
  files: { count: number; units: number };
  /** Repo-relative paths the run covered — what staleness (§7.3) watches. */
  coveredPaths: string[];
  /** tsc + eslint rows, deduped. `build` rows are live and merged at render time. */
  diagnostics: Diagnostic[];
  /** Empty = complete. Non-empty = `partial`, and never a clean bill of health. */
  partial: PartialReason[];
  failures: ServiceFailure[];
  /** Diagnostic count the tsc service reported when it is known to have capped —
   *  `null` when the cap is the LEGACY one and the true count is unknown. */
  tscTotal: number | null;
}

export interface RunPorts extends ScopePorts {
  /** The gated catalog `invoke` (the SDK's), or a double. */
  invoke<T>(name: string, params: Record<string, unknown>): Promise<T>;
  now?: () => number;
}

const errCode = (e: unknown): { code: string; message: string } => {
  const err = e as { code?: unknown; message?: unknown };
  return {
    code: typeof err?.code === 'string' ? err.code : 'unknown',
    message: typeof err?.message === 'string' ? err.message : String(e),
  };
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Resolve the scope, then run both services over it. */
export async function runTools(
  requested: ScopeId,
  ports: RunPorts,
  bounds?: { maxFiles?: number; maxUnits?: number },
): Promise<RunResult> {
  const now = ports.now ?? (() => Date.now());
  const startedAt = now();
  const resolved: ResolvedScope = await resolveScope(requested, ports, bounds);
  const { files } = resolved;
  const partial: PartialReason[] = [];
  const failures: ServiceFailure[] = [];

  if (resolved.truncated) {
    partial.push({
      kind: 'scope-truncated',
      count: resolved.truncated.dropped,
      detail:
        resolved.truncated.bound === 'files'
          ? `${plural(resolved.truncated.dropped, 'file')} not submitted — the service takes 200 per run`
          : `${plural(resolved.truncated.dropped, 'file')} not submitted — the service takes 1 MB per run`,
    });
  }

  const contentOf = (path: string): string | undefined => files.find((f) => f.path === path)?.content;
  const request = { files: files.map((f) => ({ path: f.path, content: f.content })) };
  let tscTotal: number | null = null;
  const diagnostics: Diagnostic[] = [];

  if (files.length > 0) {
    const [tsc, lint] = await Promise.allSettled([
      ports.invoke<TscResult>('authoring:typecheck', request),
      ports.invoke<LintResult>('authoring:lint', request),
    ]);

    if (tsc.status === 'fulfilled') {
      const r = tsc.value;
      const rows = Array.isArray(r?.diagnostics) ? r.diagnostics : [];
      rows.forEach((d, i) => diagnostics.push(fromTsc(d, contentOf, i)));
      // R3-384 fields when present; the legacy silent cap when not.
      if (r.truncated === true && typeof r.total === 'number') {
        tscTotal = r.total;
        const dropped = r.total - rows.length;
        partial.push({ kind: 'tsc-truncated', count: dropped, detail: `typecheck dropped ${plural(dropped, 'diagnostic')} (service cap)` });
      } else if (r.truncated === undefined && rows.length === LEGACY_SERVICE_CAP) {
        partial.push({ kind: 'tsc-truncated', detail: `typecheck returned ${LEGACY_SERVICE_CAP} (service cap) — the true count is unknown` });
      }
      const unchecked = diagnostics.filter((d) => d.source === 'tsc' && d.note === 'relative').length;
      if (unchecked > 0) {
        partial.push({
          kind: 'relative-coverage',
          count: unchecked,
          detail: `${plural(unchecked, 'import was', 'imports were')} not checked — the files importing them may hide errors`,
        });
      }
    } else {
      const { code, message } = errCode(tsc.reason);
      failures.push({ source: 'tsc', code, message });
      partial.push({ kind: 'service-error', detail: `typecheck did not run (${code})` });
    }

    if (lint.status === 'fulfilled') {
      const r = lint.value;
      const rows = Array.isArray(r?.diagnostics) ? r.diagnostics : [];
      rows.forEach((d, i) => diagnostics.push(fromLint(d, i)));
      const skipped = Array.isArray(r.skipped) ? r.skipped : [];
      if (typeof r.total === 'number' && r.total > rows.length) {
        const dropped = r.total - rows.length;
        partial.push({ kind: 'eslint-truncated', count: dropped, detail: `lint dropped ${plural(dropped, 'diagnostic')} (service cap)` });
      } else if (r.truncated === undefined && rows.length === LEGACY_SERVICE_CAP) {
        partial.push({ kind: 'eslint-truncated', detail: `lint returned ${LEGACY_SERVICE_CAP} (service cap) — the true count is unknown` });
      }
      if (skipped.length > 0) {
        const parse = skipped.filter((s) => s.reason === 'parse-error').length;
        const unreached = skipped.length - parse;
        const bits = [
          unreached > 0 ? `${plural(unreached, 'file')} not reached by lint` : '',
          parse > 0 ? `${plural(parse, 'file')} lint could not parse` : '',
        ].filter(Boolean);
        partial.push({ kind: 'eslint-skipped', count: skipped.length, detail: bits.join('; ') });
      }
    } else {
      const { code, message } = errCode(lint.reason);
      failures.push({ source: 'eslint', code, message });
      partial.push({ kind: 'service-error', detail: `lint did not run (${code})` });
    }
  }

  return {
    scope: resolved.scope,
    ...(resolved.fellBackFrom !== undefined ? { fellBackFrom: resolved.fellBackFrom } : {}),
    startedAt,
    durationMs: Math.max(0, now() - startedAt),
    files: { count: files.length, units: files.reduce((n, f) => n + f.content.length, 0) },
    coveredPaths: files.map((f) => f.path),
    diagnostics: dedupe(diagnostics),
    partial,
    failures,
    tscTotal,
  };
}

/** The one rule the whole surface hangs on: a run is a clean bill of health ONLY when it
 *  found nothing AND nothing was left unchecked (G-TOOL-5 / G-TOOL-5b). */
export const isCleanBill = (r: RunResult, liveBuildErrors: number): boolean =>
  r.partial.length === 0 && r.failures.length === 0 && liveBuildErrors === 0 && !r.diagnostics.some((d) => d.severity !== 'note');
