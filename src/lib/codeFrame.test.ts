// The code frame (§8.2): a tsc row gets a caret SPAN under its range, every other
// source a point — the one place §3.1's "end position is tsc-only" shows.
import { describe, expect, it } from 'vitest';
import { buildFrame, caretFor } from './codeFrame';
import type { Diagnostic } from './diagnostics';

const D = (over: Partial<Diagnostic>): Diagnostic => ({
  id: 'x',
  source: 'tsc',
  severity: 'error',
  path: 'src/use.ts',
  line: 2,
  column: 24,
  message: 'm',
  ...over,
});

const CONTENT = "import { greet } from './lib';\nexport const x = greet(42);\n// lib.ts → greet: (n: string) => number\n";

describe('caretFor', () => {
  it('spans the tsc range on the same line', () => {
    expect(caretFor(D({ endLine: 2, endColumn: 26 }), 'export const x = greet(42);')).toBe(' '.repeat(23) + '^^');
  });

  it('marks a point for eslint / build, and for a tsc span that ends on another line', () => {
    expect(caretFor(D({ source: 'eslint', column: 7 }), '  let stored = null;')).toBe(' '.repeat(6) + '^');
    expect(caretFor(D({ endLine: 3, endColumn: 2 }), 'export const x = greet(42);')).toBe(' '.repeat(23) + '^');
  });

  it('keeps tabs in the indent so the caret lines up under a tab-indented line', () => {
    expect(caretFor(D({ column: 3, endLine: 2, endColumn: 6 }), '\t\tfoo();')).toBe('\t\t^^^');
  });
});

describe('buildFrame', () => {
  it('shows context lines around the hit, the hit marked, the caret row right after it', () => {
    const rows = buildFrame(D({ endLine: 2, endColumn: 26 }), CONTENT, 1);
    expect(rows.map((r) => [r.line, r.kind])).toEqual([
      [1, 'context'],
      [2, 'hit'],
      [null, 'caret'],
      [3, 'context'],
    ]);
    expect(rows[2].text).toBe(' '.repeat(23) + '^^');
  });

  it('clamps a line past the end to the last line — a diagnostic outlives the edit that shortened its file', () => {
    const rows = buildFrame(D({ line: 999, column: 1 }), CONTENT, 1);
    expect(rows.find((r) => r.kind === 'hit')?.line).toBe(3);
  });

  it('yields nothing for an unlocated diagnostic or an empty file', () => {
    expect(buildFrame(D({ path: null, line: null, column: null }), CONTENT)).toEqual([]);
    expect(buildFrame(D({}), '')).toEqual([]);
  });

  it('handles CRLF and a missing trailing newline', () => {
    const rows = buildFrame(D({ line: 2, column: 1 }), 'a\r\nb\r\nc', 0);
    expect(rows.map((r) => r.text)).toEqual(['b', '^']);
  });
});
