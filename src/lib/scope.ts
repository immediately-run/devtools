// Run scope (TOOLS_ACTIVITY_SPEC §7.2): which files a run submits.
//
// The default is NOT bare changed files. A changed file whose imports are all
// unsubmitted gets a relative coverage note per import, each import degrades to
// `any`, and real errors inside the changed file vanish with them — a run that reports
// "0 problems" having checked almost nothing. So the default walks the changed files'
// LOCAL import closure (relative specifiers, transitively) up to the service bound, and
// reports the truncation when it hits it — the bounds are the service's, restated here
// so the app truncates BEFORE the call rather than learning about it as `service-error`.
//
// Pure over injected ports: the file reads and the two host lists (changed / open)
// come in, `{ files, truncated }` goes out. The real ports are in `host.ts`.

import { dirnameOf, normalizePath } from './diagnostics';

export type ScopeId = 'changed' | 'open' | 'project';

export const SCOPE_LABEL: Record<ScopeId, string> = {
  changed: 'Changed files + imports',
  open: 'Open files',
  project: 'Whole project',
};

/** The service's per-call bounds (§7.2, "the complete list"): files and total content
 *  in UTF-16 code units. The 2 MB serialized-input and 30 s wall-clock bounds are the
 *  host's and are observed as errors, not planned around. */
export const MAX_FILES = 200;
export const MAX_TOTAL_UNITS = 1_000_000;

export interface ScopePorts {
  /** UTF-8 text of a repo-relative path; rejects (any error) when absent. */
  readFile(path: string): Promise<string>;
  /** Every source file under the app root, repo-relative — the `project` scope. */
  listSourceFiles(): Promise<string[]>;
  /** `VcsState.changes` minus deletions, repo-relative. Empty when there is no contribute session. */
  changedPaths(): string[];
  /** `EditorContext.openFiles` (they arrive with a leading slash; normalized here). */
  openPaths(): string[];
}

export interface ScopeFile {
  path: string;
  content: string;
}

export interface ResolvedScope {
  /** What actually ran — may differ from what was asked (see `fellBackFrom`). */
  scope: ScopeId;
  /** Set when the requested scope was EMPTY and a broader one was used instead: changed
   *  → open → project. The panel shows the effective scope, never the requested one. */
  fellBackFrom?: ScopeId;
  files: ScopeFile[];
  /** Files known to belong to the scope but not submitted, because a bound was hit.
   *  `null` = complete. A non-null value makes the run `partial` (§7.2). */
  truncated: {
    dropped: number;
    bound: 'files' | 'size';
    /** Files that alone exceed the whole size budget — the notice names them, because "N not
     *  submitted" without the reason reads as the service's fault. */
    oversize?: string[];
  } | null;
}

/** Source extensions the services can check. `.d.ts` counts (it types). */
export const SOURCE_EXT = /\.(m?[jt]sx?|c[jt]s)$/;
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.immediately.run', 'coverage', '.cache']);
/** A path is source only if no segment is a skipped directory. `SKIP_DIRS` used to guard
 *  the whole-project walk alone, so `open`/`changed` seeds — the editor's file list includes
 *  the pre-transpiled artifact mirror under `.immediately.run/` — were linted as if written by
 *  hand (R3-443: 59 generated files, 193 spurious rows). */
export const isSourcePath = (p: string): boolean =>
  SOURCE_EXT.test(p) && !p.split('/').some((seg) => SKIP_DIRS.has(seg));

/** Directories no run should walk into for the `project` scope. */

// ── the import walk ───────────────────────────────────────────────────────────

