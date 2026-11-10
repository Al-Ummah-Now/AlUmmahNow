"use client";

import React from 'react';
import { UploadQueueItem, UploadStatus } from '@al-ummah/shared-types';
import {
  FileVideo,
  Pause,
  Play,
  X,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  Clock,
  Loader2
} from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { useUploadResult } from '@/lib/notifications/upload-results';

interface FileQueueItemProps {
  file: UploadQueueItem;
  onRemove: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

export function FileQueueItem({
  file,
  onRemove,
  onPause,
  onResume,
  onCancel,
  onRetry,
}: FileQueueItemProps) {
  const { t, isRTL: _isRTL } = useLanguage();
  // Processing result pushed in real time; shown here instead of a toast (NotificationCenter)
  const processed = useUploadResult(file.status === 'completed' ? file.videoId : null);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    return `${formatBytes(bytesPerSecond)}/s`;
  };

  const getStatusColor = (status: UploadStatus) => {
    switch (status) {
      case 'completed':
        return 'text-green-600 dark:text-green-400';
      case 'failed':
        return 'text-red-600 dark:text-red-400';
      case 'uploading':
        return 'text-blue-600 dark:text-blue-400';
      case 'paused':
        return 'text-brand-ink dark:text-brand-ink';
      case 'processing':
        return 'text-purple-600 dark:text-purple-400';
      case 'cancelled':
        return 'text-gray-600 dark:text-gray-400';
      default:
        return 'text-gray-500 dark:text-gray-400';
    }
  };

  const getStatusIcon = (status: UploadStatus) => {
    const iconProps = { size: 16, className: getStatusColor(status) };

    switch (status) {
      case 'completed':
        return <CheckCircle {...iconProps} />;
      case 'failed':
        return <AlertCircle {...iconProps} />;
      case 'uploading':
        return <Loader2 {...iconProps} className={`${iconProps.className} animate-spin`} />;
      case 'paused':
        return <Pause {...iconProps} />;
      case 'processing':
        return <Loader2 {...iconProps} className={`${iconProps.className} animate-spin`} />;
      case 'cancelled':
        return <X {...iconProps} />;
      default:
        return <Clock {...iconProps} />;
    }
  };

  const getStatusText = (status: UploadStatus): string => {
    switch (status) {
      case 'pending':
        return t.batch.pending;
      case 'uploading':
        return t.batch.uploading;
      case 'paused':
        return t.batch.paused;
      case 'processing':
        return t.upload.processing;
      case 'completed':
        return t.batch.completed;
      case 'failed':
        return t.upload.failed;
      case 'cancelled':
        return t.batch.cancelled;
      default:
        return status;
    }
  };

  const canPause = file.status === 'uploading';
  const canResume = file.status === 'paused';
  const canCancel = file.status === 'uploading' || file.status === 'paused' || file.status === 'pending';
  const canRetry = file.status === 'failed';
  const canRemove = file.status === 'pending' || file.status === 'cancelled' || file.status === 'failed';

