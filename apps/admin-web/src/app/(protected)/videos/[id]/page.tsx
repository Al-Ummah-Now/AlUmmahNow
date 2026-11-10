import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getContentPermissions, getVideo, listJobs } from '@/lib/api/content';
import type { AdminContentPermission, AdminJob, VideoDetailView } from '@/lib/api/content-types';
import { AdminApiError } from '@/lib/api/errors';
import { getI18n } from '@/i18n/server';
import { formatDate, formatNumber, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { AuditCard, BackLink, Chip, MonoId, Notice, ReportsCard, SectionCard, StatGrid, statusTone } from '@/components/content/parts';
import { JobsPanel } from '@/components/content/jobs';
import { logger } from '@/lib/logger';
import { VideoActions } from './VideoActions';
import { VideoPlayer } from './VideoPlayer';

export const dynamic = 'force-dynamic';

const HOLD_LABEL: Record<string, MessageKey> = { channel: 'videos.holdChannel', user: 'videos.holdUser', admin: 'videos.holdUnpublished' };

function bytes(n: number | null, locale: string): string | null {
  if (!n) return null;
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v)} ${units[i]}`;
}

/**
 * A video that is gone. The delete purge erases the record entirely, so the
 * page the admin deleted it from re-renders as this: the deletion and its
 * jobs (a failed purge keeps Retry here and on the Errors page). Never had a
 * job: a plain 404.
 */
async function ErasedVideo({ id, back }: { id: string; back: React.ReactNode }) {
  const { t } = await getI18n();
  let jobs: AdminJob[] = [];
  let permissions: AdminContentPermission[] = [];
  try {
    [jobs, permissions] = await Promise.all([listJobs({ targetKind: 'video', targetId: id, limit: 10 }), getContentPermissions()]);
  } catch (e) {
    logger.warn('[videos] Could not read an erased video\'s jobs', { id, error: e instanceof Error ? e.message : String(e) });
  }
  if (!jobs.length) notFound();
  return (
    <div data-testid="video-erased-page" data-video-id={id}>
      {back}
      <h1 className="text-2xl sm:text-3xl font-bold text-fg mb-2">{t('videos.erasedTitle')}</h1>
      <p className="mb-6"><MonoId value={id} max={60} /></p>
      <Notice testId="video-erased">{t('videos.erasedBody')}</Notice>
      <div className="mt-6 max-w-xl">
        <JobsPanel jobs={jobs} permissions={permissions} />
      </div>
    </div>
  );
}

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, locale } = await getI18n();
  const back = <BackLink href="/videos" label={t('content.back', { section: t('videos.title') })} />;

  let video: VideoDetailView | null = null;
  let permissions: AdminContentPermission[] = [];
  try {
    [video, permissions] = await Promise.all([getVideo(id), getContentPermissions()]);
  } catch (e) {
    if (e instanceof AdminApiError && e.status === 404) return <ErasedVideo id={id} back={back} />;
    logger.error('[videos] Failed to load video', { id, error: e instanceof Error ? e.message : String(e) });
  }
  if (!video) {
    return (
      <div>
        {back}
        <ErrorAlert testId="video-error">{t('content.detailFailed')}</ErrorAlert>
      </div>
    );
  }

  const v = video;
  const statusLabel = v.status ? t(`videos.statusLabels.${v.status}` as MessageKey) : t('content.none');
  const holds = v.suspensionHolds.map((h) => HOLD_LABEL[h.split(':')[0]]).filter(Boolean);
  const unpublished = v.suspensionHolds.includes('admin:unpublished');
  const resolutions = v.processing?.resolutions.length ? v.processing.resolutions : v.availableResolutions;

  return (
    <div data-testid="video-detail" data-video-id={v.id} data-hidden={v.isHidden ? 'true' : 'false'} data-status={v.status ?? ''}>
      {back}
      <div className="mb-6 flex flex-col gap-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-fg break-words" dir="auto" data-testid="video-title">{v.title || v.id}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          <MonoId value={v.id} max={40} />
          <Chip tone={statusTone(v.status)} large testId="video-status">{statusLabel}</Chip>
          <Chip tone="neutral">{v.isPublic ? t('videos.public') : t('videos.private')}</Chip>
          {v.isHidden && <Chip tone="bad" testId="video-hidden">{t('videos.hiddenYes')}</Chip>}
          {v.isDeleted && <Chip tone="neutral">{t('channels.deleted')}</Chip>}
        </div>
      </div>

      {v.isDeleted && <Notice tone="bad" testId="video-deleted">{t('videos.deletedNotice')}</Notice>}
      {v.isHidden && (holds.length > 0 || v.moderationAction) && (
        <Notice tone="warn" testId="video-holds">
          {t('videos.holds')}: {[...holds.map((k) => t(k)), ...(v.moderationAction ? [t('videos.moderationHidden')] : [])].join(' · ')}
        </Notice>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className={cardClass} aria-label={t('videos.previewTitle')}>
            <VideoPlayer playUrl={v.playUrl} videoUrl={v.videoUrl} poster={v.thumbnailUrl} title={v.title} />
          </section>

          {/* Processing is shown up front: stuck and failed uploads are what admins come here for */}
          <SectionCard title={t('videos.processingTitle')} id="video-processing" testId="video-processing">
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-fg-muted">{t('videos.status')}</dt>
                <dd><Chip tone={statusTone(v.status)}>{statusLabel}</Chip></dd>
              </div>
              <div>
                <dt className="text-fg-muted">{t('videos.bunnyStatus')}</dt>
                <dd className="text-fg" data-testid="video-bunny-status">
                  {v.processing ? (
                    <>
                      <span dir="ltr">{v.processing.status}</span>
                      {v.processing.encodeProgress !== null && v.processing.encodeProgress < 100 && (
                        <span className="block text-fg-muted">{t('videos.encodeProgress', { progress: v.processing.encodeProgress })}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-fg-muted">{t('videos.bunnyUnavailable')}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">{t('videos.resolutions')}</dt>
                <dd className="flex flex-wrap gap-1">
                  {resolutions.length ? resolutions.map((r) => <Chip key={r} tone="info">{r}</Chip>) : <span className="text-fg-muted">{t('videos.noResolutions')}</span>}
                </dd>
              </div>
            </dl>
          </SectionCard>

          <SectionCard title={t('videos.detailsTitle')} id="video-details">
            <StatGrid
              stats={[
                { label: t('videos.views'), value: formatNumber(v.views, locale) },
                { label: t('videos.likes'), value: formatNumber(v.likeCount, locale) },
                { label: t('videos.comments'), value: formatNumber(v.commentCount, locale) },
                { label: t('content.reports'), value: formatNumber(v.openReports, locale) },
              ]}
            />
            <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-fg-muted">{t('content.channel')}</dt>
                <dd>
                  {v.channelId ? (
                    <Link href={`/channels/${encodeURIComponent(v.channelId)}`} className={`${linkClass} break-words`} dir="auto" data-testid="video-channel-link">{v.channelName || v.channelId}</Link>
                  ) : (
                    <span className="text-fg-subtle">{t('content.noChannel')}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-fg-muted">{t('content.owner')}</dt>
                <dd>
                  {v.ownerId ? <Link href={`/users/${encodeURIComponent(v.ownerId)}`} className={`${linkClass} break-all`} dir="ltr">{v.ownerId}</Link> : t('content.none')}
                </dd>
              </div>
              <div><dt className="text-fg-muted">{t('content.created')}</dt><dd className="text-fg">{v.createdAt ? formatDate(v.createdAt, locale, true) : t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('content.updated')}</dt><dd className="text-fg">{v.updatedAt ? formatDate(v.updatedAt, locale, true) : t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('videos.dimensions')}</dt><dd className="text-fg" dir="ltr">{v.width && v.height ? `${v.width}×${v.height}` : t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('videos.size')}</dt><dd className="text-fg">{bytes(v.fileSize, locale) ?? t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('videos.category')}</dt><dd className="text-fg">{v.category ?? t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('videos.language')}</dt><dd className="text-fg">{v.language ?? t('content.none')}</dd></div>
            </dl>
            {v.tags.length > 0 && (
              <div className="mt-4">
                <p className="text-sm text-fg-muted mb-1">{t('videos.tags')}</p>
                <div className="flex flex-wrap gap-1">{v.tags.map((tag) => <Chip key={tag} tone="neutral">{tag}</Chip>)}</div>
              </div>
            )}
            {v.description && <p className="mt-4 text-sm text-fg whitespace-pre-wrap break-words" dir="auto">{v.description}</p>}
          </SectionCard>

          <VideoActions
            video={{ id: v.id, title: v.title, description: v.description, isPublic: v.isPublic, isDeleted: v.isDeleted, unpublished, status: v.status, processing: v.processing, width: v.width, height: v.height }}
            permissions={permissions}
          />
        </div>

        <div className="space-y-6">
          <JobsPanel jobs={v.jobs} permissions={permissions} />
          <ReportsCard reports={v.reports} t={t} locale={locale} />
          <AuditCard entries={v.audit} t={t} locale={locale} />
        </div>
      </div>
    </div>
  );
}
