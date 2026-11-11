'use client';

/**
 * The Videos list on the shared list foundation (components/list, hooks/useAdminList):
 * rows from the client cache over the content pass-through, filters and saved
 * views in the URL, inline Unpublish / Republish that act at once with an Undo
 * toast, bulk unpublish / republish (undoable) and bulk delete (in-app confirm,
 * a soft delete restorable for 30 days), keyboard support, cards on a phone.
 */
import { R2Badge } from '@/components/content/r2';
import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import type { AdminContentPermission, AdminVideoRow } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber, type MessageKey } from '@/i18n/translate';
import { linkClass } from '@/components/ui';
import { ActionFeedback, ConfirmButton } from '@/components/content/actions';
import { Chip, MonoId, Notice, PageHeader, smallButtonClass, statusTone } from '@/components/content/parts';
import { BulkBar } from '@/components/list/BulkBar';
import { DataTable, type DataColumn } from '@/components/list/DataTable';
import { FiltersBar, type FilterField } from '@/components/list/FiltersBar';
import { ListEmpty, ListError, SkeletonRows } from '@/components/list/ListStates';
import { ListPager } from '@/components/list/ListPager';
import { SavedViews, type SavedViewTab } from '@/components/list/SavedViews';
import { RelativeTime } from '@/components/list/StatusChip';
import { useListKeyboard } from '@/components/list/useListKeyboard';
import { useUndoableAction } from '@/components/undo/UndoToast';
import { runBulk, useAdminCount, useAdminList, useAdminMutation, useAdminPermissions, type BulkResult } from '@/hooks/useAdminList';
import { useListParams } from '@/hooks/useListParams';
import { contentApi } from '@/lib/list/api-client';
import { describeActionError } from '@/lib/list/describe-error';
import { listRootKey } from '@/lib/list/keys';
import { hasFilters } from '@/lib/list/params';
import { logger } from '@/lib/logger-client';
import { LIST_RETURN_PARAM, VIDEO_LIST_SPEC, VIDEO_RESOURCE, VIDEO_VIEWS } from './list-spec';
import { VideoBulkActionsSlot } from './extensions';

const enc = encodeURIComponent;
const PROCESSING_REFRESH_MS = 15_000;

