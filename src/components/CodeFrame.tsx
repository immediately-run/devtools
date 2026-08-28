// The read-only code frame (§8.2): the selected diagnostic in source context, the hit
// line marked, and a caret row under the span (tsc) or at the point (everything else).
// Read-only on purpose — two editable views of one file is the conflict surface
// EDITOR_AS_APP_SPEC §6 exists to keep small. The file is read from the working-tree
// mount at selection time, so a stale run shows the CURRENT text, which is the honest
// thing: the caret may no longer point at the problem, and the stale banner says so.
import { useEffect, useState } from 'react';
import type { Diagnostic } from '../lib/diagnostics';
import { type FrameRow, buildFrame } from '../lib/codeFrame';

export interface CodeFrameProps {
  diagnostic: Diagnostic;
  readFile: ((path: string) => Promise<string>) | null;
}

/** The last completed read, keyed by the diagnostic it was for — so a switch of
 *  selection renders "reading…" (a key mismatch) rather than the previous file. */
type Loaded = { key: string; rows: FrameRow[] } | { key: string; error: string };

export default function CodeFrame({ diagnostic, readFile }: CodeFrameProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const { id: key, path, line, severity } = diagnostic;

  // Derived, not state: the two cases that need no read.
  const unavailable = path === null || line === null ? 'This problem is not located in a file.' : !readFile ? 'No working tree to read from.' : null;

  useEffect(() => {
    if (unavailable || !readFile || path === null) return;
    let cancelled = false;
    readFile(path).then(
      (content) => {
        if (!cancelled) setLoaded({ key, rows: buildFrame(diagnostic, content) });
      },
      () => {
        if (!cancelled) setLoaded({ key, error: 'That file is no longer in the working tree.' });
      },
    );
    return () => {
      cancelled = true;
    };
    // `key` (the diagnostic id) is what a re-read follows; the object identity is not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, path, readFile, unavailable]);

  if (unavailable) {
    return (
      <div className="frame-code" data-severity={severity}>
        <p className="frame-empty">{unavailable}</p>
      </div>
    );
  }
  if (!loaded || loaded.key !== key) {
    return (
      <div className="frame-code" data-severity={severity} aria-busy="true">
        <p className="frame-empty">Reading {path}…</p>
      </div>
    );
  }
  if ('error' in loaded) {
    return (
      <div className="frame-code" data-severity={severity}>
        <p className="frame-empty">{loaded.error}</p>
      </div>
    );
  }
  return (
    <div className="frame-code" data-severity={severity} role="figure" aria-label={`${path} around line ${line}`}>
      <table>
        <tbody>
          {loaded.rows.map((r, i) => (
            <tr key={i} className={r.kind === 'hit' ? 'hit' : r.kind === 'caret' ? 'caret' : undefined}>
              <td className="ln">{r.line ?? ' '}</td>
              <td>{r.text || ' '}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
