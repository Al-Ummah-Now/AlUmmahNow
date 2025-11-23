"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { useI18n } from '@/lib/i18n';
import { searchVideos } from '@/lib/api/videos';
import { cancelSchedule, publishNow } from '@/lib/api/scheduling';
import type { VideoObject } from '@/interfaces';
import type { ScheduledPublishStatus } from '@al-ummah/shared-types';
import { Calendar, Clock, Edit, Trash2, PlayCircle, AlertCircle, Loader } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';

export default function ScheduledVideosPage() {
  const pathname = usePathname();
  const router = useRouter();
  const locale = pathname?.startsWith('/ar') ? 'ar' : 'en';
  const { t } = useI18n(locale);
  const auth = useAuth();
  const { user: multiAccountUser } = useMultiAccount();

  const [videos, setVideos] = useState<VideoObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<ScheduledPublishStatus | 'all'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Redirect if not authenticated or no channels
  useEffect(() => {
    if (!auth.user) {
      router.push(`/${locale}`);
      return;
    }

    // Redirect users without channels to main page
    const userChannels = multiAccountUser?.channels || [];
    if (userChannels.length === 0) {
      router.push(`/${locale}`);
    }
  }, [auth.user, multiAccountUser?.channels, router, locale]);

  // Fetch scheduled videos using single API call
  const fetchScheduledVideos = async () => {
    if (!auth.user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Get all channels the user owns
      const userChannels = multiAccountUser?.channels || [];
      const channelIds = userChannels.map(ch => ch.id);

      if (channelIds.length === 0) {
        // User has no channels, show empty state
        setVideos([]);
        setLoading(false);
        return;
      }

      // Map filter status to schedule filter
      const scheduleFilter =
        filterStatus === 'all' ? 'scheduled' :
        filterStatus === 'published' ? 'published' :
        'scheduled'; // Default to scheduled for other statuses

      // Use single searchVideos call with schedule filtering
      const result = await searchVideos(
        '', // Empty query to get all videos
        {
          channelIds, // Filter by user's channels
          isOwner: true, // Only show videos owned by the user
          scheduleFilter, // Filter by schedule status (scheduled/published)
          sortBy: 'date', // Sort by date (most recent first)
          sortOrder: 'desc',
        },
        {
          limit: 100, // Fetch up to 100 scheduled videos
        },
        {
          userId: auth.user.id,
          channelId: auth.user.id, // Use user ID as fallback channel
        }
      );

      if (!result) {
        throw new Error('Failed to fetch scheduled videos');
      }

      setVideos(result.data);
    } catch (err) {
      console.error('Error fetching scheduled videos:', err);
      setError('An error occurred while fetching scheduled videos');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScheduledVideos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user, multiAccountUser?.channels, filterStatus]);

  // Handle cancel schedule
  const handleCancelSchedule = async (videoId: string) => {
    if (!auth.user) return;
    if (!confirm(t.schedule?.confirmCancelSchedule ?? 'Are you sure?')) return;

    try {
      setActionLoading(videoId);

      const result = await cancelSchedule(videoId, {
        userId: auth.user.id,
        channelId: auth.user.id,
      });

      if (result?.success) {
        // Refresh the list
        await fetchScheduledVideos();
      } else {
        alert(result?.error || t.schedule?.scheduleFailed || 'Schedule operation failed');
      }
    } catch (err) {
      console.error('Error canceling schedule:', err);
      alert('An error occurred while canceling the schedule');
    } finally {
      setActionLoading(null);
    }
  };

  // Handle publish now
  const handlePublishNow = async (videoId: string) => {
    if (!auth.user) return;
    if (!confirm(t.schedule?.confirmPublishNow ?? 'Are you sure?')) return;

    try {
      setActionLoading(videoId);

      const result = await publishNow(videoId, {
        userId: auth.user.id,
        channelId: auth.user.id,
      });

      if (result?.success) {
        // Refresh the list
        await fetchScheduledVideos();
      } else {
        alert(result?.error || 'Failed to publish video');
      }
    } catch (err) {
      console.error('Error publishing video:', err);
      alert('An error occurred while publishing the video');
    } finally {
      setActionLoading(null);
    }
  };

  // Format remaining time
  const formatTimeRemaining = (scheduledDate: string): string => {
    const now = new Date();
    const scheduled = new Date(scheduledDate);
    const diff = scheduled.getTime() - now.getTime();

    if (diff < 0) return t.schedule?.publishesSoon ?? 'Soon';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days} ${t.schedule?.days ?? 'days'}, ${hours} ${t.schedule?.hours ?? 'hours'}`;
    if (hours > 0) return `${hours} ${t.schedule?.hours ?? 'hours'}, ${minutes} ${t.schedule?.minutes ?? 'minutes'}`;
    return `${minutes} ${t.schedule?.minutes ?? 'minutes'}`;
  };

  // Get status badge color
  const getStatusColor = (status: ScheduledPublishStatus): string => {
    switch (status) {
      case 'scheduled':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'publishing':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'published':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'failed':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'cancelled':
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  if (!auth.user) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-4xl">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            {t.schedule?.scheduledVideos ?? 'Scheduled Videos'}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Please sign in to view your scheduled videos.
          </p>
          <Link
            href={`/${locale}/`}
            className="inline-block px-6 py-3 bg-blue-600 text-white rounded-md hover:bg-blue-700"
          >
            {t.navigation.signIn}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 md:px-6 lg:px-8 py-8 max-w-7xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          {t.schedule?.myScheduledVideos ?? 'My Scheduled Videos'}
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          {t.schedule?.noScheduledVideosMessage ?? 'View and manage your scheduled videos'}
        </p>
      </div>

      {/* Filters */}
      <div className="mb-6 flex items-center space-x-4">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t.schedule?.filterByStatus ?? 'Filter by status'}:
        </label>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as ScheduledPublishStatus | 'all')}
          className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
        >
          <option value="all">{t.schedule?.allStatuses || 'All Statuses'}</option>
          <option value="scheduled">{t.schedule?.statusScheduled || 'Scheduled'}</option>
          <option value="publishing">{t.schedule?.statusPublishing || 'Publishing'}</option>
          <option value="published">{t.schedule?.statusPublished || 'Published'}</option>
          <option value="failed">{t.schedule?.statusFailed || 'Failed'}</option>
          <option value="cancelled">{t.schedule?.statusCancelled || 'Cancelled'}</option>
        </select>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex justify-center items-center py-12">
          <Loader className="animate-spin text-blue-600" size={32} />
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start space-x-3">
          <AlertCircle className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="font-medium text-red-900 dark:text-red-100">Error</h3>
            <p className="text-sm text-red-700 dark:text-red-200">{error}</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && videos.length === 0 && (
        <div className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <Calendar className="mx-auto text-gray-400 mb-4" size={64} />
          <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            {t.schedule?.noScheduledVideos ?? 'No Scheduled Videos'}
          </h3>
          <p className="text-gray-600 dark:text-gray-400">
            {t.schedule?.createFirstScheduledVideo ?? 'Create your first scheduled video to get started'}
          </p>
        </div>
      )}

      {/* Videos List */}
      {!loading && !error && videos.length > 0 && (
        <div className="space-y-4">
          {videos.map((video) => {
            // Extract schedule metadata from video object
            const scheduleStatus = (video as VideoObject & { scheduleStatus?: ScheduledPublishStatus }).scheduleStatus || 'scheduled';
            const scheduledPublishDate = (video as VideoObject & { scheduledPublishDate?: string }).scheduledPublishDate;
            const canEdit = video.userId === auth.user?.id;
            const canCancel = canEdit && (scheduleStatus === 'scheduled' || scheduleStatus === 'publishing');

            return (
              <div
                key={video.id}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="p-4 md:p-6 flex flex-col md:flex-row gap-4">
                  {/* Thumbnail */}
                  <div className="flex-shrink-0">
                    <div className="relative w-full md:w-64 aspect-video bg-gray-200 dark:bg-gray-700 rounded-md overflow-hidden">
                      {video.thumbnailUrl ? (
                        <Image
                          src={video.thumbnailUrl}
                          alt={video.title}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          <Calendar className="text-gray-400" size={48} />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2">
                      {video.title}
                    </h3>

                    {/* Status */}
                    <div className="mb-3">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(scheduleStatus)}`}>
                        {(t.schedule && t.schedule[`status${scheduleStatus.charAt(0).toUpperCase() + scheduleStatus.slice(1)}` as keyof typeof t.schedule]) || scheduleStatus}
                      </span>
                    </div>

                    {/* Schedule Info */}
                    <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                      {scheduledPublishDate && (
                        <>
                          <div className="flex items-center space-x-2">
                            <Calendar size={16} />
                            <span>
                              {t.schedule?.scheduledFor || 'Scheduled for'}: {new Date(scheduledPublishDate).toLocaleString(locale)}
                            </span>
                          </div>
                          {scheduleStatus === 'scheduled' && (
                            <div className="flex items-center space-x-2">
                              <Clock size={16} />
                              <span>
                                {t.schedule?.publishesIn || 'Publishes in'}: {formatTimeRemaining(scheduledPublishDate)}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {canEdit && (
                        <Link
                          href={`/${locale}/video/${video.id}/edit`}
                          className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
                        >
                          <Edit size={16} className="mr-1.5" />
                          {t.schedule?.editSchedule || 'Edit Schedule'}
                        </Link>
                      )}
                      {scheduleStatus === 'scheduled' && (
                        <button
                          onClick={() => handlePublishNow(video.id)}
                          disabled={actionLoading === video.id}
                          className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {actionLoading === video.id ? (
                            <Loader size={16} className="mr-1.5 animate-spin" />
                          ) : (
                            <PlayCircle size={16} className="mr-1.5" />
                          )}
                          {t.schedule?.publishNow || 'Publish Now'}
                        </button>
                      )}
                      {canCancel && (
                        <button
                          onClick={() => handleCancelSchedule(video.id)}
                          disabled={actionLoading === video.id}
                          className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {actionLoading === video.id ? (
                            <Loader size={16} className="mr-1.5 animate-spin" />
                          ) : (
                            <Trash2 size={16} className="mr-1.5" />
                          )}
                          {t.schedule?.cancelSchedule || 'Cancel Schedule'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
