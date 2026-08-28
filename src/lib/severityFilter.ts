import type { Severity } from './diagnostics';

/** Which severities the list shows. Notes are OFF by default — they are not problems
 *  (§3.2), and a chip that starts pressed would count them by eye. */
export type SeverityFilter = Record<Severity, boolean>;

export const DEFAULT_FILTER: SeverityFilter = { error: true, warning: true, note: false };
