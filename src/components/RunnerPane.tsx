// `mainpane.tools` — the runner (TOOLS_ACTIVITY_SPEC §8.2, R3-391): tabs per source with
// counts, a run bar (scope, Run, run metadata, partial / stale state), the selected
// diagnostic in a read-only code frame with an explicit **Open in editor** control (the
// §5.2 fallback), and the run summary when nothing is selected.
//
// Keyboard (per frame — keys do not cross iframes): J / K and F8 / ⇧F8 move to the
// next / previous problem in the active tab's order, Enter opens. None of these
// collide with the host (⌘K palette, ⌘B panel, ⌘. mode, Escape) or the editor
// (CodeMirror's default keymap).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { type BuildErrorLike, type Diagnostic, type Source, countBySeverity, dedupe, fromBuild, groupByFile } from '../lib/diagnostics';
import { isCleanBill } from '../lib/run';
import { SCOPE_LABEL, type ScopeId } from '../lib/scope';
import type { ToolsSession } from '../hooks/useToolsSession';
import CodeFrame from './CodeFrame';
import StaleBanner from './StaleBanner';
import { PlayIcon, SeverityGlyph } from './Icons';

export interface RunnerPaneProps {
  session: ToolsSession;
  buildErrors: readonly BuildErrorLike[];
  /** Row activation — the gesture-carrying call (`openDiagnostic` in the live app). */
  onOpen: (d: Diagnostic) => Promise<void>;
  readFile: ((path: string) => Promise<string>) | null;
}

type Tab = 'overview' | Source;
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'tsc', label: 'Typecheck' },
  { id: 'eslint', label: 'Lint' },
  { id: 'build', label: 'Build' },
];
const SCOPES: ScopeId[] = ['changed', 'open', 'project'];
const SCOPE_SHORT: Record<ScopeId, string> = { changed: 'Changed', open: 'Open files', project: 'Whole project' };

const ago = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};
const kb = (units: number) => (units < 1024 ? `${units} chars` : `${Math.round(units / 1024)} KB`);

function useNow(tickMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}

export default function RunnerPane({ session, buildErrors, onOpen, readFile }: RunnerPaneProps) {
  const { status, last, running, run, stale, selectedId, select, ports } = session;
  const [tab, setTab] = useState<Tab>('overview');
  const [scope, setScope] = useState<ScopeId>('changed');
  const [openError, setOpenError] = useState<string | null>(null);
  const now = useNow();

  const all = useMemo<Diagnostic[]>(() => {
    const build = buildErrors.map((e, i) => fromBuild(e, i));
    return dedupe([...build, ...(last?.diagnostics ?? [])]);
  }, [buildErrors, last]);
  const counts = useMemo(() => countBySeverity(all), [all]);
  const perSource = useMemo(() => {
    const n: Record<Source, number> = { tsc: 0, eslint: 0, build: 0 };
    for (const d of all) if (d.severity !== 'note') n[d.source] += 1;
    return n;
  }, [all]);

  // The traversal order the keyboard follows: the panel's order (by file, document
  // order), narrowed to the active tab's source. Notes are not problems (§3.2) and are
  // not traversed.
  const order = useMemo(() => {
    const { groups } = groupByFile(all);
    const rows = groups.flatMap((g) => g.rows);
    return tab === 'overview' ? rows : rows.filter((d) => d.source === tab);
  }, [all, tab]);
  const selected = useMemo(() => all.find((d) => d.id === selectedId) ?? null, [all, selectedId]);

  const open = useCallback(
    (d: Diagnostic) => {
      setOpenError(null);
      // From the click / Enter handler on purpose: `reveal` needs the gesture the host
      // reads for itself (§5.2). This button IS the fallback when a row click's reveal
      // was refused — it is a fresh gesture.
      void onOpen(d).catch((e: unknown) => {
        const code = (e as { code?: string })?.code;
        setOpenError(code === 'not-found' ? 'That file is no longer in the working tree.' : `Could not open the file (${code ?? 'unknown'}).`);
      });
    },
    [onOpen],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      if (order.length === 0) return;
      const i = order.findIndex((d) => d.id === selectedId);
      const next = i === -1 ? (delta === 1 ? 0 : order.length - 1) : (i + delta + order.length) % order.length;
      select(order[next].id);
    },
    [order, selectedId, select],
  );

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === 'F8') {
        e.preventDefault();
        step(e.shiftKey ? -1 : 1);
      } else if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        step(1);
      } else if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        step(-1);
      } else if (e.key === 'Enter' && selected) {
        e.preventDefault();
        open(selected);
      }
    },
    [step, selected, open],
  );

  const liveBuildErrors = all.filter((d) => d.source === 'build').length;
  const clean = last !== null && status.state === 'done' && isCleanBill(last, liveBuildErrors);
  const isStale = stale.length > 0;

  return (
    <section className="runner" aria-label="Tools runner" onKeyDown={onKey} tabIndex={-1}>
      <div className="tabs" role="tablist" aria-label="Tool">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id !== 'overview' && <span className="n">{perSource[t.id]}</span>}
          </button>
        ))}
      </div>

      <div className="runbar">
        <div className="scope" role="group" aria-label="Run scope">
          {SCOPES.map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)} title={SCOPE_LABEL[s]}>
              {SCOPE_SHORT[s]}
            </button>
          ))}
        </div>
        <button type="button" className="runbtn" onClick={() => void run(scope)} disabled={running || !ports} aria-busy={running}>
          <PlayIcon /> {running ? 'Running…' : 'Run'}
        </button>
        <div className="meta" role="status">
          {ports === undefined && <span>Connecting to the working tree…</span>}
          {ports === null && <span>No working tree here.</span>}
          {status.state === 'running' && <span>Running {SCOPE_LABEL[status.scope].toLowerCase()}…</span>}
          {status.state === 'failed' && <span className="warn">✕ failed — {status.error}</span>}
          {last && status.state !== 'running' && (
            <>
              <span className={isStale ? 'warn' : last.partial.length > 0 ? 'warn' : 'ok'}>
                {isStale ? '◔ stale' : last.partial.length > 0 ? '◐ partial' : '✓ ran'} {ago(now - last.startedAt)}
              </span>
              <span>
                {last.files.count} {last.files.count === 1 ? 'file' : 'files'} · {kb(last.files.units)}
              </span>
              <span>{(last.durationMs / 1000).toFixed(1)}s</span>
              <span>
                {SCOPE_LABEL[last.scope].toLowerCase()}
                {last.fellBackFrom ? ` (${SCOPE_LABEL[last.fellBackFrom].toLowerCase()} was empty)` : ''}
              </span>
            </>
          )}
        </div>
      </div>

      <StaleBanner stale={stale} onRerun={() => void run(scope)} running={running} />

      {openError && (
        <p className="partial" role="alert">
          <span>{openError}</span>
        </p>
      )}

      <div className={`pane${isStale ? ' pane--stale' : ''}`}>
        {selected ? (
          <>
            <div className="detail-hd">
              <span className={`sevmark sevmark--${selected.severity}`} aria-hidden="true">
                <SeverityGlyph severity={selected.severity} />
              </span>
              <div style={{ minWidth: 0 }}>
                <h2>{selected.message}</h2>
                <p className="detail-sub">{selected.path === null ? 'not file-located' : `${selected.path}:${selected.line}:${selected.column}`}</p>
                <div className="tagrow">
                  <span className="tag">{selected.source}</span>
                  {selected.code && <span className="tag">{selected.code}</span>}
                  <span className="tag">{selected.severity}</span>
                  {selected.note && <span className="tag">{selected.note}</span>}
                </div>
              </div>
            </div>
            <CodeFrame diagnostic={selected} readFile={readFile} />
            <div className="actions">
              <button type="button" className="btn btn--primary" onClick={() => open(selected)} disabled={selected.path === null}>
                Open in editor
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void navigator.clipboard?.writeText(`${selected.path ?? ''}${selected.line !== null ? `:${selected.line}:${selected.column}` : ''} ${selected.message}`.trim()).catch(() => {});
                }}
              >
                Copy message
              </button>
              <span className="hint">↵ opens · J / K move · F8 / ⇧F8 next / previous</span>
            </div>
          </>
        ) : (
          <Summary session={session} counts={counts} clean={clean} tab={tab} perSource={perSource} order={order} />
        )}
      </div>
    </section>
  );
}

