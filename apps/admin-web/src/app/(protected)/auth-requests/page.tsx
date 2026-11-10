import Link from 'next/link';
import { getI18n } from '@/i18n/server';
import { formatDate, translateDynamic } from '@/i18n/translate';
import { listAuthRequests } from '@/lib/api/auth-requests';
import { AUTH_REQUEST_STATUSES, authRequestNeedsAttention, type AuthRequestList, type AuthRequestStatus } from '@/lib/api/auth-request-types';
import { ErrorAlert, cardClass, fieldClass, linkClass, secondaryButtonClass } from '@/components/ui';
import { AuthRequestStatusChip, DeliveryChip } from '@/components/auth-requests/AuthRequestStatusChip';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** Every moderation request sent to auth, newest first, with live status. */
export default async function AuthRequestsPage({ searchParams }: { searchParams: Promise<{ status?: string; delivery?: string }> }) {
  const { t, locale } = await getI18n();
  const { status: rawStatus, delivery: rawDelivery } = await searchParams;
  const status = (AUTH_REQUEST_STATUSES as readonly string[]).includes(rawStatus ?? '') ? (rawStatus as AuthRequestStatus) : undefined;
  const delivery = rawDelivery === 'failed' ? 'failed' : undefined;
  let list: AuthRequestList | null = null;
  try {
    list = await listAuthRequests({ status, delivery, limit: 100 });
  } catch (error) {
    logger.error('[auth-requests] Failed to load', { error: error instanceof Error ? error.message : String(error) });
  }
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-fg">{t('authRequests.title')}</h1>
        <p className="text-fg-muted mt-2 max-w-prose">{t('authRequests.subtitle')}</p>
      </div>
      <form method="get" className="mb-6 flex flex-wrap items-end gap-3">
        <label>
          <span className="sr-only">{t('authRequests.colStatus')}</span>
          <select name="status" defaultValue={status ?? ''} className={fieldClass}>
            <option value="">{t('authRequests.allStatuses')}</option>
            {AUTH_REQUEST_STATUSES.map((s) => (
              <option key={s} value={s}>{translateDynamic(t, 'authRequests.status', s)}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="sr-only">{t('authRequests.deliveryFilterFailed')}</span>
          <select name="delivery" defaultValue={delivery ?? ''} className={fieldClass}>
            <option value="">{t('authRequests.allDeliveries')}</option>
            <option value="failed">{t('authRequests.deliveryFilterFailed')}</option>
          </select>
        </label>
        <button type="submit" className={secondaryButtonClass}>{t('authRequests.filter')}</button>
      </form>
      {!list && <ErrorAlert testId="auth-requests-error">{t('authRequests.loadFailed')}</ErrorAlert>}
      {!!list?.needsAttention && !delivery && (
        <ErrorAlert testId="auth-requests-needs-attention">
          {t('authRequests.needsAttention', { count: list.needsAttention })}{' '}
          <Link href="/auth-requests?delivery=failed" className={linkClass}>{t('authRequests.showNeedsAttention')}</Link>
        </ErrorAlert>
      )}
      {list && list.requests.length === 0 && <p className="text-fg-muted" data-testid="auth-requests-empty">{t('authRequests.empty')}</p>}
      {list && list.requests.length > 0 && (
        <div className={`${cardClass} overflow-x-auto p-0`}>
          <table className="w-full text-sm" data-testid="auth-requests-table">
            <thead className="text-start text-fg-muted">
              <tr>
                <th className="p-3 text-start font-medium">{t('authRequests.colDate')}</th>
                <th className="p-3 text-start font-medium">{t('authRequests.colUser')}</th>
                <th className="p-3 text-start font-medium">{t('authRequests.colAction')}</th>
                <th className="p-3 text-start font-medium">{t('authRequests.colStatus')}</th>
                <th className="p-3 text-start font-medium">{t('authRequests.colDecision')}</th>
              </tr>
            </thead>
            <tbody>
              {list.requests.map((r) => (
                <tr key={r.id} className="border-t border-border" data-testid="auth-requests-row" data-request-id={r.id} data-delivery={r.delivery.status} data-status={r.status ?? ''}>
                  <td className="p-3 whitespace-nowrap">{formatDate(r.createdAt, locale, true)}</td>
                  <td className="p-3">
                    <Link href={`/auth-requests/users/${encodeURIComponent(r.subjectUserId)}`} className={linkClass} dir="ltr">{r.subjectUserId}</Link>
                  </td>
                  <td className="p-3">{translateDynamic(t, 'authRequests.actions', r.action)}</td>
                  <td className="p-3">
                    {r.delivery.status === 'sent' && r.status ? (
                      <AuthRequestStatusChip status={r.status} label={translateDynamic(t, 'authRequests.status', r.status)} />
                    ) : (
                      <DeliveryChip status={r.delivery.status} label={translateDynamic(t, 'authRequests.delivery', r.delivery.status)} />
                    )}
                    {authRequestNeedsAttention(r) && r.delivery.status !== 'failed' && <span className="ms-1 text-danger-fg">!</span>}
                  </td>
                  <td className="p-3 text-fg-muted">{r.decisionNote ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
