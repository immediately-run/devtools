// Root component — immediately.run renders the default export of THIS file, booted
// at the literal path `files/src/App.tsx`. `main.tsx` is never loaded by the host.
//
// The Tools activity occupies TWO regions from this one repo, and the platform has
// no way to bind a region to a specific entry point (`RegionBinding` carries no
// `entryPoint`, and program-identity `appKey` is written but unwired). So one
// program serves both halves and branches on `useRegion()` — the shipped idiom,
// with two precedents: `agent-demo` (panel.agent + stage.conversation) and
// `file-explorer` (panel.files + page.commander), which PRINCIPALS_SPEC §4 calls
// one-repo-many-bindings.
//
// The two halves are two FRAMES: the host mounts each region in its own sandboxed
// iframe, so they share no memory. They keep one session in step over their single
// IPC edge to each other (`hooks/useSiblingSync.ts`, protocol in `lib/sync.ts`).
import { useEffect, useMemo } from 'react';
import { useDiagnostics, useHostTheme, useRegion, onVcsStateChange } from '@immediately-run/sdk';
import Placeholder from './components/Placeholder';
import ProblemsPanel from './components/ProblemsPanel';
import RunnerPane from './components/RunnerPane';
import { openDiagnostic, siblingPorts, stalenessPorts } from './lib/host';
import type { Diagnostic } from './lib/diagnostics';
import { useToolsSession } from './hooks/useToolsSession';
import { useWorkingTree } from './hooks/useWorkingTree';
import './index.css';

/** The host's theme reaches this frame over the SDK channel, not as CSS — mirror it
 *  onto the root element so the stylesheet's `html[data-theme]` block applies. */
function useMirroredTheme() {
  const theme = useHostTheme();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
}

/** Resolve once the host has pushed vcs state (so the default scope sees the changed
 *  files), or after a short deadline when there is no contribute session to push. */
const awaitHost = (): Promise<void> =>
  new Promise((resolve) => {
    let done = false;
    // The channel REPLAYS its current value to a late subscriber synchronously, so the
    // listener can run before `subscribe` has even returned — `off` must exist first.
    // (Caught live by this very panel: its first build row was the TDZ error here.)
    let off: () => void = () => {};
    const finish = () => {
      if (done) return;
      done = true;
      off();
      resolve();
    };
    off = onVcsStateChange(() => finish());
    if (done) off();
    setTimeout(finish, 1500);
  });

const onOpen = (d: Diagnostic) => openDiagnostic(d, { reveal: true });

/** Everything both halves share: the working tree, the staleness legs, the sibling
 *  edge, and the session over them. The panel does the one automatic first-open run
 *  (§7.1); the runner asks the panel for the current state instead. */
function useHalf(autoRun: boolean) {
  useMirroredTheme();
  const tree = useWorkingTree();
  const staleness = useMemo(() => (tree ? stalenessPorts(tree.mount) : null), [tree]);
  const sibling = useMemo(() => siblingPorts(), []);
  const session = useToolsSession({ ports: tree === undefined ? undefined : (tree?.ports ?? null), staleness, sibling, autoRun, awaitHost });
  const readFile = useMemo(() => (tree ? (path: string) => tree.ports.readFile(path) : null), [tree]);
  return { session, readFile };
}

function ProblemsHalf() {
  const { session } = useHalf(true);
  const { buildErrors } = useDiagnostics();
  return <ProblemsPanel session={session} buildErrors={buildErrors} onOpen={onOpen} />;
}

function RunnerHalf() {
  const { session, readFile } = useHalf(false);
  const { buildErrors } = useDiagnostics();
  return <RunnerPane session={session} buildErrors={buildErrors} onOpen={onOpen} readFile={readFile} />;
}

export default function App() {
  const region = useRegion();

  if (region === 'panel.tools') return <ProblemsHalf />;
  if (region === 'mainpane.tools') return <RunnerHalf />;

  // Standalone (no region): loaded from a URL or a dev server rather than bound
  // into the workbench. There is no working-tree mount here and no editor session,
  // so there is nothing to report on — say that rather than render an empty shell.
  return (
    <Placeholder
      region={null}
      title="Tools"
      detail="This app is a workbench surface. Open it from the Tools activity inside the immediately.run editor, where it can see the working tree it reports on."
      item="R3-387"
    />
  );
}
