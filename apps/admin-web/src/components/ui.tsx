/**
 * Small presentational primitives shared by server and client components.
 * They take already-translated strings so they stay i18n-agnostic.
 */
import type { ReportStatus } from '@al-ummah/shared-types';

export function ErrorAlert({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div
      role="alert"
      data-testid={testId ?? 'error-alert'}
      className="bg-danger-bg border border-danger-border text-danger-fg px-4 py-3 rounded mb-6"
    >
      {children}
    </div>
  );
}

const chipClasses: Record<ReportStatus, string> = {
  pending: 'bg-chip-pending-bg text-chip-pending-fg',
  reviewing: 'bg-chip-reviewing-bg text-chip-reviewing-fg',
  resolved: 'bg-chip-resolved-bg text-chip-resolved-fg',
  dismissed: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
};

export function StatusChip({ status, label, large = false }: { status: ReportStatus; label: string; large?: boolean }) {
  return (
    <span
      data-testid="status-chip"
      data-status={status}
      className={`${large ? 'px-3 py-1' : 'px-2 py-1 text-sm'} rounded font-medium ${chipClasses[status] ?? chipClasses.dismissed}`}
    >
      {label}
    </span>
  );
}

export const cardClass = 'bg-surface border border-border rounded-lg p-6';
export const linkClass =
  'text-link hover:text-link-hover underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded';
export const primaryButtonClass =
  'inline-block bg-accent hover:bg-accent-hover text-on-accent font-medium py-3 px-6 rounded transition-colors text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-focus';
export const secondaryButtonClass =
  'inline-block bg-surface-2 hover:bg-surface-hover text-fg border border-border font-medium py-3 px-6 rounded transition-colors text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-focus';
export const fieldClass =
  'bg-surface-2 text-fg border border-border rounded px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
