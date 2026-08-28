# devtools — the Tools activity for immediately.run

The workbench surface that shows a person what `tsc`, `eslint` and the bundler are
saying about the app they are editing.

Those services have been live on the platform since R3-75 and, until this app, had
**no human-facing surface at all**: the only caller was the model inside the coding
agent, and the only rendering was a raw tool result printed into an agent transcript.
The surfaces a person actually watches — editor squiggles, the preview's error
overlay — are fed only by the bundler, and transpilation strips types without
checking them. So an app could be green everywhere in the interface and still fail
its own `tsc -b`.

**Design of record:** [`TOOLS_ACTIVITY_SPEC`](https://github.com/immediately-run/docs)
in the docs corpus. Read it before changing behaviour here; the closed decisions and
their rejected alternatives live in its Decisions section.

## Shape

One repo, one entry point, two regions:

| Region | Half |
|---|---|
| `panel.tools` | The problems list — three sources in one list, grouped by file |
| `mainpane.tools` | The runner — tool tabs, run scope and controls, the selected diagnostic in context |

`src/App.tsx` branches on `useRegion()`. It is not two entry points: `RegionBinding`
carries no `entryPoint`, and program-identity `appKey` is written but unwired, so a
binding cannot name one. This is the shipped idiom — `agent-demo` and `file-explorer`
both do it, and `PRINCIPALS_SPEC` §4 calls it one-repo-many-bindings.

## State

The **problems list is built** (`R3-390`); the runner is still a placeholder (`R3-391`).

- `R3-387` — bind the activity and both regions in the host — done
- `R3-390` — the problems list — built
- `R3-391` — the runner and staleness — next

## How the panel works

```
src/lib/diagnostics.ts   the unified model: tsc / eslint / build → one Diagnostic,
                         path normalization, dedup, grouping, counts (notes excluded)
src/lib/scope.ts         changed files + local import closure (default) · open files ·
                         whole project — bounded to the service's 200 files / 1 MB,
                         falling back changed → open → project and SAYING so
src/lib/run.ts           one run: resolve scope → typecheck + lint → normalize →
                         `partial` reasons (truncation, relative coverage notes,
                         service failures); `isCleanBill` is the only door to "No problems"
src/lib/host.ts          the SDK adapters (working-tree fs, vcs/editor lists, the gated
                         `invoke`) — the one module that touches the SDK for the run
src/hooks/useProblemsRun.ts  run state + the single automatic run on first open
src/components/*         the panel: chips, filter, grouped list, partial banner
```

Everything above `host.ts` takes ports, so the pipeline and the panel are tested
against an in-memory tree and canned service replies with no SDK mock.

Two rules a change here must keep:

- **A run with anything unchecked is `partial` and never renders "No problems".**
  Relative coverage notes (an import the request did not include) count as unchecked
  — a bare changed file whose imports are all outside the request would otherwise
  report a clean run having checked almost nothing (`TOOLS_ACTIVITY_SPEC` §3.2, §7.2).
- **The row click is the gesture.** Opening a diagnostic asks the host to switch the
  user to the editor activity (`editor:reveal`), which the host only does under a real
  user activation it reads itself. Never call it on run completion or from a timer;
  it is denied by design there.

The two regions are two sandboxed frames and share no memory. The panel is complete
on its own; how the runner learns the panel's selection is `R3-391`'s open question.

## Developing

```sh
npm ci
npm run dev     # standalone; no working tree, so the placeholder explains itself
npm test
npm run lint
npm run build
```

To run it inside the real workbench, serve the working tree and bind it to a region:

```sh
immediately.run dev . --region panel.tools --origin https://local.immediately.run
```

That only works once the region exists in the host's build defaults (R3-387). Before
then it fails **silently** — the page renders and the region loads nothing.
