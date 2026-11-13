"use client";

import { FilterCombobox, type FilterItem } from '@/components/ui/FilterCombobox';
import { matchesSearch } from '@/lib/search/match';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import React, { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Search, UploadCloud, Trash2, Eye, Edit, ListPlus, MoreVertical, Check } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { VideoObject } from '@/interfaces';
import { listVideos, deleteVideo } from '@/lib/api/videos';
import { channelAllows } from '@/lib/channel-utils';
import { getChannelById } from '@/lib/api/channels';
import { FitImage } from '@/components/VideoThumbnail/FitImage';
import Link from '@/components/common/AppLink';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import { logger } from '@/lib/logger-client';
import { formatViews } from '@/lib/format/videoMeta';
import { reportError } from '@/lib/errors/reporter';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import AddToPlaylistDialog from '@/components/playlists/AddToPlaylistDialog';
import { toPicked, type PickedVideo } from '@/components/playlists/VideoPicker';
import { fill } from '@/components/playlists/text';
import { useConfirm } from '@/components/ui/confirm-dialog';
import '@/theme/playlist-tools.css';
import { publishedDateOf } from '@/lib/format/videoMeta';

type FilterStatus = 'all' | 'ready' | 'processing' | 'uploading' | 'failed';
type FilterPrivacy = 'all' | 'public' | 'private';
type SortBy = 'date' | 'views' | 'title';

const VIDEO_PAGE_SIZE = 100;
const MAX_VIDEO_PAGES = 10;

