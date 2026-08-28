// The run pipeline end-to-end over an in-memory tree and canned service replies —
// the shapes the kernel returns (`{ diagnostics: [...] }` OBJECTS, not arrays; string
// lint severities; R3-384's `truncated`/`total`/`skipped`) and the partial rules
// (G-TOOL-5, G-TOOL-5b).
import { describe, expect, it } from 'vitest';
import { isCleanBill, runTools, type RunPorts } from './run';

const RELATIVE_NOTE = (spec: string) =>
  `'${spec}' was not included in this typecheck request, so its exports are unchecked. This is not an error: include the file to check it.`;

function ports(
  files: Record<string, string>,
  replies: { typecheck?: unknown; lint?: unknown; typecheckError?: unknown; lintError?: unknown },
  lists: { changed?: string[]; open?: string[] } = {},
): RunPorts & { calls: Array<{ name: string; params: Record<string, unknown> }> } {
  const calls: Array<{ name: string; params: Record<string, unknown> }> = [];
  let t = 1000;
  return {
    calls,
    now: () => (t += 250),
    readFile: async (p) => {
      if (p in files) return files[p];
      throw new Error('ENOENT');
    },
    listSourceFiles: async () => Object.keys(files),
    changedPaths: () => lists.changed ?? [],
    openPaths: () => lists.open ?? [],
    invoke: async <T,>(name: string, params: Record<string, unknown>): Promise<T> => {
      calls.push({ name, params });
      if (name === 'authoring:typecheck') {
        if (replies.typecheckError) throw replies.typecheckError;
        return (replies.typecheck ?? { diagnostics: [], truncated: false, total: 0 }) as T;
      }
      if (name === 'authoring:lint') {
        if (replies.lintError) throw replies.lintError;
        return (replies.lint ?? { diagnostics: [], truncated: false, total: 0, skipped: [] }) as T;
      }
      throw new Error(`unexpected ${name}`);
    },
  };
}

const FILES = {
  'src/use.ts': "import { greet } from './lib';\nexport const x = greet(42);",
  'src/lib.ts': 'export const greet = (n: string) => n.length;',
};

