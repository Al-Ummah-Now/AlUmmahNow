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
  const { isRTL } = useLanguage();

  const [isScheduled, setIsScheduled] = useState(!!initialScheduledDate);
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
    if (initialScheduledDate) {
      const date = new Date(initialScheduledDate);
      setScheduleDate(date.toISOString().split('T')[0]);
      setScheduleTime(date.toTimeString().slice(0, 5));
      setIsScheduled(true);
    }
  }, [initialScheduledDate]);

  // Fetch current schedule on mount
  useEffect(() => {
    const fetchSchedule = async () => {
      if (!videoId || isPublic) return;

      try {
        const result = await getVideoSchedule(videoId, { channelId });
        if (result?.success && result.result) {
          const date = new Date(result.result.scheduledPublishDate);
          setScheduleDate(date.toISOString().split('T')[0]);
          setScheduleTime(date.toTimeString().slice(0, 5));
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
      setError('Please select date and time');
      return;
    }

    const scheduledDateTime = new Date(`${scheduleDate}T${scheduleTime}`);
    if (scheduledDateTime <= new Date()) {
      setError('Scheduled time must be in the future');
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
        setSuccess('Video scheduled successfully');
        setStatus(result.result?.status || 'scheduled');
        setIsScheduled(true);
        onScheduleChange?.(true, scheduledDateTime.toISOString());
      } else {
        setError(result?.error || 'Failed to schedule video');
      }
    } catch (err) {
      logger.error('[ScheduleSection] Error scheduling video', err);
      setError('Failed to schedule video');
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
        setSuccess('Schedule cancelled');
        setIsScheduled(false);
        setScheduleDate('');
        setScheduleTime('');
        setStatus('');
        onScheduleChange?.(false);
      } else {
        setError(result?.error || 'Failed to cancel schedule');
      }
    } catch (err) {
      logger.error('[ScheduleSection] Error canceling schedule', err);
      setError('Failed to cancel schedule');
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
        setSuccess('Video published successfully');
        setIsScheduled(false);
        setStatus('published');
        onScheduleChange?.(false);
      } else {
        setError(result?.error || 'Failed to publish video');
      }
    } catch (err) {
      logger.error('[ScheduleSection] Error publishing video', err);
      setError('Failed to publish video');
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

    const statusLabels: Record<string, string> = {
      scheduled: 'Scheduled',
      publishing: 'Publishing',
      published: 'Published',
      failed: 'Failed',
      cancelled: 'Cancelled',
    };

    if (!status) return null;

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColors[status] || statusColors.scheduled}`}>
        {statusLabels[status] || status}
      </span>
    );
  };

  // If video is already public, show info message with guidance
  if (isPublic && !isScheduled) {
    return (
      <Card className="p-4 bg-gray-50 dark:bg-gray-800">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-gray-400" />
          <h3 className="text-lg font-medium dark:text-white">
            Schedule Publication
          </h3>
        </div>
        <div className="mt-3 flex items-start gap-2 text-gray-600 dark:text-gray-400">
          <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">This video is already public</p>
            <p className="text-sm mt-1">
              To schedule a video, first set it to private using the visibility toggle above, then configure your schedule here.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            <h3 className="text-lg font-medium dark:text-white">
              Schedule Publication
            </h3>
          </div>
          {getStatusBadge()}
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-lg">
            <Check className="w-4 h-4" />
            <span className="text-sm">{success}</span>
          </div>
        )}

        {/* Date and Time Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="schedule-date" className="text-sm font-medium dark:text-gray-200">
              Date
            </Label>
            <input
              id="schedule-date"
              type="date"
              value={scheduleDate}
              onChange={(e) => setScheduleDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
              className="mt-1 w-full px-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={loading || status === 'published'}
            />
          </div>
          <div>
            <Label htmlFor="schedule-time" className="text-sm font-medium dark:text-gray-200">
              Time
            </Label>
            <div className="relative mt-1">
              <Clock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                id="schedule-time"
                type="time"
                value={scheduleTime}
                onChange={(e) => setScheduleTime(e.target.value)}
                className="w-full pl-10 pr-3 py-2 border rounded-lg dark:bg-gray-700 dark:border-gray-600 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loading || status === 'published'}
              />
            </div>
          </div>
        </div>

        {/* Timezone Display */}
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Timezone: {timezone}
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
              Notify subscribers when published
            </span>
          </div>
          <input
            type="checkbox"
            checked={notifyOnPublish}
            onChange={(e) => setNotifyOnPublish(e.target.checked)}
            disabled={loading || status === 'published'}
            className="w-5 h-5 rounded border-gray-300 text-blue-500 focus:ring-blue-500 dark:bg-gray-700 dark:border-gray-600"
          />
        </label>

        {/* Action Buttons */}
        <div className={`flex gap-3 ${isRTL ? 'flex-row-reverse' : ''}`}>
          {status !== 'published' && (
            <>
              <Button
                onClick={handleSchedule}
                disabled={loading || !scheduleDate || !scheduleTime}
                className="flex-1"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Calendar className="w-4 h-4 mr-2" />
                )}
                {isScheduled ? 'Update Schedule' : 'Schedule Video'}
              </Button>

              {/* Publish Now - show for scheduled videos OR private unscheduled videos */}
              {(isScheduled && status === 'scheduled') || (!isPublic && !isScheduled) ? (
                <Button
                  variant="outline"
                  onClick={handlePublishNow}
                  disabled={loading}
                >
                  Publish Now
                </Button>
              ) : null}

              {/* Cancel - only for scheduled videos */}
              {isScheduled && status === 'scheduled' && (
                <Button
                  variant="destructive"
                  onClick={handleCancelSchedule}
                  disabled={loading}
                >
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              )}
            </>
          )}
        </div>

        {/* Scheduled Info */}
        {isScheduled && scheduleDate && scheduleTime && (
          <div className="text-sm text-gray-600 dark:text-gray-400 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            Scheduled for:{' '}
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
