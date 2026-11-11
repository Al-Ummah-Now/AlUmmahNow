'use client';

/**
 * One playlist in Manage Playlists: its details (name, description,
 * visibility, cover), its order (manual, or automatic by a field in either
 * direction) and its videos.
 *
 *   Manual order → drag a row by its handle (keyboard: Space, arrows, Space),
 *                  or use Move up / Move down; each move is saved at once
 *   Automatic    → the server sorts; rows show no handles
 *   Add videos   → the channel picker (videos already in it are marked), then
 *                  one bulk add; large adds continue in the background with
 *                  progress (BulkAddNotice)
 *   Remove       → per row, unavailable videos included
 *
 * Every failure shows a friendly message and goes to the error reporter.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from '@/components/common/AppLink';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckCircle2, ExternalLink, Film, GripVertical, ListPlus, Trash2, X } from 'lucide-react';
import type { PlaylistBulkAddResult, PlaylistManageItem } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  addVideosToPlaylist,
  getPlaylistManageItems,
  removeVideosFromPlaylist,
  reorderPlaylistVideos,
  savePlaylist,
  type PlaylistManagePage,
} from '@/lib/api/playlists';
import { reportError } from '@/lib/errors/reporter';
import { pairOf, pairPayload, playlistName } from '@/lib/playlists/playlist-names';
import { getPlaylistHref } from '@/lib/playlists/playlist-utils';
import '@/theme/playlist-tools.css';
import BulkAddNotice, { type BulkAddOutcome } from './BulkAddNotice';
import PlaylistDetailsFields, { PlaylistSortFields, type PlaylistDetailsValue } from './PlaylistDetailsFields';
import VideoPicker, { type PickedVideo } from './VideoPicker';
import { counted, fill, formatDuration, localTitle } from './text';
import { LABEL, MUTED, NOTICE, TEXT } from './styles';

interface Props {
  channelId: string;
  playlistId: string;
  /** A background add started when the playlist was created (?job=). */
  initialJobId?: string;
}

/** Entries fetched per request while loading the whole playlist. */
const ITEMS_PAGE = 100;
/** Video thumbnails offered as the cover. */
const COVER_CHOICES = 12;

type Meta = PlaylistManagePage['playlist'];
type Status = { tone: 'success' | 'error'; message: string; ref?: string } | null;
interface Notice { key: string; outcome: BulkAddOutcome; videoIds: string[]; justCreated?: boolean }

function detailsOf(meta: Meta): PlaylistDetailsValue {
  // A playlist from before bilingual names: its name goes to the language it's written in
  const name = pairOf(meta.title, meta.titleLocalized);
  const about = pairOf(meta.description, meta.descriptionLocalized);
  return {
    titleEn: name.en,
    titleAr: name.ar,
    descriptionEn: about.en,
    descriptionAr: about.ar,
    isPublic: meta.isPublic,
    sortMode: meta.sortMode,
    sortField: meta.sortField,
    sortDirection: meta.sortDirection,
  };
}

/** A queued add started elsewhere (create form): the notice follows the job. */
function queuedOutcome(jobId: string): BulkAddOutcome {
  const result: PlaylistBulkAddResult = { status: 'queued', added: 0, alreadyInPlaylist: 0, notInChannel: 0, pending: 0, videosCount: 0, jobId };
  return { kind: 'result', result };
}

