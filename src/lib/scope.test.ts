// Scope resolution (§7.2): the import closure, its bounds, and the fallback that
// refuses to report "0 problems" over zero files.
import { describe, expect, it } from 'vitest';
import { collectClosure, collectFlat, relativeSpecifiers, resolveCandidates, resolveScope, type ScopePorts } from './scope';

/** An in-memory tree as the fs port. */
function tree(files: Record<string, string>, lists: { changed?: string[]; open?: string[] } = {}): ScopePorts & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    readFile: async (p) => {
      reads.push(p);
      if (p in files) return files[p];
      throw Object.assign(new Error(`ENOENT ${p}`), { code: 'not-found' });
    },
    listSourceFiles: async () => Object.keys(files),
    changedPaths: () => lists.changed ?? [],
    openPaths: () => lists.open ?? [],
  };
}

describe('relativeSpecifiers', () => {
  it('finds static, re-export, dynamic and require specifiers; ignores packages; dedupes', () => {
    const src = `
      import a from './a';
      import { b } from "../lib/b.js";
      import * as c from './c';
      import './side.css';
      export { d } from './d';
      export * from './e';
      const f = await import('./f');
      const g = require('./g');
      import react from 'react';
      import { z } from 'zod';
      import a2 from './a';
      // import './commented'
    `;
    expect(relativeSpecifiers(src)).toEqual(['./a', '../lib/b.js', './c', './side.css', './d', './e', './f', './g', './commented']);
  });
});

describe('resolveCandidates', () => {
  it('tries the extensionless forms and index files, relative to the importing file', () => {
    expect(resolveCandidates('src/hooks/useTheme.ts', '../lib/compare')).toEqual([
      'src/lib/compare.ts',
      'src/lib/compare.tsx',
      'src/lib/compare.js',
      'src/lib/compare.jsx',
      'src/lib/compare.mts',
      'src/lib/compare.cts',
      'src/lib/compare/index.ts',
      'src/lib/compare/index.tsx',
      'src/lib/compare/index.js',
      'src/lib/compare/index.jsx',
    ]);
  });

  it('a .js specifier in TS source also means the .ts/.tsx file on disk', () => {
    expect(resolveCandidates('src/a.ts', './b.js').slice(0, 3)).toEqual(['src/b.js', 'src/b.ts', 'src/b.tsx']);
  });

  it('an asset specifier resolves to nothing — it is not a source file', () => {
    expect(resolveCandidates('src/a.ts', './logo.svg')).toEqual([]);
    expect(resolveCandidates('src/a.ts', './brand.css')).toEqual([]);
  });
});

describe('collectClosure — the default scope walks local imports', () => {
  const files = {
    'src/App.tsx': "import { greet } from './lib/greet';\nimport './app.css';\nexport const x = greet(1);",
    'src/lib/greet.ts': "import { fmt } from './fmt';\nexport const greet = (n: string) => fmt(n);",
    'src/lib/fmt.ts': 'export const fmt = (s: string) => s;',
    'src/unrelated.ts': 'export const u = 1;',
  };

  it('submits the seeds plus their transitive relative imports, breadth-first', async () => {
    const { files: out, truncated } = await collectClosure(['src/App.tsx'], tree(files));
    expect(out.map((f) => f.path)).toEqual(['src/App.tsx', 'src/lib/greet.ts', 'src/lib/fmt.ts']);
    expect(truncated).toBeNull();
  });

  it('submits every seed before any import, so a truncated run still checks what changed', async () => {
    const { files: out, truncated } = await collectClosure(['src/App.tsx', 'src/unrelated.ts'], tree(files), { maxFiles: 2 });
    expect(out.map((f) => f.path)).toEqual(['src/App.tsx', 'src/unrelated.ts']);
    // greet was discovered and dropped; fmt was never reached (it is behind greet).
    expect(truncated).toEqual({ dropped: 1, bound: 'files' });
  });

  it('names the count it dropped against the size bound', async () => {
    const { files: out, truncated } = await collectClosure(['src/App.tsx'], tree(files), { maxUnits: files['src/App.tsx'].length + 5 });
    expect(out.map((f) => f.path)).toEqual(['src/App.tsx']);
    expect(truncated).toEqual({ dropped: 1, bound: 'size' });
  });

  it('a deleted seed is skipped silently and a missing import is not retried', async () => {
    const t = tree({ 'src/a.ts': "import './gone';\nimport './gone';", 'src/b.ts': "import './gone';" });
    const { files: out } = await collectClosure(['src/a.ts', 'src/deleted.ts', 'src/b.ts'], t);
    expect(out.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    // Every candidate for './gone' is probed once for a.ts, then served from the miss cache for b.ts.
    const goneProbes = t.reads.filter((p) => p.startsWith('src/gone'));
    expect(new Set(goneProbes).size).toBe(goneProbes.length);
  });
});

describe('resolveScope — fallback says so, never a silent empty run', () => {
  const files = { 'src/a.ts': 'export const a = 1;', 'src/b.ts': 'export const b = 2;', 'README.md': '# hi', 'node_modules/x/index.ts': 'x' };

  it('changed files (source only, deletions already excluded) plus closure', async () => {
    const r = await resolveScope('changed', tree(files, { changed: ['src/a.ts', 'README.md'] }));
    expect(r.scope).toBe('changed');
    expect(r.fellBackFrom).toBeUndefined();
    expect(r.files.map((f) => f.path)).toEqual(['src/a.ts']);
  });

  it('an empty changed set falls back to open files, and records it', async () => {
    const r = await resolveScope('changed', tree(files, { open: ['/src/b.ts'] }));
    expect(r).toMatchObject({ scope: 'open', fellBackFrom: 'changed' });
    expect(r.files.map((f) => f.path)).toEqual(['src/b.ts']);
  });

  it('with nothing changed and nothing open it runs the whole project, sorted, skipping node_modules', async () => {
    const r = await resolveScope('changed', tree(files));
    expect(r).toMatchObject({ scope: 'project', fellBackFrom: 'changed' });
    expect(r.files.map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('the whole project is bounded and reports the drop', async () => {
    const many = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`src/f${i}.ts`, 'export {}']));
    const r = await resolveScope('project', tree(many), { maxFiles: 3 });
    expect(r.files).toHaveLength(3);
    expect(r.truncated).toEqual({ dropped: 2, bound: 'files' });
  });

  it('collectFlat dedupes and normalizes, and skips unreadable paths', async () => {
    const { files: out } = await collectFlat(['/src/a.ts', 'src/a.ts', 'src/missing.ts'], tree(files));
    expect(out.map((f) => f.path)).toEqual(['src/a.ts']);
  });
});