describe('runTools', () => {
  it('submits the resolved scope to BOTH services as { files: [{ path, content }] } and merges the object replies', async () => {
    const p = ports(
      FILES,
      {
        typecheck: {
          diagnostics: [{ path: '/src/use.ts', start: 54, length: 2, category: 'error', code: 2345, messageText: 'nope' }],
          truncated: false,
          total: 1,
        },
        lint: { diagnostics: [{ path: '/src/lib.ts', line: 1, column: 8, ruleId: 'prefer-const', severity: 'warning', messageText: 'w' }], truncated: false, total: 1, skipped: [] },
      },
      { changed: ['src/use.ts'] },
    );
    const r = await runTools('changed', p);
    expect(p.calls.map((c) => c.name).sort()).toEqual(['authoring:lint', 'authoring:typecheck']);
    expect(p.calls[0].params).toEqual({ files: [{ path: 'src/use.ts', content: FILES['src/use.ts'] }, { path: 'src/lib.ts', content: FILES['src/lib.ts'] }] });
    expect(r.scope).toBe('changed');
    expect(r.coveredPaths).toEqual(['src/use.ts', 'src/lib.ts']);
    expect(r.files).toEqual({ count: 2, units: FILES['src/use.ts'].length + FILES['src/lib.ts'].length });
    expect(r.diagnostics.map((d) => [d.source, d.path, d.line, d.column, d.severity])).toEqual([
      ['tsc', 'src/use.ts', 2, 24, 'error'],
      ['eslint', 'src/lib.ts', 1, 8, 'warning'],
    ]);
    expect(r.partial).toEqual([]);
    expect(r.durationMs).toBeGreaterThan(0);
    expect(isCleanBill(r, 0)).toBe(false);
  });

  it('a run that found nothing and left nothing unchecked is the clean bill of health', async () => {
    const r = await runTools('changed', ports(FILES, {}, { changed: ['src/use.ts'] }));
    expect(r.partial).toEqual([]);
    expect(isCleanBill(r, 0)).toBe(true);
    expect(isCleanBill(r, 1)).toBe(false); // a live build error is a problem too
  });

  it('G-TOOL-5b — ANY relative coverage note makes the run partial, naming the count', async () => {
    const r = await runTools(
      'changed',
      ports(
        { 'src/use.ts': "import { greet } from './lib';" }, // ./lib does not exist on disk → the service says so
        { typecheck: { diagnostics: [{ path: '/src/use.ts', start: 22, length: 7, category: 'message', code: 2307, messageText: RELATIVE_NOTE('./lib') }], truncated: false, total: 1 } },
        { changed: ['src/use.ts'] },
      ),
    );
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toMatchObject({ severity: 'note', note: 'relative' });
    expect(r.partial).toEqual([expect.objectContaining({ kind: 'relative-coverage', count: 1 })]);
    expect(isCleanBill(r, 0)).toBe(false);
  });

  it('an asset or bundled note does NOT make the run partial', async () => {
    const r = await runTools(
      'changed',
      ports(
        FILES,
        {
          typecheck: {
            diagnostics: [
              { path: '/src/use.ts', start: 0, length: 1, category: 'message', code: 2307, messageText: RELATIVE_NOTE('./logo.svg') },
              { path: '/src/use.ts', start: 0, length: 1, category: 'message', code: 2307, messageText: "No bundled type declarations for 'zod', so its exports are unchecked. This is not an error: the typecheck runs against a fixed kernel type set, not node_modules." },
            ],
            truncated: false,
            total: 2,
          },
        },
        { changed: ['src/use.ts'] },
      ),
    );
    expect(r.partial).toEqual([]);
    expect(isCleanBill(r, 0)).toBe(true); // notes are not problems (G-TOOL-7)
  });

  it('G-TOOL-5 — service truncation is reported with the dropped count (R3-384 fields)', async () => {
    const r = await runTools(
      'changed',
      ports(
        FILES,
        {
          typecheck: { diagnostics: [{ path: '/src/use.ts', start: 0, length: 1, category: 'error', code: 1, messageText: 'e' }], truncated: true, total: 231 },
          lint: { diagnostics: [], truncated: true, total: 0, skipped: [{ path: '/src/lib.ts', reason: 'not-reached' }, { path: '/src/use.ts', reason: 'parse-error' }] },
        },
        { changed: ['src/use.ts'] },
      ),
    );
    expect(r.tscTotal).toBe(231);
    expect(r.partial.map((p) => p.kind)).toEqual(['tsc-truncated', 'eslint-skipped']);
    expect(r.partial[0]).toMatchObject({ count: 230, detail: expect.stringContaining('230') });
    expect(r.partial[1]).toMatchObject({ count: 2, detail: expect.stringMatching(/1 file not reached by lint; 1 file lint could not parse/) });
  });

  it('the legacy silent cap — exactly 200 rows and no `truncated` field — is "200 (service cap)", never a count', async () => {
    const two00 = Array.from({ length: 200 }, (_, i) => ({ path: '/src/use.ts', start: i, length: 1, category: 'error', code: 1, messageText: `e${i}` }));
    const r = await runTools('changed', ports(FILES, { typecheck: { diagnostics: two00 } }, { changed: ['src/use.ts'] }));
    expect(r.tscTotal).toBeNull();
    expect(r.partial).toEqual([expect.objectContaining({ kind: 'tsc-truncated', detail: expect.stringContaining('200 (service cap)') })]);
    expect(r.partial[0].count).toBeUndefined();
    // 199 is not the cap.
    const r2 = await runTools('changed', ports(FILES, { typecheck: { diagnostics: two00.slice(1) } }, { changed: ['src/use.ts'] }));
    expect(r2.partial).toEqual([]);
  });

  it('the scope bound is reported as the app dropping files, before any service is called', async () => {
    const many = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`src/f${i}.ts`, 'export {}']));
    const r = await runTools('project', ports(many, {}), { maxFiles: 3 });
    expect(r.partial).toEqual([expect.objectContaining({ kind: 'scope-truncated', count: 1, detail: expect.stringContaining('1 file not submitted') })]);
    expect(r.files.count).toBe(3);
  });

  it('one service failing is partial + a failure, the other still lands', async () => {
    const r = await runTools(
      'changed',
      ports(FILES, { typecheckError: Object.assign(new Error('timeout'), { code: 'service-timeout' }), lint: { diagnostics: [{ path: 'src/lib.ts', line: 1, column: 1, ruleId: 'x', severity: 'error', messageText: 'm' }] } }, { changed: ['src/use.ts'] }),
    );
    expect(r.failures).toEqual([{ source: 'tsc', code: 'service-timeout', message: 'timeout' }]);
    expect(r.partial).toEqual([expect.objectContaining({ kind: 'service-error', detail: 'typecheck did not run (service-timeout)' })]);
    expect(r.diagnostics.map((d) => d.source)).toEqual(['eslint']);
    expect(isCleanBill(r, 0)).toBe(false);
  });

  it('with no files at all (an empty project) it calls nothing and reports the fallback', async () => {
    const p = ports({}, {});
    const r = await runTools('changed', p);
    expect(p.calls).toEqual([]);
    expect(r).toMatchObject({ scope: 'project', fellBackFrom: 'changed', files: { count: 0, units: 0 } });
  });

  it('dedupes across sources on (path, line, column, message)', async () => {
    const r = await runTools(
      'changed',
      ports(
        FILES,
        {
          typecheck: { diagnostics: [{ path: '/src/lib.ts', start: 0, length: 1, category: 'error', code: 1, messageText: 'same' }] },
          lint: { diagnostics: [{ path: 'src/lib.ts', line: 1, column: 1, ruleId: 'r', severity: 'error', messageText: 'same' }] },
        },
        { changed: ['src/use.ts'] },
      ),
    );
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0].source).toBe('tsc');
  });
});