function StatusLine({ status }: { status: Status }) {
  const { t } = useLanguage();
  if (!status) return null;
  return (
    <div role={status.tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2 rounded-[var(--r-md)] px-3 py-2 text-sm ${NOTICE[status.tone]}`}>
      {status.tone === 'error' ? <AlertTriangle className="h-4 w-4 flex-none" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4 flex-none" aria-hidden="true" />}
      <span>
        {status.message}
        {status.ref && <span className="block text-xs">{fill(t.playlistTools.errorRef, { ref: status.ref })}</span>}
      </span>
    </div>
  );
}

interface RowProps {
  item: PlaylistManageItem;
  index: number;
  total: number;
  manual: boolean;
  busy: boolean;
  onMove: (from: number, to: number) => void;
  onRemove: (item: PlaylistManageItem) => void;
}

function PlaylistItemRow({ item, index, total, manual, busy, onMove, onRemove }: RowProps) {
  const { t, lang } = useLanguage();
  const p = t.playlistTools;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !manual || busy });
  const video = item.video;
  const title = video ? localTitle(video, lang) : p.unavailable;
  const duration = formatDuration(video?.duration);
  // Alt+↑ / Alt+↓ anywhere on the row moves it (the bulk-rename order's shortcut)
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!manual || busy || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
    event.preventDefault();
    const to = event.key === 'ArrowUp' ? index - 1 : index + 1;
    if (to < 0 || to >= total) return;
    onMove(index, to);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="playlist-item"][data-video-id="${item.id.replace(/["\\]/g, '\\$&')}"] [data-testid="playlist-item-handle"]`)?.focus());
  };
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onKeyDown={onKeyDown}
      className="pl-row flex flex-wrap items-center gap-x-2 gap-y-1 p-2 sm:flex-nowrap sm:gap-3"
      data-dragging={isDragging || undefined}
      data-unavailable={video ? undefined : true}
      data-testid="playlist-item"
      data-video-id={item.id}
    >
      {manual && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          className="pl-handle flex-none"
          aria-label={fill(p.dragHandle, { title })}
          disabled={busy}
          data-testid="playlist-item-handle"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
      <span className="pl-pos flex-none" aria-hidden="true">{index + 1}</span>
      <span className={`pl-thumb flex-none ${video?.isShort ? 'pl-thumb-short' : ''}`}>
        {video?.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <Film className="h-5 w-5" aria-hidden="true" />
        )}
        {duration && <span className="pl-dur">{duration}</span>}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`line-clamp-2 text-sm font-medium ${TEXT}`}>{title}</span>
        {video ? (
          <span className="mt-1 flex flex-wrap gap-1">
            {video.isShort && <span className="bdg bdg-ok">{p.shortBadge}</span>}
            {video.isPublic === false && <span className="bdg pl-bdg-muted">{t.playlist.privateLabel}</span>}
            {video.uploadStatus && video.uploadStatus !== 'ready' && <span className="bdg pl-bdg-muted">{p.processingBadge}</span>}
          </span>
        ) : (
          <span className={`mt-0.5 block text-xs ${MUTED}`}>{p.unavailableHelp}</span>
        )}
      </span>
      {/* Phones: the actions wrap onto their own line so the title keeps the row's width */}
      <span className="flex w-full flex-none items-center justify-end sm:w-auto">
        {manual && (
          <>
            <button type="button" className="b b-ghost b-icon" onClick={() => onMove(index, index - 1)} disabled={busy || index === 0} aria-label={fill(p.moveUpTitle, { title })} title={fill(p.moveUpTitle, { title })} data-testid="playlist-item-up">
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className="b b-ghost b-icon" onClick={() => onMove(index, index + 1)} disabled={busy || index === total - 1} aria-label={fill(p.moveDownTitle, { title })} title={fill(p.moveDownTitle, { title })} data-testid="playlist-item-down">
              <ArrowDown className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
        <button type="button" className="b b-ghost b-icon text-[var(--fanous-color-error-text)]" onClick={() => onRemove(item)} disabled={busy} aria-label={fill(p.removeTitle, { title })} title={fill(p.removeTitle, { title })} data-testid="playlist-item-remove">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}

export default function PlaylistEditor({ channelId, playlistId, initialJobId }: Props) {
  const { t, lang, isRTL } = useLanguage();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const p = t.playlistTools;
  const [meta, setMeta] = useState<Meta | null>(null);
  const [items, setItems] = useState<PlaylistManageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ status: number | null; ref?: string } | null>(null);
  const [details, setDetails] = useState<PlaylistDetailsValue | null>(null);
  const [cover, setCover] = useState<string | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsStatus, setDetailsStatus] = useState<Status>(null);
  const [savingSort, setSavingSort] = useState(false);
  const [listStatus, setListStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<PickedVideo[]>([]);
  const [adding, setAdding] = useState(false);
  const [notices, setNotices] = useState<Notice[]>(() => (initialJobId ? [{ key: `job-${initialJobId}`, outcome: queuedOutcome(initialJobId), videoIds: [], justCreated: true }] : []));
  const loadId = useRef(0);

  const load = useCallback(async (keepDetails = false) => {
    const id = ++loadId.current;
    setLoading(true);
    try {
      const all: PlaylistManageItem[] = [];
      let offset: number | null = 0;
      let latest: Meta | null = null;
      while (offset !== null) {
        const answer = await getPlaylistManageItems(playlistId, { offset, limit: ITEMS_PAGE }, { channelId });
        if (id !== loadId.current) return;
        if (!answer.ok) {
          const ref = answer.status === 404 ? undefined : reportError(new Error('Loading a playlist for its editor failed'), { shown: true, status: answer.status ?? undefined, extra: { step: 'playlist-editor-load', playlistId } });
          setLoadError({ status: answer.status, ref });
          return;
        }
        latest = answer.data.playlist;
        all.push(...answer.data.items);
        offset = answer.data.nextOffset;
      }
      setLoadError(null);
      setItems(all);
      if (latest) {
        setMeta(latest);
        if (!keepDetails) {
          setDetails(detailsOf(latest));
          setCover(latest.coverVideoId ?? null);
        } else {
          // The order may have changed on the server; the typed details stay
          setDetails((prev) => (prev ? { ...prev, sortMode: latest!.sortMode, sortField: latest!.sortField, sortDirection: latest!.sortDirection } : detailsOf(latest!)));
        }
      }
    } catch (error) {
      if (id !== loadId.current) return;
      setLoadError({ status: null, ref: reportError(error, { shown: true, extra: { step: 'playlist-editor-load', playlistId } }) });
    } finally {
      if (id === loadId.current) setLoading(false);
    }
  }, [playlistId, channelId]);

  useEffect(() => {
    void load();
  }, [load]);

  const manual = meta?.sortMode !== 'auto';
  const inPlaylist = useMemo(() => new Set(items.map((item) => item.id)), [items]);
  const titleOf = (item: PlaylistManageItem) => (item.video ? localTitle(item.video, lang) : p.unavailable);
  const playlistTitle = meta ? playlistName(meta, lang) : '';

  // ── Details ───────────────────────────────────────────────────────────
  const saveDetails = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!details || !meta) return;
    const name = pairPayload({ en: details.titleEn, ar: details.titleAr });
    const about = pairPayload({ en: details.descriptionEn, ar: details.descriptionAr });
    const title = name.base;
    if (!title) {
      setDetailsStatus({ tone: 'error', message: p.nameOneLanguage });
      return;
    }
    setSavingDetails(true);
    setDetailsStatus(null);
    try {
      const answer = await savePlaylist(playlistId, {
        title,
        // Sent whole: an emptied language is cleared (it then shows the other)
        titleLocalized: name.localized,
        description: about.base,
        descriptionLocalized: about.localized,
        isPublic: details.isPublic,
        coverVideoId: cover,
      }, { channelId });
      if (answer.ok) {
        setMeta({ ...meta, title, titleLocalized: name.localized, description: about.base, descriptionLocalized: about.localized, isPublic: details.isPublic, coverVideoId: cover ?? undefined });
        setDetailsStatus({ tone: 'success', message: p.detailsSaved });
      } else {
        const ref = reportError(new Error('Saving playlist details failed'), { shown: true, status: answer.status ?? undefined, extra: { step: 'playlist-details-save', playlistId } });
        setDetailsStatus({ tone: 'error', message: answer.status === 403 ? fill(p.addForbidden, { title: playlistTitle }) : t.playlist.updateFailed, ref });
      }
    } catch (error) {
      setDetailsStatus({ tone: 'error', message: t.playlist.updateFailed, ref: reportError(error, { shown: true, extra: { step: 'playlist-details-save', playlistId } }) });
    } finally {
      setSavingDetails(false);
    }
  };

  // ── Order ─────────────────────────────────────────────────────────────
  const changeSort = async (next: PlaylistDetailsValue) => {
    if (!details || !meta) return;
    const previous = details;
    setDetails(next);
    if (next.sortMode === previous.sortMode && next.sortField === previous.sortField && next.sortDirection === previous.sortDirection) return;
    setSavingSort(true);
    setListStatus(null);
    try {
      const answer = await savePlaylist(playlistId, { sortMode: next.sortMode, sortField: next.sortField, sortDirection: next.sortDirection }, { channelId });
      if (!answer.ok) {
        setDetails(previous);
        setListStatus({ tone: 'error', message: p.sortFailed, ref: reportError(new Error('Changing the playlist order failed'), { shown: true, status: answer.status ?? undefined, extra: { step: 'playlist-sort-save', playlistId, sortMode: next.sortMode, sortField: next.sortField } }) });
        return;
      }
      setListStatus({ tone: 'success', message: p.sortSaved });
      await load(true);
    } catch (error) {
      setDetails(previous);
      setListStatus({ tone: 'error', message: p.sortFailed, ref: reportError(error, { shown: true, extra: { step: 'playlist-sort-save', playlistId } }) });
    } finally {
      setSavingSort(false);
    }
  };

  const saveOrder = async (next: PlaylistManageItem[], previous: PlaylistManageItem[]) => {
    setItems(next);
    setBusy(true);
    try {
      const answer = await reorderPlaylistVideos(playlistId, next.map((item) => item.id), { channelId });
      if (answer.ok) {
        // The stored order wins (someone may have added a video meanwhile)
        const byId = new Map(next.map((item) => [item.id, item]));
        const stored = answer.data.videos.map((id, position) => ({ ...(byId.get(id) ?? { id, video: null }), position }));
        setItems(stored);
        setListStatus({ tone: 'success', message: p.orderSaved });
        if (stored.some((item) => !byId.has(item.id))) void load(true);
        return;
      }
      setItems(previous);
      if (answer.status === 409) {
        // Switched to automatic elsewhere: show the server's order
        void load(true);
      }
      setListStatus({ tone: 'error', message: answer.status === 409 ? p.autoNoDrag : t.playlist.updateFailed, ref: answer.status === 409 ? undefined : reportError(new Error('Saving the playlist order failed'), { shown: true, status: answer.status ?? undefined, extra: { step: 'playlist-reorder', playlistId } }) });
    } catch (error) {
      setItems(previous);
      setListStatus({ tone: 'error', message: t.playlist.updateFailed, ref: reportError(error, { shown: true, extra: { step: 'playlist-reorder', playlistId } }) });
    } finally {
      setBusy(false);
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    void saveOrder(arrayMove(items, from, to), items);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((item) => item.id === active.id);
    const to = items.findIndex((item) => item.id === over.id);
    if (from >= 0 && to >= 0) move(from, to);
  };

  const positionOf = (id: string | number) => items.findIndex((item) => item.id === id) + 1;
  const nameOf = (id: string | number) => {
    const item = items.find((entry) => entry.id === id);
    return item ? titleOf(item) : '';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => fill(p.dndPickedUp, { title: nameOf(active.id), position: positionOf(active.id), total: items.length }),
    onDragOver: ({ active, over }) => (over ? fill(p.dndMoved, { title: nameOf(active.id), position: positionOf(over.id), total: items.length }) : undefined),
    onDragEnd: ({ active, over }) => (over ? fill(p.dndDropped, { title: nameOf(active.id), position: positionOf(over.id), total: items.length }) : undefined),
    onDragCancel: ({ active }) => fill(p.dndCancelled, { title: nameOf(active.id) }),
  };

  // ── Remove ────────────────────────────────────────────────────────────
  const remove = async (item: PlaylistManageItem) => {
    const previous = items;
    const title = titleOf(item);
    const confirmed = await confirm({
      title: t.confirmDialog.removeFromPlaylistTitle,
      description: t.confirmDialog.removeFromPlaylistBody.replace('{title}', title),
      confirmLabel: t.confirmDialog.remove,
      testId: 'playlist-editor-remove-dialog',
    });
    if (!confirmed) return;
    setItems(items.filter((entry) => entry.id !== item.id));
    setBusy(true);
    try {
      const answer = await removeVideosFromPlaylist(playlistId, [item.id], { channelId });
      if (answer.ok) {
        if (cover === item.id) setCover(null);
        setListStatus({ tone: 'success', message: fill(p.removedOne, { title }) });
        return;
      }
      setItems(previous);
      setListStatus({ tone: 'error', message: t.playlist.updateFailed, ref: reportError(new Error('Removing a video from a playlist failed'), { shown: true, status: answer.status ?? undefined, extra: { step: 'playlist-remove', playlistId, videoId: item.id } }) });
    } catch (error) {
      setItems(previous);
      setListStatus({ tone: 'error', message: t.playlist.updateFailed, ref: reportError(error, { shown: true, extra: { step: 'playlist-remove', playlistId, videoId: item.id } }) });
    } finally {
      setBusy(false);
    }
  };

  // ── Add ───────────────────────────────────────────────────────────────
  const addPicked = async () => {
    if (picked.length === 0) {
      setListStatus({ tone: 'error', message: p.noVideosChosen });
      return;
    }
    const videoIds = picked.map((v) => v.id);
    setAdding(true);
    setListStatus(null);
    let outcome: BulkAddOutcome;
    try {
      const answer = await addVideosToPlaylist(playlistId, videoIds, { channelId });
      outcome = answer.ok
        ? { kind: 'result', result: answer.data }
        : { kind: 'request-failed', status: answer.status, ref: reportError(new Error('Adding videos to a playlist failed'), { shown: true, status: answer.status ?? undefined, extra: { step: 'playlist-editor-add', playlistId, count: videoIds.length } }) };
    } catch (error) {
      outcome = { kind: 'request-failed', status: null, ref: reportError(error, { shown: true, extra: { step: 'playlist-editor-add', playlistId, count: videoIds.length } }) };
    }
    setNotices((prev) => [{ key: `add-${Date.now()}`, outcome, videoIds }, ...prev]);
    setAdding(false);
    if (outcome.kind === 'result') {
      setPicked([]);
      setPicking(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  const Back = isRTL ? ArrowRight : ArrowLeft;
  const allHref = `/${lang}/settings/channel/${channelId}/playlists`;

  if (loadError && !meta) {
    return (
      <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <Link href={allHref} className="b b-ghost b-sm"><Back className="h-4 w-4" aria-hidden="true" />{p.allPlaylists}</Link>
        <div role="alert" className={`flex flex-wrap items-center justify-between gap-3 rounded-[var(--r-md)] px-4 py-3 text-sm ${NOTICE.error}`} data-testid="playlist-editor-error">
          <span>
            {loadError.status === 404 ? t.playlist.loadFailed : p.loadItemsFailed}
            {loadError.ref && <span className="block text-xs">{fill(p.errorRef, { ref: loadError.ref })}</span>}
          </span>
          <button type="button" className="b b-secondary b-sm" onClick={() => void load()}>{p.tryAgain}</button>
        </div>
      </div>
    );
  }

  if (!meta || !details) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label={p.loadingVideos}>
        <span className="sk block h-8 w-64" />
        <div className="c space-y-3"><span className="sk block h-10" /><span className="sk block h-24" /></div>
        <div className="c space-y-3">{Array.from({ length: 4 }, (_, i) => <span key={i} className="sk block h-14" />)}</div>
      </div>
    );
  }

  const coverChoices = items.filter((item) => item.video?.thumbnailUrl).slice(0, COVER_CHOICES);
  // A chosen cover beyond the first few stays offered
  const chosenCover = cover ? items.find((item) => item.id === cover && item.video?.thumbnailUrl) : undefined;
  if (chosenCover && !coverChoices.includes(chosenCover)) coverChoices.push(chosenCover);

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'} data-testid="playlist-editor">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href={allHref} className="b b-ghost b-sm -ms-3 mb-1"><Back className="h-4 w-4" aria-hidden="true" />{p.allPlaylists}</Link>
          <h1 className={`truncate text-2xl font-bold ${TEXT}`}>{playlistTitle}</h1>
          <p className={`text-sm ${MUTED}`}>{counted(items.length, p.countOne, p.countOther)}</p>
        </div>
        <Link href={getPlaylistHref(lang, playlistId)} className="b b-secondary b-sm">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
          {t.playlist.viewPlaylist}
        </Link>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        {/* Details */}
        <form onSubmit={saveDetails} className="c space-y-5" aria-labelledby="playlist-details-heading" noValidate data-testid="playlist-details-form">
          <h2 id="playlist-details-heading" className={`text-lg font-semibold ${TEXT}`}>{p.details}</h2>
          <PlaylistDetailsFields value={details} onChange={(next) => setDetails({ ...next, sortMode: details.sortMode, sortField: details.sortField, sortDirection: details.sortDirection })} idPrefix="playlist-edit" hideSort disabled={savingDetails} />

          <fieldset>
            <legend className={LABEL}>{p.coverLabel}</legend>
            <p className={`mb-2 text-xs ${MUTED}`}>{p.coverHelp}</p>
            {coverChoices.length === 0 ? (
              <p className={`text-sm ${MUTED}`}>{p.coverNoVideos}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2" data-testid="playlist-cover-choices">
                <label className="pl-cover grid aspect-video place-items-center p-1 text-center text-xs font-medium" data-checked={cover === null || undefined}>
                  <input type="radio" name="playlist-cover" className="pl-hit" checked={cover === null} onChange={() => setCover(null)} disabled={savingDetails} />
                  <span className={TEXT}>{p.coverAuto}</span>
                </label>
                {coverChoices.map((item) => {
                  const title = titleOf(item);
                  return (
                    <label key={item.id} className="pl-cover aspect-video" data-checked={cover === item.id || undefined} title={fill(p.coverUse, { title })}>
                      <input type="radio" name="playlist-cover" className="pl-hit" checked={cover === item.id} onChange={() => setCover(item.id)} aria-label={fill(p.coverUse, { title })} disabled={savingDetails} />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.video!.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <StatusLine status={detailsStatus} />
          <button type="submit" className="b b-primary w-full" disabled={savingDetails} data-testid="playlist-details-save">
            {savingDetails ? t.common.saving : t.common.save}
          </button>
        </form>

        {/* Order and videos */}
        <section className="c space-y-5" aria-labelledby="playlist-videos-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="playlist-videos-heading" className={`text-lg font-semibold ${TEXT}`}>
              {p.videosHeading}
              <span className={`ms-2 text-sm font-normal ${MUTED}`} data-testid="playlist-item-count">{counted(items.length, p.countOne, p.countOther)}</span>
            </h2>
            {!picking && (
              <button type="button" className="b b-primary b-sm" onClick={() => setPicking(true)} data-testid="playlist-add-videos">
                <ListPlus className="h-4 w-4" aria-hidden="true" />
                {p.addVideos}
              </button>
            )}
          </div>

          <PlaylistSortFields value={details} onChange={(next) => void changeSort(next)} idPrefix="playlist-order" disabled={savingSort || busy} />

          {notices.length > 0 && (
            <div className="space-y-2">
              {notices.map((notice) => (
                <BulkAddNotice
                  key={notice.key}
                  playlistId={playlistId}
                  playlistTitle={playlistTitle}
                  channelId={channelId}
                  outcome={notice.outcome}
                  videoIds={notice.videoIds}
                  justCreated={notice.justCreated}
                  onChanged={() => void load(true)}
                />
              ))}
            </div>
          )}

          {picking && (
            <div className="pl-tray space-y-3 rounded-[var(--r-lg)] p-4" data-testid="playlist-add-panel">
              <div className="flex items-center justify-between gap-2">
                <h3 className={`font-semibold ${TEXT}`}>{p.pickerTitle}</h3>
                <button type="button" className="b b-ghost b-icon" onClick={() => { setPicking(false); setPicked([]); }} aria-label={t.playlist.upload.cancel}>
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <VideoPicker channelId={channelId} selected={picked} onChange={setPicked} excludeIds={inPlaylist} idPrefix="playlist-add" />
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" className="b b-secondary" onClick={() => { setPicking(false); setPicked([]); }} disabled={adding}>{t.playlist.upload.cancel}</button>
                <button type="button" className="b b-primary" onClick={() => void addPicked()} disabled={adding || picked.length === 0} data-testid="playlist-add-submit">
                  {adding ? p.adding : picked.length > 0 ? counted(picked.length, p.addSelectedOne, p.addSelectedOther) : p.addVideos}
                </button>
              </div>
            </div>
          )}

          <StatusLine status={listStatus} />

          {items.length === 0 ? (
            <div className="empty">
              <Film className="h-10 w-10" aria-hidden="true" />
              <p>{p.emptyEditor}</p>
            </div>
          ) : (
            <>
              <p id="playlist-reorder-hint" className={`text-xs ${MUTED}`}>{manual ? p.reorderHint : p.autoNoDrag}</p>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
                accessibility={{ announcements, screenReaderInstructions: { draggable: p.reorderHint } }}
              >
                <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                  <ol className={`space-y-1 ${loading ? 'opacity-70' : ''}`} aria-busy={loading || busy} data-testid="playlist-items">
                    {items.map((item, index) => (
                      <PlaylistItemRow key={item.id} item={item} index={index} total={items.length} manual={manual} busy={busy || savingSort} onMove={move} onRemove={(entry) => void remove(entry)} />
                    ))}
                  </ol>
                </SortableContext>
              </DndContext>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
