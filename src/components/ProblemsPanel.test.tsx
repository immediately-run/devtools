// The panel over an in-memory tree and canned service replies — no SDK mock, the
// ports ARE the seam. What is asserted here is the surface's honesty: the partial
// treatment, the clean-bill gate, the chips not counting notes, and the row click
// being the (only) thing that asks the host to open.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic } from '../lib/diagnostics';
import type { RunPorts } from '../lib/run';
import ProblemsPanel from './ProblemsPanel';

const RELATIVE_NOTE = "'./lib' was not included in this typecheck request, so its exports are unchecked. This is not an error: include the file to check it.";
const BUNDLED_NOTE = "No bundled type declarations for 'zod', so its exports are unchecked. This is not an error: the typecheck runs against a fixed kernel type set, not node_modules.";

const FILES: Record<string, string> = {
  'src/use.ts': "import { greet } from './lib';\nexport const x = greet(42);",
  'src/lib.ts': 'export const greet = (n: string) => n.length;',
  'src/hooks/useTheme.ts': 'let stored = null;\nexport default stored;',
};

function ports(replies: { typecheck?: unknown; lint?: unknown } = {}): RunPorts {
  return {
    readFile: async (p) => {
      if (p in FILES) return FILES[p];
      throw new Error('ENOENT');
    },
    listSourceFiles: async () => Object.keys(FILES),
    changedPaths: () => ['src/use.ts', 'src/hooks/useTheme.ts'],
    openPaths: () => [],
    invoke: async <T,>(name: string): Promise<T> => {
      if (name === 'authoring:typecheck') return (replies.typecheck ?? { diagnostics: [], truncated: false, total: 0 }) as T;
      return (replies.lint ?? { diagnostics: [], truncated: false, total: 0, skipped: [] }) as T;
    },
  };
}

const TYPICAL = {
  typecheck: {
    diagnostics: [
      { path: '/src/use.ts', start: 54, length: 2, category: 'error', code: 2345, messageText: "Argument of type 'number' is not assignable to parameter of type 'string'." },
      { path: '/src/hooks/useTheme.ts', start: 4, length: 6, category: 'error', code: 2339, messageText: "Property 'getItem' does not exist on type 'never'." },
      { path: '/src/use.ts', start: 22, length: 7, category: 'message', code: 2307, messageText: BUNDLED_NOTE },
    ],
    truncated: false,
    total: 3,
  },
  lint: {
    diagnostics: [{ path: '/src/hooks/useTheme.ts', line: 1, column: 5, ruleId: 'prefer-const', severity: 'warning', messageText: "'stored' is never reassigned. Use 'const' instead." }],
    truncated: false,
    total: 1,
    skipped: [],
  },
};

const setup = (replies?: Parameters<typeof ports>[0], extra: Partial<React.ComponentProps<typeof ProblemsPanel>> = {}) => {
  const onOpen = vi.fn<(d: Diagnostic) => Promise<void>>().mockResolvedValue(undefined);
  const utils = render(<ProblemsPanel ports={ports(replies)} buildErrors={[]} onOpen={onOpen} {...extra} />);
  return { onOpen, ...utils };
};

