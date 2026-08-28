// The unified diagnostic model (TOOLS_ACTIVITY_SPEC §3). Three producers, one list.
//
// Everything here is PURE: it converts what the three services return into one
// shape, and it carries the three normalization rules the spec's review found —
// each of which is a way the sources are NOT comparable as delivered:
//
//   1. `tsc` positions arrive as `start` + `length`, UTF-16 code-unit OFFSETS into the
//      exact content that was submitted. They are meaningful against that text only,
//      so the converter takes the submitted content, never re-reads the file.
//   2. `endLine`/`endColumn` exist for `tsc` only. `LintDiag` carries no end position
//      and `BuildError` has none, so a caret SPAN is a tsc-only affordance; every other
//      source marks a point.
//   3. `eslint` severities arrive as the STRINGS `error`/`warning` (the numeric 2/1
//      mapping happens in the kernel service). There is no mapping to write here.
//
// Paths are the fourth: `build` paths are whatever the bundler emitted, copied
// verbatim by the host's `mapShowError`, so every source is normalized to ONE form
// (repo-relative, no leading slash) before anything compares them (§3.3).

export type Source = 'tsc' | 'eslint' | 'build';
export type Severity = 'error' | 'warning' | 'note';

/** Why a `note` exists — decides whether it makes the run `partial` (§3.2). */
export type NoteKind =
  /** A relative import the run did NOT check; the import degraded to `any` and real
   *  errors in the submitted file may have vanished with it. Makes the run partial. */
  | 'relative'
  /** A relative import of an asset (`.css`, `.svg`, …) that no typecheck could ever
   *  check. Benign — it degrades to `any` but hides nothing a source file would show. */
  | 'asset'
  /** A package the kernel bundles no types for. A limit of the kernel type set; benign. */
  | 'bundled'
  /** Any other message/suggestion-level tsc output. */
  | 'other';

export interface Diagnostic {
  /** Stable within one list — `source:path:line:column:index`. */
  id: string;
  source: Source;
  severity: Severity;
  /** Repo-relative, normalized; `null` when the source gave no usable location (a
   *  `build` runtime error) — such rows live in the "not file-located" group. */
  path: string | null;
  /** 1-indexed; `null` together with `path`. */
  line: number | null;
  column: number | null;
  /** tsc only: the EXCLUSIVE end of the reported span, 1-indexed. */
  endLine?: number;
  endColumn?: number;
  /** `TS2345`, `prefer-const`, … — `undefined` when the source has no code. */
  code?: string;
  message: string;
  note?: NoteKind;
}

// ── what the services actually return (mirrors the kernel types, not re-exported) ──

/** `authoring:typecheck` — sandbox `services/authoring/typecheck.ts` `Diag`. */
export interface TscDiag {
  path: string;
  start: number;
  length: number;
  category: 'error' | 'warning' | 'suggestion' | 'message';
  code: number;
  messageText: string;
}
/** `TypecheckResult`. `truncated`/`total` arrived with R3-384; an older host omits them. */
export interface TscResult {
  diagnostics: TscDiag[];
  truncated?: boolean;
  total?: number;
}
/** `authoring:lint` — `LintDiag`. */
export interface LintDiag {
  path: string;
  line: number;
  column: number;
  ruleId: string | null;
  severity: 'error' | 'warning';
  messageText: string;
}
export interface LintSkip {
  path: string;
  reason: 'parse-error' | 'not-reached';
}
export interface LintResult {
  diagnostics: LintDiag[];
  truncated?: boolean;
  total?: number;
  skipped?: LintSkip[];
}
/** `diagnostics:read` — the SDK's `BuildError`. Every position is optional. */
export interface BuildErrorLike {
  message: string;
  path?: string;
  line?: number;
  column?: number;
}

/** The service's silent cap before R3-384 shipped `truncated`/`total`. A result of
 *  EXACTLY this many diagnostics with neither field is reported as "200 (service cap)"
 *  rather than as a clean count — the count is unknown, and unknown is not 200. */
