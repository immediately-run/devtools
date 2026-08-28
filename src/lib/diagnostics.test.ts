// The unified model (§3). The tsc offset case is driven by the REAL producer — the
// TypeScript compiler, whose `start`/`length` the kernel service forwards untouched —
// so a wrong belief about what an offset means cannot pass by agreeing with a fixture
// I typed (ways_of_working §4).
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  classifyNote,
  countBySeverity,
  dedupe,
  fromBuild,
  fromLint,
  fromTsc,
  groupByFile,
  locationLabel,
  matchesFilter,
  normalizePath,
  positionAt,
  type Diagnostic,
  type TscDiag,
} from './diagnostics';

/** Run the real compiler over one in-memory file and return its diagnostics in the
 *  service's `Diag` shape — the same forwarding the sandbox `typecheck.ts` does. */
function realTsc(path: string, content: string): TscDiag[] {
  const options: ts.CompilerOptions = { noEmit: true, strict: true, target: ts.ScriptTarget.ES2020, skipLibCheck: true, noLib: true };
  const base = ts.createCompilerHost(options);
  const host: ts.CompilerHost = {
    ...base,
    getSourceFile: (f, lang) => (f === path ? ts.createSourceFile(f, content, lang, true) : undefined),
    fileExists: (f) => f === path,
    readFile: (f) => (f === path ? content : undefined),
    writeFile: () => {},
  };
  const program = ts.createProgram([path], options, host);
  return ts.getPreEmitDiagnostics(program)
    .filter((d) => d.file && d.start !== undefined)
    .map((d) => ({
      path: d.file!.fileName,
      start: d.start!,
      length: d.length ?? 0,
      category: (['warning', 'error', 'suggestion', 'message'] as const)[d.category],
      code: d.code,
      messageText: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    }));
}

describe('fromTsc — offsets against the submitted content (rule 1)', () => {
  const path = 'src/use.ts';
  // A multi-line file with a CRLF-free layout and a multi-byte character BEFORE the
  // error, so a byte-based conversion would be off by one and a naive one by a line.
  const content = ['// café ☕', "const greet = (n: string) => n.length;", '', 'export const x = greet(42);', ''].join('\n');

  it('lands on the line and column TypeScript itself reports for the real diagnostic', () => {
    const diags = realTsc(path, content);
    expect(diags.length).toBeGreaterThan(0);
    const d = diags.find((x) => x.code === 2345)!;
    expect(d).toBeDefined();
    const out = fromTsc(d, () => content);
    const sf = ts.createSourceFile(path, content, ts.ScriptTarget.ES2020, true);
    const start = sf.getLineAndCharacterOfPosition(d.start);
    const end = sf.getLineAndCharacterOfPosition(d.start + d.length);
    expect({ line: out.line, column: out.column }).toEqual({ line: start.line + 1, column: start.character + 1 });
    expect({ line: out.endLine, column: out.endColumn }).toEqual({ line: end.line + 1, column: end.character + 1 });
    expect(out.line).toBe(4);
    expect(content.split('\n')[out.line! - 1].slice(out.column! - 1, out.endColumn! - 1)).toBe('42');
    expect(out).toMatchObject({ source: 'tsc', severity: 'error', code: 'TS2345', path: 'src/use.ts' });
  });

  it('carries endLine/endColumn (the tsc-only span) and no note for an error', () => {
    const out = fromTsc({ path: '/src/a.ts', start: 0, length: 3, category: 'error', code: 1, messageText: 'x' }, () => 'abc\ndef');
    expect(out).toMatchObject({ line: 1, column: 1, endLine: 1, endColumn: 4 });
    expect(out.note).toBeUndefined();
  });

  it('keeps a diagnostic about an unsubmitted path, at 1:1, rather than dropping it', () => {
    const out = fromTsc({ path: 'lib/x.d.ts', start: 40, length: 2, category: 'error', code: 1, messageText: 'x' }, () => undefined);
    expect(out).toMatchObject({ line: 1, column: 1 });
    expect(out.endLine).toBeUndefined();
  });

  it('maps categories: error, warning, and suggestion/message → note', () => {
    const mk = (category: TscDiag['category']) => fromTsc({ path: 'a.ts', start: 0, length: 1, category, code: 1, messageText: 'm' }, () => 'a').severity;
    expect(mk('error')).toBe('error');
    expect(mk('warning')).toBe('warning');
    expect(mk('suggestion')).toBe('note');
    expect(mk('message')).toBe('note');
  });

  it('clamps an offset past the end (a diagnostic outlives the edit that shortened its file)', () => {
    expect(positionAt('ab\ncd', 999)).toEqual({ line: 2, column: 3 });
    expect(positionAt('ab\ncd', -5)).toEqual({ line: 1, column: 1 });
  });
});

