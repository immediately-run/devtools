// Inline glyphs — the panel is an opaque-origin iframe, so nothing from the host's
// icon set is reachable; these mirror the approved design's strokes.
import type { Severity } from '../lib/diagnostics';

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 2 } as const;

export function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M7 4.5v15l13-7.5z" />
    </svg>
  );
}

export function FilterIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <path d="M4 5h16l-6 7v6l-4 2v-8z" />
    </svg>
  );
}

export function TriangleIcon() {
  return (
    <svg className="tri" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 4l10 8-10 8z" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" {...stroke} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function SeverityGlyph({ severity }: { severity: Severity }) {
  if (severity === 'error') {
    return (
      <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.4} aria-hidden="true">
        <path d="M12 7v6M12 16.5v.5" />
        <circle cx="12" cy="12" r="9" />
      </svg>
    );
  }
  if (severity === 'warning') {
    return (
      <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.4} aria-hidden="true">
        <path d="M12 3.5 21.5 20h-19z" />
        <path d="M12 10v4M12 17v.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" {...stroke} strokeWidth={2.4} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.5" />
    </svg>
  );
}