  return (
    <div data-testid="batch-file" data-status={file.status} data-video-id={file.videoId || ''} data-reconnecting={file.reconnecting ? 'true' : 'false'} data-bytes-uploaded={file.bytesUploaded} className="
      border border-gray-200 dark:border-gray-700
      rounded-lg
      p-3
      md:p-4
      bg-white dark:bg-gray-800
      hover:shadow-md
      transition-shadow
    ">
      <div className="flex items-start gap-3">
        {/* File Icon */}
        <div className="flex-shrink-0 mt-1">
          <FileVideo size={24} className="text-gray-400 dark:text-gray-500" />
        </div>

        {/* File Info */}
        <div className="flex-1 min-w-0">
          {/* File Name & Size */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="flex-1 min-w-0">
              <h3 data-testid="batch-file-name" className="
                text-sm font-medium
                text-gray-900 dark:text-white
                truncate
              ">
                {file.metadata.title || file.file.name}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {formatBytes(file.bytesTotal)}
              </p>
            </div>

            {/* Status Badge */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {getStatusIcon(file.status)}
              <span data-testid="batch-file-status" className={`text-xs font-medium ${getStatusColor(file.status)}`}>
                {getStatusText(file.status)}
              </span>
              {processed && (
                <span
                  data-testid="batch-file-processed"
                  data-result={processed}
                  className={`text-xs font-medium ${processed === 'ready' ? 'text-[var(--fanous-color-success-text)]' : 'text-[var(--fanous-color-error-text)]'}`}
                >
                  · {processed === 'ready' ? t.notifications.realtime.uploadReadyTitle : t.upload.processingFailed}
                </span>
              )}
            </div>
          </div>

          {/* Progress Bar */}
          {(file.status === 'uploading' || file.status === 'paused' || file.status === 'processing') && (
            <div className="mb-2">
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                <div
                  className={`
                    h-1.5 rounded-full transition-all duration-300
                    ${file.status === 'paused' ? 'bg-brand' : 'bg-blue-600'}
                  `}
                  style={{ width: `${file.progress}%` }}
                ></div>
              </div>
              <div className="flex items-center justify-between mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>
                  {formatBytes(file.bytesUploaded)} / {formatBytes(file.bytesTotal)}
                </span>
                <span>{file.progress.toFixed(0)}%</span>
              </div>
            </div>
          )}

          {/* Reconnecting: a transient failure is being retried; progress is kept */}
          {file.status === 'uploading' && file.reconnecting && (
            <div data-testid="batch-file-reconnecting" role="status" className="text-xs text-muted-foreground mb-2">
              {t.upload.reconnecting}
            </div>
          )}

          {/* Upload Speed */}
          {file.status === 'uploading' && !file.reconnecting && file.speed && (
            <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              {t.batch.uploadSpeed}: {formatSpeed(file.speed)}
            </div>
          )}

          {/* Error Message */}
          {file.status === 'failed' && file.error && (
            <div className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400 mb-2">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>{file.error}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 mt-2">
            {canPause && (
              <button
                type="button"
                data-testid="batch-file-pause"
                onClick={onPause}
                className="
                  flex items-center gap-1
                  px-2 py-1
                  text-xs font-medium
                  text-brand-ink dark:text-brand
                  bg-brand-soft dark:bg-brand-soft
                  border border-brand-edge dark:border-brand-edge
                  rounded
                  hover:bg-brand-soft dark:hover:bg-brand-soft
                  focus:outline-none focus:ring-2 focus:ring-brand
                  transition-colors
                "
                aria-label={t.upload.pause}
              >
                <Pause size={12} />
                <span>{t.upload.pause}</span>
              </button>
            )}

            {canResume && (
              <button
                type="button"
                data-testid="batch-file-resume"
                onClick={onResume}
                className="
                  flex items-center gap-1
                  px-2 py-1
                  text-xs font-medium
                  text-green-700 dark:text-green-300
                  bg-green-50 dark:bg-green-900/20
                  border border-green-200 dark:border-green-800
                  rounded
                  hover:bg-green-100 dark:hover:bg-green-900/30
                  focus:outline-none focus:ring-2 focus:ring-green-500
                  transition-colors
                "
                aria-label={t.upload.resume}
              >
                <Play size={12} />
                <span>{t.upload.resume}</span>
              </button>
            )}

            {canRetry && (
              <button
                type="button"
                data-testid="batch-file-retry"
                onClick={onRetry}
                className="
                  flex items-center gap-1
                  px-2 py-1
                  text-xs font-medium
                  text-blue-700 dark:text-blue-300
                  bg-blue-50 dark:bg-blue-900/20
                  border border-blue-200 dark:border-blue-800
                  rounded
                  hover:bg-blue-100 dark:hover:bg-blue-900/30
                  focus:outline-none focus:ring-2 focus:ring-blue-500
                  transition-colors
                "
                aria-label={t.upload.retry}
              >
                <RotateCcw size={12} />
                <span>{t.upload.retry}</span>
              </button>
            )}

            {canCancel && (
              <button
                type="button"
                data-testid="batch-file-cancel"
                onClick={onCancel}
                className="
                  flex items-center gap-1
                  px-2 py-1
                  text-xs font-medium
                  text-red-700 dark:text-red-300
                  bg-red-50 dark:bg-red-900/20
                  border border-red-200 dark:border-red-800
                  rounded
                  hover:bg-red-100 dark:hover:bg-red-900/30
                  focus:outline-none focus:ring-2 focus:ring-red-500
                  transition-colors
                "
                aria-label={t.upload.cancel}
              >
                <X size={12} />
                <span>{t.upload.cancel}</span>
              </button>
            )}

            {canRemove && (
              <button
                type="button"
                data-testid="batch-file-remove"
                onClick={onRemove}
                className="
                  flex items-center gap-1
                  px-2 py-1
                  text-xs font-medium
                  text-gray-700 dark:text-gray-300
                  bg-gray-50 dark:bg-gray-700
                  border border-gray-200 dark:border-gray-600
                  rounded
                  hover:bg-gray-100 dark:hover:bg-gray-600
                  focus:outline-none focus:ring-2 focus:ring-gray-500
                  transition-colors
                "
                aria-label={t.batch.removeFile}
              >
                <X size={12} />
                <span>{t.batch.removeFile}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
