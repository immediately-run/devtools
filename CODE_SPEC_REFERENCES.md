# Code ↔ spec references

Where this repo's behaviour is specified. Keep this current: a reader who finds code
that contradicts a spec should be able to tell which one is wrong.

| Here | Specified in |
|---|---|
| Two regions from one entry point, branching on `useRegion()` | `TOOLS_ACTIVITY_SPEC` §2 |
| Why not two entry points (one `appKey`, one grant set) | `TOOLS_ACTIVITY_SPEC` §2.1; `PRINCIPALS_SPEC` §4 |
| The unified diagnostic model over three sources | `TOOLS_ACTIVITY_SPEC` §3 |
| Severity, and the `note` level that means "not a problem" | `TOOLS_ACTIVITY_SPEC` §3.2 |
| Navigation to a diagnostic's line | `TOOLS_ACTIVITY_SPEC` §4 |
| The cross-activity reveal and its gesture gate | `TOOLS_ACTIVITY_SPEC` §5.2 |
| Run scopes, bounds and `partial` | `TOOLS_ACTIVITY_SPEC` §7.2 |
| Staleness | `TOOLS_ACTIVITY_SPEC` §7.3 |
| The capabilities this app's bindings hold | `TOOLS_ACTIVITY_SPEC` §9 |
| `App.tsx` is the host's boot path, not `main.tsx` | `UI_AS_APPS_SPEC` (region app loading) |
| The cache zip this repo publishes to its own Pages | `ZIP_CACHE_AUTOMATION_SPEC` |
