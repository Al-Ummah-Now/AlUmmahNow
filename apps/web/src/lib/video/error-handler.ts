/**
 * Video Error Handler
 *
 * Comprehensive error handling for video playback with categorization,
 * retry logic with exponential backoff, and error reporting hooks.
 */

/**
 * Video error types for categorization
 */
export enum VideoErrorType {
  NETWORK_ERROR = 'NETWORK_ERROR',
  FORMAT_ERROR = 'FORMAT_ERROR',
  DECODE_ERROR = 'DECODE_ERROR',
  HLS_ERROR = 'HLS_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Video error severity levels
 */
export enum VideoErrorSeverity {
  CRITICAL = 'CRITICAL',
  WARNING = 'WARNING',
  INFO = 'INFO',
}

/**
 * Structured video error interface
 */
export interface VideoError {
  type: VideoErrorType;
  severity: VideoErrorSeverity;
  message: string;
  code?: string | number;
  originalError?: Error;
  timestamp: number;
  retryable: boolean;
  fallbackAvailable: boolean;
}

/**
 * Error reporting hook interface
 */
export interface ErrorReporter {
  (error: VideoError): void | Promise<void>;
}

/**
 * Retry strategy configuration
 */
export interface RetryConfig {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2,
};

/**
 * Video.js error codes mapping to our error types
 */
const VIDEOJS_ERROR_MAPPING: Record<number, VideoErrorType> = {
  1: VideoErrorType.UNKNOWN_ERROR, // MEDIA_ERR_ABORTED
  2: VideoErrorType.NETWORK_ERROR, // MEDIA_ERR_NETWORK
  3: VideoErrorType.DECODE_ERROR, // MEDIA_ERR_DECODE
  4: VideoErrorType.FORMAT_ERROR, // MEDIA_ERR_SRC_NOT_SUPPORTED
};

/**
 * VideoErrorHandler class
 *
 * Handles video playback errors with automatic retry logic, error categorization,
 * and reporting capabilities.
 */
export class VideoErrorHandler {
  private retryConfig: RetryConfig;
  private retryCount: number = 0;
  private errorReporters: ErrorReporter[] = [];
  private lastError: VideoError | null = null;

  constructor(retryConfig: Partial<RetryConfig> = {}) {
    this.retryConfig = {
      ...DEFAULT_RETRY_CONFIG,
      ...retryConfig,
    };
  }

  /**
   * Categorize an error based on its type and properties
   *
   * @param error - The error object to categorize
   * @param _videoElement - Optional video element for additional context (reserved for future use)
   * @returns Categorized VideoError object
   */
  categorizeError(error: unknown, _videoElement?: HTMLVideoElement): VideoError {
    const timestamp = Date.now();

    // Handle Video.js error objects
    if (this.isVideoJsError(error)) {
      return this.categorizeVideoJsError(error, timestamp);
    }

    // Handle native media errors
    if (this.isMediaError(error)) {
      return this.categorizeMediaError(error, timestamp);
    }

    // Handle HLS.js errors
    if (this.isHlsError(error)) {
      return this.categorizeHlsError(error, timestamp);
    }

    // Handle network errors
    if (this.isNetworkError(error)) {
      return {
        type: VideoErrorType.NETWORK_ERROR,
        severity: VideoErrorSeverity.WARNING,
        message: 'Network error occurred while loading video',
        originalError: error instanceof Error ? error : undefined,
        timestamp,
        retryable: true,
        fallbackAvailable: true,
      };
    }

    // Handle timeout errors
    if (this.isTimeoutError(error)) {
      return {
        type: VideoErrorType.TIMEOUT_ERROR,
        severity: VideoErrorSeverity.WARNING,
        message: 'Video loading timed out',
        originalError: error instanceof Error ? error : undefined,
        timestamp,
        retryable: true,
        fallbackAvailable: true,
      };
    }

    // Default unknown error
    return {
      type: VideoErrorType.UNKNOWN_ERROR,
      severity: VideoErrorSeverity.CRITICAL,
      message: error instanceof Error ? error.message : 'An unknown error occurred',
      originalError: error instanceof Error ? error : undefined,
      timestamp,
      retryable: false,
      fallbackAvailable: false,
    };
  }

  /**
   * Handle an error with retry logic
   *
   * @param error - The error to handle
   * @param retryCallback - Callback function to retry the operation
   * @returns Promise that resolves when retry succeeds or rejects when max retries reached
   */
  async handleWithRetry(
    error: VideoError,
    retryCallback: () => Promise<void>
  ): Promise<void> {
    this.lastError = error;
    await this.reportError(error);

    if (!error.retryable || this.retryCount >= this.retryConfig.maxRetries) {
      this.retryCount = 0;
      throw error;
    }

    const delay = this.calculateRetryDelay();
    this.retryCount++;

    await this.sleep(delay);

    try {
      await retryCallback();
      this.retryCount = 0;
    } catch (retryError) {
      const categorizedError = this.categorizeError(retryError);
      return this.handleWithRetry(categorizedError, retryCallback);
    }
  }

