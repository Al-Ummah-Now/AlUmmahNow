/**
 * ScheduledVideosList Component
 *
 * Displays scheduled videos in a list view with filtering, sorting,
 * and action buttons (edit, publish now, cancel schedule).
 */

'use client';
import { ThemedSelectField } from '@/components/ui/ThemedSelectField';
import { logger } from '@/lib/logger-client';

import React, { useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/components/AuthProvider/authContext';
import { cancelSchedule, publishNow } from '@/lib/api/scheduling';
import type { VideoObject } from '@/interfaces';
import type { ScheduledPublishStatus } from '@al-ummah/shared-types';
import { Calendar, Clock, Edit, Trash2, PlayCircle, AlertCircle, Loader } from 'lucide-react';
import Link from 'next/link';
import { FitImage } from '@/components/VideoThumbnail/FitImage';
import { usePathname } from 'next/navigation';

export interface ScheduledVideosListProps {
  videos: VideoObject[];
  isLoading: boolean;
  error?: Error | null;
  onVideoClick?: (videoId: string) => void;
  onRefresh?: () => void;
  className?: string;
}

export function ScheduledVideosList({
  videos,
  isLoading,
  error,
  onVideoClick: _onVideoClick,
  onRefresh,
  className = '',
}: ScheduledVideosListProps) {
  const pathname = usePathname();
  const locale = pathname?.startsWith('/ar') ? 'ar' : 'en';
  const { t } = useLanguage();
  const auth = useAuth();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<ScheduledPublishStatus | 'all'>('all');
  // A failed cancel / publish-now, shown inline
  const [actionError, setActionError] = useState<string | null>(null);
  const { confirm, dialog: confirmDialog } = useConfirm();

  // Filter videos by status
  const filteredVideos = React.useMemo(() => {
    if (filterStatus === 'all') {
      return videos;
    }
    return videos.filter((video) => {
      // Videos without a schedule status are listed because they are scheduled
      const scheduleStatus = video.scheduledPublishStatus || 'scheduled';
      return scheduleStatus === filterStatus;
    });
  }, [videos, filterStatus]);

  // Handle cancel schedule
  const handleCancelSchedule = async (videoId: string) => {
    if (!auth.user) return;
    setActionError(null);
    const confirmed = await confirm({
      title: t.confirmDialog.cancelScheduleTitle,
      description: t.schedule?.confirmCancelSchedule,
      confirmLabel: t.schedule?.cancelSchedule ?? t.common.confirm,
      testId: 'cancel-schedule-dialog',
    });
    if (!confirmed) return;

    // Find the video to get its channel ID
    const video = videos.find(v => v.id === videoId);
    if (!video?.channelId) return;

    try {
      setActionLoading(videoId);

      const result = await cancelSchedule(videoId, {
        channelId: video.channelId,
      });

      if (result?.success) {
        // Refresh the list
        onRefresh?.();
      } else {
        setActionError(t.schedule?.scheduleFailed || t.errors.genericError);
      }
    } catch (err) {
      logger.error('Error canceling schedule:', err);
      setActionError(t.errors.genericError);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle publish now
  const handlePublishNow = async (videoId: string) => {
    if (!auth.user) return;
    setActionError(null);
    const confirmed = await confirm({
      title: t.confirmDialog.publishNowTitle,
      description: t.schedule?.confirmPublishNow,
      confirmLabel: t.schedule?.publishNow ?? t.common.confirm,
      danger: false,
      testId: 'publish-now-dialog',
    });
    if (!confirmed) return;

    // Find the video to get its channel ID
    const video = videos.find(v => v.id === videoId);
    if (!video?.channelId) return;

    try {
      setActionLoading(videoId);

      const result = await publishNow(videoId, {
        channelId: video.channelId,
      });

      if (result?.success) {
        // Refresh the list
        onRefresh?.();
      } else {
        setActionError(t.errors.genericError);
      }
    } catch (err) {
      logger.error('Error publishing video:', err);
      setActionError(t.errors.genericError);
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
        return 'bg-brand-soft text-brand-ink dark:bg-brand-soft dark:text-brand-ink';
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

  return (
    <div className={className}>
      {confirmDialog}
      {actionError && (
        <p role="alert" data-testid="scheduled-videos-action-error" className="mb-4 rounded-lg p-3 text-sm border border-[color-mix(in_srgb,var(--fanous-color-error-fill)_40%,transparent)] bg-[color-mix(in_srgb,var(--fanous-color-error-fill)_14%,var(--fanous-color-surface))] text-[var(--fanous-color-error-text)]">
          {actionError}
        </p>
      )}
      {/* Filters */}
      <div className="mb-6 flex items-center gap-4">
        <label htmlFor="scheduled-status-filter" className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {t.schedule?.filterByStatus ?? 'Filter by status'}:
        </label>
        <ThemedSelectField
          id="scheduled-status-filter"
          data-testid="scheduled-status-filter"
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
        </ThemedSelectField>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex justify-center items-center py-12">
          <Loader className="animate-spin text-blue-600" size={32} />
        </div>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <div role="alert" data-testid="scheduled-videos-error" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="font-medium text-red-900 dark:text-red-100">{t.common.error}</h3>
            <p className="text-sm text-red-700 dark:text-red-200">{error.message}</p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && filteredVideos.length === 0 && (
        <div data-testid="scheduled-videos-empty" className="text-center py-12 bg-gray-50 dark:bg-gray-800 rounded-lg">
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
      {!isLoading && !error && filteredVideos.length > 0 && (
        <div className="space-y-4" role="list" data-testid="scheduled-videos-list">
          {filteredVideos.map((video) => {
            // Extract schedule metadata from video object
            const scheduleStatus: ScheduledPublishStatus = video.scheduledPublishStatus || 'scheduled';
            const scheduledPublishDate = (video as VideoObject & { scheduledPublishDate?: string }).scheduledPublishDate;
            const canEdit = video.userId === auth.user?.id;
            const canCancel = canEdit && (scheduleStatus === 'scheduled' || scheduleStatus === 'publishing');

            return (
              <div
                key={video.id}
                role="listitem"
                data-testid="scheduled-video-item"
                data-video-id={video.id}
                data-status={scheduleStatus}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden hover:shadow-md transition-shadow"
              >
                <div className="p-4 md:p-6 flex flex-col md:flex-row gap-4">
                  {/* Thumbnail */}
                  <div className="flex-shrink-0">
                    <div className="relative w-full md:w-64 aspect-video bg-gray-200 dark:bg-gray-700 rounded-md overflow-hidden">
                      {video.thumbnailUrl ? (
                        <FitImage
                          src={video.thumbnailUrl}
                          alt={video.title}
                          sizes="256px"
                          videoWidth={video.width}
                          videoHeight={video.height}
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
                    <h3 data-testid="scheduled-video-title" className="text-lg font-semibold text-gray-900 dark:text-white mb-2 line-clamp-2">
                      {video.title}
                    </h3>

                    {/* Status */}
                    <div className="mb-3">
                      <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(scheduleStatus)}`}>
                        {(typeof t.schedule?.[`status${scheduleStatus.charAt(0).toUpperCase() + scheduleStatus.slice(1)}` as keyof typeof t.schedule] === 'string'
                          ? t.schedule[`status${scheduleStatus.charAt(0).toUpperCase() + scheduleStatus.slice(1)}` as keyof typeof t.schedule]
                          : scheduleStatus) || scheduleStatus}
                      </span>
                    </div>

                    {/* Schedule Info */}
                    <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                      {scheduledPublishDate && (
                        <>
                          <div className="flex items-center gap-2">
                            <Calendar size={16} />
                            <span data-testid="scheduled-video-date">
                              {t.schedule?.scheduledFor || 'Scheduled for'}: {new Date(scheduledPublishDate).toLocaleString(locale)}
                            </span>
                          </div>
                          {scheduleStatus === 'scheduled' && (
                            <div className="flex items-center gap-2">
                              <Clock size={16} />
                              <span data-testid="scheduled-video-countdown">
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
                          href={`/${locale}/studio/video/${video.id}/edit`}
                          data-testid="scheduled-video-edit"
                          className="inline-flex items-center px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600"
                        >
                          <Edit size={16} className="me-1.5" />
                          {t.schedule?.editSchedule || 'Edit Schedule'}
                        </Link>
                      )}
                      {scheduleStatus === 'scheduled' && (
                        <button
                          type="button"
                          data-testid="scheduled-video-publish-now"
                          onClick={() => handlePublishNow(video.id)}
                          disabled={actionLoading === video.id}
                          className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-green-700 rounded-md hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {actionLoading === video.id ? (
                            <Loader size={16} className="me-1.5 animate-spin" />
                          ) : (
                            <PlayCircle size={16} className="me-1.5" />
                          )}
                          {t.schedule?.publishNow || 'Publish Now'}
                        </button>
                      )}
                      {canCancel && (
                        <button
                          type="button"
                          data-testid="scheduled-video-cancel"
                          onClick={() => handleCancelSchedule(video.id)}
                          disabled={actionLoading === video.id}
                          className="inline-flex items-center px-3 py-2 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {actionLoading === video.id ? (
                            <Loader size={16} className="me-1.5 animate-spin" />
                          ) : (
                            <Trash2 size={16} className="me-1.5" />
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
