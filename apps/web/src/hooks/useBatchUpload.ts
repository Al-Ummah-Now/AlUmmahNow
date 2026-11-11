"use client";

import { useState, useCallback, useRef, useEffect } from 'react';
import { naturalCompare, UploadQueueItem, VideoUploadMetadata } from '@al-ummah/shared-types';
import { BatchUploadManager } from '@/lib/upload/BatchUploadManager';
import { UploadOptimizer } from '@/lib/upload/UploadOptimizer';
import { buildBatchUploadEntries, getTusProxyEndpoint } from '@/lib/upload/batch-entries';
import { grantedUploadUrl, requestUploadResume, type ReauthoriseResult } from '@/lib/upload/resilient-tus';
import { findRememberedUpload, forgetUpload, rememberUpload } from '@/lib/upload/resume-store';
import { tryFileFingerprint } from '@/lib/upload/fingerprint';
import type { BatchUploadEntry } from '@/lib/upload/BatchUploadManager';
import { hasActiveUploads } from '@/lib/upload/batch-status';
import { initiateBatchUpload, completeVideoUpload } from '@/lib/api/upload-client';
import { useHoldReloadWhile } from '@/lib/version-skew/VersionSkewProvider';
import { getClientAuthHeaders } from '@/lib/auth/client-token';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';
import { holdReload, recoverFromVersionSkew } from '@/lib/version-skew/recovery';
import { withoutErrorForwarding } from '@/lib/errors/reporter';
import { reportUploadError, uploadErrorMessage, type UploadErrorContext, type UploadStep } from '@/lib/upload/report-upload-error';
import { creatorRefusalMessage, formatWait } from '@/lib/upload/friendly-error';
import { refreshCreatorAccess } from '@/hooks/useCreatorAccess';
import { MAX_BATCH_FILES, planBatchSelection, remainingSlots } from '@/lib/upload/batch-selection';
import { useLanguage } from '@/hooks/useLanguage';


/** An error whose message is already written for the user (translated). */
class FriendlyUploadError extends Error {}

interface UseBatchUploadOptions {
  userId?: string; // Optional - no longer needed for API calls
  channelId: string;
  sharedMetadata?: Partial<VideoUploadMetadata>;
  /**
   * The values each new file's video is created with (titles and the rest
   * set for all files on the upload page, lib/upload/set-values.ts). Files
   * without one get their file name as the title.
   */
  initiateValuesFor?: (files: File[]) => Array<Record<string, unknown> & { title: string }>;
  onUploadComplete?: (videoId: string) => void;
  onError?: (error: string) => void;
}

