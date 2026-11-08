/**
 * Tests for ErrorDisplay component
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorDisplay, CompactErrorDisplay } from '@/components/VideoPlayer/ErrorDisplay';
import { VideoErrorType, VideoErrorSeverity, VideoError } from '@/lib/video/error-handler';

describe('ErrorDisplay', () => {
  const mockError: VideoError = {
    type: VideoErrorType.NETWORK_ERROR,
    severity: VideoErrorSeverity.WARNING,
    message: 'Network connection failed',
    timestamp: Date.now(),
    retryable: true,
    fallbackAvailable: true,
  };

  describe('rendering', () => {
    it('should render error title and description in English', () => {
      render(<ErrorDisplay error={mockError} lang="en" />);

      expect(screen.getByText('Network Error')).toBeInTheDocument();
      expect(screen.getByText(/check your internet connection/i)).toBeInTheDocument();
    });

    it('should render error title and description in Arabic', () => {
      render(<ErrorDisplay error={mockError} lang="ar" />);

      expect(screen.getByText('خطأ في الشبكة')).toBeInTheDocument();
      expect(screen.getByText(/اتصالك بالإنترنت/)).toBeInTheDocument();
    });

    it('should render retry button when error is retryable', () => {
      const onRetry = jest.fn();
      render(<ErrorDisplay error={mockError} lang="en" onRetry={onRetry} />);

      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    it('should render fallback button when fallback available', () => {
      const onFallback = jest.fn();
      render(<ErrorDisplay error={mockError} lang="en" onFallback={onFallback} />);

      expect(screen.getByText('Reload Video')).toBeInTheDocument();
    });

    it('should not render retry button when error is not retryable', () => {
      const nonRetryableError: VideoError = {
        ...mockError,
        retryable: false,
      };

      render(<ErrorDisplay error={nonRetryableError} lang="en" />);
      expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
    });

    it('should not render fallback button when fallback not available', () => {
      const noFallbackError: VideoError = {
        ...mockError,
        fallbackAvailable: false,
      };

      render(<ErrorDisplay error={noFallbackError} lang="en" />);
      expect(screen.queryByText(/alternative/i)).not.toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('should call onRetry when retry button clicked', () => {
      const onRetry = jest.fn();
      render(<ErrorDisplay error={mockError} lang="en" onRetry={onRetry} />);

      fireEvent.click(screen.getByText('Try Again'));
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('should call onFallback when fallback button clicked', () => {
      const onFallback = jest.fn();
      render(<ErrorDisplay error={mockError} lang="en" onFallback={onFallback} />);

      fireEvent.click(screen.getByText('Reload Video'));
      expect(onFallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('error details', () => {
    it('should show details when showDetails is true', () => {
      render(<ErrorDisplay error={mockError} lang="en" showDetails={true} />);

      const detailsButton = screen.getByText('Error Details');
      expect(detailsButton).toBeInTheDocument();
    });

    it('should expand details when clicked', () => {
      render(<ErrorDisplay error={mockError} lang="en" showDetails={true} />);

      const detailsButton = screen.getByText('Error Details');
      fireEvent.click(detailsButton);

      expect(screen.getByText('Type:')).toBeInTheDocument();
      expect(screen.getByText('Message:')).toBeInTheDocument();
    });

    it('should not show details when showDetails is false', () => {
      render(<ErrorDisplay error={mockError} lang="en" showDetails={false} />);

      expect(screen.queryByText('Error Details')).not.toBeInTheDocument();
    });

    it('should display error code when available', () => {
      const errorWithCode: VideoError = {
        ...mockError,
        code: 'ERR_NETWORK_001',
      };

      render(<ErrorDisplay error={errorWithCode} lang="en" showDetails={true} />);

      const detailsButton = screen.getByText('Error Details');
      fireEvent.click(detailsButton);

      expect(screen.getByText(/ERR_NETWORK_001/)).toBeInTheDocument();
    });
  });

  describe('regional locale', () => {
    const timestamp = Date.UTC(2026, 0, 15, 15, 30);

    it.each([
      ['en-GB', 'en', 'en-GB'],
      [undefined, 'en', 'en-US'],
      [undefined, 'ar', 'ar-SA'],
    ] as const)('formats the time with locale %s and lang %s', (locale, lang, expected) => {
      const { container } = render(
        <ErrorDisplay error={{ ...mockError, timestamp }} lang={lang} showDetails locale={locale} />
      );
      fireEvent.click(container.querySelector('[aria-expanded]') as HTMLElement);
      expect(container.textContent).toContain(new Date(timestamp).toLocaleString(expected));
    });
  });

  describe('RTL support', () => {
    it('should apply RTL direction for Arabic', () => {
      const { container } = render(<ErrorDisplay error={mockError} lang="ar" />);

      const errorDisplay = container.firstChild as HTMLElement;
      expect(errorDisplay).toHaveAttribute('dir', 'rtl');
    });

    it('should apply LTR direction for English', () => {
      const { container } = render(<ErrorDisplay error={mockError} lang="en" />);

      const errorDisplay = container.firstChild as HTMLElement;
      expect(errorDisplay).toHaveAttribute('dir', 'ltr');
    });
  });

  describe('different error types', () => {
    it('should render HLS error correctly', () => {
      const hlsError: VideoError = {
        type: VideoErrorType.HLS_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'HLS streaming failed',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: true,
      };

      render(<ErrorDisplay error={hlsError} lang="en" />);
      expect(screen.getByText('Format Error')).toBeInTheDocument();
    });

    it('should render format error correctly', () => {
      const formatError: VideoError = {
        type: VideoErrorType.FORMAT_ERROR,
        severity: VideoErrorSeverity.CRITICAL,
        message: 'Format not supported',
        timestamp: Date.now(),
        retryable: false,
        fallbackAvailable: true,
      };

      render(<ErrorDisplay error={formatError} lang="en" />);
      expect(screen.getByText('Format Error')).toBeInTheDocument();
    });

    it('should render timeout error correctly', () => {
      const timeoutError: VideoError = {
        type: VideoErrorType.TIMEOUT_ERROR,
        severity: VideoErrorSeverity.WARNING,
        message: 'Request timed out',
        timestamp: Date.now(),
        retryable: true,
        fallbackAvailable: true,
      };

      render(<ErrorDisplay error={timeoutError} lang="en" />);
      expect(screen.getByText('Timeout Error')).toBeInTheDocument();
    });
  });
});

describe('CompactErrorDisplay', () => {
  const mockError: VideoError = {
    type: VideoErrorType.NETWORK_ERROR,
    severity: VideoErrorSeverity.WARNING,
    message: 'Network error',
    timestamp: Date.now(),
    retryable: true,
    fallbackAvailable: false,
  };

  it('should render compact error display', () => {
    render(<CompactErrorDisplay error={mockError} lang="en" />);

    expect(screen.getByText('Network Error')).toBeInTheDocument();
  });

  it('should render retry button when available', () => {
    const onRetry = jest.fn();
    render(<CompactErrorDisplay error={mockError} lang="en" onRetry={onRetry} />);

    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('should call onRetry when clicked', () => {
    const onRetry = jest.fn();
    render(<CompactErrorDisplay error={mockError} lang="en" onRetry={onRetry} />);

    fireEvent.click(screen.getByText('Try Again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should support RTL for Arabic', () => {
    const { container } = render(<CompactErrorDisplay error={mockError} lang="ar" />);

    const errorDisplay = container.firstChild as HTMLElement;
    expect(errorDisplay).toHaveAttribute('dir', 'rtl');
  });
});
