# Task 2.13: Error Handling (Network, Validation, RTMP Errors)

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 6 hours
**Dependencies**: All previous tasks
**Status**: 📝 Not Started

---

## Goal

Implement comprehensive error handling across all go-live workflows with clear user feedback, automatic recovery strategies, detailed logging, and graceful degradation.

## Architecture Pattern

**Pattern**: Layered Error Handling with Recovery Strategies
**Strategy**: Catch → Classify → Log → Recover → Notify User

## Component Structure

```typescript
// Centralized error handling
enum ErrorCategory {
  NETWORK = 'network',
  VALIDATION = 'validation',
  RTMP = 'rtmp',
  QUOTA = 'quota',
  AUTHENTICATION = 'authentication',
  SERVER = 'server',
  UNKNOWN = 'unknown'
}

interface AppError extends Error {
  category: ErrorCategory;
  code: string;
  retryable: boolean;
  userMessage: string;
  technicalDetails?: any;
  suggestions?: string[];
}

class ErrorHandler {
  static handle(error: Error | AppError, context?: ErrorContext): void {
    const appError = this.classify(error);
    
    // Log error
    this.log(appError, context);
    
    // Attempt recovery
    const recovered = this.recover(appError, context);
    
    if (!recovered) {
      // Show user notification
      this.notify(appError);
    }
  }

  private static classify(error: Error): AppError {
    if (this.isNetworkError(error)) {
      return {
        ...error,
        category: ErrorCategory.NETWORK,
        code: 'NETWORK_ERROR',
        retryable: true,
        userMessage: 'Network connection failed. Retrying...',
        suggestions: ['Check your internet connection', 'Try again in a moment']
      };
    }

    if (this.isValidationError(error)) {
      return {
        ...error,
        category: ErrorCategory.VALIDATION,
        code: 'VALIDATION_ERROR',
        retryable: false,
        userMessage: error.message,
        suggestions: ['Review your input', 'Check required fields']
      };
    }

    if (this.isRTMPError(error)) {
      return {
        ...error,
        category: ErrorCategory.RTMP,
        code: 'RTMP_ERROR',
        retryable: true,
        userMessage: 'RTMP connection failed',
        suggestions: [
          'Check your streaming software is configured correctly',
          'Verify firewall allows port 1935',
          'Try the backup RTMP server'
        ]
      };
    }

    // ... more classifications
    
    return {
      ...error,
      category: ErrorCategory.UNKNOWN,
      code: 'UNKNOWN_ERROR',
      retryable: false,
      userMessage: 'An unexpected error occurred',
      suggestions: ['Contact support if this persists']
    };
  }

  private static async recover(error: AppError, context?: ErrorContext): Promise<boolean> {
    const strategies: Record<ErrorCategory, (error: AppError, context?: ErrorContext) => Promise<boolean>> = {
      [ErrorCategory.NETWORK]: this.recoverFromNetworkError,
      [ErrorCategory.RTMP]: this.recoverFromRTMPError,
      [ErrorCategory.QUOTA]: this.recoverFromQuotaError,
      [ErrorCategory.AUTHENTICATION]: this.recoverFromAuthError,
      [ErrorCategory.SERVER]: this.recoverFromServerError,
      [ErrorCategory.VALIDATION]: async () => false, // Cannot auto-recover
      [ErrorCategory.UNKNOWN]: async () => false
    };

    const strategy = strategies[error.category];
    return await strategy(error, context);
  }

  private static async recoverFromNetworkError(error: AppError, context?: ErrorContext): Promise<boolean> {
    const maxRetries = 3;
    const retryDelay = (attempt: number) => Math.min(1000 * Math.pow(2, attempt), 10000);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await sleep(retryDelay(attempt));
      
      try {
        if (context?.operation) {
          await context.operation();
          return true; // Recovered
        }
      } catch (e) {
        if (attempt === maxRetries - 1) {
          return false; // Failed after retries
        }
      }
    }

    return false;
  }

  private static async recoverFromRTMPError(error: AppError): Promise<boolean> {
    // Try backup RTMP server
    try {
      const backupServer = await getBackupRTMPServer();
      updateRTMPConfig({ rtmpUrl: backupServer });
      
      showNotification({
        type: 'info',
        message: 'Switched to backup RTMP server'
      });
      
      return true;
    } catch (e) {
      return false;
    }
  }

  private static async recoverFromQuotaError(): Promise<boolean> {
    showModal({
      title: 'Streaming Quota Exceeded',
      message: 'Upgrade your plan to continue streaming.',
      actions: [
        { label: 'Upgrade Now', onClick: () => router.push('/billing/upgrade'), primary: true },
        { label: 'Cancel', onClick: () => {} }
      ]
    });
    
    return false; // User action required
  }

  private static notify(error: AppError): void {
    showNotification({
      type: error.category === ErrorCategory.VALIDATION ? 'warning' : 'error',
      title: this.getUserFriendlyTitle(error.category),
      message: error.userMessage,
      duration: error.retryable ? 5000 : 0,
      actions: this.getNotificationActions(error)
    });
  }

  private static log(error: AppError, context?: ErrorContext): void {
    const logData = {
      category: error.category,
      code: error.code,
      message: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href
    };

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('[Error]', logData);
    }

    // Send to error tracking service
    if (window.errorTracking) {
      window.errorTracking.captureException(error, logData);
    }

    // Log critical errors to backend
    if ([ErrorCategory.RTMP, ErrorCategory.SERVER].includes(error.category)) {
      fetch('/api/errors/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logData)
      }).catch(() => {}); // Silent fail
    }
  }
}

// Global error boundary
class GlobalErrorBoundary extends React.Component<Props, State> {
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    ErrorHandler.handle(error, {
      component: this.props.componentName,
      errorInfo
    });
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback onReset={() => this.setState({ hasError: false })} />;
    }

    return this.props.children;
  }
}
```

