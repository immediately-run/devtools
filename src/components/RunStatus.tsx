// The run's own account of itself: what ran, over how much, and — when it fell short
// — exactly how (§7.2). A `partial` run renders the amber treatment with every reason
// named; it is structurally impossible to reach the clean-bill copy from here while
// `partial` is non-empty, which is the property G-TOOL-5 / G-TOOL-5b ask for.
import { useEffect, useState } from 'react';
import type { RunStatus as Status } from '../hooks/useProblemsRun';
import { SCOPE_LABEL } from '../lib/scope';
import { ClockIcon } from './Icons';

/** A clock the "ran 14s ago" label can read purely: sampled in state, ticked by an
 *  interval, never `Date.now()` during render. */
function useNow(tickMs = 5000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}

const ago = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
};

const kb = (units: number) => (units < 1024 ? `${units} chars` : `${Math.round(units / 1024)} KB`);

export default function RunStatus({ status }: { status: Status }) {
  const now = useNow();
  if (status.state === 'idle') return null;
  if (status.state === 'running') {
    return (
      <p className="runmeta" role="status">
        Running typecheck and lint — {SCOPE_LABEL[status.scope].toLowerCase()}…
      </p>
    );
  }
  if (status.state === 'failed') {
    return (
      <p className="partial" role="alert">
        <span>
          <b>The run failed.</b> {status.error}
        </span>
      </p>
    );
  }
  const r = status.result;
  const scope = SCOPE_LABEL[r.scope].toLowerCase();
  const fellBack = r.fellBackFrom !== undefined ? ` (${SCOPE_LABEL[r.fellBackFrom].toLowerCase()} was empty)` : '';
  return (
    <>
      <p className="runmeta" role="status" data-partial={r.partial.length > 0 ? 'true' : 'false'}>
        <span className={r.partial.length > 0 ? 'warn' : 'ok'}>{r.partial.length > 0 ? '◐ partial' : '✓ ran'}</span>
        <span>{ago(now - r.startedAt)}</span>
        <span>
          {r.files.count} {r.files.count === 1 ? 'file' : 'files'} · {kb(r.files.units)}
        </span>
        <span>{(r.durationMs / 1000).toFixed(1)}s</span>
        <span className="scope">
          {scope}
          {fellBack}
        </span>
      </p>
      {r.partial.length > 0 && (
        <div className="partial" role="note" aria-label="This run is partial">
          <ClockIcon />
          <div>
            <b>Partial run.</b> Not everything was checked:
            <ul>
              {r.partial.map((p, i) => (
                <li key={`${p.kind}-${i}`} data-kind={p.kind}>
                  {p.detail}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
