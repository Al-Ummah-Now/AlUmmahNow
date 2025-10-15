/**
 * Tests for VideoFallbackStrategy
 */

import {
  VideoFallbackStrategy,
  createVideoFallbackStrategy,
  VideoSource,
  shouldFallback,
} from '@/lib/video/fallback-strategy';
import {
  VideoErrorType,
  VideoErrorSeverity,
  VideoError,
} from '@/lib/video/error-handler';
import { VideoQuality } from '@/services/bunny/types';

describe('VideoFallbackStrategy', () => {
  let strategy: VideoFallbackStrategy;
  const hlsUrl = 'https://example.com/video.m3u8';
  const mp4Urls: Record<VideoQuality, string> = {
    '240p': 'https://example.com/video_240.mp4',
    '360p': 'https://example.com/video_360.mp4',
    '480p': 'https://example.com/video_480.mp4',
    '720p': 'https://example.com/video_720.mp4',
    '1080p': 'https://example.com/video_1080.mp4',
  };

  beforeEach(() => {
    strategy = createVideoFallbackStrategy();
    strategy.initializeSources(hlsUrl, mp4Urls);
  });

  describe('initializeSources', () => {
    it('should initialize with HLS as primary source', () => {
      const currentSource = strategy.getCurrentSource();
      expect(currentSource?.type).toBe('hls');
      expect(currentSource?.url).toBe(hlsUrl);
    });

    it('should add all MP4 sources', () => {
      const sources = strategy.getAvailableSources();
      expect(sources.length).toBe(6); // 1 HLS + 5 MP4 qualities
    });

    it('should order MP4 sources by quality preference', () => {
      const sources = strategy.getAvailableSources();
      const mp4Sources = sources.filter(s => s.type === 'mp4');

      expect(mp4Sources[0].quality).toBe('720p'); // Preferred quality
      expect(mp4Sources[1].quality).toBe('480p');
    });
  });

  describe('getNextFallback', () => {
    it('should fallback to MP4 on HLS error', () => {
      const hlsError: VideoError = {
        type: VideoErrorType.HLS_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'HLS playback failed',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: true,
      };

      const fallback = strategy.getNextFallback(hlsError);
      expect(fallback?.type).toBe('mp4');
      expect(fallback?.quality).toBe('720p'); // Preferred quality
    });

    it('should try next quality on format error', () => {
      const formatError: VideoError = {
        type: VideoErrorType.FORMAT_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'Format not supported',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: true,
      };

      const firstFallback = strategy.getNextFallback(formatError);
      expect(firstFallback?.type).toBe('mp4');
      expect(firstFallback?.quality).toBe('720p');

      const secondFallback = strategy.getNextFallback(formatError);
      expect(secondFallback?.quality).toBe('480p');
    });

    it('should return null when no fallbacks available', () => {
      const error: VideoError = {
        type: VideoErrorType.FORMAT_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'Format error',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: true,
      };

      // Exhaust all sources
      while (strategy.getNextFallback(error)) {
        // Keep getting fallbacks until none left
      }

      const fallback = strategy.getNextFallback(error);
      expect(fallback).toBeNull();
    });

    it('should not fallback on non-fallbackable errors', () => {
      const error: VideoError = {
        type: VideoErrorType.DECODE_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'Decode error',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: false,
      };

      const fallback = strategy.getNextFallback(error);
      expect(fallback).toBeNull();
    });
  });

  describe('switchToSource', () => {
    it('should switch to a specific source', () => {
      const mp4Source: VideoSource = {
        type: 'mp4',
        url: mp4Urls['480p'],
        quality: '480p',
        label: '480P',
      };

      const success = strategy.switchToSource(mp4Source);
      expect(success).toBe(true);

      const currentSource = strategy.getCurrentSource();
      expect(currentSource?.url).toBe(mp4Urls['480p']);
    });

    it('should fail to switch to non-existent source', () => {
      const invalidSource: VideoSource = {
        type: 'mp4',
        url: 'https://invalid.com/video.mp4',
        quality: '720p',
        label: 'Invalid',
      };

      const success = strategy.switchToSource(invalidSource);
      expect(success).toBe(false);
    });
  });

  describe('getPreferredMp4Url', () => {
    it('should return preferred quality URL', () => {
      const url = strategy.getPreferredMp4Url(mp4Urls);
      expect(url).toBe(mp4Urls['720p']);
    });

    it('should fallback to available quality if preferred not available', () => {
      const limitedMp4Urls: Record<VideoQuality, string> = {
        '240p': '',
        '360p': '',
        '480p': 'https://example.com/video_480.mp4',
        '720p': '',
        '1080p': '',
      };

      const url = strategy.getPreferredMp4Url(limitedMp4Urls);
      expect(url).toBe(limitedMp4Urls['480p']);
    });

    it('should return null if no MP4 URLs available', () => {
      const emptyMp4Urls: Record<VideoQuality, string> = {
        '240p': '',
        '360p': '',
        '480p': '',
        '720p': '',
        '1080p': '',
      };

      const url = strategy.getPreferredMp4Url(emptyMp4Urls);
      expect(url).toBeNull();
    });
  });

  describe('isUsingHls', () => {
    it('should return true when using HLS', () => {
      expect(strategy.isUsingHls()).toBe(true);
    });

    it('should return false when using MP4', () => {
      const hlsError: VideoError = {
        type: VideoErrorType.HLS_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'HLS error',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: true,
      };

      strategy.getNextFallback(hlsError);
      expect(strategy.isUsingHls()).toBe(false);
    });
  });

  describe('hasMp4Fallback', () => {
    it('should return true when MP4 fallbacks available', () => {
      expect(strategy.hasMp4Fallback()).toBe(true);
    });

    it('should return false when all MP4 sources attempted', () => {
      const error: VideoError = {
        type: VideoErrorType.FORMAT_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'Format error',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: true,
      };

      // Exhaust all MP4 sources
      while (strategy.hasMp4Fallback()) {
        strategy.getNextFallback(error);
      }

      expect(strategy.hasMp4Fallback()).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset to initial state', () => {
      const hlsError: VideoError = {
        type: VideoErrorType.HLS_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'HLS error',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: true,
      };

      // Switch to MP4
      strategy.getNextFallback(hlsError);
      expect(strategy.isUsingHls()).toBe(false);

      // Reset
      strategy.reset();
      expect(strategy.isUsingHls()).toBe(true);
    });
  });

  describe('shouldFallback helper', () => {
    it('should return true for HLS errors', () => {
      const error: VideoError = {
        type: VideoErrorType.HLS_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'HLS error',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: true,
      };

      expect(shouldFallback(error)).toBe(true);
    });

    it('should return true for format errors', () => {
      const error: VideoError = {
        type: VideoErrorType.FORMAT_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'Format error',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: true,
      };

      expect(shouldFallback(error)).toBe(true);
    });

    it('should return false for errors without fallback', () => {
      const error: VideoError = {
        type: VideoErrorType.DECODE_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'Decode error',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: false,
      };

      expect(shouldFallback(error)).toBe(false);
    });
  });
});