describe('classifyNote — which notes make the run partial (§3.2)', () => {
  // The two phrasings are the kernel's (`coverageNote` in sandbox typecheck.ts).
  const relative = "'./lib' was not included in this typecheck request, so its exports are unchecked. This is not an error: include the file to check it.";
  const asset = "'./logo.svg' was not included in this typecheck request, so its exports are unchecked. This is not an error: include the file to check it.";
  const bundled = "No bundled type declarations for 'zod', so its exports are unchecked. This is not an error: the typecheck runs against a fixed kernel type set, not node_modules.";

  it('a relative SOURCE import that was not submitted is `relative`', () => {
    expect(classifyNote(relative)).toBe('relative');
    expect(classifyNote(relative.replace("'./lib'", "'../hooks/useTheme'"))).toBe('relative');
    expect(classifyNote(relative.replace("'./lib'", "'./x.ts'"))).toBe('relative');
  });

  it('a relative ASSET import is `asset` — nothing a typecheck could ever check', () => {
    expect(classifyNote(asset)).toBe('asset');
    expect(classifyNote(asset.replace('logo.svg', 'brand.css'))).toBe('asset');
    expect(classifyNote(asset.replace('logo.svg', 'data.json'))).toBe('asset');
  });

  it('a package without bundled types is `bundled`; anything else `other`', () => {
    expect(classifyNote(bundled)).toBe('bundled');
    expect(classifyNote('Unreachable code detected.')).toBe('other');
  });

  it('fromTsc attaches the kind to message-level rows only', () => {
    const note = fromTsc({ path: 'a.ts', start: 0, length: 1, category: 'message', code: 2307, messageText: relative }, () => 'a');
    expect(note).toMatchObject({ severity: 'note', note: 'relative' });
  });
});

describe('fromLint / fromBuild', () => {
  it('lint severities pass through as the strings they arrive as (rule 3); a null ruleId is `parse`', () => {
    expect(fromLint({ path: '/src/a.ts', line: 7, column: 12, ruleId: 'eqeqeq', severity: 'warning', messageText: 'm' })).toMatchObject({
      source: 'eslint',
      severity: 'warning',
      path: 'src/a.ts',
      line: 7,
      column: 12,
      code: 'eqeqeq',
    });
    expect(fromLint({ path: 'a.ts', line: 1, column: 1, ruleId: null, severity: 'error', messageText: 'Parsing error: x' }).code).toBe('parse');
    expect(fromLint({ path: 'a.ts', line: 1, column: 1, ruleId: null, severity: 'error', messageText: 'x' }).endLine).toBeUndefined();
  });

  it('a build error with path AND line is located; anything less is not', () => {
    expect(fromBuild({ message: 'm', path: '/src/App.tsx', line: 28, column: 46 })).toMatchObject({ path: 'src/App.tsx', line: 28, column: 46, severity: 'error', source: 'build' });
    expect(fromBuild({ message: 'm', path: '/src/App.tsx', line: 28 })).toMatchObject({ path: 'src/App.tsx', line: 28, column: 1 });
    expect(fromBuild({ message: 'm', path: '/src/App.tsx' })).toMatchObject({ path: null, line: null, column: null });
    expect(fromBuild({ message: 'ReferenceError: x is not defined' })).toMatchObject({ path: null, line: null });
    expect(fromBuild({ message: 'm', line: 3 })).toMatchObject({ path: null });
  });
});

describe('normalizePath — one form for three sources (§3.3)', () => {
  it('strips the leading slash and the /app mount prefix, collapses . and ..', () => {
    expect(normalizePath('/src/App.tsx')).toBe('src/App.tsx');
    expect(normalizePath('src/App.tsx')).toBe('src/App.tsx');
    expect(normalizePath('/app/src/App.tsx')).toBe('src/App.tsx');
    expect(normalizePath('./src/../src/App.tsx')).toBe('src/App.tsx');
    expect(normalizePath('../../etc/passwd')).toBe('etc/passwd');
    expect(normalizePath('src\\win\\a.ts')).toBe('src/win/a.ts');
  });
});

