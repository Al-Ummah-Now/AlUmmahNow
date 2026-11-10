"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import { UploadQueueItem, VideoUploadMetadata } from '@al-ummah/shared-types';
import { BatchUploadManager } from '@/lib/upload/BatchUploadManager';
import { UploadOptimizer } from '@/lib/upload/UploadOptimizer';
import { buildBatchUploadEntries, getTusProxyEndpoint } from '@/lib/upload/batch-entries';
import { requestUploadResume, type ReauthoriseResult } from '@/lib/upload/resilient-tus';
import { findRememberedUpload, forgetUpload, rememberUpload } from '@/lib/upload/resume-store';
import type { BatchUploadEntry } from '@/lib/upload/BatchUploadManager';
import { hasActiveUploads } from '@/lib/upload/batch-status';
import { initiateBatchUpload, completeVideoUpload } from '@/lib/actions/upload';
import { getClientAuthHeaders } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';
import { useLanguage } from '@/hooks/useLanguage';


interface UseBatchUploadOptions {
  userId?: string; // Optional - no longer needed for API calls
  channelId: string;
  sharedMetadata?: Partial<VideoUploadMetadata>;
  onUploadComplete?: (videoId: string) => void;
  onError?: (error: string) => void;
}

export function useBatchUpload({
  userId: _userId, // Deprecated - no longer used
  channelId,
  sharedMetadata = {},
  onUploadComplete,
  onError,
}: UseBatchUploadOptions) {
  const { t } = useLanguage();
  const [files, setFiles] = useState<UploadQueueItem[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isInitiating, setIsInitiating] = useState(false);

  const batchManagerRef = useRef<BatchUploadManager | null>(null);
  const optimizerRef = useRef<UploadOptimizer | null>(null);

  // Keep latest values for the long-lived manager callbacks
  const channelIdRef = useRef(channelId);
  const onUploadCompleteRef = useRef(onUploadComplete);
  const onErrorRef = useRef(onError);
  const uploadFailedMessageRef = useRef(t.errors.uploadFailed);
  useEffect(() => {
    channelIdRef.current = channelId;
    onUploadCompleteRef.current = onUploadComplete;
    onErrorRef.current = onError;
    uploadFailedMessageRef.current = t.errors.uploadFailed;
  }, [channelId, onUploadComplete, onError, t]);

  // Initialize managers
  useEffect(() => {
    if (!optimizerRef.current) {
      optimizerRef.current = new UploadOptimizer();
    }

    if (!batchManagerRef.current) {
      const concurrency = optimizerRef.current.getOptimalConcurrency();
      batchManagerRef.current = new BatchUploadManager(concurrency);

      // Subscribe to progress updates
      batchManagerRef.current.onProgressUpdate((progress) => {
        setOverallProgress(progress.overallProgress);

        // Update file list from queue state
        const queueItems = Array.from(batchManagerRef.current!.getQueueState().values());
        setFiles(queueItems);
        // Once nothing is pending, uploading or paused the batch is over, so the
        // page shows its actions again (Start / Add Videos) instead of hiding them forever
        if (!hasActiveUploads(queueItems)) {
          setIsUploading(false);
        }
      });

      // After TUS finishes, mark the upload complete so Bunny processing is
      // tracked (same step the single-upload flow performs).
      batchManagerRef.current.onUploadSuccess(async (item) => {
        if (!item.videoId) return;
        forgetUpload(item.file, channelIdRef.current);
        try {
          const result = await completeVideoUpload(item.videoId, channelIdRef.current, item.file.size);
          if (!result.success) {
            logger.error('[useBatchUpload] Complete upload failed', { videoId: item.videoId, error: result.error });
            onErrorRef.current?.(result.error || uploadFailedMessageRef.current);
            return;
          }
          logger.info('[useBatchUpload] Upload completed', { videoId: item.videoId });
          onUploadCompleteRef.current?.(item.videoId);
        } catch (error) {
          logger.error('[useBatchUpload] Complete upload threw', { videoId: item.videoId, error });
          onErrorRef.current?.(error instanceof Error ? error.message : uploadFailedMessageRef.current);
        }
      });
    }

    return () => {
      // Leaving the page pauses (keeps every upload resumable: picking the
      // same files again resumes them). Cancelling here terminated the uploads
      // at Bunny and threw away what was already uploaded.
      if (batchManagerRef.current) {
        batchManagerRef.current.pauseAll();
      }
    };
  }, []);

  /**
   * Add files to the upload queue
   */
  const addFiles = useCallback(async (selectedFiles: File[]) => {
    if (!batchManagerRef.current || !optimizerRef.current) return;

    setIsInitiating(true);

    try {
      // Check device capability
      const canHandle = optimizerRef.current.canHandleBatchUpload(selectedFiles.length);
      if (!canHandle) {
        const recommendedBatchSize = optimizerRef.current.getRecommendedBatchSize();
        onError?.(
          t.batch.errors.deviceLimit
            .replace('{count}', String(selectedFiles.length))
            .replace('{recommended}', String(recommendedBatchSize))
        );
        setIsInitiating(false);
        return;
      }

      // Browser uploads go straight to the API TUS proxy with the user's token
      const authHeaders = await getClientAuthHeaders();
      if (!authHeaders['Authorization']) {
        throw new Error(t.errors.unauthorized);
      }
      const apiUrl = getApiUrl();
      const endpoint = getTusProxyEndpoint(apiUrl);
      const chunkSize = optimizerRef.current.getOptimalChunkSize();

      // A file picked again after a reload or a crash resumes its video (same
      // Bunny upload, at its offset) instead of becoming a new video.
      const resumedEntries: BatchUploadEntry[] = [];
      const freshFiles: File[] = [];
      for (const file of selectedFiles) {
        const remembered = findRememberedUpload(file, channelId);
        if (!remembered) {
          freshFiles.push(file);
          continue;
        }
        let result: ReauthoriseResult | null = null;
        for (let attempt = 0; attempt < 3 && !result; attempt++) {
          try {
            result = await requestUploadResume(apiUrl, remembered.videoId, authHeaders);
          } catch (error) {
            logger.warn('[useBatchUpload] Resume check failed, retrying', { videoId: remembered.videoId, attempt, error });
            await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          }
        }
        if (result?.kind === 'grant') {
          resumedEntries.push({
            file,
            videoId: remembered.videoId,
            tusConfig: {
              tusEndpoint: endpoint,
              tusHeaders: { Authorization: authHeaders['Authorization'] },
              metadata: { tusSessionId: result.tusSessionId, videoId: remembered.videoId },
              chunkSize,
              expiresAt: '',
              ...(result.tusUploadId ? { uploadUrl: `${endpoint}/${result.tusUploadId}` } : {}),
            },
          });
          continue;
        }
        if (result?.kind === 'completed') {
          forgetUpload(file, channelId);
          logger.info('[useBatchUpload] File was already uploaded', { videoId: remembered.videoId });
          onUploadCompleteRef.current?.(remembered.videoId);
          continue;
        }
        // The video is gone (deleted) or could not be checked: a new upload
        forgetUpload(file, channelId);
        freshFiles.push(file);
      }

      let freshEntries: BatchUploadEntry[] = [];
      if (freshFiles.length > 0) {
        // Initiate batch upload with backend (one TUS proxy session per file)
        const initiateResult = await initiateBatchUpload(
          freshFiles.map(file => ({
            title: file.name.replace(/\.[^/.]+$/, ''),
            fileSize: file.size,
            mimeType: file.type,
            isPublic: sharedMetadata.isPublic ?? true,
            description: sharedMetadata.description,
            tags: sharedMetadata.tags?.join(','),
          })),
          channelId,
          {
            channelId,
            category: sharedMetadata.category,
            isPublic: sharedMetadata.isPublic,
          }
        );

        if (!initiateResult.success || !initiateResult.result) {
          throw new Error(initiateResult.error || t.batch.errors.initiateFailed);
        }

        freshEntries = buildBatchUploadEntries({
          files: freshFiles,
          sessions: initiateResult.result,
          apiUrl,
          authorization: authHeaders['Authorization'],
          chunkSize,
        });
        for (const entry of freshEntries) rememberUpload(entry.file, channelId, entry.videoId);
      }

      const entries = [...resumedEntries, ...freshEntries];

      // Add videos to batch manager
      await batchManagerRef.current.addVideos(entries, sharedMetadata);

      // Update local state
      const queueState = batchManagerRef.current.getQueueState();
      setFiles(Array.from(queueState.values()));
    } catch (error) {
      logger.error('[useBatchUpload] Failed to add files', { error });
      onError?.(error instanceof Error ? error.message : t.batch.errors.initiateFailed);
    } finally {
      setIsInitiating(false);
    }
  }, [channelId, sharedMetadata, onError, t]);

  /**
   * Remove a file from the queue
   */
  const removeFile = useCallback((fileId: string) => {
    if (!batchManagerRef.current) return;

    const item = files.find(f => f.id === fileId);
    if (item && (item.status === 'pending' || item.status === 'cancelled' || item.status === 'failed')) {
      forgetUpload(item.file, channelIdRef.current);
      // removeUpload drops it from the manager's queue too; cancelUpload only
      // marked it cancelled, so the removed file came back on the next update
      batchManagerRef.current.removeUpload(fileId);
      setFiles(Array.from(batchManagerRef.current.getQueueState().values()));
    }
  }, [files]);

  /**
   * Start all uploads in the queue
   */
  const startUpload = useCallback(async () => {
    if (!batchManagerRef.current) return;

    setIsUploading(true);
    try {
      await batchManagerRef.current.startUploads();
      if (!hasActiveUploads(Array.from(batchManagerRef.current.getQueueState().values()))) {
        setIsUploading(false);
      }
    } catch (error) {
      logger.error('Failed to start uploads:', error);
      onError?.(error instanceof Error ? error.message : 'Failed to start uploads');
    }
  }, [onError]);

  /**
   * Pause a single upload
   */
  const pauseUpload = useCallback(async (fileId: string) => {
    if (!batchManagerRef.current) return;

    try {
      await batchManagerRef.current.pauseUpload(fileId);
    } catch (error) {
      logger.error('Failed to pause upload:', error);
    }
  }, []);

  /**
   * Resume a paused upload
   */
  const resumeUpload = useCallback(async (fileId: string) => {
    if (!batchManagerRef.current) return;

    try {
      await batchManagerRef.current.resumeUpload(fileId);
    } catch (error) {
      logger.error('Failed to resume upload:', error);
    }
  }, []);

  /**
   * Cancel a single upload
   */
  const cancelUpload = useCallback(async (fileId: string) => {
    if (!batchManagerRef.current) return;

    try {
      const item = batchManagerRef.current.getQueueState().get(fileId);
      if (item) forgetUpload(item.file, channelIdRef.current);
      await batchManagerRef.current.cancelUpload(fileId);
    } catch (error) {
      logger.error('Failed to cancel upload:', error);
    }
  }, []);

  /**
   * Retry a failed upload
   */
  const retryUpload = useCallback(async (fileId: string) => {
    if (!batchManagerRef.current) return;

    try {
      await batchManagerRef.current.retryUpload(fileId);
    } catch (error) {
      logger.error('Failed to retry upload:', error);
      onError?.(error instanceof Error ? error.message : 'Failed to retry upload');
    }
  }, [onError]);

  /**
   * Pause all uploads
   */
  const pauseAll = useCallback(() => {
    if (!batchManagerRef.current) return;
    batchManagerRef.current.pauseAll();
  }, []);

  /**
   * Resume all paused uploads
   */
  const resumeAll = useCallback(async () => {
    if (!batchManagerRef.current) return;

    try {
      await batchManagerRef.current.resumeAll();
    } catch (error) {
      logger.error('Failed to resume all uploads:', error);
    }
  }, []);

  /**
   * Cancel all uploads
   */
  const cancelAll = useCallback(() => {
    if (!batchManagerRef.current) return;

    for (const item of batchManagerRef.current.getQueueState().values()) {
      if (item.status === 'uploading' || item.status === 'pending' || item.status === 'paused') forgetUpload(item.file, channelIdRef.current);
    }
    batchManagerRef.current.cancelAll();
    setIsUploading(false);

    // Update local state
    const queueState = batchManagerRef.current.getQueueState();
    setFiles(Array.from(queueState.values()));
  }, []);

  /**
   * Clear the entire queue
   */
  const clearQueue = useCallback(() => {
    if (!batchManagerRef.current) return;

    batchManagerRef.current.clearQueue();
    setFiles([]);
    setOverallProgress(0);
    setIsUploading(false);
  }, []);

  return {
    files,
    overallProgress,
    isUploading,
    isInitiating,
    addFiles,
    removeFile,
    startUpload,
    pauseUpload,
    resumeUpload,
    cancelUpload,
    retryUpload,
    pauseAll,
    resumeAll,
    cancelAll,
    clearQueue,
  };
}
