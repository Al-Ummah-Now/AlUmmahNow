'use client';

import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Bell, BellOff, X, Check, AlertCircle, Loader2 } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import {
  scheduleVideo,
  updateSchedule,
  cancelSchedule,
  publishNow,
  getVideoSchedule,
} from '@/lib/api/scheduling';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { logger } from '@/lib/logger-client';
import { isActiveSchedule, toLocalDateInput, toLocalTimeInput } from './schedule-inputs';

interface ScheduleSectionProps {
  videoId: string;
  channelId: string;
  isPublic: boolean;
  scheduledPublishDate?: string;
  scheduledPublishStatus?: string;
  onScheduleChange?: (scheduled: boolean, date?: string) => void;
}

export default function ScheduleSection({
  videoId,
  channelId,
  isPublic,
  scheduledPublishDate: initialScheduledDate,
  scheduledPublishStatus: initialStatus,
  onScheduleChange,
}: ScheduleSectionProps) {
  const { t, isRTL } = useLanguage();
  const s = t.schedule ?? ({} as NonNullable<typeof t.schedule>);

  // A cancelled or published schedule keeps its date on the video; only pending ones count
  const hasPendingSchedule = !!initialScheduledDate && (!initialStatus || initialStatus === 'scheduled' || initialStatus === 'publishing');
  const [isScheduled, setIsScheduled] = useState(hasPendingSchedule);
  const [scheduleDate, setScheduleDate] = useState('');
  const [scheduleTime, setScheduleTime] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [notifyOnPublish, setNotifyOnPublish] = useState(true);
  const [status, setStatus] = useState(initialStatus || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Parse initial scheduled date
  useEffect(() => {
    if (initialScheduledDate && hasPendingSchedule) {
      // Both inputs are local: an ISO (UTC) date next to a local time showed the
      // wrong day for users east/west of UTC near midnight
      const date = new Date(initialScheduledDate);
      setScheduleDate(toLocalDateInput(date));
      setScheduleTime(toLocalTimeInput(date));
      setIsScheduled(true);
    }
  }, [initialScheduledDate, hasPendingSchedule]);

  // Fetch current schedule on mount
  useEffect(() => {
    const fetchSchedule = async () => {
      if (!videoId || isPublic) return;

      try {
        const result = await getVideoSchedule(videoId, { channelId });
        // Unscheduled videos also answer 200 ({ isScheduled: false } and no date);
        // treating that as a schedule showed every private video as "Scheduled"
        if (result?.success && result.result && isActiveSchedule(result.result)) {
          const date = new Date(result.result.scheduledPublishDate);
          setScheduleDate(toLocalDateInput(date));
          setScheduleTime(toLocalTimeInput(date));
          setTimezone(result.result.timezone);
          setStatus(result.result.status);
          setIsScheduled(true);
        }
      } catch (err) {
        logger.error('[ScheduleSection] Error fetching schedule', err);
      }
    };

    fetchSchedule();
  }, [videoId, channelId, isPublic]);

  const handleSchedule = async () => {
    if (!scheduleDate || !scheduleTime) {
      setError(s.selectDateAndTime ?? 'Please select a date and time');
      return;
    }

    const scheduledDateTime = new Date(`${scheduleDate}T${scheduleTime}`);
    if (scheduledDateTime <= new Date()) {
      setError(s.mustBeInFuture ?? 'The scheduled time must be in the future');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = isScheduled && status
        ? await updateSchedule(videoId, scheduledDateTime.toISOString(), timezone, { channelId }, notifyOnPublish)
        : await scheduleVideo(videoId, scheduledDateTime.toISOString(), timezone, notifyOnPublish, { channelId });

      if (result?.success) {
        setSuccess(s.scheduleSuccess ?? 'Video scheduled successfully');
        setStatus(result.result?.status || 'scheduled');
        setIsScheduled(true);
        onScheduleChange?.(true, scheduledDateTime.toISOString());
      } else {
        setError(result?.error || s.scheduleFailed || 'Failed to schedule video');
      }
    } catch (err) {
      logger.error('[ScheduleSection] Error scheduling video', err);
      setError(s.scheduleFailed ?? 'Failed to schedule video');
    } finally {
      setLoading(false);
    }
  };

  const handleCancelSchedule = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await cancelSchedule(videoId, { channelId });

      if (result?.success) {
        setSuccess(s.scheduleCancelled ?? 'Schedule cancelled');
        setIsScheduled(false);
        setScheduleDate('');
        setScheduleTime('');
        setStatus('');
        onScheduleChange?.(false);
      } else {
        setError(result?.error || s.cancelScheduleFailed || 'Failed to cancel schedule');
      }
    } catch (err) {
      logger.error('[ScheduleSection] Error canceling schedule', err);
      setError(s.cancelScheduleFailed ?? 'Failed to cancel schedule');
    } finally {
      setLoading(false);
    }
  };

  const handlePublishNow = async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await publishNow(videoId, { channelId });

      if (result?.success) {
        setSuccess(s.publishedSuccessfully ?? 'Video published successfully');
        setIsScheduled(false);
        setStatus('published');
        onScheduleChange?.(false);
      } else {
        setError(result?.error || s.publishFailed || 'Failed to publish video');
      }
    } catch (err) {
      logger.error('[ScheduleSection] Error publishing video', err);
      setError(s.publishFailed ?? 'Failed to publish video');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = () => {
    const statusColors: Record<string, string> = {
      scheduled: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      publishing: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      published: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200',
    };

    const statusLabels: Record<string, string | undefined> = {
      scheduled: s.statusScheduled,
      publishing: s.statusPublishing,
      published: s.statusPublished,
      failed: s.statusFailed,
      cancelled: s.statusCancelled,
    };

    if (!status) return null;

    return (
      <span data-testid="edit-schedule-status" data-status={status} className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[status] || statusColors.scheduled}`}>
        {statusLabels[status] || status}
      </span>
    );
  };

  // If video is already public, show info message with guidance
  if (isPublic && !isScheduled) {
    return (
      <Card className="p-4 bg-gray-50 dark:bg-gray-800" data-testid="edit-schedule" data-state="public">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-gray-400" />
          <h3 className="text-lg font-medium dark:text-white">
            {s.schedulePublication}
          </h3>
        </div>
        <div className="mt-3 flex items-start gap-2 text-gray-600 dark:text-gray-400">
          <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium" data-testid="edit-schedule-public-note">{s.alreadyPublic}</p>
            <p className="text-sm mt-1">
              {s.alreadyPublicHelp}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4" data-testid="edit-schedule" data-state={isScheduled ? 'scheduled' : 'unscheduled'}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h3 className="text-lg font-medium dark:text-white">
              {s.schedulePublication}
            </h3>
          </div>
          {getStatusBadge()}
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div role="alert" data-testid="edit-schedule-error" className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </div>
        )}
        {success && (
          <div role="status" data-testid="edit-schedule-success" className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg">
            <Check className="w-4 h-4" />
            <span className="text-sm">{success}</span>
          </div>
        )}

        {/* Date and Time Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="schedule-date" className="text-sm font-medium dark:text-gray-200">
              {s.dateLabel}
            </Label>
            <input
              id="schedule-date"
              data-testid="edit-schedule-date"
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              min={toLocalDateInput(new Date())}
              className="mt-1 w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={loading || status === 'published'}
            />
          </div>
          <div>
            <Label htmlFor="schedule-time" className="text-sm font-medium dark:text-gray-200">
              {s.timeLabel}
            </Label>
            <div className="relative mt-1">
              <Clock className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                id="schedule-time"
                data-testid="edit-schedule-time"
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="w-full ps-10 pe-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loading || status === 'published'}
              />
            </div>
          </div>
        </div>

        {/* Timezone Display */}
        <div className="text-sm text-gray-500 dark:text-gray-400" data-testid="edit-schedule-timezone">
          {s.timezone}: {timezone}
        </div>

        {/* Notify on Publish Toggle */}
        <label className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg cursor-pointer">
          <div className="flex items-center gap-2">
            {notifyOnPublish ? (
              <Bell className="w-4 h-4 text-blue-500" />
            ) : (
              <BellOff className="w-4 h-4 text-gray-400" />
            )}
            <span className="text-sm dark:text-gray-200">
              {s.notifyOnPublish}
            </span>
          </div>
          <input
            type="checkbox"
            data-testid="edit-schedule-notify"
            checked={notifyOnPublish}
            onChange={(e) => setNotifyOnPublish(e.target.checked)}
            disabled={loading || status === 'published'}
            className="w-5 h-5 rounded border-gray-300 text-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
          />
        </label>

        {/* Action Buttons */}
        {/* dir already mirrors the row in Arabic; flex-row-reverse flipped it back to LTR order */}
        <div className="flex flex-wrap gap-3">
          {status !== 'published' && (
            <>
              <Button
                type="button"
                data-testid="edit-schedule-submit"
                onClick={handleSchedule}
                disabled={loading || !scheduleDate || !scheduleTime}
                className="flex-1"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin me-2" />
                ) : (
                  <Calendar className="w-4 h-4 me-2" />
                )}
                {isScheduled ? s.updateScheduleAction : s.scheduleVideoAction}
              </Button>

              {/* Publish Now - show for scheduled videos OR private unscheduled videos */}
              {(isScheduled && status === 'scheduled') || (!isPublic && !isScheduled) ? (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="edit-schedule-publish-now"
                  onClick={handlePublishNow}
                  disabled={loading}
                >
                  {s.publishNow}
                </Button>
              ) : null}

              {/* Cancel - only for scheduled videos */}
              {isScheduled && status === 'scheduled' && (
                <Button
                  type="button"
                  variant="destructive"
                  data-testid="edit-schedule-cancel"
                  onClick={handleCancelSchedule}
                  disabled={loading}
                >
                  <X className="w-4 h-4 me-2" />
                  {s.cancelSchedule}
                </Button>
              )}
            </>
          )}
        </div>

        {/* Scheduled Info */}
        {isScheduled && scheduleDate && scheduleTime && (
          <div className="text-sm text-gray-600 dark:text-gray-400 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg" data-testid="edit-schedule-summary">
            {s.scheduledFor}:{' '}
            <strong>
              {new Date(`${scheduleDate}T${scheduleTime}`).toLocaleString(isRTL ? 'ar' : 'en', {
                dateStyle: 'full',
                timeStyle: 'short',
              })}
            </strong>
          </div>
        )}
      </div>
    </Card>
  );
}