const D = (over: Partial<Diagnostic> & Pick<Diagnostic, 'source' | 'severity'>): Diagnostic => ({
  id: `${over.source}:${over.path ?? '-'}:${over.line ?? '-'}:${over.column ?? '-'}:${Math.random()}`,
  path: 'src/a.ts',
  line: 1,
  column: 1,
  message: 'm',
  ...over,
});

describe('dedupe — (path, line, column) + message, build before tsc before eslint', () => {
  it('keeps the highest-ranked source of an identical row', () => {
    const rows = [
      D({ source: 'eslint', severity: 'warning', message: 'same' }),
      D({ source: 'tsc', severity: 'error', message: 'same' }),
      D({ source: 'build', severity: 'error', message: 'same' }),
    ];
    const out = dedupe(rows);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('build');
  });

  it('a different message at the same position is a different row', () => {
    const out = dedupe([D({ source: 'tsc', severity: 'error', message: 'a' }), D({ source: 'eslint', severity: 'error', message: 'b' })]);
    expect(out).toHaveLength(2);
  });

  it('never dedupes unlocated rows — two runtime errors are two events', () => {
    const out = dedupe([D({ source: 'build', severity: 'error', path: null, line: null, column: null }), D({ source: 'build', severity: 'error', path: null, line: null, column: null })]);
    expect(out).toHaveLength(2);
  });

  it('only compares after normalization — a build path with a slash meets a tsc path without', () => {
    const out = dedupe([fromBuild({ message: 'same', path: '/src/a.ts', line: 1, column: 1 }), fromTsc({ path: 'src/a.ts', start: 0, length: 1, category: 'error', code: 1, messageText: 'same' }, () => 'x')]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('build');
  });
});

describe('counts and grouping (§3.2 / §8.1 / G-TOOL-7)', () => {
  const rows = [
    D({ source: 'tsc', severity: 'error', path: 'src/b.ts', line: 9 }),
    D({ source: 'tsc', severity: 'note', note: 'relative', path: 'src/b.ts', line: 1 }),
    D({ source: 'eslint', severity: 'warning', path: 'src/a.ts', line: 3 }),
    D({ source: 'tsc', severity: 'error', path: 'src/a.ts', line: 1, column: 5 }),
    D({ source: 'tsc', severity: 'error', path: 'src/a.ts', line: 1, column: 2 }),
    D({ source: 'build', severity: 'error', path: null, line: null, column: null }),
    D({ source: 'tsc', severity: 'note', note: 'bundled', path: 'src/c.ts' }),
  ];

  it('notes are NOT counted as problems', () => {
    expect(countBySeverity(rows)).toEqual({ errors: 4, warnings: 1, notes: 2 });
  });

  it('groups by file A→Z, document order within a file, unlocated last, notes apart', () => {
    const { groups, notes } = groupByFile(rows);
    expect(groups.map((g) => g.path)).toEqual(['src/a.ts', 'src/b.ts', null]);
    expect(groups[0].rows.map((r) => `${r.line}:${r.column}`)).toEqual(['1:2', '1:5', '3:1']);
    expect(groups[1].rows).toHaveLength(1); // the note is not in the file's group
    expect(notes).toHaveLength(2);
  });

  it('filters over path, message and code, case-insensitively', () => {
    const d = D({ source: 'tsc', severity: 'error', path: 'src/Hooks/useTheme.ts', message: "Property 'getItem' does not exist", code: 'TS2339' });
    expect(matchesFilter(d, 'usetheme')).toBe(true);
    expect(matchesFilter(d, 'GETITEM')).toBe(true);
    expect(matchesFilter(d, 'ts2339')).toBe(true);
    expect(matchesFilter(d, 'zod')).toBe(false);
    expect(matchesFilter(d, '   ')).toBe(true);
  });

  it('locationLabel is line:column, empty when unlocated', () => {
    expect(locationLabel(D({ source: 'tsc', severity: 'error', line: 12, column: 24 }))).toBe('12:24');
    expect(locationLabel(D({ source: 'build', severity: 'error', path: null, line: null, column: null }))).toBe('');
  });
});
