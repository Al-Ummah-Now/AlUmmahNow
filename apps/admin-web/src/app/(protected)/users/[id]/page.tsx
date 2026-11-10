import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContentPermissions, getUser } from '@/lib/api/content';
import type { AdminContentPermission, UserDetailView } from '@/lib/api/content-types';
import { AdminApiError } from '@/lib/api/errors';
import { getAdminSession } from '@/lib/auth';
import { normalizeRole } from '@/lib/roles';
import { getI18n } from '@/i18n/server';
import { formatDate, formatNumber } from '@/i18n/translate';
import { ErrorAlert, linkClass } from '@/components/ui';
import { AuditCard, BackLink, Chip, MonoId, Notice, ReportsCard, SectionCard, StatGrid } from '@/components/content/parts';
import { JobsPanel } from '@/components/content/jobs';
import { UserAuthRequestsPanel } from '@/components/auth-requests/UserAuthRequestsPanel';
import { logger } from '@/lib/logger';
import { UserActions } from './UserActions';

export const dynamic = 'force-dynamic';

/** A videos user (api-videos profile). The Auth id is shown for reference only; nothing here changes the Auth account. */
export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, locale } = await getI18n();
  const back = <BackLink href="/users" label={t('content.back', { section: t('users.title') })} />;

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
          <h1 className="text-2xl sm:text-3xl font-bold text-fg break-words" dir="auto" data-testid="user-name">{u.displayName || u.userName || u.id}</h1>
          <p className="text-sm text-fg-muted flex flex-wrap gap-x-3">
            {u.userName && <span dir="ltr">@{u.userName}</span>}
            {u.email && <span dir="ltr">{u.email}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {u.isBanned && <Chip tone="bad" large testId="user-banned">{t('users.banned')}</Chip>}
          {u.profileDeleted && <Chip tone="neutral" large>{t('users.profileDeleted')}</Chip>}
        </div>
      </div>

      {u.isBanned && u.ban && (
        <Notice tone="bad" testId="user-banned-banner">
          <p>{t('users.bannedBanner', { date: formatDate(u.ban.bannedAt, locale, true) })}</p>
          {u.ban.reason && <p className="text-sm mt-1" dir="auto">{t('users.banReason', { reason: u.ban.reason })}</p>}
        </Notice>
      )}
      {u.profileDeleted && <Notice testId="user-profile-deleted">{t('users.profileDeletedBanner')}</Notice>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <SectionCard title={t('users.countsTitle')} id="user-counts">
            <StatGrid
              stats={[
                { label: t('users.countVideos'), value: formatNumber(u.counts.videos, locale) },
                { label: t('users.countPlaylists'), value: formatNumber(u.counts.playlists, locale) },
                { label: t('users.countSubscriptions'), value: formatNumber(u.counts.subscriptions, locale) },
                { label: t('users.countComments'), value: formatNumber(u.counts.comments, locale) },
              ]}
            />
            <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-fg-muted">{t('users.authId')}</dt>
                <dd><MonoId value={u.id} max={60} /></dd>
              </div>
              <div><dt className="text-fg-muted">{t('users.timezone')}</dt><dd className="text-fg" dir="ltr">{u.timezone ?? t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('users.colCreated')}</dt><dd className="text-fg">{u.createdAt ? formatDate(u.createdAt, locale, true) : t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('content.updated')}</dt><dd className="text-fg">{u.updatedAt ? formatDate(u.updatedAt, locale, true) : t('content.none')}</dd></div>
            </dl>
            {u.bio && <p className="mt-4 text-sm text-fg whitespace-pre-wrap break-words" dir="auto">{u.bio}</p>}
            <p className="mt-4 flex flex-wrap gap-4 text-sm">
              <Link href={`/videos?ownerId=${encodeURIComponent(u.id)}`} className={linkClass}>{t('users.videosTitle')}</Link>
              <Link href={`/playlists?ownerId=${encodeURIComponent(u.id)}`} className={linkClass}>{t('users.playlistsTitle')}</Link>
              <Link href={`/comments?userId=${encodeURIComponent(u.id)}`} className={linkClass}>{t('users.countComments')}</Link>
            </p>
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