export const LEGACY_SERVICE_CAP = 200;

// ── paths ─────────────────────────────────────────────────────────────────────

/** One path form for every source: repo-relative, `/`-separated, no leading slash, no
 *  `.` segments, `..` clamped at the root. `/app/…` (the working-tree mount's absolute
 *  form) is treated as the repo root. */
export function normalizePath(p: string): string {
  let s = p.replace(/\\/g, '/');
  if (s.startsWith('/app/')) s = s.slice('/app/'.length);
  else if (s === '/app') s = '';
  const out: string[] = [];
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

export const dirnameOf = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export const basenameOf = (p: string): string => (p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p);

// ── tsc ───────────────────────────────────────────────────────────────────────

/** Line/column (1-indexed) of a UTF-16 offset in `content`. The offset past the end
 *  clamps to the end of the text — a diagnostic can outlive an edit. */
export function positionAt(content: string, offset: number): { line: number; column: number } {
  const at = Math.max(0, Math.min(offset, content.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < at; i++) {
    if (content.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: at - lineStart + 1 };
}

const RELATIVE_NOTE = /was not included in this typecheck request/;
const BUNDLED_NOTE = /No bundled type declarations for/;
/** The specifier the note quotes: `'./lib' was not included …` / `… for 'zod', …`. */
const QUOTED_SPEC = /'([^']+)'/;
const ASSET_EXT = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp[34]|webm|wav|ogg|json|md|mdx|txt|html|wasm)$/i;

/** Classify a message-level tsc diagnostic (§3.2). The text is the kernel's
 *  (`coverageNote` in the typecheck service); only its two fixed phrasings are
 *  recognized, anything else is `other`. */
export function classifyNote(messageText: string): NoteKind {
  if (RELATIVE_NOTE.test(messageText)) {
    const spec = QUOTED_SPEC.exec(messageText)?.[1] ?? '';
    return ASSET_EXT.test(spec) ? 'asset' : 'relative';
  }
  if (BUNDLED_NOTE.test(messageText)) return 'bundled';
  return 'other';
}

/**
 * Convert one tsc diagnostic against the content it was computed over. `contentOf`
 * returns the SUBMITTED text for a path; when the run did not submit that path (a
 * diagnostic about a lib file), the position cannot be derived and the row is kept
 * with `line`/`column` at 1 — better a row at the top of the file than a lost error.
 */
export function fromTsc(d: TscDiag, contentOf: (path: string) => string | undefined, index = 0): Diagnostic {
  const path = normalizePath(d.path);
  const content = contentOf(path);
  const severity: Severity = d.category === 'error' ? 'error' : d.category === 'warning' ? 'warning' : 'note';
  const base = {
    id: '',
    source: 'tsc' as const,
    severity,
    path,
    code: `TS${d.code}`,
    message: d.messageText,
    ...(severity === 'note' ? { note: classifyNote(d.messageText) } : {}),
  };
  if (content === undefined) {
    return { ...base, line: 1, column: 1, id: `tsc:${path}:1:1:${index}` };
  }
  const start = positionAt(content, d.start);
  const end = positionAt(content, d.start + d.length);
  return {
    ...base,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    id: `tsc:${path}:${start.line}:${start.column}:${index}`,
  };
}

// ── eslint ────────────────────────────────────────────────────────────────────

/** Severities pass through (rule 3). A `null` ruleId is ESLint's own parse error
 *  ("Parsing error: …"), reported as an ordinary message — it gets the code `parse`. */
export function fromLint(d: LintDiag, index = 0): Diagnostic {
  const path = normalizePath(d.path);
  return {
    id: `eslint:${path}:${d.line}:${d.column}:${index}`,
    source: 'eslint',
    severity: d.severity,
    path,
    line: d.line,
    column: d.column,
    code: d.ruleId ?? 'parse',
    message: d.messageText,
  };
}

// ── build ─────────────────────────────────────────────────────────────────────

