import * as tus from 'tus-js-client';
import { TusConfig, TusCallbacks } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger-client';


/**
 * Manages parallel TUS uploads with concurrency control
 */
export class TusParallelManager {
  private uploads: Map<string, tus.Upload> = new Map();
  private concurrentLimit: number;
  private activeCount: number = 0;
  private pendingQueue: string[] = [];

  constructor(concurrentLimit: number = 3) {
    this.concurrentLimit = Math.max(1, Math.min(5, concurrentLimit));
  }

  /**
   * Create a TUS upload instance with callbacks
   */
  createUpload(
    id: string,
    file: File,
    config: TusConfig,
    callbacks: TusCallbacks
  ): tus.Upload {
    const upload = new tus.Upload(file, {
      endpoint: config.tusEndpoint,
      headers: config.tusHeaders,
      chunkSize: config.chunkSize || 5 * 1024 * 1024, // 5MB default
      retryDelays: [0, 3000, 5000, 10000, 20000],
      storeFingerprintForResuming: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        filename: file.name,
        filetype: file.type,
        // e.g. tusSessionId + videoId for the API TUS proxy
        ...(config.metadata || {}),
      },

      onError: (error) => {
        this.activeCount--;
        this.processQueue();
        callbacks.onError?.(id, error);
      },

      onProgress: (bytesUploaded, bytesTotal) => {
        callbacks.onProgress?.(id, bytesUploaded, bytesTotal);
      },

      onSuccess: () => {
        this.activeCount--;
        this.uploads.delete(id);
        this.processQueue();
        callbacks.onSuccess?.(id);
      },

      onBeforeRequest: (req) => {
        callbacks.onBeforeRequest?.(id, req);
      },
    });

    this.uploads.set(id, upload);
    return upload;
  }

  /**
   * Start an upload (respecting concurrency limits)
   */
  async start(id: string): Promise<void> {
    const upload = this.uploads.get(id);
    if (!upload) {
      throw new Error(`Upload with id ${id} not found`);
    }

    if (this.activeCount >= this.concurrentLimit) {
      // Add to pending queue
      if (!this.pendingQueue.includes(id)) {
        this.pendingQueue.push(id);
      }
      return;
    }

    this.activeCount++;

    try {
      // Check for previous uploads to resume
      const previousUploads = await upload.findPreviousUploads();
      if (previousUploads.length > 0) {
        upload.resumeFromPreviousUpload(previousUploads[0]);
      }

      upload.start();
    } catch (error) {
      this.activeCount--;
      this.processQueue();
      throw error;
    }
  }

  /**
   * Pause an upload
   */
  pause(id: string): void {
    const upload = this.uploads.get(id);
    if (upload) {
      upload.abort();
      this.activeCount = Math.max(0, this.activeCount - 1);

      // Remove from pending queue if it was queued
      const queueIndex = this.pendingQueue.indexOf(id);
      if (queueIndex > -1) {
        this.pendingQueue.splice(queueIndex, 1);
      }

      this.processQueue();
    }
  }

  /**
   * Resume a paused upload
   */
  async resume(id: string): Promise<void> {
    const upload = this.uploads.get(id);
    if (upload) {
      await this.start(id);
    }
  }

  /**
   * Cancel an upload and remove fingerprint
   */
  cancel(id: string): void {
    const upload = this.uploads.get(id);
    if (upload) {
      upload.abort(true); // Remove fingerprint for resume
      this.uploads.delete(id);
      this.activeCount = Math.max(0, this.activeCount - 1);

      // Remove from pending queue if it was queued
      const queueIndex = this.pendingQueue.indexOf(id);
      if (queueIndex > -1) {
        this.pendingQueue.splice(queueIndex, 1);
      }

      this.processQueue();
    }
  }

  /**
   * Process the pending queue
   */
  private processQueue(): void {
    while (this.pendingQueue.length > 0 && this.activeCount < this.concurrentLimit) {
      const nextId = this.pendingQueue.shift();
      if (nextId) {
        this.start(nextId).catch(error => {
          logger.error(`Failed to start queued upload ${nextId}:`, error);
        });
      }
    }
  }

  /**
   * Get the number of active uploads
   */
  getActiveCount(): number {
    return this.activeCount;
  }

  /**
   * Get the number of queued uploads
   */
  getQueuedCount(): number {
    return this.pendingQueue.length;
  }

  /**
   * Set concurrency limit (1-5)
   */
  setConcurrencyLimit(limit: number): void {
    this.concurrentLimit = Math.max(1, Math.min(5, limit));

    // Pause overflow uploads if new limit is lower
    if (this.activeCount > this.concurrentLimit) {
      const activeIds = Array.from(this.uploads.keys())
        .filter(id => !this.pendingQueue.includes(id))
        .slice(this.concurrentLimit);

      activeIds.forEach(id => {
        this.pause(id);
        this.pendingQueue.unshift(id); // Add to front of queue
      });
    } else {
      // Try to start queued uploads if limit increased
      this.processQueue();
    }
  }

  /**
   * Get upload instance by ID
   */
  getUpload(id: string): tus.Upload | undefined {
    return this.uploads.get(id);
  }

  /**
   * Check if an upload exists
   */
  hasUpload(id: string): boolean {
    return this.uploads.has(id);
  }

  /**
   * Clear all uploads
   */
  clearAll(): void {
    this.uploads.forEach((_upload, id) => {
      this.cancel(id);
    });
    this.uploads.clear();
    this.pendingQueue = [];
    this.activeCount = 0;
  }
}
