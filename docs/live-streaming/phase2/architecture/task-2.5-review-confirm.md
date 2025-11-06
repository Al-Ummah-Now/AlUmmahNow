# Task 2.5: Step 4 - Review & Confirm with Preview

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 4 hours
**Dependencies**: Tasks 2.2, 2.3, 2.4
**Status**: 📝 Not Started

---

## Goal

Create a comprehensive review step that aggregates all form data, performs pre-flight validation, displays cost estimates, and executes atomic stream creation with rollback capability.

## Architecture Pattern

**Pattern**: Transaction Pattern with Idempotent Operations and Rollback
**Strategy**: Optimistic UI with server confirmation and automatic rollback on failure

## Component Structure

```typescript
// File: /apps/web/src/components/GoLiveForm/ReviewStep.tsx
interface ReviewStepProps {
  streamData: CompleteStreamData;
  onConfirm: () => Promise<void>;
  onBack: () => void;
  onEdit: (step: number) => void;
}

interface CompleteStreamData {
  details: StreamDetailsData;
  thumbnail?: ThumbnailData;
  rtmpConfig: RTMPConfig;
  estimatedCost?: StreamCost;
}

interface StreamCost {
  bandwidth: number; // GB
  storage: number; // GB
  transcoding: number; // minutes
  estimatedTotal: number; // USD
  breakdown: {
    bandwidthCost: number;
    storageCost: number;
    transcodingCost: number;
  };
}
```

## Data Flow

```
Load Review → Aggregate Form Data → Pre-flight Validation
      ↓              ↓                       ↓
Calculate Cost → Display Summary → User Confirms
      ↓                                     ↓
Idempotency Key → Create Stream API → Optimistic Update
      ↓                                     ↓
Server Response → Update Final State → Redirect to Dashboard
      ↓                                     ↓
On Error → Rollback Changes → Show Error → Allow Retry
```

## Dependencies

- **react-markdown** - Formatted description preview
- **react-countdown** - Countdown for scheduled streams
- **date-fns** - Date formatting

## Integration Points

- Quota checking service
- Cost calculation API
- Content moderation API
- Stream creation endpoint (`POST /api/live-streams`)
- Analytics tracking

## Performance Considerations

```typescript
// Optimistic UI with rollback
const useOptimisticStreamCreation = () => {
  const [optimisticStream, setOptimisticStream] = useState<Stream | null>(null);
  const queryClient = useQueryClient();

  const createStream = async (data: CompleteStreamData) => {
    // Generate temporary ID for optimistic update
    const tempStream: Stream = {
      id: `temp_${Date.now()}`,
      ...data.details,
      status: 'creating',
      createdAt: new Date().toISOString(),
      thumbnailUrl: data.thumbnail?.thumbnailUrl
    };

    // Immediately show success UI
    setOptimisticStream(tempStream);

    // Optimistically update cache
    queryClient.setQueryData(['streams', 'my-streams'], (old: Stream[] = []) => [
      tempStream,
      ...old
    ]);

    try {
      // Actual API call with idempotency
      const realStream = await api.createStream(data);

      // Replace temp with real stream
      setOptimisticStream(realStream);
      queryClient.setQueryData(['streams', 'my-streams'], (old: Stream[] = []) =>
        old.map(s => s.id === tempStream.id ? realStream : s)
      );

      return realStream;
    } catch (error) {
      // Rollback optimistic update
      setOptimisticStream(null);
      queryClient.setQueryData(['streams', 'my-streams'], (old: Stream[] = []) =>
        old.filter(s => s.id !== tempStream.id)
      );

      throw error;
    }
  };

  return { optimisticStream, createStream };
};
```

## Security Considerations

```typescript
// Pre-submission validation
const validateStreamData = async (data: CompleteStreamData): Promise<ValidationResult> => {
  const checks = [
    checkAuthentication(),
    checkQuota(),
    checkContent(data.details),
    checkSchedule(data.details.scheduledStartTime),
    checkResources()
  ];

  const results = await Promise.all(checks);
  const errors = results.filter(r => !r.valid);

  if (errors.length > 0) {
    return {
      valid: false,
      errors: errors.map(e => e.error),
      suggestions: errors.flatMap(e => e.suggestions || [])
    };
  }

  return { valid: true };
};

// Idempotent stream creation
const createStreamIdempotent = async (data: CompleteStreamData): Promise<Stream> => {
  // Generate idempotency key from data
  const idempotencyKey = await generateIdempotencyKey(data);

  try {
    const response = await api.post('/live-streams', {
      ...data,
      headers: {
        'Idempotency-Key': idempotencyKey,
        'X-Content-Hash': await hashContent(data)
      }
    });

    return response.data;
  } catch (error) {
    if (error.status === 409) {
      // Stream already created with this key, fetch it
      console.log('Stream already exists, fetching...');
      return await api.getStreamByIdempotencyKey(idempotencyKey);
    }
    throw error;
  }
};

// Generate deterministic idempotency key
const generateIdempotencyKey = async (data: CompleteStreamData): Promise<string> => {
  const payload = {
    userId: getCurrentUserId(),
    channelId: data.details.channelId,
    title: data.details.title,
    scheduledStartTime: data.details.scheduledStartTime,
    timestamp: Date.now()
  };

  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(JSON.stringify(payload));
  const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
};
```

## Error Handling