function duration(seconds: number | null): string | null {
  if (!seconds || seconds <= 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** Unpublish or republish videos, one request each; fails only when none went through. */
async function setPublished(ids: readonly string[], publish: boolean): Promise<BulkResult> {
  const result = await runBulk(ids, (id) => contentApi.post(`videos/${enc(id)}/${publish ? 'republish' : 'unpublish'}`));
  if (result.ok.length === 0 && result.failed.length > 0) throw result.failed[0].error;
  return result;
}

async function deleteVideos(ids: readonly string[], reason?: string): Promise<BulkResult> {
  const result = await runBulk(ids, (id) => contentApi.delete(`videos/${enc(id)}`, { reason: reason?.trim() || undefined }));
  if (result.ok.length === 0 && result.failed.length > 0) throw result.failed[0].error;
  return result;
}

export function VideosList() {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useListParams(VIDEO_LIST_SPEC, VIDEO_VIEWS);
  const { values } = params;
  const list = useAdminList<AdminVideoRow>({
    resource: VIDEO_RESOURCE,
    spec: VIDEO_LIST_SPEC,
    values,
    refetchInterval: values.status === 'processing' ? PROCESSING_REFRESH_MS : false,
  });
  const permissionsQuery = useAdminPermissions();
  const permissions: AdminContentPermission[] = permissionsQuery.data ?? [];
  const canManage = permissions.includes('videos:manage');
  const canDelete = permissions.includes('content:delete');
  const selectable = canManage || canDelete;

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resetKey, setResetKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const filtersRef = useRef<HTMLFormElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const undoable = useUndoableAction();

  // A different list starts with nothing selected
  const [selectionQuery, setSelectionQuery] = useState(params.query);
  if (selectionQuery !== params.query) {
    setSelectionQuery(params.query);
    setSelected(new Set());
  }

  const publish = useAdminMutation<{ ids: string[]; publish: boolean }, BulkResult, AdminVideoRow>({
    resource: VIDEO_RESOURCE,
    mutationFn: ({ ids, publish: on }) => setPublished(ids, on),
    optimistic: ({ ids, publish: on }) => ({ ids, patch: { isHidden: !on } }),
    succeededIds: (r) => r.ok,
  });
  const remove = useAdminMutation<{ ids: string[]; reason?: string }, BulkResult, AdminVideoRow>({
    resource: VIDEO_RESOURCE,
    mutationFn: ({ ids, reason }) => deleteVideos(ids, reason),
    optimistic: ({ ids }) => ({ ids, patch: 'remove' }),
    succeededIds: (r) => r.ok,
  });

  const views: SavedViewTab[] = [
    { id: 'all', label: t('list.views.all'), count: useAdminCount(VIDEO_RESOURCE, VIDEO_LIST_SPEC, {}).data },
    { id: 'processing', label: t('videos.statusLabels.processing'), count: useAdminCount(VIDEO_RESOURCE, VIDEO_LIST_SPEC, { status: 'processing' }).data, countTestId: 'processing-count' },
    { id: 'failed', label: t('videos.statusLabels.failed'), count: useAdminCount(VIDEO_RESOURCE, VIDEO_LIST_SPEC, { status: 'failed' }).data, alertWhenNonZero: true, countTestId: 'failed-count' },
    { id: 'reported', label: t('list.views.reported'), count: useAdminCount(VIDEO_RESOURCE, VIDEO_LIST_SPEC, { reported: 'yes' }).data },
    { id: 'private', label: t('videos.private'), count: useAdminCount(VIDEO_RESOURCE, VIDEO_LIST_SPEC, { visibility: 'private' }).data },
  ];

  const statusLabel = (s: string | null) => (s ? t(`videos.statusLabels.${s}` as MessageKey) : t('content.none'));
  const detailHref = useCallback((id: string) => `/videos/${enc(id)}${params.query ? `?${LIST_RETURN_PARAM}=${enc(params.query)}` : ''}`, [params.query]);

  const rows = list.rows;
  const rowIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const chosen = rows.filter((r) => selected.has(r.id)).map((r) => r.id);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const keyboard = useListKeyboard({
    rowIds,
    containerRef: tableRef,
    onToggle: selectable ? toggle : undefined,
    onOpen: (id) => router.push(detailHref(id)),
    focusSearch: () => filtersRef.current?.querySelector<HTMLInputElement>('input[name="q"]')?.focus(),
  });

  const fail = (name: string, e: unknown) => {
    logger.warn('[videos] Change failed', { name, status: (e as { status?: number })?.status });
    setError(describeActionError(t, e));
  };

  /** Unpublish or republish, at once, with Undo (owner rule: undo instead of confirm). */
  const changePublished = async (ids: string[], on: boolean, name: string) => {
    setError(null);
    setMessage(null);
    setBusy(name);
    try {
      const result = await undoable.run({
        action: () => publish.mutateAsync({ ids, publish: on }),
        undo: (done) => publish.mutateAsync({ ids: done.ok, publish: !on }),
        message: (done) =>
          done.ok.length === 1 && ids.length === 1
            ? t(on ? 'videos.republishedOne' : 'videos.unpublishedOne')
            : t(on ? 'videos.republishedMany' : 'videos.unpublishedMany', { count: done.ok.length }),
      });
      if (result.failed.length) setError(t('videos.bulkResult', { ok: result.ok.length, total: ids.length }));
      if (ids.length > 1) setSelected(new Set());
    } catch (e) {
      fail(name, e);
    } finally {
      setBusy(null);
    }
  };

  const bulkDelete = async (reason: string) => {
    setError(null);
    setMessage(null);
    setBusy('delete');
    try {
      const result = await remove.mutateAsync({ ids: chosen, reason });
      setMessage(t('videos.bulkResult', { ok: result.ok.length, total: chosen.length }) + ` ${t('deleted.softNote')}`);
      setSelected(new Set());
    } catch (e) {
      fail('delete', e);
    } finally {
      setBusy(null);
    }
  };

  const fields: FilterField[] = [
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
  ];

  const columns: DataColumn<AdminVideoRow>[] = [
    {
      id: 'video',
      primary: true,
      header: t('videos.colVideo'),
      cell: (v) => {
        const time = duration(v.duration);
        return (
          <div className="flex items-start gap-3 min-w-0">
            <div className="relative shrink-0">
              {v.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- remote thumbnails from the images CDN
                <img src={v.thumbnailUrl} alt="" className="h-12 w-20 sm:h-14 sm:w-24 rounded object-cover bg-surface-2" loading="lazy" />
              ) : (
                <span aria-hidden="true" className="block h-12 w-20 sm:h-14 sm:w-24 rounded bg-surface-2" />
              )}
              {time && <span className="absolute bottom-1 end-1 rounded bg-fg/80 px-1 text-[10px] text-surface tabular-nums" dir="ltr">{time}</span>}
            </div>
            <div className="min-w-0">
              <Link href={detailHref(v.id)} className={`${linkClass} font-medium break-words`} dir="auto" data-testid="video-link" data-row-primary>
                {v.title || v.id}
              </Link>
              <span className="block"><MonoId value={v.id} /></span>
              <span className="block md:hidden text-xs text-fg-muted mt-1" dir="auto">
                {v.channelName ?? (v.channelId ? v.channelId : t('content.noChannel'))} · {t('videos.viewsCount', { count: v.views })}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      id: 'channel',
      wide: true,
      header: t('videos.colChannel'),
      className: 'text-sm',
      cell: (v) =>
        v.channelId ? (
          <Link href={`/channels/${enc(v.channelId)}`} className={`${linkClass} break-words`} dir="auto" data-testid="video-channel-link">
            {v.channelName || v.channelId}
          </Link>
        ) : (
          <span className="text-fg-subtle">{t('content.noChannel')}</span>
        ),
    },
    {
      id: 'uploader',
      wide: true,
      header: t('videos.colUploader'),
      className: 'text-sm',
      cell: (v) =>
        v.ownerId ? (
          <Link href={`/users/${enc(v.ownerId)}`} className={`${linkClass} break-words`} dir="auto" data-testid="video-owner-link">
            {v.ownerName || <MonoId value={v.ownerId} />}
          </Link>
        ) : (
          <span className="text-fg-subtle">{t('content.none')}</span>
        ),
    },
    {
      id: 'status',
      header: t('videos.colStatus'),
      cell: (v) => (
        <div className="flex flex-wrap items-center gap-1">
          <Chip tone={statusTone(v.status)} testId="chip-status">{statusLabel(v.status)}</Chip>
          <Chip tone="neutral">{v.isPublic ? t('videos.public') : t('videos.private')}</Chip>
          {v.isHidden && <Chip tone="bad" testId="chip-hidden">{t('videos.hiddenYes')}</Chip>}
          {!!v.openReports && <Chip tone="warn" testId="chip-reports">{t('content.openReports', { count: v.openReports })}</Chip>}
          {v.createdAt && (
            <span className="md:hidden text-xs text-fg-muted">
              <RelativeTime value={v.createdAt} />
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'r2',
      wide: true,
      header: t('mediaDelivery.colR2'),
      cardLabel: t('mediaDelivery.colR2'),
      // Absent from an older api-videos: nothing rather than a wrong "Not transcoded"
      cell: (v) => <span data-testid="video-r2-cell">{v.r2 !== undefined && <R2Badge r2={v.r2} t={t} prefix={false} testId="chip-r2" />}</span>,
    },
    { id: 'views', wide: true, align: 'end', header: t('videos.colViews'), cell: (v) => formatNumber(v.views, locale) },
    {
      id: 'created',
      wide: true,
      header: t('videos.colCreated'),
      className: 'text-sm text-fg-muted whitespace-nowrap',
      cell: (v) => (v.createdAt ? <RelativeTime value={v.createdAt} /> : t('content.none')),
    },
  ];
  if (canManage) {
    columns.push({
      id: 'actions',
      header: <span className="sr-only">{t('list.actions')}</span>,
      align: 'end',
      cell: (v) =>
        v.isHidden ? (
          <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => changePublished([v.id], true, `republish:${v.id}`)} aria-label={t('videos.republishTitle', { title: v.title || v.id })} data-testid="video-row-republish">
            {t('videos.republish')}
          </button>
        ) : (
          <button type="button" className={smallButtonClass} disabled={!!busy} onClick={() => changePublished([v.id], false, `unpublish:${v.id}`)} aria-label={t('videos.unpublishTitle', { title: v.title || v.id })} data-testid="video-row-unpublish">
            {t('videos.unpublish')}
          </button>
        ),
    });
  }

  const filtered = hasFilters(values);
  const clear = () => {
    params.clear();
    setResetKey((k) => k + 1);
  };

  return (
    <div data-testid="videos-list" data-list-ready={list.isLoading ? undefined : 'true'}>
      <PageHeader deletedKind="video" title={t('videos.title')} subtitle={t('videos.subtitle')} total={list.total} t={t} />

      <SavedViews
        views={views}
        active={params.view}
        onSelect={(id) => {
          params.setView(id);
          setResetKey((k) => k + 1);
        }}
        label={t('videos.statusSummary')}
        testId="video-status-summary"
      />

      <FiltersBar
        ref={filtersRef}
        label={t('videos.title')}
        testId="videos-filters"
        fields={fields}
        values={values}
        onChange={params.update}
        onText={params.updateText}
        onClear={clear}
        resetKey={resetKey}
      />

      <ActionFeedback error={error} message={message} testId="video-bulk-result" />

      {list.error ? (
        <ListError error={list.error} onRetry={() => void list.refetch()} testId="videos-error" />
      ) : list.isLoading ? (
        <SkeletonRows />
      ) : (
        <>
          {!list.indexComplete && <Notice tone="warn">{t('content.indexBuilding')}</Notice>}
          {rows.length === 0 ? (
            <ListEmpty title={t('videos.emptyTitle')} body={t('videos.emptyBody')} filtered={filtered} onClear={clear} />
          ) : (
            <DataTable
              ref={tableRef}
              rows={rows}
              columns={columns}
              caption={t('videos.tableCaption')}
              testId="videos-table"
              stale={list.isPreviousData}
              currentId={keyboard.current}
              rowProps={(v) => ({ 'data-testid': 'video-row', 'data-video-id': v.id, 'data-status': v.status ?? '', 'data-hidden': v.isHidden ? 'true' : 'false' })}
              selection={
                selectable
                  ? {
                      selected,
                      onToggle: toggle,
                      onToggleAll: () => setSelected(chosen.length === rows.length ? new Set() : new Set(rowIds)),
                      rowLabel: (v) => t('videos.selectVideo', { title: v.title }),
                      allLabel: t('videos.selectAll'),
                      rowTestId: 'video-select',
                      allTestId: 'video-select-all',
                    }
                  : undefined
              }
            />
          )}
          {list.total !== undefined && <ListPager page={list.page} pageSize={list.pageSize} total={list.total} busy={list.isFetching} onPage={(p) => params.update({ page: p > 1 ? String(p) : undefined })} />}
        </>
      )}

      {selectable && (
        <BulkBar
          count={chosen.length}
          label={t('videos.bulkActions')}
          selectedText={t('videos.selected', { count: chosen.length })}
          onClear={() => setSelected(new Set())}
          testId="video-bulk-bar"
          countTestId="video-selected-count"
          extra={
            <div data-slot="video-bulk-actions-extensions">
              <VideoBulkActionsSlot
                selectedIds={chosen}
                permissions={permissions}
                onDone={() => {
                  setSelected(new Set());
                  void queryClient.invalidateQueries({ queryKey: listRootKey(VIDEO_RESOURCE) });
                }}
              />
            </div>
          }
        >
          {canManage && (
            <>
              <button type="button" className={smallButtonClass} disabled={!chosen.length || !!busy} onClick={() => changePublished(chosen, false, 'unpublish')} data-testid="video-bulk-unpublish">
                {busy === 'unpublish' ? t('content.working') : t('videos.bulkUnpublish')}
              </button>
              <button type="button" className={smallButtonClass} disabled={!chosen.length || !!busy} onClick={() => changePublished(chosen, true, 'republish')} data-testid="video-bulk-republish">
                {busy === 'republish' ? t('content.working') : t('videos.bulkRepublish')}
              </button>
            </>
          )}
          {canDelete && (
            <ConfirmButton
              label={t('videos.bulkDelete')}
              title={t('videos.bulkDeleteTitle', { count: chosen.length })}
              body={t('videos.bulkDeleteBody')}
              confirmLabel={t('videos.bulkDelete')}
              withReason
              reasonHint={t('deleted.reasonHint')}
              danger
              disabled={!chosen.length || !!busy}
              busy={busy === 'delete'}
              testId="video-bulk-delete"
              onConfirm={(reason) => bulkDelete(reason)}
            />
          )}
        </BulkBar>
      )}
    </div>
  );
}
