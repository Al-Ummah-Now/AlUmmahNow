import type { AuthRequestStatus, DeliveryStatus } from '@/lib/api/auth-request-types';

/** Status chip for a request to auth, in the report chip colours. */
const classes: Record<AuthRequestStatus, string> = {
  pending: 'bg-chip-pending-bg text-chip-pending-fg',
  info_requested: 'bg-chip-reviewing-bg text-chip-reviewing-fg',
  approved: 'bg-chip-reviewing-bg text-chip-reviewing-fg',
  rejected: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
  actioned: 'bg-chip-resolved-bg text-chip-resolved-fg',
};

export function AuthRequestStatusChip({ status, label }: { status: AuthRequestStatus; label: string }) {
  return (
    <span data-testid="auth-request-status" data-status={status} className={`px-2 py-0.5 text-sm rounded font-medium ${classes[status] ?? classes.pending}`}>
      {label}
    </span>
  );
}

/** Before auth has it: sending (queued / retrying) or failed (needs a videos admin). */
export function DeliveryChip({ status, label }: { status: DeliveryStatus; label: string }) {
  const cls = status === 'failed' ? 'bg-danger-bg text-danger-fg' : 'bg-chip-reviewing-bg text-chip-reviewing-fg';
  return (
    <span data-testid="auth-request-delivery" data-delivery={status} className={`px-2 py-0.5 text-sm rounded font-medium ${cls}`}>
      {label}
    </span>
  );
}
