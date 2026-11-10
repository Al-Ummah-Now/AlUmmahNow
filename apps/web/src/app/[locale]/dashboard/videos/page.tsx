'use client';

import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import { logger } from '@/lib/logger-client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, UploadCloud, Trash2, Eye, Edit, X, BarChart3, Pencil } from 'lucide-react';
import { formatViews } from '@/lib/format/videoMeta';
import { RelativeDate } from '@/components/RelativeDate';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { VideoObject } from '@/interfaces';
import { searchVideos, bulkDeleteVideos, bulkUpdateVideos } from '@/lib/api/videos';
import { BulkEditDialog } from '@/components/bulkEdit/BulkEditDialog';
import { applyChangesLocally, type BulkVideoChanges } from '@/lib/dashboard/bulk-edit';
import Image from 'next/image';
import Link from 'next/link';
import { compareDashboardVideos, type DashboardSort } from '@/lib/dashboard/sort-videos';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type FilterStatus = 'all' | 'ready' | 'processing' | 'uploading' | 'failed';
type FilterPrivacy = 'all' | 'public' | 'private';
type FilterDuration = 'all' | 'short' | 'standard' | 'long';
type SortBy = DashboardSort;
type VideoStatus = Exclude<FilterStatus, 'all'>;

/** Upload/processing status of a video; videos without one are treated as ready */
function getVideoStatus(video: VideoObject): VideoStatus {
  const status = video.uploadStatus;
  return status === 'processing' || status === 'uploading' || status === 'failed' ? status : 'ready';
}

