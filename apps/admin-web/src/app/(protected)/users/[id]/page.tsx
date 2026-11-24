import Link from '@/components/AppLink';
import { notFound } from 'next/navigation';
import { getContentPermissions, getUser } from '@/lib/api/content';
import type { AdminContentPermission, UserDetailView } from '@/lib/api/content-types';
import { AdminApiError } from '@/lib/api/errors';
import { getAdminSession } from '@/lib/auth';
import { canManageBilling, canManageCreators, canReadBilling, normalizeRole } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatNumber } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { AuditCard } from '@/components/audit/AuditCard';
import { BackLink, Chip, MonoId, Notice, ReportsCard, SectionCard, StatGrid, smallButtonClass } from '@/components/content/parts';
import { JobsPanel } from '@/components/content/jobs';
import { UserAuthRequestsPanel } from '@/components/auth-requests/UserAuthRequestsPanel';
import { UserCreatorTierPanel } from '@/components/creators/UserCreatorTierPanel';
import { UserCaptionMinutesPanel } from '@/components/creators/UserCaptionMinutesPanel';
import { UserBillingPanel } from '@/components/payments/UserBillingPanel';
import { logger } from '@/lib/logger';
import { UserActions } from './UserActions';
import { InviteStatusChip } from '@/components/invites/InviteStatusChip';
import { adminUserName } from '@/lib/user-name';

import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
export const dynamic = 'force-dynamic';

