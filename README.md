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

Both halves are **placeholders**. They exist first because the ladder is otherwise
circular: the registry is built from build-defaults outward, so a region does not
exist until the host says it does — and `immediately.run dev --region` validates only
that the string contains a dot, so it will accept an unregistered region and serve a
page that looks fine and loads nothing. Binding a placeholder is what makes the real
work testable.

- `R3-387` — bind the activity and both regions in the host
- `R3-390` — the problems list
- `R3-391` — the runner and staleness

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