export default function VideoDashboardPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const { user: multiAccountUser, loading: multiAccountLoading } = useMultiAccount();
  const router = useRouter();

  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [filteredVideos, setFilteredVideos] = useState<VideoObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [privacyFilter, setPrivacyFilter] = useState<FilterPrivacy>('all');
  const [durationFilter, setDurationFilter] = useState<FilterDuration>('all');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [videoToDelete, setVideoToDelete] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  // Redirect if not authenticated or no channels
  useEffect(() => {
    if (!user) {
      router.push(`/${lang}`);
      return;
    }

    // Redirect users without channels to main page, once the session's
    // channels have loaded (an unloaded session also has no channels)
    if (multiAccountLoading) return;
    const userChannels = multiAccountUser?.channels || [];
    if (userChannels.length === 0) {
      router.push(`/${lang}`);
    }
  }, [user, multiAccountUser, multiAccountLoading, router, lang]);

  // Fetch videos using single API call with filters
  useEffect(() => {
    // Ignore responses from superseded requests (rapid filter changes can
    // otherwise resolve out of order and show stale results)
    let cancelled = false;

    const fetchVideos = async () => {
      // Wait for the session's channels, but don't block on a background
      // session reload once channels are known
      if (!user || (multiAccountLoading && !multiAccountUser?.channels?.length)) return;

      setLoading(true);
      try {
        // Get all channels the user owns
        const userChannels = multiAccountUser?.channels || [];
        const channelIds = userChannels.map(ch => ch.id);

        if (channelIds.length === 0) {
          // User has no channels, show empty state
          setVideos([]);
          setFilteredVideos([]);
          setLoading(false);
          return;
        }

        // One search across all the user's channels, following the cursor so
        // owners with more than a page of videos see all of them (bounded)
        const MAX_PAGES = 10;
        const allVideos: VideoObject[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const result = await searchVideos(
            '', // Empty query to get all videos
            {
              channelIds, // Pass all user's channel IDs
              isOwner: true, // Mark as owner request for proper filtering
              durationFilter: durationFilter, // Use the new durationFilter parameter
              sortBy: sortBy === 'date' ? 'date' : sortBy === 'views' ? 'views' : 'relevance',
              sortOrder: 'desc',
            },
            {
              limit: 100, // Get more videos at once for owner dashboard
              ...(cursor && { cursor }),
            },
            {  channelId: channelIds[0] || user.id }
          );
          allVideos.push(...(result?.data || []));
          // GET /api/videos/search returns the next-page cursor at the top level
          cursor = (result as { cursor?: string } | null)?.cursor || result?.pagination?.nextCursor || undefined;
          if (!cursor) break;
        }

        logger.debug('[VideoDashboard] Fetched videos:', allVideos.length);
        logger.debug('[VideoDashboard] Video IDs:', allVideos.map(v => v.id));
        logger.debug('[VideoDashboard] Channel IDs used in query:', channelIds);

        // Filter videos by privacy setting (server-side filtering not yet available)
        let filtered = allVideos;
        if (privacyFilter !== 'all') {
          filtered = filtered.filter((video) =>
            privacyFilter === 'public' ? video.isPublic : !video.isPublic
          );
        }

        if (cancelled) return;
        setVideos(filtered);
        setFilteredVideos(filtered);
      } catch (error) {
        logger.error('Error fetching videos:', error);
        if (cancelled) return;
        setVideos([]);
        setFilteredVideos([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchVideos();
    return () => {
      cancelled = true;
    };
  }, [user, multiAccountUser?.channels, multiAccountLoading, durationFilter, sortBy, privacyFilter]);

  // Apply client-side search and status filtering
  useEffect(() => {
    let filtered = [...videos];

    // Search filter (client-side for immediate feedback)
    if (searchQuery) {
      filtered = filtered.filter((video) =>
        video.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Status filter (client-side; the search API has no status parameter)
    if (statusFilter !== 'all') {
      filtered = filtered.filter((video) => getVideoStatus(video) === statusFilter);
    }

    // Always sort on the client: the search API has no title sort (it was sent as
    // "relevance"), so choosing "Title" left the list in date order
    filtered.sort((a, b) => compareDashboardVideos(a, b, sortBy));

    setFilteredVideos(filtered);
  }, [videos, searchQuery, statusFilter, sortBy]);

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

  const handleDeleteVideo = (videoId: string) => {
    setVideoToDelete(videoId);
    setDeleteDialogOpen(true);
  };

  const confirmDeleteVideo = async () => {
    if (!user || !videoToDelete) return;

    // The API validates that the channelId header belongs to the caller, so
    // it must be the video's channel (not the user id)
    const target = videos.find((v) => v.id === videoToDelete);
    const channelId = target?.channelId || multiAccountUser?.channels?.[0]?.id;
    if (!channelId) {
      setErrorMessage(t.errors?.genericError || 'An error occurred');
      setDeleteDialogOpen(false);
      return;
    }

    try {
      // The bulk endpoint reports per-video success; DELETE /api/videos/:id
      // rejected every request on API builds before its param-name fix
      const result = await bulkDeleteVideos([videoToDelete], { channelId });
      if (result?.results?.[0]?.success) {
        setVideos((prev) => prev.filter((v) => v.id !== videoToDelete));
        setSelectedVideos((prev) => {
          const newSet = new Set(prev);
          newSet.delete(videoToDelete);
          return newSet;
        });
        setDeleteDialogOpen(false);
        setVideoToDelete(null);
      } else {
        setErrorMessage(t.errors?.genericError || 'An error occurred');
        setDeleteDialogOpen(false);
      }
    } catch (error) {
      logger.error('Error deleting video:', error);
      setErrorMessage(t.errors?.genericError || 'An error occurred');
      setDeleteDialogOpen(false);
    }
  };

  const handleDeleteSelected = () => {
    if (!user) return;
    if (selectedVideos.size === 0) return;
    setBulkDeleteDialogOpen(true);
  };

  const confirmBulkDelete = async () => {
    if (!user) return;

    try {
      // One bulk request per channel: the channelId header must be a channel
      // the caller owns, and selected videos can span several channels
      const fallbackChannelId = multiAccountUser?.channels?.[0]?.id || '';
      const idsByChannel = new Map<string, string[]>();
      Array.from(selectedVideos).forEach((videoId) => {
        const channelId = videos.find((v) => v.id === videoId)?.channelId || fallbackChannelId;
        idsByChannel.set(channelId, [...(idsByChannel.get(channelId) || []), videoId]);
      });

      const responses = await Promise.all(
        Array.from(idsByChannel.entries()).map(([channelId, videoIds]) =>
          bulkDeleteVideos(videoIds, { channelId })
        )
      );
      const result = responses.every((r) => r === null)
        ? null
        : {
            results: responses.flatMap((r, index) =>
              r
                ? r.results
                : Array.from(idsByChannel.values())[index].map((videoId) => ({ videoId, success: false }))
            ),
            summary: responses.reduce(
              (acc, r, index) => {
                const count = Array.from(idsByChannel.values())[index].length;
                return {
                  succeeded: acc.succeeded + (r?.summary.succeeded ?? 0),
                  failed: acc.failed + (r ? r.summary.failed : count),
                };
              },
              { succeeded: 0, failed: 0 }
            ),
          };

      if (!result) {
        setErrorMessage(t.errors?.genericError || 'Failed to delete videos');
        setBulkDeleteDialogOpen(false);
        return;
      }

      // Determine which videos were successfully deleted
      const successfullyDeleted = new Set<string>();
      const failedDeletes: string[] = [];

      result.results.forEach((deleteResult) => {
        if (deleteResult.success) {
          successfullyDeleted.add(deleteResult.videoId);
        } else {
          failedDeletes.push(deleteResult.videoId);
        }
      });

      // Only remove successfully deleted videos from UI
      if (successfullyDeleted.size > 0) {
        setVideos((prev) => prev.filter((v) => !successfullyDeleted.has(v.id)));
        setSelectedVideos((prev) => {
          const newSet = new Set(prev);
          successfullyDeleted.forEach(id => newSet.delete(id));
          return newSet;
        });
      }

      // Show appropriate message
      if (result.summary.failed > 0) {
        if (result.summary.succeeded > 0) {
          setErrorMessage(
            (t.video.bulkDeletePartial || t.errors?.genericError || '')
              .replace('{succeeded}', result.summary.succeeded.toString())
              .replace('{failed}', result.summary.failed.toString())
          );
        } else {
          setErrorMessage(t.errors?.genericError || 'Failed to delete videos');
        }
      }

      setBulkDeleteDialogOpen(false);
    } catch (error) {
      logger.error('Error deleting videos:', error);
      setErrorMessage(t.errors?.genericError || 'An error occurred');
      setBulkDeleteDialogOpen(false);
    }
  };

  /** Bulk edit (Epic 5.3): one request per channel, like bulk delete. Resolves true when every video was updated. */
  const applyBulkEdit = async (changes: BulkVideoChanges): Promise<boolean> => {
    if (!user) return false;
    const b = t.bulkEdit;
    try {
      const fallbackChannelId = multiAccountUser?.channels?.[0]?.id || '';
      const idsByChannel = new Map<string, string[]>();
      Array.from(selectedVideos).forEach((videoId) => {
        const channelId = videos.find((v) => v.id === videoId)?.channelId || fallbackChannelId;
        idsByChannel.set(channelId, [...(idsByChannel.get(channelId) || []), videoId]);
      });
      const responses = await Promise.all(
        Array.from(idsByChannel.entries()).map(([channelId, videoIds]) => bulkUpdateVideos(videoIds, changes, { channelId }))
      );
      const updated = new Set<string>();
      let failed = 0;
      responses.forEach((r, index) => {
        if (!r) {
          failed += Array.from(idsByChannel.values())[index].length;
          return;
        }
        r.results.forEach((res) => (res.success ? updated.add(res.videoId) : failed++));
      });

      if (updated.size > 0) {
        setVideos((prev) => prev.map((v) => (updated.has(v.id) ? applyChangesLocally(v, changes) : v)));
      }
      if (failed === 0) {
        setNoticeMessage(b.done.replace('{count}', updated.size.toString()));
        return true;
      }
      setErrorMessage(
        updated.size > 0
          ? b.partial.replace('{succeeded}', updated.size.toString()).replace('{failed}', failed.toString())
          : b.failed
      );
      return updated.size > 0;
    } catch (error) {
      logger.error('Error editing videos:', error);
      setErrorMessage(b.failed);
      return false;
    }
  };

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="mb-4">
            <h1 className="text-3xl font-bold dark:text-white">{t.video.videoManagement}</h1>
          </div>

          {/* Search and Filters */}
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute start-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="search"
                data-testid="dashboard-search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.video.searchVideos}
                aria-label={t.video.searchVideos}
                className="w-full ps-10 pe-10 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  data-testid="dashboard-search-clear"
                  className="absolute end-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label={t.video.clearSearch || t.search.clear}
                >
                  <X size={18} />
                </button>
              )}
            </div>

            {/* Filters Row */}
            <div className="flex flex-wrap gap-4">
              <ThemedSelectField
                data-testid="dashboard-filter-status"
                aria-label={t.video.allStatus}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
                className="px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="all">{t.video.allStatus}</option>
                <option value="ready">{t.video.ready}</option>
                <option value="processing">{t.video.processing}</option>
                <option value="uploading">{t.video.uploading}</option>
                <option value="failed">{t.video.failed}</option>
              </ThemedSelectField>

              <ThemedSelectField
                data-testid="dashboard-filter-privacy"
                aria-label={t.video.filterByPrivacy}
                value={privacyFilter}
                onChange={(e) => setPrivacyFilter(e.target.value as FilterPrivacy)}
                className="px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="all">{t.video.filterByPrivacy}</option>
                <option value="public">{t.video.public}</option>
                <option value="private">{t.video.private}</option>
              </ThemedSelectField>

              <ThemedSelectField
                data-testid="dashboard-filter-duration"
                aria-label={t.video.allVideos}
                value={durationFilter}
                onChange={(e) => setDurationFilter(e.target.value as FilterDuration)}
                className="px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="all">{t.video.allVideos || 'All Videos'}</option>
                <option value="short">{t.video.shortVideos || 'Short (≤3 min)'}</option>
                <option value="standard">{t.video.standardVideos || 'Standard (3-20 min)'}</option>
                <option value="long">{t.video.longVideos || 'Long (>20 min)'}</option>
              </ThemedSelectField>

              <ThemedSelectField
                data-testid="dashboard-sort"
                aria-label={t.search.sortBy}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="date">{t.video.sortByDate}</option>
                <option value="views">{t.video.sortByViews}</option>
                <option value="title">{t.video.sortByTitle}</option>
              </ThemedSelectField>
            </div>

            {/* Bulk Actions */}
            {selectedVideos.size > 0 && (
              <div data-testid="dashboard-bulk-actions" className="flex items-center gap-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <span data-testid="dashboard-selected-count" data-count={selectedVideos.size} className="text-sm font-medium dark:text-white">
                  {t.video.videosSelected?.replace('{count}', selectedVideos.size.toString()) || `${selectedVideos.size} videos selected`}
                </span>
                <button
                  onClick={handleSelectAll}
                  data-testid="dashboard-select-all"
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {selectedVideos.size === filteredVideos.length ? t.video.deselectAll : t.video.selectAll}
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => setBulkEditOpen(true)}
                  data-testid="dashboard-edit-selected"
                  className="flex items-center gap-2 px-4 py-2 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
                >
                  <Pencil size={16} aria-hidden="true" />
                  {t.bulkEdit.button}
                </button>
                <button
                  onClick={handleDeleteSelected}
                  data-testid="dashboard-delete-selected"
                  className="flex items-center gap-2 px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                >
                  <Trash2 size={16} />
                  {t.video.deleteSelected}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Video Grid */}
        {loading ? (
          <div data-testid="dashboard-loading" className="flex items-center justify-center py-20">
            <div className="text-gray-500 dark:text-gray-400">{t.common.loading}</div>
          </div>
        ) : filteredVideos.length === 0 ? (
          <div data-testid="dashboard-empty" className="bg-white dark:bg-gray-800 rounded-lg p-12 text-center">
            <UploadCloud size={64} className="mx-auto mb-4 text-gray-400" />
            <h2 className="text-2xl font-semibold mb-2 dark:text-white">{t.video.noVideosFound}</h2>
            <p className="text-gray-600 dark:text-gray-400">{t.video.uploadFirstVideo}</p>
          </div>
        ) : (
          <div data-testid="dashboard-video-grid" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredVideos.map((video) => (
              <div
                key={video.id}
                data-testid="dashboard-video-card"
                data-video-id={video.id}
                data-channel-id={video.channelId || ''}
                data-privacy={video.isPublic ? 'public' : 'private'}
                data-status={getVideoStatus(video)}
                data-duration={video.duration ?? ''}
                data-created={video.dateCreated || ''}
                onClick={(e) => {
                  // Only toggle selection if clicking on the card itself, not buttons or links
                  const target = e.target as HTMLElement;
                  if (
                    !target.closest('a') &&
                    !target.closest('button') &&
                    !target.closest('input[type="checkbox"]')
                  ) {
                    handleSelectVideo(video.id);
                  }
                }}
                className="video-card bg-white dark:bg-gray-900 text-black dark:text-white flex flex-col rounded-lg shadow-md overflow-hidden cursor-pointer hover:shadow-lg transition-shadow"
              >
                {/* Thumbnail with Checkbox */}
                <div className="relative w-full h-48 bg-gray-200 dark:bg-gray-700">
                  {/* Checkbox overlay */}
                  <input
                    type="checkbox"
                    checked={selectedVideos.has(video.id)}
                    onChange={() => handleSelectVideo(video.id)}
                    data-testid="dashboard-video-select"
                    aria-label={`${t.video.selectVideo || t.video.selectAll}: ${video.title}`}
                    className="absolute top-3 start-3 w-5 h-5 z-10 cursor-pointer"
                  />

                  {/* Thumbnail Image */}
                  {video.thumbnailUrl && video.thumbnailUrl.trim() !== '' ? (
                    <Image
                      src={video.thumbnailUrl}
                      alt={video.title}
                      fill
                      className="object-cover"
                      sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                      unoptimized
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                        const placeholder = e.currentTarget.nextElementSibling as HTMLElement;
                        if (placeholder) placeholder.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  
                  {/* Placeholder */}
                  <div
                    className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-700"
                    style={{ display: video.thumbnailUrl && video.thumbnailUrl.trim() !== '' ? 'none' : 'flex' }}
                  >
                    <svg
                      className="w-16 h-16 text-gray-400 dark:text-gray-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                </div>

                {/* Video Details - Matching VideoCard style */}
                <div className="p-4">
                  <h3 data-testid="dashboard-video-title" className="text-lg truncate font-[Tahoma]">
                    {video.title}
                  </h3>
                  <p className="text-sm truncate">{video.channelName || video.channel}</p>
                  <p className="text-sm" data-testid="dashboard-video-meta">
                    {formatViews(video.views, lang)} • <RelativeDate value={video.dateCreated} lang={lang} />
                  </p>

                  {/* Privacy + status badges */}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span
                      data-testid="dashboard-video-status"
                      className="inline-block px-2 py-1 rounded text-xs font-medium bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-300"
                    >
                      {t.video[getVideoStatus(video)]}
                    </span>
                    <span
                      data-testid="dashboard-video-privacy"
                      className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                        video.isPublic
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200'
                      }`}
                    >
                      {video.isPublic ? t.video.public : t.video.private}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-3">
                    <Link
                      href={`/${lang}/video?vid=${video.id}`}
                      data-testid="dashboard-video-view"
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-2 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
                    >
                      <Eye size={14} />
                      <span className="text-xs">{t.common.view}</span>
                    </Link>
                    <Link
                      href={`/${lang}/video/${video.id}/edit`}
                      data-testid="dashboard-video-edit"
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-2 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
                    >
                      <Edit size={14} />
                      <span className="text-xs">{t.common.edit}</span>
                    </Link>
                    <Link
                      href={`/${lang}/analytics/videos/${encodeURIComponent(video.id)}`}
                      data-testid="dashboard-video-analytics"
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-2 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
                    >
                      <BarChart3 size={14} aria-hidden="true" />
                      <span className="text-xs">{t.analytics.dashboard.viewAnalytics}</span>
                    </Link>
                    <button
                      onClick={() => handleDeleteVideo(video.id)}
                      data-testid="dashboard-video-delete"
                      className="px-2 py-2 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      aria-label={t.common.delete}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Bulk edit result */}
        {noticeMessage && (
          <div role="status" data-testid="dashboard-notice" className="fixed bottom-4 end-4 start-4 md:start-auto md:w-96 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 shadow-lg z-50">
            <div className="flex items-start gap-3">
              <p className="flex-1 text-sm font-medium text-green-800 dark:text-green-200">{noticeMessage}</p>
              <button onClick={() => setNoticeMessage(null)} aria-label={t.common.close} className="text-green-700 dark:text-green-300">
                <X size={18} />
              </button>
            </div>
          </div>
        )}

        <BulkEditDialog open={bulkEditOpen} count={selectedVideos.size} onOpenChange={setBulkEditOpen} onApply={applyBulkEdit} />

        {/* Error Message Banner */}
        {errorMessage && (
          <div role="alert" data-testid="dashboard-error" className="fixed top-4 end-4 start-4 md:start-auto md:w-96 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 shadow-lg z-50">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  {errorMessage}
                </p>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
                aria-label={t.common.close}
                className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Delete Single Video Dialog */}
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.video?.confirmDeleteTitle || 'Delete Video?'}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.video?.confirmDelete || 'Are you sure you want to delete this video? This action cannot be undone.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => {
                setDeleteDialogOpen(false);
                setVideoToDelete(null);
              }}>
                {t.common?.cancel || 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmDeleteVideo}
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              >
                {t.common?.delete || 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Bulk Delete Dialog */}
        <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.video?.confirmDeleteMultipleTitle || 'Delete Multiple Videos?'}</AlertDialogTitle>
              <AlertDialogDescription>
                {t.video?.confirmDeleteMultiple?.replace('{count}', selectedVideos.size.toString()) ||
                  `Are you sure you want to delete ${selectedVideos.size} video${selectedVideos.size > 1 ? 's' : ''}? This action cannot be undone.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setBulkDeleteDialogOpen(false)}>
                {t.common?.cancel || 'Cancel'}
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={confirmBulkDelete}
                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
              >
                {t.common?.delete || 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
