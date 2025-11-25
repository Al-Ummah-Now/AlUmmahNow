"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import { UploadQueueItem, VideoUploadMetadata, TusConfig } from '@al-ummah/shared-types';
import { BatchUploadManager } from '@/lib/upload/BatchUploadManager';
import { UploadOptimizer } from '@/lib/upload/UploadOptimizer';
import { initiateBatchUpload } from '@/lib/actions/upload';
import { logger } from '@/lib/logger-client';


interface UseBatchUploadOptions {
  userId?: string; // Optional - no longer needed for API calls
  channelId: string;
  sharedMetadata?: Partial<VideoUploadMetadata>;
  onUploadComplete?: (videoId: string) => void;
  onError?: (error: string) => void;
}

export function useBatchUpload({
  userId, // Deprecated - no longer used
  channelId,
  sharedMetadata = {},
  // onUploadComplete,
  onError,
}: UseBatchUploadOptions) {
  const [files, setFiles] = useState<UploadQueueItem[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isInitiating, setIsInitiating] = useState(false);

  const batchManagerRef = useRef<BatchUploadManager | null>(null);
  const optimizerRef = useRef<UploadOptimizer | null>(null);

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
        const queueState = batchManagerRef.current!.getQueueState();
        setFiles(Array.from(queueState.values()));
      });
    }

    return () => {
      // Cleanup on unmount
      if (batchManagerRef.current) {
        batchManagerRef.current.cancelAll();
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
          `Your device may not have enough memory for ${selectedFiles.length} files. Try uploading ${recommendedBatchSize} files at a time.`
        );
        setIsInitiating(false);
        return;
      }

      // Initiate batch upload with backend
      const initiateResult = await initiateBatchUpload(
        selectedFiles.map(file => ({
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
        throw new Error(initiateResult.error || 'Failed to initiate batch upload');
      }

      // Create TUS configs map
      const tusConfigs = new Map<string, { videoId: string; tusConfig: TusConfig }>();
      initiateResult.result.forEach((config, index) => {
        const file = selectedFiles[index];
        if (file) {
          tusConfigs.set(file.name, {
            videoId: config.videoId,
            tusConfig: {
              tusEndpoint: config.tusEndpoint,
              tusHeaders: config.tusHeaders,
              chunkSize: optimizerRef.current!.getOptimalChunkSize(),
              expiresAt: config.expiresAt,
            },
          });
        }
      });

      // Add videos to batch manager
      await batchManagerRef.current.addVideos(
        selectedFiles,
        sharedMetadata,
        tusConfigs
      );

      // Update local state
      const queueState = batchManagerRef.current.getQueueState();
      setFiles(Array.from(queueState.values()));
    } catch (error) {
      logger.error('Failed to add files:', error);
      onError?.(error instanceof Error ? error.message : 'Failed to add files to queue');
    } finally {
      setIsInitiating(false);
    }
  }, [userId, channelId, sharedMetadata, onError]);

  /**
   * Remove a file from the queue
   */
  const removeFile = useCallback((fileId: string) => {
    if (!batchManagerRef.current) return;

    const item = files.find(f => f.id === fileId);
    if (item && (item.status === 'pending' || item.status === 'cancelled' || item.status === 'failed')) {
      batchManagerRef.current.cancelUpload(fileId);

      // Update local state
      const queueState = batchManagerRef.current.getQueueState();
      setFiles(Array.from(queueState.values()).filter(f => f.id !== fileId));
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
