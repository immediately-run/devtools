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

Both halves are **built**: the problems list (`R3-390`) and the runner (`R3-391`).
The live drill (`R3-392`) is what remains.

- `R3-387` — bind the activity and both regions in the host — done
- `R3-390` — the problems list — done
- `R3-391` — the runner, staleness, sibling sync, keyboard — built
- `R3-392` — the live drill — next

## How it works

```
src/lib/diagnostics.ts   the unified model: tsc / eslint / build → one Diagnostic,
                         path normalization, dedup, grouping, counts (notes excluded)
src/lib/scope.ts         changed files + local import closure (default) · open files ·
                         whole project — bounded to the service's 200 files / 1 MB,
                         falling back changed → open → project and SAYING so
src/lib/run.ts           one run: resolve scope → typecheck + lint → normalize →
                         `partial` reasons (truncation, relative coverage notes,
                         service failures); `isCleanBill` is the only door to "No problems"
src/lib/codeFrame.ts     the read-only code frame rows: hit line + a caret SPAN for tsc
                         (the one source with an end position), a point for the rest
src/lib/sync.ts          the sibling protocol (hello / run-result / select) and its
                         validation — the other frame's payload is data, not trust
src/lib/host.ts          the SDK adapters (the edited repo's worktree mount, vcs/editor
                         lists, staleness legs, the IPC edge, openInEditor) — the one
                         module that touches the SDK for the session
src/hooks/useToolsSession.ts  ONE session for both halves: run, selection, staleness,
                         kept in step over the IPC edge (useSiblingSync / useStaleness)
src/components/ProblemsPanel.tsx  panel.tools — chips, filter, grouped list, banners
src/components/RunnerPane.tsx     mainpane.tools — tabs, run bar, code frame, actions
```

Everything above `host.ts` takes ports, so the pipeline and both halves are tested
against an in-memory tree, an in-memory bus and canned service replies with no SDK mock.

**The two halves are two frames.** The host mounts each region in its own sandboxed
iframe; they share no memory. They hold one session in step over their single §5.6
IPC edge to each other (and to nothing else — the explorer reveal stays a consequence,
never a message). A half that mounts later sends `hello` and receives the current run
and selection instead of re-running. The panel does the one automatic first-open run;
the runner never auto-runs.

**Staleness.** A run records the paths it covered; the worktree mount's change stream →
debounce → `refreshDiff()` → a write to a covered path marks the run stale. It stays on
screen, dimmed and labelled, and is never a clean bill.

**Keyboard**, per frame (keys do not cross iframes): the panel's list takes arrows /
Home / End / Enter; the runner takes J / K and F8 / ⇧F8 (next / previous problem in the
active tab) and Enter. None collide with the host (⌘K palette, ⌘B panel, ⌘. mode,
Escape) or the editor (CodeMirror's default keymap).

Two rules a change here must keep:

- **A run with anything unchecked is `partial` and never renders "No problems".**
  Relative coverage notes (an import the request did not include) count as unchecked
  — a bare changed file whose imports are all outside the request would otherwise
  report a clean run having checked almost nothing (`TOOLS_ACTIVITY_SPEC` §3.2, §7.2).
- **The row click is the gesture.** Opening a diagnostic asks the host to switch the
  user to the editor activity (`editor:reveal`), which the host only does under a real
  user activation it reads itself. Never call it on run completion or from a timer;
  it is denied by design there.

The two regions are two sandboxed frames and share no memory; see "The two halves are
two frames" above for how they stay in step.

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
