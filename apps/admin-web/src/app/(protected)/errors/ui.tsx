/**
 * Presentational pieces of the Errors pages (server and client safe).
 */

/** "TypeError: message", without repeating a name the message already starts with. */
export function errorTitle(g: { name: string | null; message: string }): string {
  return g.name && !g.message.startsWith(g.name) ? `${g.name}: ${g.message}` : g.message;
}

const statusChipClasses: Record<string, string> = {
  new: 'bg-danger-bg text-danger-fg',
  acknowledged: 'bg-chip-reviewing-bg text-chip-reviewing-fg',
  resolved: 'bg-chip-resolved-bg text-chip-resolved-fg',
  ignored: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
  open: 'bg-chip-pending-bg text-chip-pending-fg',
  retrying: 'bg-chip-reviewing-bg text-chip-reviewing-fg',
  dismissed: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
};

/** Error group status (new, acknowledged, resolved, ignored) or item status (open, retrying, resolved, dismissed). */
export function ErrorStatusChip({ status, label, testId = 'error-status-chip' }: { status: string; label: string; testId?: string }) {
  return (
    <span data-testid={testId} data-status={status} className={`px-2 py-1 text-sm rounded font-medium whitespace-nowrap ${statusChipClasses[status] ?? statusChipClasses.ignored}`}>
      {label}
    </span>
  );
}

/** Marks a release E2E test group. */
export function TestChip({ label }: { label: string }) {
  return (
    <span data-testid="error-test-chip" className="px-2 py-0.5 text-xs rounded font-medium bg-chip-pending-bg text-chip-pending-fg whitespace-nowrap">
      {label}
    </span>
  );
}

/**
 * Occurrences per day as an inline SVG polyline. Drawn left to right in
 * time order in both directions (a time axis is not mirrored in RTL).
 */
export function Sparkline({ values, label, width = 112, height = 28 }: { values: number[]; label: string; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="text-accent overflow-visible" style={{ direction: 'ltr' }} data-testid="error-sparkline">
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} className="stroke-border" strokeWidth="1" />
      {values.length > 0 && <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />}
    </svg>
  );
}

/** Hourly occurrences as bars, oldest on the left. Each bar carries its own title for hover. */
export function HourlyChart({ hours, label, barTitle }: { hours: { hour: string; occurrences: number }[]; label: string; barTitle: (h: { hour: string; occurrences: number }) => string }) {
  const width = 480;
  const height = 96;
  const max = Math.max(1, ...hours.map((h) => h.occurrences));
  const slot = hours.length ? width / hours.length : width;
  const bar = Math.max(1, slot - 2);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="w-full h-24 text-accent" preserveAspectRatio="none" style={{ direction: 'ltr' }} data-testid="error-hourly-chart">
      <line x1="0" y1={height - 0.5} x2={width} y2={height - 0.5} className="stroke-border" strokeWidth="1" />
      {hours.map((h, i) => {
        const barHeight = h.occurrences ? Math.max(2, (h.occurrences / max) * (height - 4)) : 0;
        return (
          <rect key={h.hour} x={i * slot + 1} y={height - barHeight} width={bar} height={barHeight} fill="currentColor" rx="1">
            <title>{barTitle(h)}</title>
          </rect>
        );
      })}
    </svg>
  );
}
