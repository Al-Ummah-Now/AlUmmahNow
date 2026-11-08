/**
 * Batch upload related types
 * These types are shared between frontend and backend
 */

import { VideoUploadMetadata, VideoCategory } from './video';

/**
 * Upload status for individual videos in a batch
 */
export type UploadStatus =
  | 'pending'      // In queue, not started
  | 'initiating'   // Getting TUS config from API
  | 'uploading'    // Active upload
  | 'paused'       // User paused
  | 'processing'   // Upload done, server processing
  | 'completed'    // Fully complete
  | 'failed'       // Failed (can retry)
  | 'cancelled';   // User cancelled

/**
 * Individual upload queue item
 */
export interface UploadQueueItem {
  id: string;                    // Unique queue item ID
  file: File;                     // File object
  videoId?: string;               // Bunny.net video ID (after initiation)
  metadata: VideoUploadMetadata;  // Video metadata
  status: UploadStatus;           // Current status
  progress: number;               // 0-100
  error?: string;                 // Error message if failed
  retryCount: number;             // Number of retry attempts
  startedAt?: Date;               // Upload start time
  completedAt?: Date;             // Upload completion time
  speed?: number;                 // Current upload speed (bytes/sec)
  bytesUploaded: number;          // Bytes uploaded
  bytesTotal: number;             // Total file size
}

/**
 * Upload queue state
 */
export interface UploadQueueState {
  items: Map<string, UploadQueueItem>;
  activeUploads: Set<string>;      // IDs of currently uploading items
  maxConcurrent: number;            // Max parallel uploads
  totalProgress: number;            // Overall progress 0-100
  isProcessing: boolean;            // Queue is active
  settings: QueueSettings;          // User preferences
}

/**
 * Queue settings and preferences
 */
export interface QueueSettings {
  autoProceed: boolean;             // Auto-start next after completion
  maxRetries: number;               // Max retry attempts
  concurrentUploads: number;        // 1-5 parallel uploads
  chunkSize: number;                // TUS chunk size
  preserveOnError: boolean;         // Keep failed uploads in queue
}

/**
 * Batch upload initiation request
 */
export interface BatchUploadInitiateRequest {
  videos: Array<{
    title: string;
    description?: string;
    fileSize: number;
    mimeType: string;
    isPublic: boolean;
    tags?: string;
  }>;
  sharedMetadata?: {
    channelId?: string;
    category?: VideoCategory;
    isPublic?: boolean;
  };
}

/**
 * Batch upload initiation response
 */
export interface BatchUploadInitiateResponse {
  success: boolean;
  result?: Array<{
    videoId: string;
    /** Session ID for the TUS proxy (send as `tusSessionId` upload metadata) */
    tusSessionId: string;
    expiresAt: string;
    chunkSize: number;
    resumable: boolean;
  }>;
  error?: string;
}

/**
 * TUS upload configuration
 */
export interface TusConfig {
  /** TUS endpoint (the API's /api/videos/tus proxy) */
  tusEndpoint: string;
  /** Headers sent with every TUS request (e.g. Authorization) */
  tusHeaders: Record<string, string>;
  /** Extra upload metadata (e.g. tusSessionId, videoId) */
  metadata?: Record<string, string>;
  chunkSize: number;
  expiresAt: string;
}

/**
 * TUS callbacks for event handling
 */
export interface TusCallbacks {
  onError?: (id: string, error: Error) => void;
  onProgress?: (id: string, bytesUploaded: number, bytesTotal: number) => void;
  onSuccess?: (id: string) => void;
  onBeforeRequest?: (id: string, req: any) => void;
}

/**
 * Device capabilities for optimization
 */
export interface DeviceCapabilities {
  isDesktop: boolean;
  isTablet: boolean;
  isMobile: boolean;
  hasWebWorker: boolean;
  cores: number;
}

/**
 * Batch upload configuration
 */
export interface BatchUploadConfig {
  // Limits
  maxFiles: number;              // Default: 15
  maxTotalSize: number;          // Default: 10GB
  maxConcurrent: number;         // Default: 3

  // Performance
  chunkSize: number;             // Default: 5MB
  retryDelays: number[];         // Default: [0, 3000, 5000, 10000]
  maxRetries: number;            // Default: 3

  // Features
  allowDuplicates: boolean;      // Default: false
  autoStart: boolean;            // Default: true
  preserveOnError: boolean;      // Default: true
  backgroundUpload: boolean;     // Default: false

  // UI
  layout: 'grid' | 'list';       // Default: 'list'
  showThumbnails: boolean;       // Default: true
  compactMode: boolean;          // Default: false
}

/**
 * Batch upload metrics for analytics
 */
export interface BatchUploadMetrics {
  // Performance metrics
  totalUploadsInitiated: number;
  totalUploadsCompleted: number;
  averageUploadTime: number;
  averageQueueSize: number;
  concurrentUploadAverage: number;

  // Error metrics
  failureRate: number;
  retrySuccessRate: number;
  commonErrorTypes: Record<string, number>;

  // User behavior
  averageFilesPerBatch: number;
  metadataMode: 'shared' | 'individual';
  abandonmentRate: number;

  // Resource usage
  peakMemoryUsage: number;
  averageBandwidthUtilization: number;
}