```typescript
enum StreamCreationError {
  QUOTA_EXCEEDED = 'quota_exceeded',
  INVALID_SCHEDULE = 'invalid_schedule',
  CONTENT_VIOLATION = 'content_violation',
  NETWORK_ERROR = 'network_error',
  SERVER_ERROR = 'server_error',
  INSUFFICIENT_FUNDS = 'insufficient_funds'
}

const errorRecoveryStrategies: Record<StreamCreationError, () => void> = {
  [StreamCreationError.QUOTA_EXCEEDED]: () => {
    showModal({
      title: 'Streaming Quota Exceeded',
      message: 'You\'ve reached your monthly streaming limit.',
      actions: [
        { label: 'Upgrade Plan', onClick: () => router.push('/billing/upgrade'), primary: true },
        { label: 'View Usage', onClick: () => router.push('/dashboard/usage') }
      ]
    });
  },

  [StreamCreationError.INVALID_SCHEDULE]: () => {
    showNotification({
      type: 'error',
      message: 'Scheduled time is invalid. Please select a future date.',
      action: { label: 'Fix Schedule', onClick: () => goToStep(1) }
    });
  },

  [StreamCreationError.CONTENT_VIOLATION]: () => {
    showModal({
      title: 'Content Policy Violation',
      message: 'Your stream title or description may violate our community guidelines.',
      actions: [
        { label: 'Review Guidelines', onClick: () => window.open('/guidelines', '_blank') },
        { label: 'Edit Content', onClick: () => goToStep(1), primary: true }
      ]
    });
  },

  [StreamCreationError.NETWORK_ERROR]: () => {
    showNotification({
      type: 'warning',
      message: 'Network error. Retrying automatically...',
      duration: 3000
    });
    retryWithBackoff();
  },

  [StreamCreationError.SERVER_ERROR]: () => {
    showModal({
      title: 'Server Error',
      message: 'We\'re experiencing technical difficulties. Please try again.',
      actions: [
        { label: 'Contact Support', onClick: () => openSupportChat() },
        { label: 'Retry', onClick: () => window.location.reload(), primary: true }
      ]
    });
  },

  [StreamCreationError.INSUFFICIENT_FUNDS]: () => {
    showModal({
      title: 'Insufficient Balance',
      message: 'Your account balance is too low for this stream.',
      actions: [
        { label: 'Add Funds', onClick: () => router.push('/billing/add-funds'), primary: true },
        { label: 'View Pricing', onClick: () => router.push('/pricing') }
      ]
    });
  }
};
```

## Type Safety

```typescript
// Complete type chain validation
type ValidatedStreamData = CompleteStreamData & {
  _validated: true;
  validatedAt: number;
  validationSignature: string;
};

const assertValidated = (data: any): asserts data is ValidatedStreamData => {
  if (!data._validated || Date.now() - data.validatedAt > 60000) {
    throw new Error('Data validation expired. Please review your stream details.');
  }
};

// Cost calculation types
interface CostBreakdown {
  bandwidth: {
    estimatedGB: number;
    pricePerGB: number;
    total: number;
  };
  storage: {
    estimatedGB: number;
    pricePerGB: number;
    total: number;
  };
  transcoding: {
    estimatedMinutes: number;
    pricePerMinute: number;
    total: number;
  };
  subtotal: number;
  taxes: number;
  total: number;
}

const calculateStreamCost = (data: CompleteStreamData): CostBreakdown => {
  // Estimate based on stream settings
  const durationHours = 2; // Default estimate
  const bitrateKbps = data.rtmpConfig.customSettings?.bitrate || 4000;
  const estimatedGB = (bitrateKbps * durationHours * 3600) / (8 * 1024 * 1024);

  return {
    bandwidth: {
      estimatedGB,
      pricePerGB: 0.01,
      total: estimatedGB * 0.01
    },
    storage: {
      estimatedGB: estimatedGB * 0.5, // Recordings are compressed
      pricePerGB: 0.02,
      total: estimatedGB * 0.5 * 0.02
    },
    transcoding: {
      estimatedMinutes: durationHours * 60,
      pricePerMinute: 0.005,
      total: durationHours * 60 * 0.005
    },
    subtotal: 0, // Calculated below
    taxes: 0,
    total: 0
  };
};
```

## Testing Criteria

- [ ] All form data displays correctly
- [ ] Edit buttons navigate to correct steps
- [ ] Cost estimation calculates accurately
- [ ] Pre-flight validation catches errors
- [ ] Idempotency prevents duplicate streams
- [ ] Optimistic UI shows immediate feedback
- [ ] Rollback works on creation failure
- [ ] Success redirects to dashboard
- [ ] Error messages clear and actionable

## Acceptance Criteria

- [ ] Display complete stream summary
- [ ] Show thumbnail preview
- [ ] List all stream details (title, category, etc.)
- [ ] Display RTMP configuration (masked key)
- [ ] Show cost estimate breakdown
- [ ] Edit button for each section
- [ ] Pre-flight validation before submission
- [ ] Idempotent stream creation
- [ ] Loading state during creation
- [ ] Success animation on completion
- [ ] Error handling with recovery options
- [ ] Redirect to stream dashboard on success

## Related Tasks

- **Depends On**: Tasks 2.2 (Details), 2.3 (Thumbnail), 2.4 (RTMP)
- **Blocks**: Task 2.6 (StreamSetupComponent)
- **Related**: Task 2.13 (Error Handling), Task 2.14 (Success States)

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md#task-5-step-4-review-and-confirm)
- [Idempotency Patterns](https://stripe.com/docs/api/idempotent_requests)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
