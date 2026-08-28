// The runner (§8.2) over a real session and an in-memory tree: tabs count per
// source, the selected diagnostic renders in the code frame with a tsc caret span
// (a point for others), Open in editor is a fresh gesture, the summary shows when
// nothing is selected, a stale run is labelled and dimmed (G-TOOL-6), and J/K/F8
// traverse.
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RunnerPane from './RunnerPane';
import { useToolsSession } from '../hooks/useToolsSession';
import type { StalenessPorts } from '../hooks/useStaleness';
import type { Diagnostic } from '../lib/diagnostics';
import type { RunPorts } from '../lib/run';

const FILES: Record<string, string> = {
  'src/use.ts': "import { greet } from './lib';\nexport const x = greet(42);\n",
  'src/lib.ts': 'export const greet = (n: string) => n.length;\n',
};

function ports(): RunPorts {
  return {
    readFile: async (p) => {
      if (p in FILES) return FILES[p];
      throw new Error('ENOENT');
    },
    listSourceFiles: async () => Object.keys(FILES),
    changedPaths: () => ['src/use.ts'],
    openPaths: () => [],
    invoke: async <T,>(name: string): Promise<T> => {
      if (name === 'authoring:typecheck') {
        return {
          diagnostics: [{ path: '/src/use.ts', start: 54, length: 2, category: 'error', code: 2345, messageText: "Argument of type 'number' is not assignable to parameter of type 'string'." }],
          truncated: false,
          total: 1,
        } as T;
      }
      return { diagnostics: [{ path: '/src/lib.ts', line: 1, column: 14, ruleId: 'prefer-const', severity: 'warning', messageText: 'w' }], truncated: false, total: 1, skipped: [] } as T;
    },
  };
}

function watch() {
  const listeners = new Set<(p: string[]) => void>();
  const staleness: StalenessPorts = { watch: (cb) => (listeners.add(cb), () => listeners.delete(cb)), refreshDiff: async () => {} };
  return { staleness, write: (p: string[]) => listeners.forEach((l) => l(p)) };
}

function Harness({ p, staleness, onOpen, autoRun = true }: { p: RunPorts; staleness?: StalenessPorts; onOpen: (d: Diagnostic) => Promise<void> }) {
  const session = useToolsSession({ ports: p, staleness: staleness ?? null, autoRun });
  return <RunnerPane session={session} buildErrors={[]} onOpen={onOpen} readFile={(path) => p.readFile(path)} />;
}

const setup = (extra: { staleness?: StalenessPorts } = {}) => {
  const onOpen = vi.fn<(d: Diagnostic) => Promise<void>>().mockResolvedValue(undefined);
  render(<Harness p={ports()} onOpen={onOpen} {...extra} />);
  return { onOpen };
};

describe('RunnerPane', () => {
  it('shows the run summary with per-source tab counts when nothing is selected', async () => {
    setup();
    await screen.findByText(/✓ ran/);
    const tabs = screen.getByRole('tablist');
    expect(within(tabs).getByRole('tab', { name: /typecheck\s*1/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: /lint\s*1/i })).toBeInTheDocument();
    expect(within(tabs).getByRole('tab', { name: /build\s*0/i })).toBeInTheDocument();
    expect(screen.getByText('Errors').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByText('Warnings').nextElementSibling).toHaveTextContent('1');
    expect(screen.getByRole('status').textContent).toMatch(/2 files/);
  });

  it('J / F8 select the next problem; the tsc row renders a caret SPAN, the eslint row a point', async () => {
    const user = userEvent.setup();
    const { onOpen } = setup();
    await screen.findByText(/✓ ran/);
    screen.getByRole('region', { name: /tools runner/i }).focus();
    // Traversal is the panel's order: files A→Z, so src/lib.ts (eslint) comes first.
    await user.keyboard('j');
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('w');
    const frame = await screen.findByRole('figure');
    const caret = within(frame).getAllByRole('row').find((r) => r.className === 'caret')!;
    expect(caret.textContent!.trim()).toBe('^'); // eslint: a point
    expect(screen.getByText('src/lib.ts:1:14')).toBeInTheDocument();
    await user.keyboard('{F8}');
    const h2 = await screen.findByRole('heading', { level: 2 });
    expect(h2.textContent).toMatch(/Argument of type 'number'/);
    const frame2 = await screen.findByRole('figure', { name: /src\/use\.ts/ });
    const caret2 = within(frame2).getAllByRole('row').find((r) => r.className === 'caret')!;
    expect(caret2.textContent!.trim()).toBe('^^'); // tsc: the span
    expect(screen.getByText('src/use.ts:2:24')).toBeInTheDocument();
    await user.keyboard('{Shift>}{F8}{/Shift}');
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('w');
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toMatchObject({ path: 'src/lib.ts', line: 1, column: 14 });
  });

  it('Open in editor is an explicit control — the §5.2 fallback — and calls with the selected diagnostic', async () => {
    const user = userEvent.setup();
    const { onOpen } = setup();
    await screen.findByText(/✓ ran/);
    screen.getByRole('region', { name: /tools runner/i }).focus();
    await user.keyboard('j');
    await user.click(await screen.findByRole('button', { name: /open in editor/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].source).toBe('eslint');
  });

  it('a source tab narrows the traversal to that source', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByText(/✓ ran/);
    await user.click(screen.getByRole('tab', { name: /lint/i }));
    screen.getByRole('region', { name: /tools runner/i }).focus();
    await user.keyboard('j');
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('w');
    await user.keyboard('j'); // wraps within lint only
    expect((await screen.findByRole('heading', { level: 2 })).textContent).toBe('w');
  });

  it('G-TOOL-6 — a write to a covered file marks the run stale: labelled, dimmed, never current', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const w = watch();
    setup({ staleness: w.staleness });
    await screen.findByText(/✓ ran/);
    act(() => w.write(['src/lib.ts']));
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(await screen.findByText(/out of date/i)).toBeInTheDocument();
    expect(screen.getByText(/◔ stale/)).toBeInTheDocument();
    expect(document.querySelector('.pane')).toHaveClass('pane--stale');
    expect(screen.queryByText(/✓ ran/)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('with no working tree it explains itself and Run is disabled', () => {
    function NoTree() {
      const session = useToolsSession({ ports: null });
      return <RunnerPane session={session} buildErrors={[]} onOpen={vi.fn()} readFile={null} />;
    }
    render(<NoTree />);
    expect(screen.getAllByText(/no working tree here/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^run$/i })).toBeDisabled();
  });
});
