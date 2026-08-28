// The SDK adapters — the ONLY module that touches `@immediately-run/sdk` for the run
// pipeline. Everything above it (scope, run, the panel) takes these as ports, so the
// pipeline is testable with an in-memory tree and no host, and this file stays thin
// enough to read as a contract.

import { fsAvailable, getEditorContext, getVcsState, invoke, openAppFs } from '@immediately-run/sdk';
import type { Diagnostic } from './diagnostics';
import { SKIP_DIRS, isSourcePath } from './scope';
import type { RunPorts } from './run';

/** Is there a working tree to report on? False standalone (`vite dev`, a URL load). */
export const hasWorkingTree = (): boolean => {
  try {
    return fsAvailable();
  } catch {
    return false;
  }
};

/** Walk the app's working tree for source files (the `project` scope), skipping the
 *  trees no run should enter. Bounded by the caller through the scope bounds; this
 *  lists, it does not read. */
async function listSourceFiles(): Promise<string[]> {
  const fs = openAppFs();
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir || undefined);
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.kind === 'dir') {
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) await walk(rel);
      } else if (isSourcePath(rel)) {
        out.push(rel);
      }
    }
  };
  await walk('');
  return out;
}

/** The live ports: the app's own working-tree mount + the host's two lists + the gated
 *  catalog `invoke`. `changedPaths` is empty when there is no contribute session (the
 *  channel then never reports anything) — the scope resolver falls back and says so. */
export function hostPorts(): RunPorts {
  const fs = openAppFs();
  return {
    readFile: (path) => fs.readFile(path, 'utf8'),
    listSourceFiles,
    changedPaths: () =>
      getVcsState()
        .changes.filter((c) => c.status !== 'deleted')
        .map((c) => c.path),
    openPaths: () => getEditorContext().openFiles,
    invoke: (name, params) => invoke(name, params),
  };
}

/**
 * Bring the user to a diagnostic (TOOLS_ACTIVITY_SPEC §4 / §5.2). One gated call opens
 * the file, lands the caret, and — with `reveal` — asks the host to switch the user to
 * the activity that owns the editor, which this activity is not (it owns the main pane).
 *
 * `reveal` rides the elevated `editor:reveal` and needs a REAL gesture: the host reads
 * its own `navigator.userActivation`, which a click inside this frame flips for ~5 s.
 * So call this from the click / Enter handler, never on run completion or a timer —
 * those are denied by design, not a bug to work around. The promise resolves whether or
 * not the user moved (no oracle against the focus gate); the visible "Open in editor"
 * control in the runner is the fallback when it did not.
 *
 * Wire: `{ path, selection, reveal }` on `protocol-editor open` — the same message the
 * SDK's `openInEditor(path, selection, { reveal })` sends from 0.56.0; routed through
 * the gated `invoke` here so the app does not pin an SDK that is still in release.
 */
export async function openDiagnostic(d: Diagnostic, opts: { reveal: boolean }): Promise<void> {
  if (d.path === null || d.line === null) return;
  await invoke('editor:open', {
    path: d.path,
    selection: { line: d.line, column: d.column ?? 1 },
    ...(opts.reveal ? { reveal: true } : {}),
  });
}
