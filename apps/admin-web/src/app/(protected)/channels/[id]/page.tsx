import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getChannel, getContentPermissions } from '@/lib/api/content';
import type { AdminContentPermission, ChannelDetailView } from '@/lib/api/content-types';
import { AdminApiError } from '@/lib/api/errors';
import { getI18n } from '@/i18n/server';
import { formatDate, formatNumber } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { AuditCard, BackLink, Chip, MonoId, Notice, ReportsCard, StatGrid } from '@/components/content/parts';
import { JobsPanel } from '@/components/content/jobs';
import { logger } from '@/lib/logger';
import { ChannelActions } from './ChannelActions';

export const dynamic = 'force-dynamic';

export default async function ChannelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, locale } = await getI18n();
  const back = <BackLink href="/channels" label={t('content.back', { section: t('channels.title') })} />;

  let channel: ChannelDetailView | null = null;
  let permissions: AdminContentPermission[] = [];
  try {
    [channel, permissions] = await Promise.all([getChannel(id), getContentPermissions()]);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) notFound();
    logger.error('[channels] Failed to load channel', { id, error: e instanceof Error ? e.message : String(e) });
  }
  if (!channel) {
    return (
      <div>
        {back}
        <ErrorAlert testId="channel-error">{t('content.detailFailed')}</ErrorAlert>
      </div>
    );
  }

  const ch = channel;
  return (
    <div data-testid="channel-detail" data-channel-id={ch.id} data-suspended={ch.isSuspended ? 'true' : 'false'}>
      {back}

      <div className="relative mb-6 overflow-hidden rounded-lg border border-border bg-surface">
        {ch.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote cover from the images CDN
          <img src={ch.coverUrl} alt="" className="h-28 sm:h-40 w-full object-cover" />
        ) : (
          <div className="h-20 sm:h-28 bg-surface-2" aria-hidden="true" />
        )}
        <div className="p-4 sm:p-6 flex flex-col sm:flex-row sm:items-end gap-4">
          {ch.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- remote avatar from the images CDN
            <img src={ch.avatarUrl} alt="" className="-mt-14 sm:-mt-16 h-20 w-20 rounded-full border-4 border-surface object-cover bg-surface-2" />
          ) : (
            <span aria-hidden="true" className="-mt-14 sm:-mt-16 h-20 w-20 rounded-full border-4 border-surface bg-surface-2 block" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl sm:text-3xl font-bold text-fg break-words" dir="auto" data-testid="channel-name">
              {ch.name || ch.id}
            </h1>
            <p className="text-fg-muted text-sm flex flex-wrap gap-x-3 gap-y-1">
              {ch.handle && <span dir="ltr" data-testid="channel-handle">@{ch.handle}</span>}
              <MonoId value={ch.id} max={40} />
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {ch.isSuspended && <Chip tone="bad" large>{t('channels.suspended')}</Chip>}
            {ch.isVerified && <Chip tone="good" large>{t('channels.verified')}</Chip>}
            {ch.isMain && <Chip tone="info" large>{t('channels.main')}</Chip>}
            {ch.isPrivate && <Chip tone="neutral" large>{t('channels.private')}</Chip>}
            {ch.isDeleted && <Chip tone="neutral" large>{t('channels.deleted')}</Chip>}
          </div>
        </div>
      </div>

      {ch.isDeleted && <Notice tone="bad" testId="channel-deleted">{t('channels.deletedNotice')}</Notice>}
      {ch.isSuspended && ch.suspension && (
        <Notice tone="bad" testId="channel-suspended-banner">
          <p>{t('channels.suspendedBanner', { date: formatDate(ch.suspension.at, locale, true) })}</p>
          {ch.suspension.reason && <p className="text-sm mt-1" dir="auto">{t('channels.suspendedReason', { reason: ch.suspension.reason })}</p>}
        </Notice>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className={cardClass} aria-label={t('channels.statVideos')}>
            <StatGrid
              stats={[
                { label: t('channels.statVideos'), value: formatNumber(ch.stats.videos, locale), testId: 'stat-videos' },
                { label: t('channels.statSubscribers'), value: formatNumber(ch.stats.subscribers, locale) },
                { label: t('channels.statViews'), value: formatNumber(ch.stats.views, locale) },
                { label: t('channels.statPlaylists'), value: formatNumber(ch.stats.playlists, locale) },
              ]}
            />
            <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-fg-muted">{t('channels.ownerLink')}</dt>
                <dd>
                  {ch.ownerId ? (
                    <Link href={`/users/${encodeURIComponent(ch.ownerId)}`} className={`${linkClass} break-all`} data-testid="channel-owner-link">
                      {ch.owner?.displayName || ch.ownerEmail || ch.ownerId}
                    </Link>
                  ) : (
                    t('content.none')
                  )}
                  {ch.ownerEmail && <span className="block text-fg-muted" dir="ltr">{ch.ownerEmail}</span>}
                  {ch.ownerId && !ch.owner && <span className="block text-fg-subtle">{t('channels.ownerUnknown')}</span>}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">{t('content.created')}</dt>
                <dd className="text-fg">{ch.createdAt ? formatDate(ch.createdAt, locale, true) : t('content.none')}</dd>
              </div>
            </dl>
            <p className="mt-4">
              <Link href={`/videos?channelId=${encodeURIComponent(ch.id)}`} className={linkClass} data-testid="channel-videos-link">
                {t('channels.viewVideos')}
              </Link>
            </p>
          </section>

          <ChannelActions
            channel={{ id: ch.id, name: ch.name, handle: ch.handle, description: ch.description, isVerified: ch.isVerified, isSuspended: ch.isSuspended, isDeleted: ch.isDeleted }}
            permissions={permissions}
          />
        </div>

        <div className="space-y-6">
          <JobsPanel jobs={ch.jobs} permissions={permissions} />
          <ReportsCard reports={ch.reports} t={t} locale={locale} />
          <AuditCard entries={ch.audit} t={t} locale={locale} />
        </div>
      </div>
    </div>
  );
}
