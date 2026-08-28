// The read-only code frame (TOOLS_ACTIVITY_SPEC §8.2): a few lines of the file around
// the selected diagnostic, the hit line marked, and — for `tsc` only, the one source
// that carries an end position (§3.1 rule 2) — a caret row UNDER the span. Every other
// source marks a point. Pure: content in, rows out.

import type { Diagnostic } from './diagnostics';

export interface FrameRow {
  /** 1-indexed line number, or `null` for the caret row. */
  line: number | null;
  text: string;
  kind: 'context' | 'hit' | 'caret';
}

export const CONTEXT_LINES = 3;

/** Caret text for a diagnostic on `lineText`: a span (`^^^`) for a tsc row whose end is
 *  on the same line, a point (`^`) otherwise. Column-1 spaces first; tabs are kept so
 *  the caret lines up under a tab-indented line in a monospace frame. */
export function caretFor(d: Diagnostic, lineText: string): string {
  const col = Math.max(1, d.column ?? 1);
  const indent = lineText.slice(0, col - 1).replace(/[^\t]/g, ' ');
  const spanEnd = d.source === 'tsc' && d.endLine === d.line && typeof d.endColumn === 'number' ? d.endColumn : col + 1;
  const width = Math.max(1, spanEnd - col);
  return indent + '^'.repeat(width);
}

/**
 * Rows for `d` over `content`. A `line` past the end clamps to the last line (a
 * diagnostic outlives the edit that shortened its file — the same rule the editor's
 * open applies). Unlocated diagnostics yield no rows.
 */
export function buildFrame(d: Diagnostic, content: string, context = CONTEXT_LINES): FrameRow[] {
  if (d.line === null || content === '') return [];
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '' && content.endsWith('\n')) lines.pop();
  if (lines.length === 0) return [];
  const hit = Math.min(d.line, lines.length);
  const from = Math.max(1, hit - context);
  const to = Math.min(lines.length, hit + context);
  const rows: FrameRow[] = [];
  for (let n = from; n <= to; n++) {
    rows.push({ line: n, text: lines[n - 1], kind: n === hit ? 'hit' : 'context' });
    if (n === hit) rows.push({ line: null, text: caretFor(d, lines[n - 1]), kind: 'caret' });
  }
  return rows;
}
