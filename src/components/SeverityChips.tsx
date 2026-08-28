// Severity filter chips carrying counts (§8.1). Toggling a chip hides its rows; the
// count stays, so what was filtered away is still visible. The default (notes off)
// lives in `lib/severityFilter.ts` — this file exports only the component (Fast Refresh).
import type { Counts, Severity } from '../lib/diagnostics';
import type { SeverityFilter } from '../lib/severityFilter';

const LABEL: Record<Severity, string> = { error: 'Errors', warning: 'Warnings', note: 'Notes' };
const KEY: Record<Severity, keyof Counts> = { error: 'errors', warning: 'warnings', note: 'notes' };

export default function SeverityChips({
  counts,
  filter,
  onChange,
}: {
  counts: Counts;
  filter: SeverityFilter;
  onChange: (next: SeverityFilter) => void;
}) {
  return (
    <div className="counts" role="group" aria-label="Filter by severity">
      {(['error', 'warning', 'note'] as Severity[]).map((sev) => (
        <button
          key={sev}
          type="button"
          className="chip"
          aria-pressed={filter[sev]}
          data-sev={sev}
          onClick={() => onChange({ ...filter, [sev]: !filter[sev] })}
        >
          <span className={`dot dot--${sev}`} aria-hidden="true" />
          {LABEL[sev]} <span className="n">{counts[KEY[sev]]}</span>
        </button>
      ))}
    </div>
  );
}