describe('ProblemsPanel', () => {
  it('runs once on open and lists three sources grouped by file, with positions', async () => {
    setup(TYPICAL, { buildErrors: [{ message: 'Unexpected token', path: '/src/App.tsx', line: 28, column: 46 }] });
    const list = await screen.findByRole('listbox', { name: /problems by file/i });
    const groups = within(list).getAllByRole('group');
    // A→Z by path: src/App.tsx (build), src/hooks/useTheme.ts, src/use.ts. The notes
    // group is not rendered until the Notes chip is on (see the chips test).
    expect(groups.map((g) => g.querySelector('summary')?.textContent)).toEqual(['src/App.tsx1', 'src/hooks/useTheme.ts2', 'src/use.ts1']);
    expect(within(groups[0]).getByRole('option').textContent).toContain('build');
    expect(within(groups[0]).getByRole('option').textContent).toContain('28:46');
    const useTheme = within(groups[1]).getAllByRole('option');
    expect(useTheme[0].textContent).toContain('tsc · TS2339');
    expect(useTheme[0].textContent).toContain('1:5');
    expect(useTheme[1].textContent).toContain('eslint · prefer-const');
    expect(within(groups[2]).getByRole('option').textContent).toContain('2:24');
  });

  it('G-TOOL-7 — the chips count problems, never notes; notes are off by default and toggle on', async () => {
    const user = userEvent.setup();
    setup(TYPICAL);
    await screen.findByRole('listbox');
    const chips = screen.getByRole('group', { name: /filter by severity/i });
    expect(within(chips).getByRole('button', { name: /errors 2/i })).toHaveAttribute('aria-pressed', 'true');
    expect(within(chips).getByRole('button', { name: /warnings 1/i })).toHaveAttribute('aria-pressed', 'true');
    const notes = within(chips).getByRole('button', { name: /notes 1/i });
    expect(notes).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/coverage note/)).not.toBeInTheDocument();
    await user.click(notes);
    expect(screen.getByText(/1 coverage note/)).toBeInTheDocument();
    // Turning errors off hides the rows but keeps the count.
    await user.click(within(chips).getByRole('button', { name: /errors 2/i }));
    expect(screen.queryByText(/TS2345/)).not.toBeInTheDocument();
    expect(within(chips).getByRole('button', { name: /errors 2/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('the substring filter narrows by path or message', async () => {
    const user = userEvent.setup();
    setup(TYPICAL);
    await screen.findByRole('listbox');
    await user.type(screen.getByRole('textbox', { name: /filter problems/i }), 'usetheme');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    await user.clear(screen.getByRole('textbox', { name: /filter problems/i }));
    await user.type(screen.getByRole('textbox', { name: /filter problems/i }), 'zzz-nothing');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
  });

  it('a row click asks the host to open THAT diagnostic — the click is the gesture', async () => {
    const user = userEvent.setup();
    const { onOpen } = setup(TYPICAL);
    const list = await screen.findByRole('listbox');
    await user.click(within(list).getByText(/TS2345/).closest('button')!);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toMatchObject({ source: 'tsc', path: 'src/use.ts', line: 2, column: 24 });
    // and never during the run itself
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keyboard: arrows move the selection, Enter opens', async () => {
    const user = userEvent.setup();
    const { onOpen } = setup(TYPICAL);
    const list = await screen.findByRole('listbox');
    const rows = within(list).getAllByRole('option');
    rows[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    expect(rows[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe(rows[1].dataset.id);
    await user.keyboard('{End}');
    expect(rows[rows.length - 1]).toHaveFocus();
  });

  it('a clean run says "No problems" — and names the scope and file count it checked', async () => {
    setup();
    const clean = (await screen.findByText(/no problems/i)).closest('p')!;
    expect(clean).toHaveAttribute('data-clean', 'true');
    expect(clean.textContent).toMatch(/changed files \+ imports/i);
    expect(clean.textContent).toMatch(/3 files checked/i);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('G-TOOL-5b — a relative coverage note makes the run partial: the banner names it and "No problems" never renders', async () => {
    setup({
      typecheck: { diagnostics: [{ path: '/src/use.ts', start: 22, length: 7, category: 'message', code: 2307, messageText: RELATIVE_NOTE }], truncated: false, total: 1 },
    });
    const banner = await screen.findByRole('note', { name: /partial/i });
    expect(banner.textContent).toMatch(/1 import was not checked/);
    expect(screen.queryByText(/no problems/i)).not.toBeInTheDocument();
    expect(screen.getByText(/nothing found in the files that were checked/i)).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toMatch(/partial/);
  });

  it('G-TOOL-5 — input truncation names the dropped count and marks the run partial', async () => {
    setup({ typecheck: { diagnostics: [], truncated: true, total: 240 } });
    const banner = await screen.findByRole('note', { name: /partial/i });
    expect(banner.textContent).toMatch(/240 diagnostics \(service cap\)/);
    expect(screen.queryByText(/no problems/i)).not.toBeInTheDocument();
  });

  it('a build error alone (no run yet) still shows, live', () => {
    setup({}, { autoRun: false, buildErrors: [{ message: 'ReferenceError: x is not defined' }] });
    expect(screen.getByText(/not file-located/i)).toBeInTheDocument();
    expect(screen.getByRole('option').textContent).toContain('ReferenceError');
  });

  it('a failed open is reported, not swallowed', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn<(d: Diagnostic) => Promise<void>>().mockRejectedValue(Object.assign(new Error('gone'), { code: 'not-found' }));
    render(<ProblemsPanel ports={ports(TYPICAL)} buildErrors={[]} onOpen={onOpen} />);
    const list = await screen.findByRole('listbox');
    await user.click(within(list).getAllByRole('option')[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer in the working tree/i);
  });
});
