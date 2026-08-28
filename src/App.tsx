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
// Both halves are placeholders until R3-390 (the problems list) and R3-391 (the
// runner). They exist now because the ladder is otherwise circular: `mergeRegistry`
// iterates build-defaults, so a region does not exist until site-main says it does,
// and `immediately.run dev --region` validates only that the string contains a dot
// — it accepts an unregistered region and serves a page that looks fine and loads
// nothing. Binding a placeholder first is what makes the next item testable.
import { useRegion } from '@immediately-run/sdk';
import Placeholder from './components/Placeholder';
import './index.css';

export default function App() {
  const region = useRegion();

  if (region === 'panel.tools') {
    return (
      <Placeholder
        region="panel.tools"
        title="Problems"
        detail="The problems list lands here — tsc, eslint and build diagnostics in one list, grouped by file."
        item="R3-390"
      />
    );
  }

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
