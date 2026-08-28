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
// iframe, so they share no memory. The panel (R3-390) is complete on its own — a row
// click opens the file in the editor across activities. The runner (R3-391) is still
// the placeholder; how it learns the panel's selection is that item's open question.
import { useEffect, useMemo } from 'react';
import { useDiagnostics, useHostTheme, useRegion, onVcsStateChange } from '@immediately-run/sdk';
import Placeholder from './components/Placeholder';
import ProblemsPanel from './components/ProblemsPanel';
import { hasWorkingTree, hostPorts, openDiagnostic } from './lib/host';
import type { Diagnostic } from './lib/diagnostics';
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
    const finish = () => {
      if (done) return;
      done = true;
      off();
      resolve();
    };
    const off = onVcsStateChange(() => finish());
    setTimeout(finish, 1500);
  });

function ProblemsHalf() {
  useMirroredTheme();
  const { buildErrors } = useDiagnostics();
  const ports = useMemo(() => (hasWorkingTree() ? hostPorts() : null), []);
  const onOpen = (d: Diagnostic) => openDiagnostic(d, { reveal: true });
  return <ProblemsPanel ports={ports} buildErrors={buildErrors} onOpen={onOpen} awaitHost={awaitHost} />;
}

export default function App() {
  const region = useRegion();

  if (region === 'panel.tools') return <ProblemsHalf />;

  if (region === 'mainpane.tools') {
    return (
      <Placeholder
        region="mainpane.tools"
        title="Tools"
        detail="The runner lands here — tool tabs, run scope and controls, and the selected diagnostic in source context."
        item="R3-391"
      />
    );
  }

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
