"use client";

import React from 'react';
import { UploadQueueItem } from '@al-ummah/shared-types';
import { FileQueueItem } from './FileQueueItem';
import { Pause, Play, X, RotateCcw, Info, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import type { BatchNotice, ProcessingPhase } from '@/lib/upload/processing-status';
import '@/theme/upload-status.css';

interface BatchUploadQueueProps {
  files: UploadQueueItem[];
  overallProgress: number;
  isUploading: boolean;
  /** Server-side processing of each uploaded file, by video id */
  processingPhases?: Record<string, ProcessingPhase>;
  /** What happens next for the whole queue (see batchNotice) */
  notice?: BatchNotice;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onCancelAll: () => void;
  onRemoveFile: (fileId: string) => void;
  onPauseFile: (fileId: string) => void;
  onResumeFile: (fileId: string) => void;
  onCancelFile: (fileId: string) => void;
  onRetryFile: (fileId: string) => void;
  /** Category picker for a row (batch uploader) */
  renderCategory?: (file: UploadQueueItem) => React.ReactNode;
}

export function BatchUploadQueue({
  files,
  overallProgress,
  // isUploading,
  processingPhases = {},
  notice = null,
  onPauseAll,
  onResumeAll,
  onCancelAll,
  onRemoveFile,
  onPauseFile,
  onResumeFile,
  onCancelFile,
  onRetryFile,
  renderCategory,
}: BatchUploadQueueProps) {
  const { t, isRTL: _isRTL } = useLanguage();

  const stats = React.useMemo(() => {
    const completed = files.filter(f => f.status === 'completed').length;
    const uploading = files.filter(f => f.status === 'uploading').length;
    const failed = files.filter(f => f.status === 'failed').length;
    const pending = files.filter(f => f.status === 'pending').length;
    const paused = files.filter(f => f.status === 'paused').length;
    const cancelled = files.filter(f => f.status === 'cancelled').length;

    return { completed, uploading, failed, pending, paused, cancelled, total: files.length };
  }, [files]);

  const hasActiveTasks = stats.uploading > 0 || stats.pending > 0 || stats.paused > 0;

  // One polite announcement per row that finishes processing (not one live region per row)
  const [announcement, setAnnouncement] = React.useState('');
  const announcedRef = React.useRef<Record<string, ProcessingPhase>>({});
  React.useEffect(() => {
    for (const file of files) {
      if (!file.videoId) continue;
      const phase = processingPhases[file.videoId];
      if ((phase === 'ready' || phase === 'failed') && announcedRef.current[file.videoId] !== phase) {
        announcedRef.current[file.videoId] = phase;
        const title = file.metadata.title || file.file.name;
        setAnnouncement((phase === 'ready' ? t.uploadStatus.announceReady : t.uploadStatus.announceFailed).replace('{title}', title));
      }
    }
  }, [files, processingPhases, t]);

  const noticeText =
    notice === 'keepOpen'
      ? t.uploadStatus.batchKeepOpen
      : notice === 'processing'
        ? t.uploadStatus.batchProcessing
        : notice === 'allReady'
          ? t.uploadStatus.batchAllReady
          : '';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 md:p-6" data-testid="batch-queue" data-total={stats.total} data-completed={stats.completed}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg md:text-xl font-semibold text-gray-900 dark:text-white">
            {t.batch.uploadQueue}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1" data-testid="batch-summary">
            {t.uploadStatus.uploadedCount.replace('{completed}', stats.completed.toString()).replace('{total}', stats.total.toString())}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          {stats.paused > 0 && (
            <button
              type="button"
              data-testid="batch-resume-all"
              onClick={onResumeAll}
              className="
                flex items-center gap-1.5
                px-3 py-2
                text-sm font-medium
                text-white bg-green-600
                rounded-md
                hover:bg-green-700
                focus:outline-none focus:ring-2 focus:ring-green-500
                transition-colors
                min-w-[100px]
                justify-center
              "
              aria-label={t.batch.resumeAll}
            >
              <Play size={16} />
              <span className="hidden sm:inline">{t.batch.resumeAll}</span>
            </button>
          )}

          {stats.uploading > 0 && (
            <button
              type="button"
              data-testid="batch-pause-all"
              onClick={onPauseAll}
              className="
                flex items-center gap-1.5
                px-3 py-2
                text-sm font-medium
                text-on-brand bg-brand
                rounded-md
                hover:bg-brand-hover
                focus:outline-none focus:ring-2 focus:ring-brand
                transition-colors
                min-w-[100px]
                justify-center
              "
              aria-label={t.batch.pauseAll}
            >
              <Pause size={16} />
              <span className="hidden sm:inline">{t.batch.pauseAll}</span>
            </button>
          )}

          {stats.failed > 0 && (
            <button
              type="button"
              data-testid="batch-retry-failed"
              onClick={() => {
                files.filter(f => f.status === 'failed').forEach(f => onRetryFile(f.id));
              }}
              className="
                flex items-center gap-1.5
                px-3 py-2
                text-sm font-medium
                text-white bg-blue-600
                rounded-md
                hover:bg-blue-700
                focus:outline-none focus:ring-2 focus:ring-blue-500
                transition-colors
                min-w-[100px]
                justify-center
              "
              aria-label={t.batch.retryFailed}
            >
              <RotateCcw size={16} />
              <span className="hidden sm:inline">{t.batch.retryFailed}</span>
            </button>
          )}

          {hasActiveTasks && (
            <button
              type="button"
              data-testid="batch-cancel-all"
              onClick={onCancelAll}
              className="
                flex items-center gap-1.5
                px-3 py-2
                text-sm font-medium
                text-white bg-red-600
                rounded-md
                hover:bg-red-700
                focus:outline-none focus:ring-2 focus:ring-red-500
                transition-colors
                min-w-[100px]
                justify-center
              "
              aria-label={t.batch.cancelAll}
            >
              <X size={16} />
              <span className="hidden sm:inline">{t.batch.cancelAll}</span>
            </button>
          )}
        </div>
      </div>

      {noticeText && (
        <p className="ups-notice" data-testid="batch-notice" data-notice={notice ?? ''}>
          {notice === 'allReady' ? <CheckCircle2 aria-hidden="true" /> : <Info aria-hidden="true" />}
          <span>{noticeText}</span>
        </p>
      )}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="batch-processing-announcement">
        {announcement}
      </p>

      {/* Overall Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t.batch.overallProgress}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400" data-testid="batch-overall-percent">
            {overallProgress.toFixed(0)}%
          </span>
        </div>
        <div
          className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5"
          role="progressbar"
          aria-label={t.batch.overallProgress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(overallProgress)}
        >
          <div
            className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
            style={{ width: `${overallProgress}%` }}
          ></div>
        </div>
      </div>

      {/* Status Summary */}
      <div className="
        grid
        grid-cols-2
        sm:grid-cols-3
        md:grid-cols-6
        gap-2
        mb-4
        text-xs
      ">
        {stats.uploading > 0 && (
          <div className="bg-blue-50 dark:bg-blue-900/20 px-2 py-1.5 rounded text-center">
            <div className="font-semibold text-blue-700 dark:text-blue-300">{stats.uploading}</div>
            <div className="text-blue-600 dark:text-blue-400">{t.batch.uploading}</div>
          </div>
        )}
        {stats.pending > 0 && (
          <div className="bg-gray-50 dark:bg-gray-700 px-2 py-1.5 rounded text-center">
            <div className="font-semibold text-gray-700 dark:text-gray-300">{stats.pending}</div>
            <div className="text-gray-600 dark:text-gray-400">{t.batch.pending}</div>
          </div>
        )}
        {stats.paused > 0 && (
          <div className="bg-brand-soft dark:bg-brand-soft px-2 py-1.5 rounded text-center">
            <div className="font-semibold text-brand-ink dark:text-brand-ink">{stats.paused}</div>
            <div className="text-brand-ink dark:text-brand-ink">{t.batch.paused}</div>
          </div>
        )}
        {stats.completed > 0 && (
          <div className="bg-green-50 dark:bg-green-900/20 px-2 py-1.5 rounded text-center">
            <div className="font-semibold text-green-700 dark:text-green-300">{stats.completed}</div>
            <div className="text-green-600 dark:text-green-400">{t.uploadStatus.uploadedLabel}</div>
          </div>
        )}
        {stats.failed > 0 && (
          <div className="bg-red-50 dark:bg-red-900/20 px-2 py-1.5 rounded text-center">
            <div className="font-semibold text-red-700 dark:text-red-300">{stats.failed}</div>
            <div className="text-red-600 dark:text-red-400">{t.upload.failed}</div>
          </div>
        )}
        {stats.cancelled > 0 && (
          <div className="bg-gray-50 dark:bg-gray-700 px-2 py-1.5 rounded text-center">
            <div className="font-semibold text-gray-700 dark:text-gray-300">{stats.cancelled}</div>
            <div className="text-gray-600 dark:text-gray-400">{t.batch.cancelled}</div>
          </div>
        )}
      </div>

      {/* File List */}
      <div className="space-y-3">
        {files.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p>{t.batch.queueEmpty}</p>
          </div>
        ) : (
          files.map((file) => (
            <FileQueueItem
              key={file.id}
              file={file}
              processingPhase={file.status === 'completed' ? (file.videoId && processingPhases[file.videoId]) || 'processing' : undefined}
              onRemove={() => onRemoveFile(file.id)}
              onPause={() => onPauseFile(file.id)}
              onResume={() => onResumeFile(file.id)}
              onCancel={() => onCancelFile(file.id)}
              onRetry={() => onRetryFile(file.id)}
              categorySlot={renderCategory?.(file)}
            />
          ))
        )}
      </div>
    </div>
  );
}
