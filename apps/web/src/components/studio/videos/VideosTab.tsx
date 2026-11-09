'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MoreVertical, UploadCloud } from 'lucide-react';
import type { View } from 'react-big-calendar';
import { VIDEO_CATEGORIES, type StudioVideoStatus } from '@al-ummah/shared-types';
import { BulkEditDialog } from '@/components/bulkEdit/BulkEditDialog';
import { CalendarControls } from '@/components/calendar/CalendarControls';
import { ViewSwitcher } from '@/components/calendar/ViewSwitcher';
import { navigateNext, navigatePrevious } from '@/components/calendar/utils/dateFormatters';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useLanguage } from '@/hooks/useLanguage';
import { getChannelContentCounts, listChannelContent, type StudioVideo } from '@/lib/api/studio-content';
import { cancelSchedule, publishNow } from '@/lib/api/scheduling';
import { bulkDeleteVideos, bulkUpdateVideos } from '@/lib/api/videos';
import type { BulkVideoChanges } from '@/lib/dashboard/bulk-edit';
import { logger } from '@/lib/logger-client';
import { can, type StudioRole } from '@/lib/studio/permissions';
import { MAX_BULK_SELECTION, parseVideosQuery, rowActions, videosQueryString, type VideoRowAction, type VideosQuery } from '@/lib/studio/videos';

const ScheduledVideoCalendar = dynamic(
  () => import('@/components/calendar/ScheduledVideoCalendar').then((mod) => ({ default: mod.ScheduledVideoCalendar })),
  { ssr: false },
);

const STATUSES: StudioVideoStatus[] = ['published', 'scheduled', 'drafts', 'processing', 'failed'];
const PAGE = 30;
const CALENDAR_PAGE = 100;
const PROCESSING_REFRESH_MS = 15000;
const selectClass = 'min-h-11 rounded-md border border-input bg-background px-2 text-sm text-foreground';

interface Props {
  locale: string;
  channelId: string;
  role: StudioRole;
}

type Pending = { ids: string[] } | null;

