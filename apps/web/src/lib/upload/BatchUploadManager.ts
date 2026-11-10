import {
  UploadQueueItem,
  UploadStatus,
  TusConfig,
  TusCallbacks,
  VideoUploadMetadata,
} from '@al-ummah/shared-types';
import { TusParallelManager } from './TusParallelManager';
import { UploadOptimizer } from './UploadOptimizer';
import { logger } from '@/lib/logger-client';


/**
 * Batch progress state
 */
export interface BatchProgress {
  total: number;
  completed: number;
  failed: number;
  uploading: number;
  pending: number;
  cancelled: number;
  overallProgress: number;
  totalBytes: number;
  uploadedBytes: number;
  uploadSpeed: number;
  eta: number;
}

/**
 * Status change callback
 */
export type StatusChangeCallback = (status: UploadStatus) => void;

/**
 * Progress update callback
 */
export type ProgressCallback = (progress: BatchProgress) => void;

/**
 * Called once a file has been fully uploaded through TUS
 */
export type UploadSuccessCallback = (item: UploadQueueItem) => void;
/** A file failed for good: step is where (start, retry, or the TUS transfer itself). */
export type UploadErrorCallback = (item: UploadQueueItem, error: unknown, step: 'start' | 'retry' | 'tus') => void;

/**
 * A file paired with the video record and TUS config created for it by the API
 */
export interface BatchUploadEntry {
  file: File;
  videoId: string;
  tusConfig: TusConfig;
}

/**
 * Manages batch video uploads with parallel upload support
 */
export class BatchUploadManager {
  private tusManager: TusParallelManager;
  private optimizer: UploadOptimizer;
  private queue: Map<string, UploadQueueItem>;
  private statusCallbacks: Map<string, Set<StatusChangeCallback>>;
  private progressCallbacks: Set<ProgressCallback>;
  private successCallbacks: Set<UploadSuccessCallback> = new Set();
  private errorCallbacks: Set<UploadErrorCallback> = new Set();
  private uploadSpeeds: Map<string, number[]>; // Track upload speeds for ETA

  constructor(concurrentLimit: number = 3) {
    this.tusManager = new TusParallelManager(concurrentLimit);
    this.optimizer = new UploadOptimizer();
    this.queue = new Map();
    this.statusCallbacks = new Map();
    this.progressCallbacks = new Set();
    this.uploadSpeeds = new Map();

    // Use optimizer to set optimal concurrency
    const optimalConcurrency = this.optimizer.getOptimalConcurrency();
    this.tusManager.setConcurrencyLimit(optimalConcurrency);
  }

  /**
   * Add videos to the upload queue
   */
  async addVideos(
    entries: BatchUploadEntry[],
    sharedMetadata: Partial<VideoUploadMetadata>
  ): Promise<void> {
    // Every picked file may already be uploaded or queued: nothing to add
    if (entries.length === 0) return;
    for (const config of entries) {
      const { file } = config;
      const id = this.generateId();

      const queueItem: UploadQueueItem = {
        id,
        file,
        videoId: config.videoId,
        metadata: {
          title: file.name,
          ...sharedMetadata,
        } as VideoUploadMetadata,
        status: 'pending',
        progress: 0,
        bytesUploaded: 0,
        bytesTotal: file.size,
        retryCount: 0,
      };

      this.queue.set(id, queueItem);

      // Create TUS upload
      this.tusManager.createUpload(
        id,
        file,
        config.tusConfig,
        this.createCallbacks(id)
      );
    }

    this.notifyProgressUpdate();
  }

  /**
   * Show a file picked again after it was uploaded as "already uploaded"
   * (its existing row, or a new finished row when it was uploaded before a
   * reload). Nothing is uploaded and no video is created.
   */
  markAlreadyUploaded(rowId: string): void {
    const item = this.queue.get(rowId);
    if (!item) return;
    item.alreadyUploaded = true;
    this.queue.set(rowId, item);
    this.notifyProgressUpdate();
  }

  addAlreadyUploaded(file: File, videoId: string, sharedMetadata: Partial<VideoUploadMetadata>): string {
    const id = this.generateId();
    this.queue.set(id, {
      id,
      file,
      videoId,
      metadata: { title: file.name, ...sharedMetadata } as VideoUploadMetadata,
      status: 'completed',
      progress: 100,
      bytesUploaded: file.size,
      bytesTotal: file.size,
      retryCount: 0,
      alreadyUploaded: true,
      completedAt: new Date(),
    });
    this.notifyProgressUpdate();
    return id;
  }

  /**
   * Remove completed and cancelled rows ("Clear finished"). Pending, running,
   * paused and failed rows stay.
   */
  clearFinished(): void {
    let removed = false;
    for (const [id, item] of this.queue.entries()) {
      if (item.status === 'completed' || item.status === 'cancelled') {
        this.tusManager.cancel(id);
        this.queue.delete(id);
        this.statusCallbacks.delete(id);
        this.uploadSpeeds.delete(id);
        removed = true;
      }
    }
    if (removed) this.notifyProgressUpdate();
  }