/** A build row is located only when it has BOTH a path and a line; a bare column is
 *  meaningless. Everything else is "not file-located" (§3.3). */
export function fromBuild(e: BuildErrorLike, index = 0): Diagnostic {
  const located = typeof e.path === 'string' && e.path.length > 0 && typeof e.line === 'number' && e.line >= 1;
  const path = located ? normalizePath(e.path as string) : null;
  const line = located ? (e.line as number) : null;
  const column = located ? (typeof e.column === 'number' && e.column >= 1 ? e.column : 1) : null;
  return {
    id: `build:${path ?? '-'}:${line ?? '-'}:${column ?? '-'}:${index}`,
    source: 'build',
    severity: 'error',
    path,
    line,
    column,
    message: e.message,
  };
}

// ── merge ─────────────────────────────────────────────────────────────────────

const SOURCE_RANK: Record<Source, number> = { build: 0, tsc: 1, eslint: 2 };

/**
 * Dedup on `(path, line, column)` + byte-equal message, keeping `build` before `tsc`
 * before `eslint` (§3.3). Rows with no location are never deduped — two runtime
 * errors with the same text are two events.
 */
export function dedupe(diags: readonly Diagnostic[]): Diagnostic[] {
  const ordered = [...diags].sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
  const seen = new Set<string>();
  const out: Diagnostic[] = [];
  for (const d of ordered) {
    if (d.path === null) {
      out.push(d);
      continue;
    }
    const key = `${d.path} ${d.line} ${d.column} ${d.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/** Counted problems only: notes are NOT problems (§3.2, G-TOOL-7). */
export interface Counts {
  errors: number;
  warnings: number;
  notes: number;
}
export function countBySeverity(diags: readonly Diagnostic[]): Counts {
  const c: Counts = { errors: 0, warnings: 0, notes: 0 };
  for (const d of diags) {
    if (d.severity === 'error') c.errors += 1;
    else if (d.severity === 'warning') c.warnings += 1;
    else c.notes += 1;
  }
  return c;
}

export interface FileGroup {
  /** `null` = the "not file-located" group. */
  path: string | null;
  rows: Diagnostic[];
}

/**
 * The panel's shape (§8.1): grouped by file, groups A→Z by path, DOCUMENT ORDER within
 * a file, the not-file-located group last. Notes are returned separately — they render
 * in one collapsed group of their own and never in a file's group.
 */
export function groupByFile(diags: readonly Diagnostic[]): { groups: FileGroup[]; notes: Diagnostic[] } {
  const notes: Diagnostic[] = [];
  const byPath = new Map<string | null, Diagnostic[]>();
  for (const d of diags) {
    if (d.severity === 'note') {
      notes.push(d);
      continue;
    }
    const list = byPath.get(d.path) ?? [];
    list.push(d);
    byPath.set(d.path, list);
  }
  const paths = [...byPath.keys()].filter((p): p is string => p !== null).sort((a, b) => a.localeCompare(b));
  const groups: FileGroup[] = paths.map((path) => ({
    path,
    rows: (byPath.get(path) ?? []).slice().sort((a, b) => a.line! - b.line! || a.column! - b.column!),
  }));
  const unlocated = byPath.get(null);
  if (unlocated && unlocated.length > 0) groups.push({ path: null, rows: unlocated });
  return { groups, notes };
}

/** Substring filter over path, message and code (§8.1), case-insensitive. */
export function matchesFilter(d: Diagnostic, needle: string): boolean {
  const q = needle.trim().toLowerCase();
  if (!q) return true;
  return (
    (d.path ?? '').toLowerCase().includes(q) ||
    d.message.toLowerCase().includes(q) ||
    (d.code ?? '').toLowerCase().includes(q)
  );
}

/** `12:24` — tabular figures are the renderer's job; this is the text. */
export const locationLabel = (d: Diagnostic): string => (d.line === null ? '' : `${d.line}:${d.column ?? 1}`);
