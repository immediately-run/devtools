// `panel.tools` — the problems list (TOOLS_ACTIVITY_SPEC §8.1, R3-390).
//
// Three sources in one list: `tsc` and `eslint` from the last run, `build` LIVE from
// the host's diagnostics channel (§7.1 — it is push-fed and costs nothing, so it is
// never manual). Everything is normalized to one path form before it is merged.
//
// The run, the selection and the staleness live in the shared `ToolsSession` (R3-391),
// which the runner in the other frame holds in step over the sibling edge; this
// component is one view of it. Props are the ports, so a test renders it over an
// in-memory tree and canned service replies and never mocks the SDK.
import { useCallback, useMemo, useState } from 'react';
import { type BuildErrorLike, type Diagnostic, countBySeverity, dedupe, fromBuild, groupByFile, matchesFilter } from '../lib/diagnostics';
import { isCleanBill } from '../lib/run';
import { type RunStatus as Status, type ToolsSession } from '../hooks/useToolsSession';
import { SCOPE_LABEL } from '../lib/scope';
import { DEFAULT_FILTER, type SeverityFilter } from '../lib/severityFilter';
import ProblemsList from './ProblemsList';
import RunStatus from './RunStatus';
import SeverityChips from './SeverityChips';
import StaleBanner from './StaleBanner';
import { FilterIcon, PlayIcon } from './Icons';

export interface ProblemsPanelProps {
  session: ToolsSession;
  /** The live `build` rows (the SDK's `useDiagnostics().buildErrors`). */
  buildErrors: readonly BuildErrorLike[];
  /** Row activation — the gesture-carrying call (`openDiagnostic` in the live app). */
  onOpen: (d: Diagnostic) => Promise<void>;
}

const NO_BUILD: readonly BuildErrorLike[] = [];

export default function ProblemsPanel({ session, buildErrors = NO_BUILD, onOpen }: ProblemsPanelProps) {
  const { status, last, run, running, stale, selectedId, select, ports } = session;
  const [filter, setFilter] = useState<SeverityFilter>(DEFAULT_FILTER);
  const [needle, setNeedle] = useState('');
  const [openError, setOpenError] = useState<string | null>(null);

  // The unified list: live build rows + the last run's rows, deduped (§3.3).
  const all = useMemo<Diagnostic[]>(() => {
    const build = buildErrors.map((e, i) => fromBuild(e, i));
    return dedupe([...build, ...(last?.diagnostics ?? [])]);
  }, [buildErrors, last]);

  const counts = useMemo(() => countBySeverity(all), [all]);
  const visible = useMemo(() => all.filter((d) => filter[d.severity] && matchesFilter(d, needle)), [all, filter, needle]);
  const { groups, notes } = useMemo(() => groupByFile(visible), [visible]);
  // A row that disappears (re-run, filter) drops the selection — derived, not synced.
  const effectiveSelectedId = selectedId !== null && visible.some((d) => d.id === selectedId) ? selectedId : null;

  const open = useCallback(
    (d: Diagnostic) => {
      setOpenError(null);
      // Called from the click / Enter handler ON PURPOSE: `reveal` needs the gesture the
      // host reads for itself. Do not move this onto run completion (§5.2, G-TOOL-10).
      void onOpen(d).catch((e: unknown) => {
        const code = (e as { code?: string })?.code;
        setOpenError(code === 'not-found' ? 'That file is no longer in the working tree.' : `Could not open the file (${code ?? 'unknown'}).`);
      });
    },
    [onOpen],
  );

  const problems = counts.errors + counts.warnings;
  const visibleProblems = visible.filter((d) => d.severity !== 'note').length;
  const liveBuildErrors = all.filter((d) => d.source === 'build').length;
  const clean = last !== null && status.state === 'done' && isCleanBill(last, liveBuildErrors) && stale.length === 0;

  return (
    <section className="problems" aria-labelledby="problems-title">
      <div className="panel-top">
        <div className="panel-title-row">
          <h1 className="panel-title" id="problems-title">
            Problems
          </h1>
          <button type="button" className="runbtn" onClick={() => void run('changed')} disabled={running || !ports} aria-busy={running}>
            <PlayIcon /> {running ? 'Running…' : 'Run'}
          </button>
        </div>
        <SeverityChips counts={counts} filter={filter} onChange={setFilter} />
        <label className="filter">
          <FilterIcon />
          <input type="text" placeholder="Filter by path or message…" aria-label="Filter problems" value={needle} onChange={(e) => setNeedle(e.target.value)} />
        </label>
      </div>

      {ports === undefined ? (
        <p className="runmeta" role="status">
          Connecting to the working tree…
        </p>
      ) : ports === null ? (
        <p className="empty">
          <b>No working tree here.</b> Open this from the Tools activity inside the immediately.run editor, where it can see the files it reports on.
        </p>
      ) : (
        <RunStatus status={status} />
      )}

      <StaleBanner stale={stale} onRerun={() => void run('changed')} running={running} />

      {openError && (
        <p className="partial" role="alert">
          <span>{openError}</span>
        </p>
      )}

      {ports && (
        <EmptyState status={status} total={all.length} problems={problems} visibleProblems={visibleProblems} hiddenNotes={!filter.note ? counts.notes : 0} clean={clean} />
      )}

      <ProblemsList groups={groups} notes={notes} selectedId={effectiveSelectedId} onSelect={(d) => select(d.id)} onOpen={open} dimmed={stale.length > 0} />
    </section>
  );
}

function EmptyState({
  status,
  total,
  problems,
  visibleProblems,
  hiddenNotes,
  clean,
}: {
  status: Status;
  total: number;
  problems: number;
  visibleProblems: number;
  hiddenNotes: number;
  clean: boolean;
}) {
  if (status.state === 'idle' && total === 0) return <p className="empty">Run typecheck and lint to see problems here. Build errors appear as they happen.</p>;
  if (status.state === 'running' && total === 0) return null;
  if (status.state === 'done' && clean) {
    // The clean bill of health — reachable ONLY through `isCleanBill`, which refuses
    // while anything was left unchecked (G-TOOL-5 / 5b), and never while stale (G-TOOL-6).
    return (
      <p className="empty empty--ok" data-clean="true">
        <b>No problems</b> in {SCOPE_LABEL[status.result.scope].toLowerCase()} — {status.result.files.count} {status.result.files.count === 1 ? 'file' : 'files'} checked.
      </p>
    );
  }
  if (status.state === 'done' && problems === 0) {
    // Nothing found, but the run was partial, stale, or a service failed: say what it
    // was, never "no problems". Hidden notes are named so the list is not silently empty.
    return (
      <p className="empty">
        Nothing found in the files that were checked.
        {hiddenNotes > 0 ? ` ${hiddenNotes} coverage ${hiddenNotes === 1 ? 'note is' : 'notes are'} hidden by the Notes chip.` : ''}
      </p>
    );
  }
  if (problems > 0 && visibleProblems === 0) return <p className="empty">Nothing matches the current filter.</p>;
  return null;
}
