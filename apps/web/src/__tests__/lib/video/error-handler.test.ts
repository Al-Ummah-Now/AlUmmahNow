/**
 * Tests for VideoErrorHandler
 */

import {
  VideoErrorHandler,
  createVideoErrorHandler,
  VideoErrorType,
  VideoErrorSeverity,
  VideoError,
} from '@/lib/video/error-handler';

describe('VideoErrorHandler', () => {
  let errorHandler: VideoErrorHandler;

  beforeEach(() => {
    errorHandler = createVideoErrorHandler();
  });

  describe('categorizeError', () => {
    it('should categorize Video.js network errors', () => {
      const videoJsError = { code: 2, message: 'Network error' };
      const result = errorHandler.categorizeError(videoJsError);

      expect(result.type).toBe(VideoErrorType.NETWORK_ERROR);
      expect(result.severity).toBe(VideoErrorSeverity.WARNING);
      expect(result.retryable).toBe(true);
    });

    it('should categorize Video.js decode errors', () => {
      const videoJsError = { code: 3, message: 'Decode error' };
      const result = errorHandler.categorizeError(videoJsError);

      expect(result.type).toBe(VideoErrorType.DECODE_ERROR);
      expect(result.severity).toBe(VideoErrorSeverity.CRITICAL);
      expect(result.retryable).toBe(false);
    });

    it('should categorize Video.js format errors', () => {
      const videoJsError = { code: 4, message: 'Format not supported' };
      const result = errorHandler.categorizeError(videoJsError);

      expect(result.type).toBe(VideoErrorType.FORMAT_ERROR);
      expect(result.severity).toBe(VideoErrorSeverity.CRITICAL);
      expect(result.fallbackAvailable).toBe(true);
    });

    it('should categorize HLS errors', () => {
      const hlsError = {
        type: 'networkError',
        details: 'manifestLoadError',
        fatal: true,
      };
      const result = errorHandler.categorizeError(hlsError);

      expect(result.type).toBe(VideoErrorType.HLS_ERROR);
      expect(result.severity).toBe(VideoErrorSeverity.CRITICAL);
      expect(result.fallbackAvailable).toBe(true);
    });

    it('should categorize network errors', () => {
      const networkError = new Error('Network request failed');
      networkError.name = 'NetworkError';
      const result = errorHandler.categorizeError(networkError);

      expect(result.type).toBe(VideoErrorType.NETWORK_ERROR);
      expect(result.retryable).toBe(true);
    });

    it('should categorize timeout errors', () => {
      const timeoutError = new Error('Request timed out');
      timeoutError.name = 'TimeoutError';
      const result = errorHandler.categorizeError(timeoutError);

      expect(result.type).toBe(VideoErrorType.TIMEOUT_ERROR);
      expect(result.retryable).toBe(true);
    });

    it('should categorize unknown errors', () => {
      const unknownError = new Error('Something went wrong');
      const result = errorHandler.categorizeError(unknownError);

      expect(result.type).toBe(VideoErrorType.UNKNOWN_ERROR);
      expect(result.severity).toBe(VideoErrorSeverity.CRITICAL);
    });

    it('should include timestamp in categorized errors', () => {
      const error = new Error('Test error');
      const result = errorHandler.categorizeError(error);

      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('number');
    });
  });

  describe('handleWithRetry', () => {
    it('should retry on retryable errors', async () => {
      const retryCallback = jest.fn().mockResolvedValue(undefined);
      const error: VideoError = {
        type: VideoErrorType.NETWORK_ERROR,
        severity: VideoErrorSeverity.WARNING,
        message: 'Network error',
        timestamp: Date.now(),
        retryable: true,
        fallbackAvailable: false,
      };

      await errorHandler.handleWithRetry(error, retryCallback);

      expect(retryCallback).toHaveBeenCalledTimes(1);
    });

    it('should not retry on non-retryable errors', async () => {
      const retryCallback = jest.fn();
      const error: VideoError = {
        type: VideoErrorType.DECODE_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'Decode error',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: false,
      };

      await expect(errorHandler.handleWithRetry(error, retryCallback)).rejects.toThrow();
      expect(retryCallback).not.toHaveBeenCalled();
    });

    it('should respect max retry limit', async () => {
      const retryCallback = jest.fn().mockRejectedValue(new Error('Still failing'));
      const error: VideoError = {
        type: VideoErrorType.NETWORK_ERROR,
        severity: VideoErrorSeverity.WARNING,
        message: 'Network error',
        timestamp: Date.now(),
        retryable: true,
        fallbackAvailable: false,
      };

      await expect(errorHandler.handleWithRetry(error, retryCallback)).rejects.toThrow();
      expect(retryCallback).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff', async () => {
      jest.useFakeTimers();
      const retryCallback = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockResolvedValue(undefined);

      const error: VideoError = {
        type: VideoErrorType.NETWORK_ERROR,
        severity: VideoErrorSeverity.WARNING,
        message: 'Network error',
        timestamp: Date.now(),
        retryable: true,
        fallbackAvailable: false,
      };

      const retryPromise = errorHandler.handleWithRetry(error, retryCallback);

      jest.advanceTimersByTime(1000);
      await Promise.resolve();

      jest.useRealTimers();
      await retryPromise;

      expect(retryCallback).toHaveBeenCalledTimes(2);
    });
  });

  describe('error reporters', () => {
    it('should call error reporters', async () => {
      const reporter = jest.fn();
      errorHandler.addErrorReporter(reporter);

      const error: VideoError = {
        type: VideoErrorType.NETWORK_ERROR,
        severity: VideoErrorSeverity.WARNING,
        message: 'Network error',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: false,
      };

      const retryCallback = jest.fn();
      await expect(errorHandler.handleWithRetry(error, retryCallback)).rejects.toThrow();

      expect(reporter).toHaveBeenCalledWith(error);
    });

    it('should remove error reporters', async () => {
      const reporter = jest.fn();
      errorHandler.addErrorReporter(reporter);
      errorHandler.removeErrorReporter(reporter);

      const error: VideoError = {
        type: VideoErrorType.NETWORK_ERROR,
        severity: VideoErrorSeverity.WARNING,
        message: 'Network error',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: false,
      };

      const retryCallback = jest.fn();
      await expect(errorHandler.handleWithRetry(error, retryCallback)).rejects.toThrow();

      expect(reporter).not.toHaveBeenCalled();
    });
  });

  describe('retry count management', () => {
    it('should track retry count', async () => {
      const retryCallback = jest.fn().mockRejectedValue(new Error('Fail'));
      const error: VideoError = {
        type: VideoErrorType.NETWORK_ERROR,
        severity: VideoErrorSeverity.WARNING,
        message: 'Network error',
        timestamp: Date.now(),
        retryable: true,
        fallbackAvailable: false,
      };

      await expect(errorHandler.handleWithRetry(error, retryCallback)).rejects.toThrow();

      expect(errorHandler.getRetryCount()).toBe(0); // Reset after max retries
    });

    it('should reset retry count', () => {
      errorHandler.resetRetryCount();
      expect(errorHandler.getRetryCount()).toBe(0);
    });

    it('should check for remaining retries', () => {
      expect(errorHandler.hasRetriesRemaining()).toBe(true);
    });
  });

  describe('getLastError', () => {
    it('should return the last error', async () => {
      const error: VideoError = {
        type: VideoErrorType.NETWORK_ERROR,
        severity: VideoErrorSeverity.WARNING,
        message: 'Network error',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: false,
      };

      const retryCallback = jest.fn();
      await expect(errorHandler.handleWithRetry(error, retryCallback)).rejects.toThrow();

      const lastError = errorHandler.getLastError();
      expect(lastError).toEqual(error);
    });
  });
});
