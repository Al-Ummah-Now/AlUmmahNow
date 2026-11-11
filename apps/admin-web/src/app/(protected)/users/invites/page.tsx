import Link from '@/components/AppLink';
import { listInvites } from '@/lib/api/invites';
import { getContentPermissions } from '@/lib/api/content';
import { INVITE_STATUSES, type InviteListStatus, type InviteView } from '@/lib/api/invite-types';
import { getI18n } from '@/i18n/server';
import { formatDate } from '@/i18n/translate';
import { ErrorAlert, linkClass, primaryButtonClass } from '@/components/ui';
import { FilterForm } from '@/components/content/FilterForm';
import { BackLink, EmptyState, MonoId, PageHeader, tableWrapClass, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { pickParams, type SearchParams } from '@/components/content/query';
import { InviteActions } from '@/components/invites/InviteActions';
import { InviteStatusChip } from '@/components/invites/InviteStatusChip';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const DAY = 86_400_000;

/** Invites: people invited by email, with their status and Resend / Copy link / Revoke / Restore. */
export default async function InvitesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = pickParams(await searchParams, { q: 'text', status: INVITE_STATUSES, cursor: 'text' });
  const { t, locale } = await getI18n();

  let data: { items: InviteView[]; nextCursor: string | null } | null = null;
  let canManage = false;
  try {
    const [list, permissions] = await Promise.all([listInvites({ status: params.status as InviteListStatus | undefined, q: params.q, cursor: params.cursor }), getContentPermissions()]);
    data = list;
    canManage = permissions.includes('users:manage');
  } catch (e) {
    logger.error('[invites] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }

  return (
    <div>
      <BackLink href="/users" label={t('content.back', { section: t('users.title') })} />
      <PageHeader title={t('invites.title')} subtitle={t('invites.subtitle')} t={t}>
        {canManage && (
          <Link href="/users/invites/new" className={primaryButtonClass} data-testid="invite-new">
            {t('invites.inviteButton')}
          </Link>
        )}
      </PageHeader>
      <FilterForm
        action="/users/invites"
        label={t('invites.title')}
        testId="invites-filters"
        values={params}
        fields={[
          { kind: 'search', name: 'q', label: t('invites.searchLabel'), suggest: 'invite' },
          { kind: 'select', name: 'status', label: t('invites.statusLabel'), options: INVITE_STATUSES.map((s) => ({ value: s, label: t(`invites.status.${s}`) })) },
        ]}
      />
      {!data && <ErrorAlert testId="invites-error">{t('content.loadFailed')}</ErrorAlert>}
      {data && data.items.length === 0 && <EmptyState>{t('content.empty')}</EmptyState>}
      {data && data.items.length > 0 && (
        <div className={tableWrapClass}>
          <table className="w-full" data-testid="invites-table">
            <caption className="sr-only">{t('invites.tableCaption')}</caption>
            <thead className="border-b border-border">
              <tr>
                <th className={thClass} scope="col">{t('invites.colPerson')}</th>
                <th className={thClass} scope="col">{t('invites.colStatus')}</th>
                <th className={`${thClass} ${wideOnly}`} scope="col">{t('invites.colChannels')}</th>
                <th className={`${thClass} ${wideOnly}`} scope="col">{t('invites.colInvited')}</th>
                <th className={thClass} scope="col">{t('invites.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((inv) => {
                const daysLeft = inv.purgeAfter ? Math.max(0, Math.ceil((Date.parse(inv.purgeAfter) - Date.now()) / DAY)) : null;
                return (
                  <tr key={inv.id} className="border-b border-border last:border-0" data-testid="invite-row" data-invite-id={inv.id} data-user-id={inv.userId} data-status={inv.status}>
                    <td className={tdClass}>
                      <Link href={`/users/${encodeURIComponent(inv.userId)}`} className={`${linkClass} font-medium break-all`} dir="ltr" data-testid="invite-user-link">
                        {inv.email}
                      </Link>
                      {inv.name && <span className="block text-sm text-fg-muted" dir="auto">{inv.name}</span>}
                      <span className="block"><MonoId value={inv.userId} max={24} /></span>
                    </td>
                    <td className={tdClass}>
                      <div className="flex flex-col items-start gap-1">
                        <InviteStatusChip status={inv.status} t={t} />
                        {inv.status === 'invited' && inv.expiresAt && <span className="text-xs text-fg-muted">{t('invites.expiresAt', { date: formatDate(inv.expiresAt, locale) })}</span>}
                        {inv.delivery === 'sent' && <span className="text-xs text-fg-muted">{inv.emailSent ? t('invites.emailSent', { count: inv.sendCount }) : t('invites.emailNotSent')}</span>}
                        {inv.pendingOp && !inv.opError && <span className="text-xs text-fg-muted">{t('invites.pending')}</span>}
                        {(inv.deliveryError || inv.opError) && <span className="text-xs text-danger-fg break-words" dir="ltr">{inv.opError ?? inv.deliveryError}</span>}
                        {inv.deletedAt && <span className="text-xs text-fg-muted">{inv.purgeRequestedAt ? t('invites.queuedPurge') : t('invites.daysLeft', { days: daysLeft ?? 0 })}</span>}
                        {inv.deletedReason && <span className="text-xs text-fg-muted" dir="auto">{inv.deletedReason}</span>}
                      </div>
                    </td>
                    <td className={`${tdClass} ${wideOnly} text-sm`}>
                      <div className="flex flex-col gap-1">
                        <span className="text-fg-muted">{inv.role === 'creator' ? t('invites.roleCreator') : t('invites.roleViewer')}{inv.tierId ? ` · ${inv.tierId}` : ''}{inv.authRoles.includes('Scholar') ? ` · ${t('invites.scholar')}` : ''}</span>
                        {inv.channels.map((ch) => (
                          <Link key={ch.id} href={`/channels/${encodeURIComponent(ch.id)}`} className={linkClass} dir="auto" data-testid="invite-channel">
                            {ch.name}{ch.handle ? ` (@${ch.handle})` : ''}
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td className={`${tdClass} ${wideOnly} text-sm text-fg-muted whitespace-nowrap`}>
                      <time dateTime={inv.createdAt}>{formatDate(inv.createdAt, locale)}</time>
                      {inv.createdByEmail && <span className="block text-xs" dir="ltr">{t('invites.byWhom', { who: inv.createdByEmail })}</span>}
                    </td>
                    <td className={tdClass}>
                      <InviteActions invite={inv} canManage={canManage} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data?.nextCursor && (
        <nav className="flex justify-center mt-6" aria-label={t('content.pagination')}>
          <Link className={linkClass} href={`/users/invites?${new URLSearchParams({ ...(params.q ? { q: params.q } : {}), ...(params.status ? { status: params.status } : {}), cursor: data.nextCursor })}`}>
            {t('content.next')}
          </Link>
        </nav>
      )}
    </div>
  );
}
