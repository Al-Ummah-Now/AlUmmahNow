import Link from 'next/link';
import { ADMIN_VIDEO_SORTS, ADMIN_VIDEO_STATUSES } from '@al-ummah/shared-types';
import { getContentPermissions, listVideos } from '@/lib/api/content';
import type { AdminContentPermission, AdminPage, AdminVideoRow } from '@/lib/api/content-types';
import { getI18n } from '@/i18n/server';
import type { MessageKey } from '@/i18n/translate';
import { ErrorAlert } from '@/components/ui';
import { FilterForm } from '@/components/content/FilterForm';
import { Chip, EmptyState, Notice, PageHeader, Pager } from '@/components/content/parts';
import { PAGE_SIZE, hrefWith, pickParams, type SearchParams } from '@/components/content/query';
import { logger } from '@/lib/logger';
import { VideoTable } from './VideoTable';

export const dynamic = 'force-dynamic';

export default async function VideosPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = pickParams(await searchParams, {
    q: 'text',
    channelId: 'text',
    ownerId: 'text',
    noChannel: ['1'],
    status: ADMIN_VIDEO_STATUSES,
    visibility: ['public', 'private'],
    hidden: ['yes', 'no'],
    reported: ['yes'],
    createdFrom: 'date',
    createdTo: 'date',
    sort: ADMIN_VIDEO_SORTS,
    page: 'page',
  });
  const { t } = await getI18n();
  const page = Number(params.page ?? 1);

  let data: AdminPage<AdminVideoRow> | null = null;
  let permissions: AdminContentPermission[] = [];
  // Processing and failed totals across the whole catalogue, shown above the filters
  let counts: { processing: number; failed: number } | null = null;
  try {
    const [list, perms, processing, failed] = await Promise.all([
      listVideos({ ...params, page, pageSize: PAGE_SIZE }),
      getContentPermissions(),
      listVideos({ status: 'processing', pageSize: 1 }),
      listVideos({ status: 'failed', pageSize: 1 }),
    ]);
    data = list;
    permissions = perms;
    counts = { processing: processing.total, failed: failed.total };
  } catch (e) {
    logger.error('[videos] Failed to load', { error: e instanceof Error ? e.message : String(e) });
  }

  const statusLabel = (s: string) => t(`videos.statusLabels.${s}` as MessageKey);

  return (
    <div>
      <PageHeader deletedKind="video" title={t('videos.title')} subtitle={t('videos.subtitle')} total={data?.total} t={t}>
        {counts && (
          <nav aria-label={t('videos.statusSummary')} className="flex flex-wrap gap-2" data-testid="video-status-summary">
            <Link href={hrefWith('/videos', {}, { status: 'processing' })} className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-current={params.status === 'processing' ? 'true' : undefined}>
              <Chip tone="warn" large testId="processing-count">{t('videos.processingCount', { count: counts.processing })}</Chip>
            </Link>
            <Link href={hrefWith('/videos', {}, { status: 'failed' })} className="rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-current={params.status === 'failed' ? 'true' : undefined}>
              <Chip tone={counts.failed > 0 ? 'bad' : 'neutral'} large testId="failed-count">{t('videos.failedCount', { count: counts.failed })}</Chip>
            </Link>
          </nav>
        )}
      </PageHeader>

      <FilterForm
        action="/videos"
        label={t('videos.title')}
        testId="videos-filters"
        values={params}
        fields={[
          { kind: 'search', name: 'q', label: t('videos.searchLabel'), suggest: 'video' },
          // Processing comes first: failed and stuck uploads are what admins look for most
          { kind: 'select', name: 'status', label: t('videos.status'), options: ['processing', 'failed', 'uploading', 'initiated', 'ready'].map((s) => ({ value: s, label: statusLabel(s) })) },
          { kind: 'select', name: 'visibility', label: t('videos.visibility'), options: [{ value: 'public', label: t('videos.public') }, { value: 'private', label: t('videos.private') }] },
          { kind: 'select', name: 'hidden', label: t('videos.hidden'), options: [{ value: 'yes', label: t('videos.hiddenYes') }, { value: 'no', label: t('videos.hiddenNo') }] },
          { kind: 'pick', name: 'channelId', label: t('videos.channelId'), suggest: 'channel' },
          { kind: 'pick', name: 'ownerId', label: t('videos.ownerId'), suggest: 'user' },
          { kind: 'flag', name: 'noChannel', label: t('videos.noChannel'), value: '1' },
          { kind: 'flag', name: 'reported', label: t('content.reportedOnly'), value: 'yes' },
          { kind: 'date', name: 'createdFrom', label: t('content.from') },
          { kind: 'date', name: 'createdTo', label: t('content.to') },
          {
            kind: 'select',
            name: 'sort',
            label: t('content.sort'),
            allLabel: t('videos.sortNewest'),
            options: [
              { value: 'oldest', label: t('videos.sortOldest') },
              { value: 'views', label: t('videos.sortViews') },
              { value: 'title', label: t('videos.sortTitle') },
            ],
          },
        ]}
      />

      {!data && <ErrorAlert testId="videos-error">{t('content.loadFailed')}</ErrorAlert>}
      {data && !data.indexComplete && <Notice tone="warn">{t('content.indexBuilding')}</Notice>}
      {data && data.items.length === 0 && <EmptyState>{t('content.empty')}</EmptyState>}
      {data && data.items.length > 0 && (
        <>
          <VideoTable rows={data.items} permissions={permissions} />
          <Pager page={page} pageSize={PAGE_SIZE} total={data.total} t={t} href={(p) => hrefWith('/videos', params, { page: p > 1 ? String(p) : undefined })} />
        </>
      )}
    </div>
  );
}