## Error Recovery Strategies

```typescript
// Network error recovery
const retryWithExponentialBackoff = async <T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> => {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 30000,
    onRetry
  } = options;

  let lastError: Error;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt < maxRetries - 1) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
        
        if (onRetry) {
          onRetry(attempt + 1, delay);
        }
        
        await sleep(delay);
      }
    }
  }

  throw lastError!;
};

// RTMP error diagnostics
const diagnoseRTMPError = async (error: Error): Promise<Diagnostic> => {
  const checks = [
    checkFirewall(),
    checkPort1935(),
    checkBandwidth(),
    checkRTMPServerHealth(),
    checkStreamKey()
  ];

  const results = await Promise.allSettled(checks);
  
  const failed = results
    .map((r, i) => r.status === 'rejected' ? checks[i].name : null)
    .filter(Boolean);

  return {
    passed: failed.length === 0,
    failed,
    suggestions: generateSuggestions(failed)
  };
};
```

## Testing Criteria

- [ ] Network errors retry automatically
- [ ] Validation errors show field-level messages
- [ ] RTMP errors provide diagnostics
- [ ] Quota errors redirect to billing
- [ ] Auth errors redirect to login
- [ ] Errors logged to tracking service
- [ ] User-friendly error messages
- [ ] Recovery strategies execute
- [ ] Error boundary catches React errors
- [ ] Offline mode queues requests

## Acceptance Criteria

- [ ] All errors caught and classified
- [ ] User-friendly error messages
- [ ] Automatic retry for transient errors
- [ ] Fallback RTMP server on failure
- [ ] Validation errors per field
- [ ] Network offline detection
- [ ] Error logging to backend
- [ ] Diagnostic tools for RTMP issues
- [ ] Error recovery strategies
- [ ] Graceful degradation

## Related Tasks

- **Depends On**: All Phase 2 tasks
- **Blocks**: Task 2.15 (Testing)
- **Related**: Task 2.14 (Success states)

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
