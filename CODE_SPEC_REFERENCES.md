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
| `openDiagnostic` sends `{ path, selection, reveal }` through the gated `invoke('editor:open')` — the wire the SDK's `openInEditor(path, selection, { reveal })` speaks from 0.56.0 | `TOOLS_ACTIVITY_SPEC` §4, §5.2 |
| Navigation to a diagnostic's line | `TOOLS_ACTIVITY_SPEC` §4 |
| The cross-activity reveal and its gesture gate | `TOOLS_ACTIVITY_SPEC` §5.2 |
| Run scopes, bounds and `partial` | `TOOLS_ACTIVITY_SPEC` §7.2 |
| Staleness | `TOOLS_ACTIVITY_SPEC` §7.3 |
| The capabilities this app's bindings hold | `TOOLS_ACTIVITY_SPEC` §9 |
| `App.tsx` is the host's boot path, not `main.tsx` | `UI_AS_APPS_SPEC` (region app loading) |
| The cache zip this repo publishes to its own Pages | `ZIP_CACHE_AUTOMATION_SPEC` |