const IMPORT_RE =
  /(?:\bimport\s+(?:[^'"]*?\s+from\s+)?|\bexport\s+(?:[^'"]*?\s+from\s+)|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"\r\n]+)['"]/g;

/** Every relative specifier in `content`, in document order, deduped. Package
 *  specifiers are not followed — they are the kernel type set's business. */
export function relativeSpecifiers(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of content.matchAll(IMPORT_RE)) {
    const spec = m[1];
    if (!spec.startsWith('.') || seen.has(spec)) continue;
    seen.add(spec);
    out.push(spec);
  }
  return out;
}

/** Candidate repo-relative paths a relative specifier may resolve to, in the order
 *  TypeScript's bundler resolution tries them. Asset specifiers yield nothing. */
export function resolveCandidates(fromPath: string, spec: string): string[] {
  const joined = normalizePath(`${dirnameOf(fromPath)}/${spec}`);
  if (!joined) return [];
  const m = /\.([a-z0-9]+)$/i.exec(joined);
  const ext = m?.[1]?.toLowerCase();
  if (ext && !/^(m?[jt]sx?|c[jt]s)$/.test(ext)) return []; // an asset — not a source
  const out: string[] = [];
  if (ext) {
    out.push(joined);
    // `./x.js` in TS source means `./x.ts` on disk (and `.jsx` → `.tsx`).
    if (ext === 'js' || ext === 'jsx') {
      const stem = joined.slice(0, -ext.length);
      out.push(`${stem}ts`, `${stem}tsx`);
    }
    if (ext === 'mjs') out.push(`${joined.slice(0, -3)}mts`);
    if (ext === 'cjs') out.push(`${joined.slice(0, -3)}cts`);
  }
  for (const e of ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts']) out.push(`${joined}.${e}`);
  for (const e of ['ts', 'tsx', 'js', 'jsx']) out.push(`${joined}/index.${e}`);
  return out;
}

/**
 * Submit `seeds` plus their transitive relative imports, breadth-first, until a bound.
 * Every seed is submitted before any import (a truncated run still checks what the
 * user changed); the count of files discovered but not submitted is the truncation.
 */
export async function collectClosure(
  seeds: readonly string[],
  ports: Pick<ScopePorts, 'readFile'>,
  bounds: { maxFiles?: number; maxUnits?: number } = {},
): Promise<{ files: ScopeFile[]; truncated: ResolvedScope['truncated'] }> {
  const maxFiles = bounds.maxFiles ?? MAX_FILES;
  const maxUnits = bounds.maxUnits ?? MAX_TOTAL_UNITS;
  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (p: string) => {
    if (!queued.has(p)) {
      queued.add(p);
      queue.push(p);
    }
  };
  for (const s of seeds) enqueue(normalizePath(s));

  const files: ScopeFile[] = [];
  let units = 0;
  const pack = packer(maxFiles, maxUnits);
  // Resolution cache: a candidate that failed once fails again this run.
  const missing = new Set<string>();
  const read = async (p: string): Promise<string | undefined> => {
    if (missing.has(p)) return undefined;
    try {
      return await ports.readFile(p);
    } catch {
      missing.add(p);
      return undefined;
    }
  };

  while (queue.length > 0) {
    const path = queue.shift()!;
    const content = await read(path);
    if (content === undefined) continue; // a deleted or unreadable seed — nothing to submit
    if (files.length >= maxFiles) {
      pack.full(1 + queue.length);
      break;
    }
    if (!pack.fits(path, content, units)) continue; // skipped and counted; its imports stay out
    files.push({ path, content });
    units += content.length;
    for (const spec of relativeSpecifiers(content)) {
      for (const cand of resolveCandidates(path, spec)) {
        if (queued.has(cand)) break;
        if (missing.has(cand)) continue;
        if ((await read(cand)) !== undefined) {
          enqueue(cand);
          break;
        }
      }
    }
  }
  return { files, truncated: pack.truncated() };
}

/**
 * The size bound, shared by both collectors. A file that does not fit is SKIPPED and counted,
 * and packing continues — it used to end the run, so one tracked 10 MB build artifact, second
 * in sort order, left 251 of 252 files "not submitted" (R3-444). A file that could never fit
 * on its own is named, so the notice can say why.
 */
const packer = (maxFiles: number, maxUnits: number) => {
  let dropped = 0;
  let bound: 'files' | 'size' | null = null;
  const oversize: string[] = [];
  return {
    /** Whether `content` fits beside `units` already packed; records the drop when not. */
    fits(path: string, content: string, units: number): boolean {
      if (units + content.length <= maxUnits) return true;
      dropped++;
      bound ??= 'size';
      if (content.length > maxUnits) oversize.push(path);
      return false;
    },
    /** The file cap was hit with `remaining` candidates unread. */
    full(remaining: number): void {
      dropped += remaining;
      bound ??= 'files';
    },
    truncated(): ResolvedScope['truncated'] {
      if (bound === null) return null;
      return { dropped, bound, ...(oversize.length > 0 ? { oversize } : {}) };
    },
    maxFiles,
  };
};

/** Submit a flat list (no walk) up to the bounds — the `open` and `project` scopes. */
export async function collectFlat(
  paths: readonly string[],
  ports: Pick<ScopePorts, 'readFile'>,
  bounds: { maxFiles?: number; maxUnits?: number } = {},
): Promise<{ files: ScopeFile[]; truncated: ResolvedScope['truncated'] }> {
  const maxFiles = bounds.maxFiles ?? MAX_FILES;
  const maxUnits = bounds.maxUnits ?? MAX_TOTAL_UNITS;
  const files: ScopeFile[] = [];
  let units = 0;
  const pack = packer(maxFiles, maxUnits);
  const unique = [...new Set(paths.map(normalizePath))];
  for (let i = 0; i < unique.length; i++) {
    const path = unique[i];
    if (files.length >= maxFiles) {
      pack.full(unique.length - i);
      break;
    }
    let content: string;
    try {
      content = await ports.readFile(path);
    } catch {
      continue;
    }
    if (!pack.fits(path, content, units)) continue;
    files.push({ path, content });
    units += content.length;
  }
  return { files, truncated: pack.truncated() };
}

/**
 * Resolve the scope to submit. An empty requested scope falls back one step (changed →
 * open → project) and SAYS so, because a silent "0 problems" over zero files is the
 * exact lie §7.2 exists to prevent.
 */
export async function resolveScope(
  requested: ScopeId,
  ports: ScopePorts,
  bounds?: { maxFiles?: number; maxUnits?: number },
): Promise<ResolvedScope> {
  const order: ScopeId[] = ['changed', 'open', 'project'];
  let first: ScopeId | undefined;
  for (const scope of order.slice(order.indexOf(requested))) {
    let seeds: string[];
    if (scope === 'changed') seeds = ports.changedPaths().map(normalizePath).filter(isSourcePath);
    else if (scope === 'open') seeds = ports.openPaths().map(normalizePath).filter(isSourcePath);
    else seeds = (await ports.listSourceFiles()).map(normalizePath).filter(isSourcePath).sort();
    if (seeds.length === 0) {
      first ??= scope;
      continue;
    }
    const collected =
      scope === 'changed' ? await collectClosure(seeds, ports, bounds) : await collectFlat(seeds, ports, bounds);
    if (collected.files.length === 0) {
      first ??= scope;
      continue;
    }
    return { scope, ...(first !== undefined ? { fellBackFrom: first } : {}), ...collected };
  }
  return { scope: 'project', ...(first !== undefined ? { fellBackFrom: first } : {}), files: [], truncated: null };
}