export function useBatchUpload({
  userId: _userId, // Deprecated - no longer used
  channelId,
  sharedMetadata = {},
  initiateValuesFor,
  onUploadComplete,
  onError,
}: UseBatchUploadOptions) {
  const initiateValuesRef = useRef(initiateValuesFor);
  useEffect(() => {
    initiateValuesRef.current = initiateValuesFor;
  }, [initiateValuesFor]);
  const { t, lang } = useLanguage();
  const [files, setFiles] = useState<UploadQueueItem[]>([]);
  const [overallProgress, setOverallProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isInitiating, setIsInitiating] = useState(false);
  // A deploy while files are queued, uploading or paused must not reload the
  // page under them: the version-skew notice waits until the batch is over
  useHoldReloadWhile(isInitiating || isUploading || hasActiveUploads(files));

  const batchManagerRef = useRef<BatchUploadManager | null>(null);
  // Files the upload limit deferred: re-added when it allows (see addFiles)
  const deferredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addFilesRef = useRef<((files: File[]) => Promise<void>) | null>(null);
  useEffect(() => () => {
    if (deferredTimerRef.current) clearTimeout(deferredTimerRef.current);
  }, []);
  const optimizerRef = useRef<UploadOptimizer | null>(null);

  // Keep latest values for the long-lived manager callbacks
  const channelIdRef = useRef(channelId);
  const onUploadCompleteRef = useRef(onUploadComplete);
  const onErrorRef = useRef(onError);
  const uploadFailedMessageRef = useRef(t.errors.uploadFailed);
  const langRef = useRef(lang);
  useEffect(() => {
    channelIdRef.current = channelId;
    onUploadCompleteRef.current = onUploadComplete;
    onErrorRef.current = onError;
    uploadFailedMessageRef.current = t.errors.uploadFailed;
    langRef.current = lang;
  }, [channelId, onUploadComplete, onError, t, lang]);

  /**
   * Every upload failure the user sees: reported to the admin Errors page
   * (step, file count and sizes, HTTP status), then shown as a friendly
   * message with the reference instead of the raw error.
   */
  /** Reports the failure; shows the friendly message with the reference unless `friendly` is null (report only). */
  const failUpload = useCallback((step: UploadStep, error: unknown, friendly: string | null, ctx: UploadErrorContext = {}) => {
    const ref = reportUploadError(step, error, ctx);
    withoutErrorForwarding(() => logger.error(`[useBatchUpload] ${step} failed`, { ref, videoId: ctx.videoId, status: ctx.status, error }));
    if (friendly !== null) onErrorRef.current?.(uploadErrorMessage(friendly, ref, langRef.current));
    return ref;
  }, []);

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

      // A file's transfer failed for good (after the TUS client's own retries)
      batchManagerRef.current.onUploadError((item, error, step) => {
        const ref = failUpload(step, error, uploadFailedMessageRef.current, { file: item.file, videoId: item.videoId, bytesUploaded: item.bytesUploaded, attempt: item.retryCount });
        // The file's row shows the friendly message and reference, never the raw error
        item.error = uploadErrorMessage(uploadFailedMessageRef.current, ref, langRef.current);
      });

      // After TUS finishes, mark the upload complete so Bunny processing is
      // tracked (same step the single-upload flow performs).
      batchManagerRef.current.onUploadSuccess(async (item) => {
        if (!item.videoId) return;
        // Kept (not forgotten): picking this file again shows "already
        // uploaded" instead of creating a duplicate video
        rememberUpload(item.file, channelIdRef.current, item.videoId);
        // The TUS transfer is done but the item is not finished until complete answers
        const release = holdReload();
        try {
          const result = await completeVideoUpload(item.videoId, channelIdRef.current, item.file.size);
          if (!result.success) {
            // The bytes are at Bunny and the TUS proxy already moved the video
            // to processing (queued, with the processing-check loop behind it):
            // this call is only a backstop, so it is reported but the user is not shown an error
            failUpload('complete', result.error || 'Complete upload failed', null, {
              file: item.file, videoId: item.videoId, ...(result.status ? { status: result.status } : {}), ...(result.serverRef ? { serverRef: result.serverRef } : {}),
            });
            return;
          }
          logger.debug('[useBatchUpload] Upload completed', { videoId: item.videoId });
          onUploadCompleteRef.current?.(item.videoId);
        } catch (error) {
          if (recoverFromVersionSkew(error, 'batch-complete')) return;
          failUpload('complete', error, null, { file: item.file, videoId: item.videoId });
        } finally {
          release();
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
    // failUpload is stable (no dependencies), so this still runs once
  }, [failUpload]);

  /**
   * Add files to the upload queue
   */
  const addFiles = useCallback(async (pickedFiles: File[]) => {
    if (!batchManagerRef.current || !optimizerRef.current) return;
    // Natural file name order ("Lesson 2" before "Lesson 10"), not the order the OS handed them over in
    const selectedFiles = [...pickedFiles].sort((a, b) => naturalCompare(a.name, b.name, langRef.current === 'ar' ? 'ar' : 'en'));

    const manager = batchManagerRef.current;
    const syncFiles = () => setFiles(Array.from(manager.getQueueState().values()));

    // Finished rows (completed, cancelled) stay visible but never block a new
    // selection: files already uploaded here are marked "already uploaded",
    // files already queued are skipped, and only unfinished rows count
    // towards the 15-file limit.
    const queue = Array.from(manager.getQueueState().values());
    const plan = planBatchSelection(selectedFiles, queue);
    for (const rowId of plan.alreadyUploadedRowIds) manager.markAlreadyUploaded(rowId);
    const slots = remainingSlots(queue);
    if (plan.toAdd.length > slots) {
      syncFiles();
      onError?.(
        t.batch.errors.queueFull
          .replace('{max}', String(MAX_BATCH_FILES))
          .replace('{left}', String(slots))
      );
      return;
    }
    if (plan.toAdd.length === 0) {
      syncFiles();
      return;
    }
    const toAdd = plan.toAdd;

    setIsInitiating(true);
    // Which step a failure belongs to (reported with it)
    let step: UploadStep = 'auth';
    let initiateStatus: number | undefined;
    let initiateRef: string | undefined;

    try {
      // Check device capability (for the new files only)
      const canHandle = optimizerRef.current.canHandleBatchUpload(toAdd.length);
      if (!canHandle) {
        const recommendedBatchSize = optimizerRef.current.getRecommendedBatchSize();
        onError?.(
          t.batch.errors.deviceLimit
            .replace('{count}', String(toAdd.length))
            .replace('{recommended}', String(recommendedBatchSize))
        );
        return;
      }

      // Browser uploads go straight to the API TUS proxy with the user's token
      const authHeaders = await getClientAuthHeaders();
      if (!authHeaders['Authorization']) {
        throw new FriendlyUploadError(t.errors.unauthorized);
      }
      const apiUrl = getApiUrl();
      const endpoint = getTusProxyEndpoint(apiUrl);
      const chunkSize = optimizerRef.current.getOptimalChunkSize();

      // A file picked again after a reload or a crash resumes its video (same
      // Bunny upload, at its offset) instead of becoming a new video.
      step = 'resume';
      const resumedEntries: BatchUploadEntry[] = [];
      const freshFiles: File[] = [];
      for (const file of toAdd) {
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
              uploadUrl: grantedUploadUrl(endpoint, result, file),
            },
          });
          continue;
        }
        if (result?.kind === 'completed') {
          // Uploaded before (an earlier visit): a finished "already uploaded"
          // row with a link to the video, never a second video
          logger.debug('[useBatchUpload] File was already uploaded', { videoId: remembered.videoId });
          manager.addAlreadyUploaded(file, remembered.videoId, sharedMetadata);
          continue;
        }
        // The video is gone (deleted) or could not be checked: a new upload
        forgetUpload(file, channelId);
        freshFiles.push(file);
      }

      let freshEntries: BatchUploadEntry[] = [];
      if (freshFiles.length > 0) {
        step = 'initiate';
        // Fingerprints: the same file picked again (another tab or browser,
        // storage cleared) reuses its unfinished video instead of a new one
        const fingerprints = await Promise.all(freshFiles.map((file) => tryFileFingerprint(file)));
        // Values set for all files on the page go in with the video's creation
        const values = initiateValuesRef.current?.(freshFiles) ?? [];
        // Initiate batch upload with backend (one TUS proxy session per file)
        const initiateResult = await initiateBatchUpload(
          freshFiles.map((file, index) => ({
            fileSize: file.size,
            mimeType: file.type,
            isPublic: sharedMetadata.isPublic ?? true,
            description: sharedMetadata.description,
            tags: sharedMetadata.tags?.join(','),
            ...(values[index] ?? { title: file.name.replace(/\.[^/.]+$/, '') }),
            ...(fingerprints[index] ? { fingerprint: fingerprints[index] } : {}),
          })),
          channelId,
          {
            channelId,
            category: sharedMetadata.category,
            isPublic: sharedMetadata.isPublic,
          }
        );

        if (!initiateResult.success || !initiateResult.result) {
          // No tier or the upload limit: the user's words, not the server's (nothing for the Errors page)
          const refusal = creatorRefusalMessage(t, initiateResult);
          if (refusal) {
            logger.warn('[useBatchUpload] Batch refused', { code: initiateResult.code, retryAfter: initiateResult.retryAfter, count: freshFiles.length });
            if (initiateResult.code === 'uploads_by_invitation') void refreshCreatorAccess();
            throw new FriendlyUploadError(refusal);
          }
          initiateStatus = initiateResult.status;
          initiateRef = initiateResult.serverRef;
          throw new Error(initiateResult.error || 'Batch initiate failed');
        }

        // The upload limit fits only part of the batch: the first files start,
        // the rest start by themselves once the limit allows (page kept open)
        const startedFiles = freshFiles.slice(0, initiateResult.result.length);
        const deferred = initiateResult.deferred;
        if (deferred && startedFiles.length < freshFiles.length) {
          const waiting = freshFiles.slice(startedFiles.length);
          const waitSeconds = Math.max(1, deferred.retryAfter);
          logger.warn('[useBatchUpload] Batch partly deferred by the upload limit', { started: startedFiles.length, deferred: waiting.length, retryAfter: waitSeconds });
          onError?.(
            t.creator.batchPartial
              .replace('{started}', String(startedFiles.length))
              .replace('{total}', String(freshFiles.length))
              .replace('{left}', String(waiting.length))
              .replace('{time}', formatWait(t, waitSeconds)),
          );
          if (deferredTimerRef.current) clearTimeout(deferredTimerRef.current);
          deferredTimerRef.current = setTimeout(() => {
            deferredTimerRef.current = null;
            void addFilesRef.current?.(waiting);
          }, (waitSeconds + 2) * 1000);
        }

        freshEntries = buildBatchUploadEntries({
          files: startedFiles,
          sessions: initiateResult.result,
          apiUrl,
          authorization: authHeaders['Authorization'],
          chunkSize,
        });
        for (const entry of freshEntries) rememberUpload(entry.file, channelId, entry.videoId);
      }

      step = 'queue';
      const entries = [...resumedEntries, ...freshEntries];

      // Add videos to batch manager (may be none: all already uploaded)
      await manager.addVideos(entries, sharedMetadata);
      syncFiles();
    } catch (error) {
      syncFiles();
      // A deploy while the page was open: the version-skew notice reloads once
      // uploads are idle (picked files resume from the remembered uploads)
      if (recoverFromVersionSkew(error, 'batch-add')) return;
      if (error instanceof FriendlyUploadError) {
        onError?.(error.message);
        return;
      }
      const friendly = step === 'auth' ? t.errors.unauthorized : t.batch.errors.initiateFailed;
      failUpload(step, error, friendly, {
        files: toAdd, ...(initiateStatus ? { status: initiateStatus } : {}), ...(initiateRef ? { serverRef: initiateRef } : {}),
      });
    } finally {
      setIsInitiating(false);
    }
  }, [channelId, sharedMetadata, onError, t, failUpload]);
  useEffect(() => {
    addFilesRef.current = addFiles;
  }, [addFiles]);

  /** Put the queue in this order (row ids); uploads and batch playlist adds follow it. */
  const reorderQueue = useCallback((ids: string[]) => {
    if (!batchManagerRef.current) return;
    batchManagerRef.current.reorder(ids);
    setFiles(Array.from(batchManagerRef.current.getQueueState().values()));
  }, []);

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
      // Never leave the actions hidden after a failed start
      if (batchManagerRef.current && !hasActiveUploads(Array.from(batchManagerRef.current.getQueueState().values()))) {
        setIsUploading(false);
      }
      if (recoverFromVersionSkew(error, 'batch-start')) return;
      failUpload('start', error, uploadFailedMessageRef.current, {
        files: Array.from(batchManagerRef.current?.getQueueState().values() ?? []).map((i) => i.file),
      });
    }
  }, [failUpload]);

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
      const item = batchManagerRef.current?.getQueueState().get(fileId);
      failUpload('retry', error, uploadFailedMessageRef.current, item ? { file: item.file, videoId: item.videoId } : {});
    }
  }, [failUpload]);

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
   * Remove completed and cancelled rows ("Clear finished")
   */
  const clearFinished = useCallback(() => {
    if (!batchManagerRef.current) return;
    batchManagerRef.current.clearFinished();
    const items = Array.from(batchManagerRef.current.getQueueState().values());
    setFiles(items);
    if (items.length === 0) setOverallProgress(0);
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
    clearFinished,
    reorderQueue,
  };
}
