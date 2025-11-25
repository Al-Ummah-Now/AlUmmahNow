"use client";

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Search, UploadCloud, Trash2, Eye, Edit, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { VideoObject } from '@/interfaces';
import { searchVideos, deleteVideo, bulkDeleteVideos } from '@/lib/api/videos';
import Image from 'next/image';
import Link from 'next/link';
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
type SortBy = 'date' | 'views' | 'title';

export default function VideoDashboardPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const { user: multiAccountUser } = useMultiAccount();
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

  // Redirect if not authenticated or no channels
  useEffect(() => {
    if (!user) {
      router.push(`/${lang}`);
      return;
    }

    // Redirect users without channels to main page
    const userChannels = multiAccountUser?.channels || [];
    if (userChannels.length === 0) {
      router.push(`/${lang}`);
    }
  }, [user, multiAccountUser?.channels, router, lang]);

  // Fetch videos using single API call with filters
  useEffect(() => {
    const fetchVideos = async () => {
      if (!user) return;

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

        // Single API call with server-side filtering
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
          },
          {  channelId: channelIds[0] || user.id }
        );

        const allVideos = result?.data || [];

        console.log('[VideoDashboard] Fetched videos:', allVideos.length);
        console.log('[VideoDashboard] Video IDs:', allVideos.map(v => v.id));
        console.log('[VideoDashboard] Looking for video: e1b093a6-929c-452f-b1cf-c31d1990dd85');
        console.log('[VideoDashboard] Channel IDs used in query:', channelIds);

        // Filter videos by privacy setting (server-side filtering not yet available)
        let filtered = allVideos;
        if (privacyFilter !== 'all') {
          filtered = filtered.filter((video) =>
            privacyFilter === 'public' ? video.isPublic : !video.isPublic
          );
        }

        setVideos(filtered);
        setFilteredVideos(filtered);
      } catch (error) {
        console.error('Error fetching videos:', error);
        setVideos([]);
        setFilteredVideos([]);
      } finally {
        setLoading(false);
      }
    };

    fetchVideos();
  }, [user, multiAccountUser?.channels, durationFilter, sortBy, privacyFilter]);

  // Apply client-side search and status filtering
  useEffect(() => {
    let filtered = [...videos];

    // Search filter (client-side for immediate feedback)
    if (searchQuery) {
      filtered = filtered.filter((video) =>
        video.title.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Status filter (client-side until API supports it)
    if (statusFilter !== 'all') {
      filtered = filtered.filter(() => {
        // Assuming we have a status field, otherwise default to 'ready'
        const status = 'ready'; // Placeholder - will be implemented when video.status is available
        return status === statusFilter;
      });
    }

    // Sorting is already handled by API, but apply for client-side search results
    if (searchQuery) {
      filtered.sort((a, b) => {
        switch (sortBy) {
          case 'date':
            return new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime();
          case 'views':
            return (b.views || 0) - (a.views || 0);
          case 'title':
            return a.title.localeCompare(b.title);
          default:
            return 0;
        }
      });
    }

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

    try {
      const result = await deleteVideo(videoToDelete, {  channelId: user.id });
      if (result) {
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
      }
    } catch (error) {
      console.error('Error deleting video:', error);
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
      const videoIdsArray = Array.from(selectedVideos);

      // Call bulk delete API
      const result = await bulkDeleteVideos(videoIdsArray, {
        
        channelId: user.id
      });

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
          setErrorMessage(`Deleted ${result.summary.succeeded} video(s), but ${result.summary.failed} failed to delete`);
        } else {
          setErrorMessage(t.errors?.genericError || 'Failed to delete videos');
        }
      }

      setBulkDeleteDialogOpen(false);
    } catch (error) {
      console.error('Error deleting videos:', error);
      setErrorMessage(t.errors?.genericError || 'An error occurred');
      setBulkDeleteDialogOpen(false);
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
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.video.searchVideos}
                className="w-full pl-10 pr-10 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label="Clear search"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            {/* Filters Row */}
            <div className="flex flex-wrap gap-4">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
                className="px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="all">{t.video.allStatus}</option>
                <option value="ready">{t.video.ready}</option>
                <option value="processing">{t.video.processing}</option>
                <option value="uploading">{t.video.uploading}</option>
                <option value="failed">{t.video.failed}</option>
              </select>

              <select
                value={privacyFilter}
                onChange={(e) => setPrivacyFilter(e.target.value as FilterPrivacy)}
                className="px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="all">{t.video.filterByPrivacy}</option>
                <option value="public">{t.video.public}</option>
                <option value="private">{t.video.private}</option>
              </select>

              <select
                value={durationFilter}
                onChange={(e) => setDurationFilter(e.target.value as FilterDuration)}
                className="px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="all">{t.video.allVideos || 'All Videos'}</option>
                <option value="short">{t.video.shortVideos || 'Short (≤3 min)'}</option>
                <option value="standard">{t.video.standardVideos || 'Standard (3-20 min)'}</option>
                <option value="long">{t.video.longVideos || 'Long (>20 min)'}</option>
              </select>

              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
              >
                <option value="date">{t.video.sortByDate}</option>
                <option value="views">{t.video.sortByViews}</option>
                <option value="title">{t.video.sortByTitle}</option>
              </select>
            </div>

            {/* Bulk Actions */}
            {selectedVideos.size > 0 && (
              <div className="flex items-center gap-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                <span className="text-sm font-medium dark:text-white">
                  {t.video.videosSelected?.replace('{count}', selectedVideos.size.toString()) || `${selectedVideos.size} videos selected`}
                </span>
                <button
                  onClick={handleSelectAll}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                >
                  {selectedVideos.size === filteredVideos.length ? t.video.deselectAll : t.video.selectAll}
                </button>
                <div className="flex-1" />
                <button
                  onClick={handleDeleteSelected}
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
          <div className="flex items-center justify-center py-20">
            <div className="text-gray-500 dark:text-gray-400">{t.common.loading}</div>
          </div>
        ) : filteredVideos.length === 0 ? (
          <div className="bg-white dark:bg-gray-800 rounded-lg p-12 text-center">
            <UploadCloud size={64} className="mx-auto mb-4 text-gray-400" />
            <h2 className="text-2xl font-semibold mb-2 dark:text-white">{t.video.noVideosFound}</h2>
            <p className="text-gray-600 dark:text-gray-400">{t.video.uploadFirstVideo}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredVideos.map((video) => (
              <div
                key={video.id}
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
                    className="absolute top-3 left-3 w-5 h-5 z-10 cursor-pointer"
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
                  <h3 className="text-lg truncate font-[Tahoma]">
                    {video.title}
                  </h3>
                  <p className="text-sm truncate">{video.channelName || video.channel}</p>
                  <p className="text-sm">
                    {video.views || 0} {t.video.videoViews?.toLowerCase() || 'views'} • {formatDate(video.dateCreated)}
                  </p>

                  {/* Privacy Badge */}
                  <div className="mt-2">
                    <span
                      className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                        video.isPublic
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {video.isPublic ? t.video.public : t.video.private}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 mt-3">
                    <Link
                      href={`/${lang}/video?vid=${video.id}`}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-2 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
                    >
                      <Eye size={14} />
                      <span className="text-xs">{t.common.view}</span>
                    </Link>
                    <Link
                      href={`/${lang}/video/${video.id}/edit`}
                      className="flex-1 flex items-center justify-center gap-1 px-2 py-2 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
                    >
                      <Edit size={14} />
                      <span className="text-xs">{t.common.edit}</span>
                    </Link>
                    <button
                      onClick={() => handleDeleteVideo(video.id)}
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

        {/* Error Message Banner */}
        {errorMessage && (
          <div className="fixed top-4 right-4 left-4 md:left-auto md:w-96 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 shadow-lg z-50">
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <p className="text-sm font-medium text-red-800 dark:text-red-200">
                  {errorMessage}
                </p>
              </div>
              <button
                onClick={() => setErrorMessage(null)}
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