  /**
   * Start all uploads in the queue
   */
  async startUploads(): Promise<void> {
    const pendingUploads = Array.from(this.queue.values()).filter(
      (item) => item.status === 'pending'
    );

    for (const item of pendingUploads) {
      try {
        await this.tusManager.start(item.id);
        this.updateStatus(item.id, 'uploading');
      } catch (error) {
        this.updateStatus(item.id, 'failed');
        const queueItem = this.queue.get(item.id);
        if (queueItem) {
          queueItem.error = error instanceof Error ? error.message : 'Upload failed';
        }
        this.notifyError(queueItem ?? item, error, 'start');
      }
    }
  }

  /**
   * Pause an upload
   */
  async pauseUpload(videoId: string): Promise<void> {
    this.tusManager.pause(videoId);
    this.updateStatus(videoId, 'paused');
  }

  /**
   * Resume a paused upload
   */
  async resumeUpload(videoId: string): Promise<void> {
    await this.tusManager.resume(videoId);
    this.updateStatus(videoId, 'uploading');
  }

  /**
   * Cancel an upload
   */
  async cancelUpload(videoId: string): Promise<void> {
    this.tusManager.cancel(videoId);
    this.updateStatus(videoId, 'cancelled');
  }

  /**
   * Remove an upload from the queue entirely (cancelling it first). Unlike
   * cancelUpload, the item does not come back in later queue snapshots.
   */
  removeUpload(videoId: string): void {
    if (!this.queue.has(videoId)) return;
    this.tusManager.cancel(videoId);
    this.queue.delete(videoId);
    this.statusCallbacks.delete(videoId);
    this.uploadSpeeds.delete(videoId);
    this.notifyProgressUpdate();
  }

  /**
   * Retry a failed upload. It resumes at the server's offset (same video, same
   * upload), so the progress bar keeps what was already uploaded.
   */
  async retryUpload(videoId: string): Promise<void> {
    const item = this.queue.get(videoId);
    if (!item) return;

    item.retryCount++;
    item.status = 'pending';
    item.error = undefined;
    item.reconnecting = false;

    this.queue.set(videoId, item);

    try {
      await this.tusManager.start(videoId);
      this.updateStatus(videoId, 'uploading');
    } catch (error) {
      this.updateStatus(videoId, 'failed');
      item.error = error instanceof Error ? error.message : 'Retry failed';
      this.notifyError(item, error, 'retry');
    }
  }

  /**
   * Pause all uploads
   */
  pauseAll(): void {
    for (const [id, item] of this.queue.entries()) {
      if (item.status === 'uploading') {
        this.tusManager.pause(id);
        this.updateStatus(id, 'paused');
      }
    }
  }

  /**
   * Resume all paused uploads
   */
  async resumeAll(): Promise<void> {
    for (const [id, item] of this.queue.entries()) {
      if (item.status === 'paused') {
        await this.tusManager.resume(id);
        this.updateStatus(id, 'uploading');
      }
    }
  }

  /**
   * Cancel all uploads
   */
  cancelAll(): void {
    for (const [id, item] of this.queue.entries()) {
      if (item.status === 'uploading' || item.status === 'pending' || item.status === 'paused') {
        this.tusManager.cancel(id);
        this.updateStatus(id, 'cancelled');
      }
    }
  }

  /**
   * Get overall batch progress
   */
  getProgress(): BatchProgress {
    const items = Array.from(this.queue.values());
    const completed = items.filter((i) => i.status === 'completed').length;
    const failed = items.filter((i) => i.status === 'failed').length;
    const uploading = items.filter((i) => i.status === 'uploading').length;
    const pending = items.filter((i) => i.status === 'pending').length;
    const cancelled = items.filter((i) => i.status === 'cancelled').length;

    const totalBytes = items.reduce((sum, i) => sum + i.bytesTotal, 0);
    const uploadedBytes = items.reduce((sum, i) => sum + i.bytesUploaded, 0);
    const overallProgress = totalBytes > 0 ? (uploadedBytes / totalBytes) * 100 : 0;

    // Calculate average upload speed
    const speeds = Array.from(this.uploadSpeeds.values()).flat();
    const uploadSpeed = speeds.length > 0
      ? speeds.reduce((sum, s) => sum + s, 0) / speeds.length
      : 0;

    // Calculate ETA based on remaining bytes and average speed
    const remainingBytes = totalBytes - uploadedBytes;
    const eta = uploadSpeed > 0 ? remainingBytes / uploadSpeed : 0;

    return {
      total: items.length,
      completed,
      failed,
      uploading,
      pending,
      cancelled,
      overallProgress,
      totalBytes,
      uploadedBytes,
      uploadSpeed,
      eta,
    };
  }