export default function ChannelVideosPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const router = useRouter();
  const params = useParams();
  const channelId = params.id as string;
  const locale = params.locale as string;

  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [filteredVideos, setFilteredVideos] = useState<VideoObject[]>([]);
  const [channelName, setChannelName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [privacyFilter, setPrivacyFilter] = useState<FilterPrivacy>('all');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  // "Add to playlist": the videos it adds, in the order shown (null: closed)
  const [playlistVideos, setPlaylistVideos] = useState<PickedVideo[] | null>(null);
  // A failed delete, shown inline above the list
  const [actionError, setActionError] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Check channel ownership
  useEffect(() => {
    const checkOwnership = async () => {
      // The owner, a channel admin or an editor manages the channel's videos
      const ownershipCheck = await channelAllows(channelId, 'video.edit');
      setIsOwner(ownershipCheck);

      if (!ownershipCheck) {
        router.push(`/${locale}/channels/${channelId}`);
      }
    };

    if (channelId) {
      checkOwnership();
    }
  }, [channelId, router, locale]);

  // Fetch videos and channel for this channel. Keyed on the user's id: the user
  // object is re-created when the session settles, and a second full load would
  // remount every card (closing an open menu) and flash the grid.
  const userId = user?.id;
  useEffect(() => {
    const fetchData = async () => {
      if (!userId || !isOwner) return;

      setLoading(true);
      try {
        // Fetch videos and channel in parallel
        // Management lists every video (shorts, live, private): the channel
        // endpoint is the public Videos tab and hides shorts and live streams.
        // /api/videos?channelId= pages this channel from the index; follow the cursor.
        const loadAllVideos = async () => {
          const all: VideoObject[] = [];
          let cursor: string | undefined;
          for (let page = 0; page < MAX_VIDEO_PAGES; page++) {
            const result = await listVideos({ channelId, limit: VIDEO_PAGE_SIZE, cursor }, { channelId });
            if (!result) break;
            all.push(...result.data);
            // api-videos returns the cursor at the top level; the shared type nests it under `pagination`
            cursor = (result as { cursor?: string }).cursor || result.pagination?.nextCursor || result.pagination?.cursor || undefined;
            if (!cursor) break;
          }
          return all;
        };

        const [allVideos, channel] = await Promise.all([
          loadAllVideos(),
          getChannelById(channelId)
        ]);

        if (channel) {
          setChannelName(channel.nameLocalized?.[locale] || channel.name || '');
        }

        logger.debug('Channel videos loaded', { channelId, count: allVideos.length });
        setVideos(allVideos);
        setFilteredVideos(allVideos);
      } catch (error) {
        reportError(error, { extra: { step: 'video-management-load', channelId } });
      } finally {
        setLoading(false);
      }
    };

    if (isOwner) {
      fetchData();
    }
  }, [userId, channelId, isOwner, locale]);

  // Suggestions under the search box: this list's videos, in the viewer's language
  const searchItems = useMemo<FilterItem[]>(() => videos.map((video) => ({
    id: video.id,
    label: getLocalizedValue(video.titleLocalized, video.title, locale),
    keywords: [video.title, ...Object.values(video.titleLocalized ?? {})],
    thumbnailUrl: video.thumbnailUrl || undefined,
    thumbnailShape: 'wide' as const,
  })), [videos, locale]);

  // Apply filters and search
  useEffect(() => {
    let filtered = [...videos];

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter((video) =>
        matchesSearch(searchQuery, video.title, ...Object.values(video.titleLocalized ?? {}))
      );
    }

    // Privacy filter
    if (privacyFilter !== 'all') {
      filtered = filtered.filter((video) =>
        privacyFilter === 'public' ? video.isPublic : !video.isPublic
      );
    }

    // Sort
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'date':
          return new Date(publishedDateOf(b) ?? 0).getTime() - new Date(publishedDateOf(a) ?? 0).getTime();
        case 'views':
          return (b.views || 0) - (a.views || 0);
        case 'title':
          return a.title.localeCompare(b.title);
        default:
          return 0;
      }
    });

    setFilteredVideos(filtered);
  }, [videos, searchQuery, statusFilter, privacyFilter, sortBy]);

  const handleSelectVideo = (videoId: string) => {
    const newSelected = new Set(selectedVideos);
    if (newSelected.has(videoId)) {
      newSelected.delete(videoId);
    } else {
      newSelected.add(videoId);
    }
    setSelectedVideos(newSelected);
  };

  const handleSelectAll = () => {
    if (selectedVideos.size === filteredVideos.length) {
      setSelectedVideos(new Set());
    } else {
      setSelectedVideos(new Set(filteredVideos.map((v) => v.id)));
    }
  };

  const addSelectedToPlaylist = () => {
    setPlaylistVideos(filteredVideos.filter((v) => selectedVideos.has(v.id)).map(toPicked));
  };

  const handleDeleteVideo = async (videoId: string) => {
    if (!user) return;

    setActionError(null);
    const video = videos.find((v) => v.id === videoId);
    const confirmed = await confirm({
      title: t.confirmDialog.deleteVideoTitle,
      description: video?.title ? `${video.title}: ${t.video.confirmDelete}` : t.video.confirmDelete,
      confirmLabel: t.common.delete,
      testId: 'video-delete-dialog',
    });
    if (!confirmed) return;

    try {
      const result = await deleteVideo(videoId, { channelId });
      if (result) {
        setVideos((prev) => prev.filter((v) => v.id !== videoId));
        setSelectedVideos((prev) => {
          const newSet = new Set(prev);
          newSet.delete(videoId);
          return newSet;
        });
      }
    } catch (error) {
      logger.error('Error deleting video', { error, videoId, channelId });
      setActionError(t.errors.genericError);
    }
  };

  const handleDeleteSelected = async () => {
    if (!user) return;
    if (selectedVideos.size === 0) return;

    setActionError(null);
    const count = selectedVideos.size.toString();
    // Bulk delete is high impact: the user types the delete word first
    const confirmed = await confirm({
      title: t.confirmDialog.deleteVideosTitle.replace('{count}', count),
      description: t.video.confirmDeleteMultiple?.replace('{count}', count),
      confirmLabel: t.common.delete,
      typeToConfirm: t.confirmDialog.deleteWord,
      testId: 'videos-bulk-delete-dialog',
    });
    if (!confirmed) return;

    try {
      const deletePromises = Array.from(selectedVideos).map((videoId) =>
        deleteVideo(videoId, { channelId })
      );

      await Promise.all(deletePromises);

      setVideos((prev) => prev.filter((v) => !selectedVideos.has(v.id)));
      setSelectedVideos(new Set());
    } catch (error) {
      logger.error('Error deleting videos', { error, selectedVideos: Array.from(selectedVideos), channelId });
      setActionError(t.errors.genericError);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return t.video.today;
    if (diffDays === 1) return t.video.yesterday;
    if (diffDays < 7) return t.video.daysAgo.replace('{count}', diffDays.toString());
    if (diffDays < 30) return t.video.weeksAgo.replace('{count}', Math.floor(diffDays / 7).toString());
    if (diffDays < 365) return t.video.monthsAgo.replace('{count}', Math.floor(diffDays / 30).toString());
    return t.video.yearsAgo.replace('{count}', Math.floor(diffDays / 365).toString());
  };

  if (!user || !isOwner) {
    return null;
  }

  return (
    <div className="min-h-screen p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        {/* Breadcrumb */}
        <ChannelSettingsBreadcrumb
          channelId={channelId}
          channelName={channelName}
          locale={locale}
          currentPage="videos"
          className="mb-6"
        />

        {/* Header */}
        <div className="mb-8">
          <div className="mb-4">
            <h1 className="text-3xl font-bold text-[var(--fanous-color-text-primary)]">{t.video.videoManagement}</h1>
          </div>
          {confirmDialog}
          {actionError && (
            <p role="alert" data-testid="videos-action-error" className="mb-4 rounded-md border border-[var(--fanous-color-error-text)] p-3 text-sm text-[var(--fanous-color-error-text)]">
              {actionError}
            </p>
          )}

          {/* Search and Filters */}
          <div className="c space-y-4 !p-4">
            {/* Search */}
            <FilterCombobox
              className="relative"
              value={searchQuery}
              onValueChange={setSearchQuery}
              items={searchItems}
              onPick={(item) => router.push(`/${locale}/video/${encodeURIComponent(item.id)}/edit`)}
              label={t.video.searchVideos ?? t.search.searchInputLabel}
              testId="channel-videos-search"
              inputClassName="f-input f-icon-start f-icon-end w-full py-2"
              icon={<Search className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-[var(--fanous-color-text-muted)]" size={20} aria-hidden="true" />}
            />

            {/* Filters Row */}
            <div className="flex flex-wrap gap-4">
              <ThemedSelectField
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
                aria-label={t.video.filterByStatus || t.video.allStatus}
                className="f-input px-4 py-2"
              >
                <option value="all">{t.video.allStatus}</option>
                <option value="ready">{t.video.ready}</option>
                <option value="processing">{t.video.processing}</option>
                <option value="uploading">{t.video.uploading}</option>
                <option value="failed">{t.video.failed}</option>
              </ThemedSelectField>

              <ThemedSelectField
                value={privacyFilter}
                onChange={(e) => setPrivacyFilter(e.target.value as FilterPrivacy)}
                aria-label={t.video.filterByPrivacy}
                className="f-input px-4 py-2"
              >
                <option value="all">{t.video.filterByPrivacy}</option>
                <option value="public">{t.video.public}</option>
                <option value="private">{t.video.private}</option>
              </ThemedSelectField>

              <ThemedSelectField
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                aria-label={t.search.sortBy}
                className="f-input px-4 py-2"
              >
                <option value="date">{t.video.sortByDate}</option>
                <option value="views">{t.video.sortByViews}</option>
                <option value="title">{t.video.sortByTitle}</option>
              </ThemedSelectField>
            </div>

            {/* Bulk Actions */}
            {selectedVideos.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-[var(--r-md)] bg-[var(--m-sel)] p-3" data-testid="video-bulk-bar">
                <span className="text-sm font-medium text-[var(--fanous-color-text-primary)]">
                  {t.video.videosSelected?.replace('{count}', selectedVideos.size.toString()) || `${selectedVideos.size} videos selected`}
                </span>
                <button type="button" onClick={handleSelectAll} className="b b-ghost b-sm">
                  {selectedVideos.size === filteredVideos.length ? t.video.deselectAll : t.video.selectAll}
                </button>
                <div className="flex-1" />
                <button type="button" onClick={addSelectedToPlaylist} className="b b-primary b-sm" data-testid="bulk-add-to-playlist">
                  <ListPlus size={16} aria-hidden="true" />
                  {t.playlistTools.addToPlaylist}
                </button>
                <button type="button" onClick={handleDeleteSelected} className="b b-ghost b-sm text-[var(--fanous-color-error-text)]">
                  <Trash2 size={16} aria-hidden="true" />
                  {t.video.deleteSelected}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Video Grid */}
        {loading ? (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label={t.common.loading}>
            {Array.from({ length: 8 }, (_, i) => <div key={i} className="sk aspect-video" />)}
          </div>
        ) : filteredVideos.length === 0 ? (
          <div className="c empty">
            <UploadCloud size={64} aria-hidden="true" />
            <h2 className="text-2xl font-semibold text-[var(--fanous-color-text-primary)]">{t.video.noVideosFound}</h2>
            <p>{t.video.uploadFirstVideo}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredVideos.map((video) => {
              const selected = selectedVideos.has(video.id);
              return (
              <div key={video.id} className="c !p-0 overflow-hidden" data-testid="managed-video" data-video-id={video.id}>
                {/* Checkbox */}
                <div className="relative">
                  <label className="absolute start-2 top-2 z-10 grid h-11 w-11 cursor-pointer place-items-center">
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => handleSelectVideo(video.id)}
                      aria-label={`${t.video.selectVideo || t.video.selectAll}: ${video.title}`}
                      className="peer pl-hit"
                      data-testid="managed-video-select"
                    />
                    <span className="ck pl-ck peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--fanous-color-focus-ring)]" data-on={selected || undefined} aria-hidden="true">{selected && <Check />}</span>
                  </label>

                  {/* Thumbnail */}
                  <div className="relative aspect-video w-full overflow-hidden bg-[var(--m-control)]">
                    {video.thumbnailUrl ? (
                      <FitImage
                        src={video.thumbnailUrl}
                        alt={video.title}
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                        videoWidth={video.width}
                        videoHeight={video.height}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-[var(--fanous-color-text-muted)]">
                        <UploadCloud size={48} aria-hidden="true" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="p-4">
                  <div className="mb-2 flex items-start gap-1">
                    <h3 className="line-clamp-2 flex-1 text-lg font-semibold text-[var(--fanous-color-text-primary)]">
                      {video.title}
                    </h3>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="b b-ghost b-icon -me-2 -mt-1 flex-none" aria-label={fill(t.playlistTools.moreActions, { title: video.title })} data-testid="managed-video-menu">
                          <MoreVertical className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setPlaylistVideos([toPicked(video)])} data-testid="managed-video-add-to-playlist">
                          <ListPlus className="h-4 w-4" aria-hidden="true" />
                          {t.playlistTools.addToPlaylist}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mb-3 flex items-center gap-2 text-sm text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)]">
                    <span>{formatViews(video.views, lang)}</span>
                    <span aria-hidden="true">•</span>
                    <span>{formatDate(video.dateCreated)}</span>
                  </div>

                  <div className="mb-3 flex items-center gap-2">
                    <span className={`bdg ${video.isPublic ? 'bdg-ok' : 'pl-bdg-muted'}`}>
                      {video.isPublic ? t.video.public : t.video.private}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Link href={`/${locale}/video/${encodeURIComponent(video.id)}`} className="b b-secondary b-sm flex-1">
                      <Eye size={16} aria-hidden="true" />
                      {t.common.view}
                    </Link>
                    <Link href={`/${locale}/video/${video.id}/edit`} className="b b-secondary b-sm flex-1">
                      <Edit size={16} aria-hidden="true" />
                      {t.common.edit}
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDeleteVideo(video.id)}
                      className="b b-ghost b-icon text-[var(--fanous-color-error-text)]"
                      aria-label={t.common.delete}
                    >
                      <Trash2 size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>

      <AddToPlaylistDialog
        open={playlistVideos !== null}
        onOpenChange={(open) => { if (!open) setPlaylistVideos(null); }}
        channelId={channelId}
        videos={playlistVideos ?? []}
      />
    </div>
  );
}
