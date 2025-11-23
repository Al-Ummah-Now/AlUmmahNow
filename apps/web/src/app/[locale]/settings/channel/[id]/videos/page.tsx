"use client";

import React, { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Search, UploadCloud, Trash2, Eye, Edit } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useAuth } from '@/components/AuthProvider/authContext';
import { VideoObject } from '@/interfaces';
import { listVideos, deleteVideo } from '@/lib/api/videos';
import { isChannelOwner } from '@/lib/channel-utils';
import { getChannelById } from '@/lib/api/channels';
import Image from 'next/image';
import Link from 'next/link';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import { logger } from '@/lib/logger-client';

type FilterStatus = 'all' | 'ready' | 'processing' | 'uploading' | 'failed';
type FilterPrivacy = 'all' | 'public' | 'private';
type SortBy = 'date' | 'views' | 'title';

export default function ChannelVideosPage() {
  const { t } = useLanguage();
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

  // Check channel ownership
  useEffect(() => {
    const checkOwnership = async () => {
      const ownershipCheck = await isChannelOwner(channelId);
      setIsOwner(ownershipCheck);

      if (!ownershipCheck) {
        router.push(`/${locale}/channels/${channelId}`);
      }
    };

    if (channelId) {
      checkOwnership();
    }
  }, [channelId, router, locale]);

  // Fetch videos and channel for this channel
  useEffect(() => {
    const fetchData = async () => {
      if (!user || !isOwner) return;

      setLoading(true);
      try {
        // Fetch videos and channel in parallel
        const [result, channel] = await Promise.all([
          listVideos({ channelId }, { userId: user.id, channelId: channelId }),
          getChannelById(channelId)
        ]);

        if (channel) {
          setChannelName(channel.name || '');
        }

        if (result) {
          setVideos(result.data);
          setFilteredVideos(result.data);
        }
      } catch (error) {
        logger.error('Error fetching videos and channel', { error, channelId, userId: user.id });
      } finally {
        setLoading(false);
      }
    };

    if (isOwner) {
      fetchData();
    }
  }, [user, channelId, isOwner]);

  // Apply filters and search
  useEffect(() => {
    let filtered = [...videos];

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter((video) =>
        video.title.toLowerCase().includes(searchQuery.toLowerCase())
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
          return new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime();
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

  const handleDeleteVideo = async (videoId: string) => {
    if (!user) return;

    if (!confirm(t.video.confirmDelete)) return;

    try {
      const result = await deleteVideo(videoId, { userId: user.id, channelId });
      if (result) {
        setVideos((prev) => prev.filter((v) => v.id !== videoId));
        setSelectedVideos((prev) => {
          const newSet = new Set(prev);
          newSet.delete(videoId);
          return newSet;
        });
      }
    } catch (error) {
      logger.error('Error deleting video', { error, videoId, channelId, userId: user.id });
      alert(t.errors.genericError);
    }
  };

  const handleDeleteSelected = async () => {
    if (!user) return;
    if (selectedVideos.size === 0) return;

    if (!confirm(t.video.confirmDeleteMultiple?.replace('{count}', selectedVideos.size.toString()) || 'Are you sure you want to delete selected videos?')) {
      return;
    }

    try {
      const deletePromises = Array.from(selectedVideos).map((videoId) =>
        deleteVideo(videoId, { userId: user.id, channelId })
      );

      await Promise.all(deletePromises);

      setVideos((prev) => prev.filter((v) => !selectedVideos.has(v.id)));
      setSelectedVideos(new Set());
    } catch (error) {
      logger.error('Error deleting videos', { error, selectedVideos: Array.from(selectedVideos), channelId, userId: user.id });
      alert(t.errors.genericError);
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
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-7xl mx-auto">
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
                className="w-full pl-10 pr-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
              />
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
                className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow"
              >
                {/* Checkbox */}
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={selectedVideos.has(video.id)}
                    onChange={() => handleSelectVideo(video.id)}
                    className="absolute top-3 left-3 w-5 h-5 z-10 cursor-pointer"
                  />

                  {/* Thumbnail */}
                  <div className="relative w-full aspect-video bg-gray-200 dark:bg-gray-700">
                    {video.thumbnailUrl ? (
                      <Image
                        src={video.thumbnailUrl}
                        alt={video.title}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                        unoptimized
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <svg
                          className="w-16 h-16 text-gray-400"
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
                    )}
                  </div>
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="font-semibold text-lg mb-2 line-clamp-2 dark:text-white">
                    {video.title}
                  </h3>
                  <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
                    <span>{video.views || 0} {t.video.views}</span>
                    <span>•</span>
                    <span>{formatDate(video.dateCreated)}</span>
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className={`px-2 py-1 rounded text-xs font-medium ${
                        video.isPublic
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400'
                      }`}
                    >
                      {video.isPublic ? t.video.public : t.video.private}
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    <Link
                      href={`/${locale}/video?vid=${video.id}`}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
                    >
                      <Eye size={16} />
                      {t.common.viewAll}
                    </Link>
                    <Link
                      href={`/${locale}/video/${video.id}/edit`}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm"
                    >
                      <Edit size={16} />
                      {t.common.edit}
                    </Link>
                    <button
                      onClick={() => handleDeleteVideo(video.id)}
                      className="px-3 py-2 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                      aria-label={t.common.delete}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