  /**
   * Register a progress update callback
   */
  onProgressUpdate(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback);
    // Return unsubscribe function
    return () => {
      this.progressCallbacks.delete(callback);
    };
  }

  /**
   * Register a callback fired when a file finishes uploading
   */
  onUploadSuccess(callback: UploadSuccessCallback): () => void {
    this.successCallbacks.add(callback);
    return () => {
      this.successCallbacks.delete(callback);
    };
  }

  /**
   * Register a callback fired when a file fails (useBatchUpload reports it to
   * the admin Errors page and shows the user a message with its reference).
   * Without a callback the failure is still logged, which reports it too.
   */
  onUploadError(callback: UploadErrorCallback): () => void {
    this.errorCallbacks.add(callback);
    return () => {
      this.errorCallbacks.delete(callback);
    };
  }

  private notifyError(item: UploadQueueItem | undefined, error: unknown, step: 'start' | 'retry' | 'tus'): void {
    if (!item || this.errorCallbacks.size === 0) {
      logger.error(`[BatchUploadManager] Upload ${step} failed`, { id: item?.id, error });
      return;
    }
    this.errorCallbacks.forEach((callback) => {
      try {
        callback(item, error, step);
      } catch (callbackError) {
        logger.error('[BatchUploadManager] Upload error callback failed', { id: item.id, error: callbackError });
      }
    });
  }

  /**
   * Register a status change callback for a specific video
   */
  onStatusChange(videoId: string, callback: StatusChangeCallback): () => void {
    if (!this.statusCallbacks.has(videoId)) {
      this.statusCallbacks.set(videoId, new Set());
    }
    this.statusCallbacks.get(videoId)!.add(callback);

    // Return unsubscribe function
    return () => {
      const callbacks = this.statusCallbacks.get(videoId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.statusCallbacks.delete(videoId);
        }
      }
    };
  }

  /**
   * Get queue state for persistence
   */
  getQueueState(): Map<string, UploadQueueItem> {
    return new Map(this.queue);
  }

  /**
   * Set concurrency limit
   */
  setConcurrency(limit: number): void {
    this.tusManager.setConcurrencyLimit(limit);
  }

  /**
   * Clear all uploads from queue
   */
  clearQueue(): void {
    this.tusManager.clearAll();
    this.queue.clear();
    this.statusCallbacks.clear();
    this.uploadSpeeds.clear();
    this.notifyProgressUpdate();
  }

  /**
   * Create TUS callbacks for an upload
   */
  private createCallbacks(id: string): TusCallbacks {
    let lastUpdate = Date.now();
    let lastBytes = 0;

    return {
      onProgress: (_, bytesUploaded, bytesTotal) => {
        const item = this.queue.get(id);
        if (!item) return;

        item.bytesUploaded = bytesUploaded;
        item.progress = (bytesUploaded / bytesTotal) * 100;

        // Calculate upload speed
        const now = Date.now();
        const timeDelta = (now - lastUpdate) / 1000; // Convert to seconds
        if (timeDelta > 0.5) { // Update every 500ms
          const bytesDelta = bytesUploaded - lastBytes;
          const speed = bytesDelta / timeDelta;

          if (!this.uploadSpeeds.has(id)) {
            this.uploadSpeeds.set(id, []);
          }
          const speeds = this.uploadSpeeds.get(id)!;
          speeds.push(speed);
          // Keep only last 10 measurements
          if (speeds.length > 10) {
            speeds.shift();
          }

          lastUpdate = now;
          lastBytes = bytesUploaded;
        }

        // Update bandwidth monitor for optimizer
        this.optimizer.updateBandwidth(bytesUploaded);

        this.queue.set(id, item);
        this.notifyProgressUpdate();
      },

      onReconnecting: (_, reconnecting) => {
        const item = this.queue.get(id);
        if (!item || item.reconnecting === reconnecting) return;
        item.reconnecting = reconnecting;
        this.queue.set(id, item);
        this.notifyProgressUpdate();
      },

      onSuccess: () => {
        this.updateStatus(id, 'completed');
        const item = this.queue.get(id);
        if (item) {
          item.reconnecting = false;
          item.completedAt = new Date();
          item.progress = 100;
          item.bytesUploaded = item.bytesTotal;
          this.queue.set(id, item);
          this.successCallbacks.forEach((callback) => {
            try {
              callback(item);
            } catch (error) {
              logger.error('[BatchUploadManager] Upload success callback failed', { id, error });
            }
          });
        }
        this.notifyProgressUpdate();
      },

      onError: (_, error) => {
        const item = this.queue.get(id);
        if (!item) return;

        // The raw text is reported (notifyError); the row shows a friendly message
        item.error = error.message;
        item.reconnecting = false;
        this.updateStatus(id, 'failed');
        this.queue.set(id, item);
        // Before the update, so the row shows the friendly message the callback sets
        this.notifyError(item, error, 'tus');
        this.notifyProgressUpdate();
      },
    };
  }

  /**
   * Update upload status and notify callbacks
   */
  private updateStatus(videoId: string, status: UploadStatus): void {
    const item = this.queue.get(videoId);
    if (!item) return;

    item.status = status;
    this.queue.set(videoId, item);

    // Notify status callbacks
    const callbacks = this.statusCallbacks.get(videoId);
    if (callbacks) {
      callbacks.forEach((callback) => callback(status));
    }
  }

  /**
   * Notify all progress callbacks
   */
  private notifyProgressUpdate(): void {
    const progress = this.getProgress();
    this.progressCallbacks.forEach((callback) => callback(progress));
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
