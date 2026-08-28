// The stale label (§7.3, G-TOOL-6): a run whose covered paths were written stays on
// screen, dimmed, and says so — never presented as current, never silently dropped.
import { ClockIcon } from './Icons';

export default function StaleBanner({ stale, onRerun, running }: { stale: readonly string[]; onRerun: () => void; running: boolean }) {
  if (stale.length === 0) return null;
  const n = stale.length;
  return (
    <p className="stale" role="status" data-stale="true">
      <ClockIcon />
      <span>
        <b>Out of date.</b> {n} {n === 1 ? 'file' : 'files'} changed since this run
        {n <= 3 ? ` (${stale.join(', ')})` : ''}.
        <button type="button" onClick={onRerun} disabled={running}>
          Run again
        </button>
      </span>
    </p>
  );
}
