// R3-386's exit criterion, as a test: ONE entry point renders a DIFFERENT half per
// region, and the standalone load is not broken. R3-390 fills the panel half in; the
// SDK is mocked to what a frame outside the workbench reports (no fs, empty channels).
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const useRegion = vi.fn<() => string | null>();
vi.mock('@immediately-run/sdk', () => ({
  useRegion: () => useRegion(),
  useHostTheme: () => 'dark',
  useDiagnostics: () => ({ buildErrors: [], consoleEntries: [], provenance: null }),
  onVcsStateChange: () => () => {},
  fsAvailable: () => false,
  waitForMount: () => Promise.reject(new Error('no mounts in this test')),
  openFs: () => {
    throw new Error('no fs in this test');
  },
  getVcsState: () => ({ changes: [], branch: null, prs: [], diffLoading: false }),
  getEditorContext: () => ({ dirtyPaths: [], openFiles: [], activeFile: null, viewedFile: null }),
  invoke: vi.fn(),
  openInEditor: vi.fn(),
}));

const { default: App } = await import('./App');

describe('region branching', () => {
  beforeEach(() => useRegion.mockReset());

  it('renders the problems half in panel.tools', () => {
    useRegion.mockReturnValue('panel.tools');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Problems' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run/i })).toBeInTheDocument();
  });

  it('the problems half without a working tree says so instead of running', async () => {
    useRegion.mockReturnValue('panel.tools');
    render(<App />);
    expect(await screen.findByText(/no working tree here/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run/i })).toBeDisabled();
  });

  it('renders the runner half in mainpane.tools', () => {
    useRegion.mockReturnValue('mainpane.tools');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument();
    expect(screen.getByText('mainpane.tools')).toBeInTheDocument();
  });

  it('the two halves are actually different — the branch is not decorative', () => {
    useRegion.mockReturnValue('panel.tools');
    const { container: panel } = render(<App />);
    const panelHtml = panel.innerHTML;
    useRegion.mockReturnValue('mainpane.tools');
    const { container: main } = render(<App />);
    expect(main.innerHTML).not.toBe(panelHtml);
  });

  it('standalone (no region) explains itself rather than rendering an empty shell', () => {
    useRegion.mockReturnValue(null);
    render(<App />);
    expect(screen.getByText('standalone')).toBeInTheDocument();
    expect(screen.getByText(/workbench surface/i)).toBeInTheDocument();
  });

  it('an unknown region falls back to the standalone explanation, not a blank frame', () => {
    useRegion.mockReturnValue('panel.somewhere-else');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Tools' })).toBeInTheDocument();
  });
});
