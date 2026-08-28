# Code ↔ spec references

Where this repo's behaviour is specified. Keep this current: a reader who finds code
that contradicts a spec should be able to tell which one is wrong.

| Here | Specified in |
|---|---|
| Two regions from one entry point, branching on `useRegion()` | `TOOLS_ACTIVITY_SPEC` §2 |
| Why not two entry points (one `appKey`, one grant set) | `TOOLS_ACTIVITY_SPEC` §2.1; `PRINCIPALS_SPEC` §4 |
| The unified diagnostic model over three sources (`src/lib/diagnostics.ts`) | `TOOLS_ACTIVITY_SPEC` §3 |
| Severity, and the `note` level that means "not a problem" | `TOOLS_ACTIVITY_SPEC` §3.2 |
| A relative coverage note makes the run `partial` (`run.ts` → `relative-coverage`); an ASSET import (`.css`, `.svg`, …) is classified `asset` and does not — a refinement this app adds, since no typecheck could ever check it | `TOOLS_ACTIVITY_SPEC` §3.2 (rule); refinement recorded in `TOOLS_ACTIVITY_STATUS` |
| Dedup after path normalization; "not file-located" group (`diagnostics.ts` `dedupe` / `groupByFile`) | `TOOLS_ACTIVITY_SPEC` §3.3 |
| Scope fallback changed → open → project, always reported (`scope.ts` `resolveScope`) | `TOOLS_ACTIVITY_SPEC` §7.2 ("the default that would lie") |
| `openDiagnostic` → `openInEditor(path, selection, { reveal: true })` (sdk 0.56.0): one gated `protocol-editor open` carrying the caret target and the cross-activity reveal | `TOOLS_ACTIVITY_SPEC` §4, §5.2 |
| The runner: tabs per source, run bar, read-only code frame with a tsc-only caret span, the explicit Open in editor control (`src/components/RunnerPane.tsx`, `src/lib/codeFrame.ts`) | `TOOLS_ACTIVITY_SPEC` §8.2, §3.1 rule 2 |
| Staleness: covered paths + `onChange` → debounce → `refreshDiff()`; a stale run stays on screen, dimmed and labelled (`src/hooks/useStaleness.ts`) | `TOOLS_ACTIVITY_SPEC` §7.3 (G-TOOL-6) |
| The two halves are two frames kept in step over ONE IPC edge to each other — hello / run-result / select, payload re-validated (`src/lib/sync.ts`, `src/hooks/useSiblingSync.ts`) | `TOOLS_ACTIVITY_SPEC` §2, §9 (`ipc` row), §12 decision "two frames, one edge" |
| Manual tsc/eslint; ONE automatic run when the activity is first opened (the panel); the runner never auto-runs | `TOOLS_ACTIVITY_SPEC` §7.1 |
| Keyboard: J / K, F8 / ⇧F8, Enter in the runner; arrows / Home / End / Enter in the panel — checked against the host's ⌘K / ⌘B / ⌘. / Escape and the editor's CodeMirror default keymap | `TOOLS_ACTIVITY_SPEC` §8.1, §13 (keyboard bindings) |
| Navigation to a diagnostic's line | `TOOLS_ACTIVITY_SPEC` §4 |
| The cross-activity reveal and its gesture gate | `TOOLS_ACTIVITY_SPEC` §5.2 |
| Run scopes, bounds and `partial` | `TOOLS_ACTIVITY_SPEC` §7.2 |
| Staleness | `TOOLS_ACTIVITY_SPEC` §7.3 |
| The capabilities this app's bindings hold | `TOOLS_ACTIVITY_SPEC` §9 |
| `App.tsx` is the host's boot path, not `main.tsx` | `UI_AS_APPS_SPEC` (region app loading) |
| The cache zip this repo publishes to its own Pages | `ZIP_CACHE_AUTOMATION_SPEC` |
