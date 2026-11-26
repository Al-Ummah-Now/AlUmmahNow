import Link from '@/components/AppLink';
import { notFound } from 'next/navigation';
import { getContentPermissions, getVideo, listJobs } from '@/lib/api/content';
import type { AdminContentPermission, AdminJob, VideoDetailView } from '@/lib/api/content-types';
import { AdminApiError } from '@/lib/api/errors';
import { getI18n } from '@/i18n/server';
import { formatStat, type MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass, linkClass } from '@/components/ui';
import { AuditCard } from '@/components/audit/AuditCard';
import { BackLink, Chip, MonoId, Notice, ReportsCard, SectionCard, StatGrid, statusTone } from '@/components/content/parts';
import { JobsPanel } from '@/components/content/jobs';
import { logger } from '@/lib/logger';
import { getAdminSession } from '@/lib/auth';
import { canManageMedia } from '@/lib/roles';
import { videoFailuresById } from '@/lib/api/failures';
import { FailureWhy } from '@/components/content/failure';
import { VideoActions } from './VideoActions';
import { VideoPlayer } from './VideoPlayer';
import { ProcessingCard } from './ProcessingCard';
import { VideoProvidersPanel } from './VideoProvidersPanel';
import { LIST_RETURN_PARAM, videosBackHref } from '../list-spec';
import { formatBytes, intlLocale, localizeDigits } from '@al-ummah/shared-types';
import type { Locale } from '@/i18n/config';
import { categoryLabel } from '@/lib/category-label';

import { LocalTime } from '@/components/LocalTime';
export const dynamic = 'force-dynamic';

const HOLD_LABEL: Record<string, MessageKey> = { channel: 'videos.holdChannel', user: 'videos.holdUser', admin: 'videos.holdUnpublished' };

function bytes(n: number | null, locale: Locale): string | null {
  return n ? formatBytes(locale, n) : null;
}

/** A language code as the reader's language names it ("ar" → «العربية», "Arabic"); an unknown one stays a code. */
function languageName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([intlLocale(locale)], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
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

export default async function VideoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const { t, locale } = await getI18n();
  // Back returns to the list as it was filtered (the row's link carries its query)
  const back = <BackLink href={videosBackHref((await searchParams)[LIST_RETURN_PARAM])} label={t('content.back', { section: t('videos.title') })} />;

  let video: VideoDetailView | null = null;
  let permissions: AdminContentPermission[] = [];
  // Transcode again needs media:manage (admins and super admins), like the Delivery page
  const session = await getAdminSession().catch(() => null);
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
  const mayHaveFailed = v.status === 'failed' || v.r2?.status === 'failed' || !!v.processingIssue;
  const failure = mayHaveFailed && canManageMedia(session?.user.role) ? ((await videoFailuresById([v.id]))[v.id] ?? null) : null;
  const statusLabel = v.status ? t(`videos.statusLabels.${v.status}` as MessageKey) : t('content.none');
  const holds = v.suspensionHolds.map((h) => HOLD_LABEL[h.split(':')[0]]).filter(Boolean);
  const unpublished = v.suspensionHolds.includes('admin:unpublished');

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

      {v.isDeleted && (
        <Notice tone="bad" testId="video-deleted">
          {t('deleted.deletedNotice')}{' '}
          <Link href="/deleted?kind=video" className={linkClass}>{t('deleted.viewDeleted')}</Link>
        </Notice>
      )}
      {v.isHidden && (holds.length > 0 || v.moderationAction) && (
        <Notice tone="warn" testId="video-holds">
          {t('videos.holds')}: {[...holds.map((k) => t(k)), ...(v.moderationAction ? [t('videos.moderationHidden')] : [])].join(t('common.sep'))}
        </Notice>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <section className={cardClass} aria-label={t('videos.previewTitle')}>
            <VideoPlayer playUrl={v.playUrl} videoUrl={v.videoUrl} poster={v.thumbnailUrl} title={v.title} />
          </section>

          {/* Processing is shown up front: stuck and failed uploads are what admins come here for. Bunny and R2 side by side */}
          <SectionCard title={t('videos.processingTitle')} id="video-processing" testId="video-processing">
            <p className="mb-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-fg-muted">{t('videos.status')}:</span>
              <Chip tone={statusTone(v.status)}>{statusLabel}</Chip>
            </p>
            {failure && (
              <div className="mb-4 rounded border border-danger-border bg-danger-bg/40 p-3" data-testid="video-failure">
                <h3 className="mb-1 text-base font-semibold text-fg">{t('videoFailure.title')}</h3>
                <FailureWhy failure={failure} t={t} />
              </div>
            )}
            <ProcessingCard
              videoId={v.id}
              processing={v.processing}
              // The words above say why; the stored reason is English, for the logs
              processingIssue={v.processingIssue && failure ? { kind: v.processingIssue.kind, at: v.processingIssue.at } : (v.processingIssue ?? null)}
              fallbackResolutions={v.availableResolutions}
              r2={v.r2}
              failure={failure}
              canManage={canManageMedia(session?.user.role)}
            />
          </SectionCard>

          {v.media !== undefined && (
            <SectionCard title={t('mediaProviders.video.title')} id="video-providers" testId="video-providers-section">
              <VideoProvidersPanel videoId={v.id} media={v.media} canManage={canManageMedia(session?.user.role)} />
            </SectionCard>
          )}

          <SectionCard title={t('videos.detailsTitle')} id="video-details">
            <StatGrid
              stats={[
                { label: t('videos.views'), value: formatStat(v.views, locale) },
                { label: t('videos.likes'), value: formatStat(v.likeCount, locale) },
                { label: t('videos.comments'), value: formatStat(v.commentCount, locale) },
                { label: t('content.reports'), value: formatStat(v.openReports, locale) },
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
              <div><dt className="text-fg-muted">{t('content.created')}</dt><dd className="text-fg">{v.createdAt ? <LocalTime value={v.createdAt} withTime /> : t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('content.updated')}</dt><dd className="text-fg">{v.updatedAt ? <LocalTime value={v.updatedAt} withTime /> : t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('videos.dimensions')}</dt><dd className="text-fg">{v.width && v.height ? localizeDigits(locale, `${v.width}×${v.height}`) : t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('videos.size')}</dt><dd className="text-fg">{bytes(v.fileSize, locale) ?? t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('videos.category')}</dt><dd className="text-fg">{(v.category && categoryLabel(v.category, locale)) || v.category || t('content.none')}</dd></div>
              <div><dt className="text-fg-muted">{t('videos.language')}</dt><dd className="text-fg">{v.language ? languageName(v.language, locale) : t('content.none')}</dd></div>
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
            video={{
              id: v.id,
              title: v.title,
              titleLocalized: v.titleLocalized,
              description: v.description,
              descriptionLocalized: v.descriptionLocalized,
              isPublic: v.isPublic,
              isDeleted: v.isDeleted,
              unpublished,
              status: v.status,
              processing: v.processing,
              width: v.width,
              height: v.height,
            }}
            permissions={permissions}
            failure={failure}
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
