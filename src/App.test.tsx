// R3-386's exit criterion, as a test: ONE entry point renders a DIFFERENT half per
// region, and the standalone load is not broken. This is the whole deliverable of
// the bootstrap item — everything else in the repo is scaffolding.
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

const useRegion = vi.fn<() => string | null>();
vi.mock('@immediately-run/sdk', () => ({ useRegion: () => useRegion() }));

const { default: App } = await import('./App');

describe('region branching', () => {
  beforeEach(() => useRegion.mockReset());

  it('renders the problems half in panel.tools', () => {
    useRegion.mockReturnValue('panel.tools');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Problems' })).toBeInTheDocument();
    expect(screen.getByText('panel.tools')).toBeInTheDocument();
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
