import { TusConfig, TusCallbacks } from '@al-ummah/shared-types';
import { logger } from '@/lib/logger-client';
import { fetchClientAuthToken } from '@/lib/auth/client-token';
import {
  ResilientUpload,
  type ReauthoriseResult,
  apiUrlFromTusEndpoint,
  requestUploadResume,
} from './resilient-tus';

export interface TusParallelManagerDeps {
  /** "Bearer <token>" for each request; force=true after a 401. */
  getAuthorization?: (force: boolean, fallback?: string) => Promise<string | null>;
  /** uploadResume for a video (re-authorises the same Bunny video). */
  reauthorise?: (videoId: string, endpoint: string, authorization: string | null) => Promise<ReauthoriseResult>;
}

async function defaultGetAuthorization(force: boolean, fallback?: string): Promise<string | null> {
  const token = await fetchClientAuthToken(force);
  return token ? `Bearer ${token}` : fallback ?? null;
}

async function defaultReauthorise(videoId: string, endpoint: string, authorization: string | null): Promise<ReauthoriseResult> {
  return requestUploadResume(apiUrlFromTusEndpoint(endpoint), videoId, authorization ? { Authorization: authorization } : {});
}

/**
 * Manages parallel TUS uploads with concurrency control. Each file is a
 * ResilientUpload: transient failures retry at the server's offset (shown as
 * "reconnecting"), so only a truly failed file frees its slot, and the rest of
 * the queue keeps going around it.
 */
export class TusParallelManager {
  private uploads: Map<string, ResilientUpload> = new Map();
  private concurrentLimit: number;
  private active: Set<string> = new Set();
  private pendingQueue: string[] = [];
  private readonly getAuthorization: NonNullable<TusParallelManagerDeps['getAuthorization']>;
  private readonly reauthorise: NonNullable<TusParallelManagerDeps['reauthorise']>;

  constructor(concurrentLimit: number = 3, deps: TusParallelManagerDeps = {}) {
    this.concurrentLimit = Math.max(1, Math.min(5, concurrentLimit));
    this.getAuthorization = deps.getAuthorization ?? defaultGetAuthorization;
    this.reauthorise = deps.reauthorise ?? defaultReauthorise;
  }

  /**
   * Create a resilient TUS upload with callbacks
   */
  createUpload(
    id: string,
    file: File,
    config: TusConfig,
    callbacks: TusCallbacks
  ): ResilientUpload {
    const fallbackAuth = config.tusHeaders?.Authorization;
    const videoId = config.metadata?.videoId ?? '';
    const tusSessionId = config.metadata?.tusSessionId ?? '';
    const upload = new ResilientUpload({
      file,
      endpoint: config.tusEndpoint,
      videoId,
      tusSessionId,
      uploadUrl: config.uploadUrl,
      chunkSize: config.chunkSize || undefined,
      metadata: config.metadata,
      getAuthorization: (force) => this.getAuthorization(force, fallbackAuth),
      reauthorise: async (vid) => this.reauthorise(vid, config.tusEndpoint, await this.getAuthorization(false, fallbackAuth)),
      onProgress: (bytesUploaded, bytesTotal) => callbacks.onProgress?.(id, bytesUploaded, bytesTotal),
      onReconnecting: (reconnecting) => callbacks.onReconnecting?.(id, reconnecting),
      onSuccess: () => {
        this.release(id);
        this.uploads.delete(id);
        callbacks.onSuccess?.(id);
      },
      onError: (error) => {
        this.release(id);
        callbacks.onError?.(id, error);
      },
    });

    this.uploads.set(id, upload);
    return upload;
  }

  /** Free an upload's slot and start the next queued one. */
  private release(id: string): void {
    if (this.active.delete(id)) this.processQueue();
  }

  /**
   * Start an upload (respecting concurrency limits)
   */
  async start(id: string): Promise<void> {
    const upload = this.uploads.get(id);
    if (!upload) {
      throw new Error(`Upload with id ${id} not found`);
    }
    if (this.active.has(id)) return;

    if (this.active.size >= this.concurrentLimit) {
      if (!this.pendingQueue.includes(id)) {
        this.pendingQueue.push(id);
      }
      return;
    }

    this.active.add(id);
    try {
      // Resumes this video's stored upload URL (reload / crash) or creates one
      await upload.start();
    } catch (error) {
      this.release(id);
      throw error;
    }
  }

  /**
   * Pause an upload
   */
  pause(id: string): void {
    const upload = this.uploads.get(id);
    if (upload) {
      void upload.abort();
      const queueIndex = this.pendingQueue.indexOf(id);
      if (queueIndex > -1) this.pendingQueue.splice(queueIndex, 1);
      this.release(id);
    }
  }

  /**
   * Resume a paused upload
   */
  async resume(id: string): Promise<void> {
    if (this.uploads.has(id)) {
      await this.start(id);
    }
  }

  /**
   * Cancel an upload and remove fingerprint
   */
  cancel(id: string): void {
    const upload = this.uploads.get(id);
    if (upload) {
      void upload.abort(true); // Remove fingerprint for resume
      this.uploads.delete(id);
      const queueIndex = this.pendingQueue.indexOf(id);
      if (queueIndex > -1) this.pendingQueue.splice(queueIndex, 1);
      this.release(id);
    }
  }

  /**
   * Process the pending queue
   */
  private processQueue(): void {
    while (this.pendingQueue.length > 0 && this.active.size < this.concurrentLimit) {
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
    return this.active.size;
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
    if (this.active.size > this.concurrentLimit) {
      const overflow = Array.from(this.active).slice(this.concurrentLimit);
      overflow.forEach(id => {
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
  getUpload(id: string): ResilientUpload | undefined {
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
    Array.from(this.uploads.keys()).forEach((id) => this.cancel(id));
    this.uploads.clear();
    this.pendingQueue = [];
    this.active.clear();
  }
}