function Summary({
  session,
  counts,
  clean,
  tab,
  perSource,
  order,
}: {
  session: ToolsSession;
  counts: ReturnType<typeof countBySeverity>;
  clean: boolean;
  tab: Tab;
  perSource: Record<Source, number>;
  order: Diagnostic[];
}) {
  const { status, last, ports } = session;
  if (ports === null) {
    return (
      <p className="empty">
        <b>No working tree here.</b> Open this from the Tools activity inside the immediately.run editor, where it can see the files it reports on.
      </p>
    );
  }
  if (!last && status.state !== 'running') {
    return <p className="empty">Run typecheck and lint to see a summary here. Build errors appear as they happen.</p>;
  }
  return (
    <>
      <div className="summary-grid">
        <div className="stat">
          <div className="lbl">Errors</div>
          <div className="val err">{counts.errors}</div>
        </div>
        <div className="stat">
          <div className="lbl">Warnings</div>
          <div className="val warn">{counts.warnings}</div>
        </div>
        <div className="stat">
          <div className="lbl">Notes</div>
          <div className="val note">{counts.notes}</div>
        </div>
      </div>
      {clean && (
        <p className="empty empty--ok" data-clean="true">
          <b>No problems</b> in {last ? SCOPE_LABEL[last.scope].toLowerCase() : ''} — {last?.files.count ?? 0} {last?.files.count === 1 ? 'file' : 'files'} checked.
        </p>
      )}
      {last && last.partial.length > 0 && (
        <div>
          <h3 className="summary-title">Partial run — not everything was checked</h3>
          <ul className="summary-list">
            {last.partial.map((p, i) => (
              <li key={`${p.kind}-${i}`} data-kind={p.kind}>
                {p.detail}
              </li>
            ))}
          </ul>
        </div>
      )}
      {tab !== 'overview' && (
        <p className="empty">
          {perSource[tab]} {tab} {perSource[tab] === 1 ? 'problem' : 'problems'}
          {order.length > 0 ? ' — press J or F8 to step through them.' : '.'}
        </p>
      )}
    </>
  );
}