/** A videos user (api-videos profile). The Auth id is shown for reference only; nothing here changes the Auth account. */
export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, locale } = await getI18n();
  const back = <BackLink href="/users" label={t('content.back', { section: t('users.backName') })} />;

  let user: UserDetailView | null = null;
  let permissions: AdminContentPermission[] = [];
  try {
    [user, permissions] = await Promise.all([getUser(id), getContentPermissions()]);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    logger.error('[users] Failed to load user', { id, error: e instanceof Error ? e.message : String(e) });
  }
  if (!user) {
    return (
      <div>
        {back}
        <ErrorAlert testId="user-error">{t('content.detailFailed')}</ErrorAlert>
      </div>
    );
  }
  const role = normalizeRole((await getAdminSession())?.user.role);
  const u = user;
  const uid = encodeURIComponent(u.id);
  const channelsHref = `/channels?ownerId=${uid}`;
  const videosHref = `/videos?ownerId=${uid}`;
  const playlistsHref = `/playlists?ownerId=${uid}`;
  const commentsHref = `/comments?userId=${uid}`;

  return (
    <div data-testid="user-detail" data-user-id={u.id} data-banned={u.isBanned ? 'true' : 'false'}>
      {back}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-4">
        {u.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote avatar from the images CDN
          <img src={u.avatarUrl} alt="" className="h-16 w-16 rounded-full object-cover bg-surface-2" />
        ) : (
          <span aria-hidden="true" className="h-16 w-16 rounded-full bg-surface-2 block" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl font-bold text-fg break-words" dir="auto" data-testid="user-name">{adminUserName(u, t('auditLog.unknownUser'))}</h1>
          <p className="text-sm text-fg-muted flex flex-wrap gap-x-3">
            {/* No @handle under a person: handles belong to channels (owner rule) */}
            {u.email && <span dir="ltr" data-testid="user-email" data-source={u.emailSource}>{u.email}</span>}
            {u.emailSource === 'none' && <span data-testid="user-no-account">{t('users.noAccount')}</span>}
            {u.emailSource === 'unavailable' && <span data-testid="user-email-unavailable">{t('users.emailUnavailable')}</span>}
            {u.profileEmail && <span data-testid="user-profile-email">{fillNodes(t('users.profileEmail'), { email: <bdi dir="ltr">{u.profileEmail}</bdi> })}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {u.isBanned && <Chip tone="bad" large testId="user-banned">{t('users.banned')}</Chip>}
          {u.profileDeleted && <Chip tone="neutral" large>{t('users.profileDeleted')}</Chip>}
          {u.invite && u.invite.status !== 'active' && <InviteStatusChip status={u.invite.status} t={t} large />}
        </div>
      </div>

      {u.isBanned && u.ban && (
        <Notice tone="bad" testId="user-banned-banner">
          <p>{fillNodes(t('users.bannedBanner'), { date: <LocalTime value={u.ban.bannedAt} withTime /> })}</p>
          {u.ban.reason && <p className="text-sm mt-1" dir="auto">{t('users.banReason', { reason: u.ban.reason })}</p>}
        </Notice>
      )}
      {u.profileDeleted && <Notice testId="user-profile-deleted">{t('users.profileDeletedBanner')}</Notice>}
      {u.invite && u.invite.status !== 'active' && (
        <Notice testId="user-invite">
          <p>{fillNodes(t('invites.userInvited'), { date: u.createdAt ? <LocalTime value={u.createdAt} /> : '' })}</p>
          <Link href={`/users/invites?q=${encodeURIComponent(u.invite.id)}`} className={linkClass} data-testid="user-invite-manage">{t('invites.manage')}</Link>
        </Notice>
      )}

      <UserCreatorTierPanel userId={u.id} userName={adminUserName(u, t('auditLog.unknownUser'))} canManage={canManageCreators(role)} />
      <UserCaptionMinutesPanel userId={u.id} canManage={canManageCreators(role)} />
      {canReadBilling(role) && <UserBillingPanel userId={u.id} canManage={canManageBilling(role)} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <SectionCard title={t('users.countsTitle')} id="user-counts">
            <StatGrid
              stats={[
                { label: t('users.countChannels'), value: formatNumber(u.channels.length, locale), href: channelsHref, linkTestId: 'user-stat-channels-link' },
                { label: t('users.countVideos'), value: formatNumber(u.counts.videos, locale), href: videosHref, linkTestId: 'user-stat-videos-link' },
                { label: t('users.countPlaylists'), value: formatNumber(u.counts.playlists, locale), href: playlistsHref, linkTestId: 'user-stat-playlists-link' },
                { label: t('users.countComments'), value: formatNumber(u.counts.comments, locale), href: commentsHref, linkTestId: 'user-stat-comments-link' },
                { label: t('users.countSubscriptions'), value: formatNumber(u.counts.subscriptions, locale) },
              ]}
            />
            <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-fg-muted">{t('users.authId')}</dt>
                <dd><MonoId value={u.id} max={60} /></dd>
              </div>
              <div><dt className="text-fg-muted">{t('users.timezone')}</dt><dd className="text-fg" dir="ltr">{u.timezone ?? t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('users.colCreated')}</dt><dd className="text-fg">{u.createdAt ? <LocalTime value={u.createdAt} withTime /> : t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('content.updated')}</dt><dd className="text-fg">{u.updatedAt ? <LocalTime value={u.updatedAt} withTime /> : t('content.none')}</dd></div>
            </dl>
            {u.bio && <p className="mt-4 text-sm text-fg whitespace-pre-wrap break-words" dir="auto">{u.bio}</p>}
            <nav aria-label={t('users.contentNav')} className="mt-4 flex flex-wrap gap-2">
              <Link href={channelsHref} className={smallButtonClass} data-testid="user-channels-link">{t('users.viewChannels')}</Link>
              <Link href={videosHref} className={smallButtonClass} data-testid="user-videos-link">{t('users.videosTitle')}</Link>
              <Link href={playlistsHref} className={smallButtonClass} data-testid="user-playlists-link">{t('users.playlistsTitle')}</Link>
              <Link href={commentsHref} className={smallButtonClass} data-testid="user-comments-link">{t('users.countComments')}</Link>
              <Link href={`/moderation?reporter_id=${encodeURIComponent(u.id)}`} className={smallButtonClass} data-testid="user-reports-filed-link">{t('users.viewReportsFiled')}</Link>
            </nav>
          </SectionCard>

          <SectionCard title={t('users.channelsTitle')} id="user-channels" testId="user-channels">
            {u.channels.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('users.channelsEmpty')}</p>
            ) : (
              <ul className="divide-y divide-border">
                {u.channels.map((ch) => (
                  <li key={ch.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/channels/${encodeURIComponent(ch.id)}`} className={`${linkClass} break-words`} dir="auto">{ch.name || ch.id}</Link>
                    <span className="flex flex-wrap gap-1">
                      {ch.isSuspended && <Chip tone="bad">{t('channels.suspended')}</Chip>}
                      {ch.isVerified && <Chip tone="good">{t('channels.verified')}</Chip>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <UserActions
            user={{ id: u.id, displayName: u.displayName, userName: u.userName, bio: u.bio, isBanned: u.isBanned, profileDeleted: !!u.profileDeleted }}
            permissions={permissions}
          />

          {/* Requests to Auth (a separate app) about this person's account, owned by the auth-requests feature */}
          <section data-slot="user-actions-extensions">
            <UserAuthRequestsPanel subjectUserId={u.id} canRequest={role === 'admin' || role === 'super_admin'} />
          </section>
        </div>

        <div className="space-y-6">
          <JobsPanel jobs={u.jobs} permissions={permissions} />
          <ReportsCard reports={u.reports} t={t} locale={locale} />
          <AuditCard entries={u.audit} t={t} locale={locale} />
        </div>
      </div>
    </div>
  );
}