  /**
   * Add an error reporter
   *
   * @param reporter - Function to call when errors occur
   */
  addErrorReporter(reporter: ErrorReporter): void {
    this.errorReporters.push(reporter);
  }

  /**
   * Remove an error reporter
   *
   * @param reporter - The reporter function to remove
   */
  removeErrorReporter(reporter: ErrorReporter): void {
    this.errorReporters = this.errorReporters.filter(r => r !== reporter);
  }

  /**
   * Get the last error that occurred
   */
  getLastError(): VideoError | null {
    return this.lastError;
  }

  /**
   * Get the current retry count
   */
  getRetryCount(): number {
    return this.retryCount;
  }

  /**
   * Reset the retry count
   */
  resetRetryCount(): void {
    this.retryCount = 0;
  }

  /**
   * Check if more retries are available
   */
  hasRetriesRemaining(): boolean {
    return this.retryCount < this.retryConfig.maxRetries;
  }

  /**
   * Report error to all registered reporters
   */
  private async reportError(error: VideoError): Promise<void> {
    const reportPromises = this.errorReporters.map(reporter => {
      try {
        return Promise.resolve(reporter(error));
      } catch (err) {
        console.error('Error reporter failed:', err);
        return Promise.resolve();
      }
    });

    await Promise.allSettled(reportPromises);
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(): number {
    const delay = this.retryConfig.initialDelay *
      Math.pow(this.retryConfig.backoffMultiplier, this.retryCount);
    return Math.min(delay, this.retryConfig.maxDelay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if error is a Video.js error
   */
  private isVideoJsError(error: unknown): error is { code: number; message: string } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof (error as { code: unknown }).code === 'number'
    );
  }

  /**
   * Check if error is a native media error
   */
  private isMediaError(error: unknown): error is MediaError {
    // MediaError may not be available in all environments (e.g., jest/jsdom)
    if (typeof MediaError === 'undefined') {
      return false;
    }
    return error instanceof MediaError;
  }

  /**
   * Check if error is an HLS error
   */
  private isHlsError(error: unknown): error is { type: string; details: string; fatal: boolean } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'type' in error &&
      'details' in error &&
      'fatal' in error
    );
  }

  /**
   * Check if error is a network error
   */
  private isNetworkError(error: unknown): boolean {
    if (error instanceof Error) {
      return (
        error.name === 'NetworkError' ||
        error.message.toLowerCase().includes('network') ||
        error.message.toLowerCase().includes('fetch')
      );
    }
    return false;
  }

  /**
   * Check if error is a timeout error
   */
  private isTimeoutError(error: unknown): boolean {
    if (error instanceof Error) {
      return (
        error.name === 'TimeoutError' ||
        error.message.toLowerCase().includes('timeout')
      );
    }
    return false;
  }

  /**
   * Categorize Video.js error
   */
  private categorizeVideoJsError(
    error: { code: number; message: string },
    timestamp: number
  ): VideoError {
    const type = VIDEOJS_ERROR_MAPPING[error.code] || VideoErrorType.UNKNOWN_ERROR;
    const retryable = type === VideoErrorType.NETWORK_ERROR || type === VideoErrorType.TIMEOUT_ERROR;
    const fallbackAvailable = type === VideoErrorType.HLS_ERROR || type === VideoErrorType.FORMAT_ERROR;

    return {
      type,
      severity: type === VideoErrorType.NETWORK_ERROR ? VideoErrorSeverity.WARNING : VideoErrorSeverity.CRITICAL,
      message: error.message || 'Video playback error',
      code: error.code,
      timestamp,
      retryable,
      fallbackAvailable,
    };
  }

  /**
   * Categorize native media error
   */
  private categorizeMediaError(error: MediaError, timestamp: number): VideoError {
    const type = VIDEOJS_ERROR_MAPPING[error.code] || VideoErrorType.UNKNOWN_ERROR;
    const retryable = error.code === MediaError.MEDIA_ERR_NETWORK;
    const fallbackAvailable = error.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;

    return {
      type,
      severity: retryable ? VideoErrorSeverity.WARNING : VideoErrorSeverity.CRITICAL,
      message: error.message || 'Media playback error',
      code: error.code,
      timestamp,
      retryable,
      fallbackAvailable,
    };
  }

  /**
   * Categorize HLS.js error
   */
  private categorizeHlsError(
    error: { type: string; details: string; fatal: boolean },
    timestamp: number
  ): VideoError {
    const isNetworkError = error.type === 'networkError';
    const isFatal = error.fatal;

    return {
      type: VideoErrorType.HLS_ERROR,
      severity: isFatal ? VideoErrorSeverity.CRITICAL : VideoErrorSeverity.WARNING,
      message: `HLS error: ${error.details}`,
      code: error.details,
      timestamp,
      retryable: isNetworkError,
      fallbackAvailable: true,
    };
  }
}

/**
 * Create a default error handler instance
 */
export function createVideoErrorHandler(config?: Partial<RetryConfig>): VideoErrorHandler {
  return new VideoErrorHandler(config);
}
