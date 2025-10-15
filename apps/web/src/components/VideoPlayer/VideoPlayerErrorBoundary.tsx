/**
 * VideoPlayerErrorBoundary Component
 *
 * React Error Boundary for catching and handling React component errors
 * in the video player. Works alongside VideoErrorHandler for comprehensive
 * error coverage.
 */

'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { ErrorDisplay } from './ErrorDisplay';
import { VideoError, VideoErrorType, VideoErrorSeverity } from '@/lib/video/error-handler';

export interface VideoPlayerErrorBoundaryProps {
  children: ReactNode;
  lang: 'en' | 'ar';
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  fallback?: (error: Error, resetError: () => void) => ReactNode;
}

interface VideoPlayerErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  videoError: VideoError | null;
}

/**
 * VideoPlayerErrorBoundary class component
 *
 * Catches React errors in video player components and displays user-friendly
 * error messages with recovery options.
 */
export class VideoPlayerErrorBoundary extends Component<
  VideoPlayerErrorBoundaryProps,
  VideoPlayerErrorBoundaryState
> {
  constructor(props: VideoPlayerErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      videoError: null,
    };
  }

  /**
   * Static method to derive state from error
   */
  static getDerivedStateFromError(error: Error): Partial<VideoPlayerErrorBoundaryState> {
    // Convert React error to VideoError
    const videoError: VideoError = {
      type: VideoErrorType.UNKNOWN_ERROR,
      severity: VideoErrorSeverity.CRITICAL,
      message: error.message || 'An unexpected error occurred in the video player',
      originalError: error,
      timestamp: Date.now(),
      retryable: true,
      fallbackAvailable: false,
    };

    return {
      hasError: true,
      error,
      videoError,
    };
  }

  /**
   * Lifecycle method called after an error is caught
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('VideoPlayerErrorBoundary caught error:', error);
      console.error('Error Info:', errorInfo);
    }

    // Call optional error callback
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }

    // Report error to error tracking service
    this.reportError(error, errorInfo);
  }

  /**
   * Reset error state to retry rendering
   */
  resetError = (): void => {
    this.setState({
      hasError: false,
      error: null,
      videoError: null,
    });
  };

  /**
   * Report error to external service
   */
  private reportError(error: Error, errorInfo: ErrorInfo): void {
    try {
      // In production, this would send to error tracking service
      // For now, just log structured error data
      const errorReport = {
        message: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'unknown',
      };

      if (process.env.NODE_ENV === 'development') {
        console.log('Error Report:', JSON.stringify(errorReport, null, 2));
      }
    } catch (reportError) {
      console.error('Failed to report error:', reportError);
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const { fallback, lang } = this.props;
      const { error, videoError } = this.state;

      // Use custom fallback if provided
      if (fallback && error) {
        return fallback(error, this.resetError);
      }

      // Use default error display
      if (videoError) {
        return (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <ErrorDisplay
              error={videoError}
              lang={lang}
              onRetry={this.resetError}
              showDetails={process.env.NODE_ENV === 'development'}
              className="max-w-4xl"
            />
          </div>
        );
      }
    }

    return this.props.children;
  }
}

/**
 * Higher-order component to wrap component with error boundary
 *
 * @param Component - Component to wrap
 * @param lang - Language for error messages
 * @returns Wrapped component with error boundary
 */
export function withVideoPlayerErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  lang: 'en' | 'ar' = 'en'
): React.FC<P> {
  return function WrappedComponent(props: P): JSX.Element {
    return (
      <VideoPlayerErrorBoundary lang={lang}>
        <Component {...props} />
      </VideoPlayerErrorBoundary>
    );
  };
}

export default VideoPlayerErrorBoundary;