export function VideosTab({ locale, channelId, role }: Props) {
  const { t } = useLanguage();
  const text = t.studio.videos;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseVideosQuery(new URLSearchParams(searchParams.toString())), [searchParams]);
  const queryKey = videosQueryString({ ...query, view: 'list', calendarView: 'month' });

  const [items, setItems] = useState<StudioVideo[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<StudioVideoStatus, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState<Pending>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [search, setSearch] = useState(query.q);
  const requestRef = useRef(0);

  const update = useCallback((changes: Partial<VideosQuery>) => {
    const next = videosQueryString({ ...query, ...changes });
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [pathname, query, router]);

  const showingCalendar = query.status === 'scheduled' && query.view === 'calendar';

  const load = useCallback(async (more?: string) => {
    const request = ++requestRef.current;
    if (!more) setLoading(true);
    setFailed(false);
    try {
      const [page, nextCounts] = await Promise.all([
        listChannelContent(channelId, { ...query, cursor: more, limit: showingCalendar ? CALENDAR_PAGE : PAGE }),
        more ? Promise.resolve(undefined) : getChannelContentCounts(channelId),
      ]);
      if (request !== requestRef.current) return;
      if (!page) {
        setFailed(true);
        return;
      }
      setItems((previous) => (more ? [...previous, ...page.items] : page.items));
      setCursor(page.cursor);
      if (nextCounts) setCounts(nextCounts);
    } catch (error) {
      logger.error('[Studio] Could not load videos', { channelId, error });
      if (request === requestRef.current) setFailed(true);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
    // queryKey covers the fields of query the list depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, queryKey, showingCalendar]);

  useEffect(() => {
    setSelected(new Set());
    void load();
  }, [load]);

  // Uploads move on by themselves while this status is open
  useEffect(() => {
    if (query.status !== 'processing') return;
    const timer = setInterval(() => void load(), PROCESSING_REFRESH_MS);
    return () => clearInterval(timer);
  }, [load, query.status]);

  // Search as the person pauses typing
  useEffect(() => {
    if (search === query.q) return;
    const timer = setTimeout(() => update({ q: search }), 300);
    return () => clearTimeout(timer);
  }, [search, query.q, update]);

  const toggle = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BULK_SELECTION) next.add(id);
      return next;
    });
  };

  const allSelected = items.length > 0 && items.every((video) => selected.has(video.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(items.slice(0, MAX_BULK_SELECTION).map((video) => video.id)));

  const run = async (work: () => Promise<unknown>, success: string) => {
    try {
      const result = await work();
      if (result === null || (result as { success?: boolean })?.success === false) throw new Error('rejected');
      setNotice(success);
      await load();
    } catch (error) {
      logger.error('[Studio] Row action failed', { channelId, error });
      setNotice(text.actionFailed);
    }
  };

  const deleteConfirmed = async () => {
    if (!pendingDelete) return;
    const { ids } = pendingDelete;
    setPendingDelete(null);
    try {
      const result = await bulkDeleteVideos(ids, { channelId });
      const succeeded = result?.summary.succeeded ?? 0;
      const failedCount = result ? result.summary.failed : ids.length;
      if (succeeded === 0) setNotice(text.bulk.failed);
      else if (failedCount > 0) setNotice(text.bulk.partial.replace('{succeeded}', String(succeeded)).replace('{failed}', String(failedCount)));
      else setNotice(text.bulk.deleted.replace('{count}', String(succeeded)));
    } catch (error) {
      logger.error('[Studio] Delete failed', { channelId, error });
      setNotice(text.bulk.failed);
    }
    setSelected(new Set());
    await load();
  };

  const applyBulkEdit = async (changes: BulkVideoChanges): Promise<boolean> => {
    const result = await bulkUpdateVideos([...selected], changes, { channelId });
    if (!result) {
      setNotice(t.bulkEdit.failed);
      return false;
    }
    const { succeeded, failed: failedCount } = result.summary;
    setNotice(failedCount === 0
      ? t.bulkEdit.done.replace('{count}', String(succeeded))
      : t.bulkEdit.partial.replace('{succeeded}', String(succeeded)).replace('{failed}', String(failedCount)));
    await load();
    return succeeded > 0;
  };

  const base = `/${locale}/studio/${encodeURIComponent(channelId)}/content/videos`;
  const watchHref = (id: string) => `/${locale}/video?vid=${encodeURIComponent(id)}`;

  const onAction = (action: VideoRowAction, video: StudioVideo) => {
    if (action === 'copyLink') {
      void navigator.clipboard.writeText(`${window.location.origin}${watchHref(video.id)}`).then(() => setNotice(text.done.copied));
    } else if (action === 'publishNow') {
      void run(() => publishNow(video.id, { channelId }), text.done.published);
    } else if (action === 'cancelSchedule') {
      void run(() => cancelSchedule(video.id, { channelId }), text.done.scheduleCancelled);
    } else if (action === 'delete') {
      setPendingDelete({ ids: [video.id] });
    }
  };

  const actionHref = (action: VideoRowAction, video: StudioVideo): string | null => {
    const id = encodeURIComponent(video.id);
    if (action === 'edit' || action === 'schedule' || action === 'reschedule') return `${base}/${id}/edit`;
    if (action === 'analytics') return `${base}/${id}/analytics`;
    if (action === 'view') return watchHref(video.id);
    return null;
  };

  const filtered = Boolean(query.q || query.category || query.language || query.visibility !== 'all' || query.type !== 'all' || query.duration !== 'all');
  const clearFilters = () => {
    setSearch('');
    update({ q: '', category: '', language: '', visibility: 'all', type: 'all', duration: 'all' });
  };
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const numberFormat = new Intl.NumberFormat(locale);

  const canBulkEdit = can(role, 'video.edit');
  const canBulkDelete = can(role, 'video.delete');

  return (
    <div data-testid="studio-videos">
      <h1 className="sr-only">{t.studio.tabs.videos}</h1>
      <p role="status" aria-live="polite" className={notice ? 'mb-3 text-sm text-foreground' : 'sr-only'}>{notice}</p>

      <div role="group" aria-label={text.statusLabel} className="mb-4 flex gap-2 overflow-x-auto">
        {STATUSES.map((status) => (
          <Button
            key={status}
            variant={query.status === status ? 'default' : 'outline'}
            aria-pressed={query.status === status}
            onClick={() => update({ status })}
            data-testid={`studio-status-${status}`}
            className="min-h-11 whitespace-nowrap"
          >
            {text.statuses[status]}{counts ? ` (${numberFormat.format(counts[status])})` : ''}
          </Button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          type="search"
          dir="auto"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={text.searchPlaceholder}
          aria-label={text.searchPlaceholder}
          data-testid="studio-videos-search"
          className="min-h-11 w-full md:w-64"
        />
        <select aria-label={text.filters.visibility} className={selectClass} value={query.visibility} onChange={(e) => update({ visibility: e.target.value as VideosQuery['visibility'] })}>
          <option value="all">{text.filters.visibility}: {text.filters.any}</option>
          <option value="public">{text.filters.public}</option>
          <option value="private">{text.filters.private}</option>
        </select>
        <select aria-label={text.filters.type} className={selectClass} value={query.type} onChange={(e) => update({ type: e.target.value as VideosQuery['type'] })}>
          <option value="all">{text.filters.type}: {text.filters.any}</option>
          <option value="videos">{text.filters.videos}</option>
          <option value="shorts">{text.filters.shorts}</option>
        </select>
        <select aria-label={text.filters.duration} className={selectClass} value={query.duration} onChange={(e) => update({ duration: e.target.value as VideosQuery['duration'] })}>
          <option value="all">{text.filters.duration}: {text.filters.any}</option>
          <option value="short">{text.filters.short}</option>
          <option value="medium">{text.filters.medium}</option>
          <option value="long">{text.filters.long}</option>
        </select>
        <select aria-label={text.filters.category} className={selectClass} value={query.category} onChange={(e) => update({ category: e.target.value })}>
          <option value="">{text.filters.category}: {text.filters.any}</option>
          {VIDEO_CATEGORIES.map((category) => (
            <option key={category.value} value={category.value}>{category.label[locale === 'ar' ? 'ar' : 'en']}</option>
          ))}
        </select>
        <select aria-label={text.filters.language} className={selectClass} value={query.language} onChange={(e) => update({ language: e.target.value })}>
          <option value="">{text.filters.language}: {text.filters.any}</option>
          <option value="ar">العربية</option>
          <option value="en">English</option>
          <option value="ur">اردو</option>
          <option value="fr">Français</option>
        </select>
        <select aria-label={text.filters.sort} className={selectClass} value={query.sort} onChange={(e) => update({ sort: e.target.value as VideosQuery['sort'] })}>
          {(['newest', 'oldest', 'views', 'title'] as const).map((sort) => (
            <option key={sort} value={sort}>{text.filters[sort]}</option>
          ))}
        </select>
        {filtered && <Button variant="ghost" onClick={clearFilters} className="min-h-11">{text.filters.clear}</Button>}
      </div>

      {query.status === 'scheduled' && (
        <div className="mb-4 space-y-3">
          <ViewSwitcher currentView={query.view} onViewChange={(view) => update({ view })} />
          {showingCalendar && (
            <CalendarControls
              currentDate={currentDate}
              viewType={query.calendarView}
              onViewTypeChange={(calendarView) => update({ calendarView })}
              onNavigatePrevious={() => setCurrentDate((date) => navigatePrevious(date, query.calendarView))}
              onNavigateNext={() => setCurrentDate((date) => navigateNext(date, query.calendarView))}
              onNavigateToday={() => setCurrentDate(new Date())}
            />
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="sticky bottom-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2 md:static" data-testid="studio-bulk-bar">
          <span className="text-sm font-medium">{text.bulk.selected.replace('{count}', numberFormat.format(selected.size))}</span>
          {canBulkEdit && <Button variant="outline" onClick={() => setBulkEditOpen(true)} className="min-h-11">{text.bulk.edit}</Button>}
          {canBulkDelete && <Button variant="outline" onClick={() => setPendingDelete({ ids: [...selected] })} className="min-h-11">{text.bulk.delete}</Button>}
          <Button variant="ghost" onClick={() => setSelected(new Set())} className="min-h-11">{text.bulk.clear}</Button>
          {selected.size >= MAX_BULK_SELECTION && <span className="text-sm text-muted-foreground">{text.bulk.limit.replace('{max}', String(MAX_BULK_SELECTION))}</span>}
        </div>
      )}

      {failed ? (
        <div className="py-12 text-center">
          <p className="mb-3 text-foreground">{text.loadFailed}</p>
          <Button onClick={() => void load()}>{text.retry}</Button>
        </div>
      ) : loading ? (
        <div className="space-y-2" aria-busy="true" data-testid="studio-videos-loading">
          {[0, 1, 2, 3].map((row) => <Skeleton key={row} className="h-16 w-full" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center" data-testid="studio-videos-empty">
          <p className="mb-3 text-muted-foreground">{filtered ? text.empty.filtered : text.empty[query.status]}</p>
          {filtered ? (
            <Button variant="outline" onClick={clearFilters}>{text.filters.clear}</Button>
          ) : query.status === 'published' && can(role, 'video.upload') ? (
            <Button asChild>
              <Link href={`/${locale}/upload`}>
                <UploadCloud aria-hidden="true" className="me-2 h-4 w-4" />
                {t.studio.upload}
              </Link>
            </Button>
          ) : null}
        </div>
      ) : showingCalendar ? (
        <ScheduledVideoCalendar
          videos={items}
          viewType={query.calendarView}
          currentDate={currentDate}
          onNavigate={(date: Date, _view: View) => setCurrentDate(date)}
          onEventClick={(id) => router.push(`${base}/${encodeURIComponent(id)}/edit`)}
        />
      ) : (
        <>
          <table className="block w-full md:table">
            <thead className="sr-only md:not-sr-only md:table-header-group">
              <tr className="border-b border-border text-start text-xs text-muted-foreground">
                <th className="p-2">
                  <input type="checkbox" aria-label={text.selectAll} checked={allSelected} onChange={toggleAll} className="h-5 w-5" />
                </th>
                <th className="p-2 text-start font-medium">{text.columns.video}</th>
                <th className="p-2 text-start font-medium">{text.columns.date}</th>
                <th className="p-2 text-end font-medium">{text.columns.views}</th>
                <th className="p-2 text-end font-medium">{text.columns.comments}</th>
                <th className="p-2 text-end font-medium">{text.columns.likes}</th>
                <th className="p-2"><span className="sr-only">{text.columns.actions}</span></th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group">
              {items.map((video) => {
                const actions = rowActions(query.status, role);
                const edit = actionHref('edit', video);
                const shown = video.scheduledPublishDate && query.status === 'scheduled' ? video.scheduledPublishDate : video.dateCreated;
                return (
                  <tr key={video.id} data-testid="studio-video-row" className="mb-3 block rounded-md border border-border p-2 md:mb-0 md:table-row md:rounded-none md:border-0 md:border-b md:p-0">
                    <td className="block md:table-cell md:p-2">
                      <input
                        type="checkbox"
                        aria-label={text.selectVideo.replace('{title}', video.title)}
                        checked={selected.has(video.id)}
                        onChange={() => toggle(video.id)}
                        className="h-5 w-5"
                      />
                    </td>
                    <td className="block md:table-cell md:p-2">
                      <div className="flex items-center gap-3">
                        <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded bg-muted">
                          {video.thumbnailUrl?.trim() ? <Image src={video.thumbnailUrl} alt="" fill sizes="96px" className="object-cover" unoptimized /> : null}
                        </div>
                        <div className="min-w-0">
                          {edit && actions.includes('edit') ? (
                            <Link href={edit} dir="auto" className="block truncate font-medium text-foreground hover:underline" data-testid="studio-video-title">{video.title}</Link>
                          ) : (
                            <span dir="auto" className="block truncate font-medium text-foreground" data-testid="studio-video-title">{video.title}</span>
                          )}
                          <span className="mt-1 flex gap-1 text-xs text-muted-foreground">
                            {video.isPublic === false && <span className="rounded bg-muted px-1">{text.badges.private}</span>}
                            {video.isLive && <span className="rounded bg-muted px-1">{text.badges.live}</span>}
                            {typeof video.duration === 'number' && video.duration > 0 && video.duration <= 60 && <span className="rounded bg-muted px-1">{text.badges.short}</span>}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="block text-sm text-muted-foreground md:table-cell md:p-2">{video.scheduledPublishDate && query.status === 'scheduled' ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(shown)) : dateFormat.format(new Date(shown))}</td>
                    <td className="inline-block pe-3 text-sm md:table-cell md:p-2 md:text-end"><span className="md:sr-only">{text.columns.views}: </span>{numberFormat.format(video.views ?? 0)}</td>
                    <td className="inline-block pe-3 text-sm md:table-cell md:p-2 md:text-end"><span className="md:sr-only">{text.columns.comments}: </span>{numberFormat.format(video.commentsCount ?? 0)}</td>
                    <td className="inline-block pe-3 text-sm md:table-cell md:p-2 md:text-end"><span className="md:sr-only">{text.columns.likes}: </span>{numberFormat.format(video.likesCount ?? 0)}</td>
                    <td className="inline-block align-middle md:table-cell md:p-2 md:text-end">
                      {actions.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={text.rowActions.replace('{title}', video.title)} data-testid="studio-video-actions">
                              <MoreVertical aria-hidden="true" className="h-5 w-5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {actions.map((action) => {
                              const href = actionHref(action, video);
                              return href ? (
                                <DropdownMenuItem key={action} asChild><Link href={href}>{text.actions[action]}</Link></DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem key={action} onSelect={() => onAction(action, video)}>{text.actions[action]}</DropdownMenuItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {cursor && (
            <div className="mt-4 text-center">
              <Button variant="outline" onClick={() => void load(cursor)}>{text.loadMore}</Button>
            </div>
          )}
        </>
      )}

      <BulkEditDialog open={bulkEditOpen} count={selected.size} onOpenChange={setBulkEditOpen} onApply={applyBulkEdit} />

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pendingDelete && pendingDelete.ids.length > 1 ? text.confirmDelete.bulkTitle.replace('{count}', String(pendingDelete.ids.length)) : text.confirmDelete.title}</AlertDialogTitle>
            <AlertDialogDescription>{text.confirmDelete.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{text.confirmDelete.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteConfirmed()} data-testid="studio-confirm-delete">{text.confirmDelete.confirm}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
