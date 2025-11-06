# Task 2.1: GoLiveForm Wizard Structure (4 Steps)

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 8 hours
**Dependencies**: None
**Status**: 📝 Not Started

---

## Goal

Create a multi-step wizard component with finite state machine pattern for guiding creators through the live stream setup process, ensuring data persistence and validation at each step.

## Architecture Pattern

**Pattern**: Finite State Machine with Persistent Form State
**Strategy**: Progressive disclosure with step-by-step validation and draft recovery

## Component Structure

```typescript
// File: /apps/web/src/components/GoLiveForm/index.tsx
interface GoLiveFormProps {
  channelId: string;
  userId: string;
  onSuccess: (streamId: string) => void;
  onCancel: () => void;
  initialData?: Partial<StreamFormData>;
}

interface GoLiveFormState {
  currentStep: 1 | 2 | 3 | 4;
  streamDetails: StreamDetailsData | null;
  thumbnailData: ThumbnailData | null;
  rtmpConfig: RTMPConfig | null;
  streamId: string | null;
  errors: Record<string, string>;
  isLoading: boolean;
  isDirty: boolean;
}

type WizardAction =
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_DATA'; step: number; data: any }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'RESET' };

const wizardReducer = (state: GoLiveFormState, action: WizardAction): GoLiveFormState => {
  switch (action.type) {
    case 'NEXT_STEP':
      return { ...state, currentStep: Math.min(4, state.currentStep + 1) as any };
    case 'PREV_STEP':
      return { ...state, currentStep: Math.max(1, state.currentStep - 1) as any };
    case 'SET_DATA':
      return { ...state, isDirty: true, /* ... set data for step */ };
    case 'SET_ERROR':
      return { ...state, errors: { ...state.errors, ...action.error } };
    case 'RESET':
      return initialState;
    default:
      return state;
  }
};
```

## Data Flow

```
User Opens Wizard → Load Draft from sessionStorage → Initialize State
        ↓                      ↓                          ↓
   Step 1: Details → Validate → Save Draft → Enable Next
        ↓                                         ↓
   Step 2: Thumbnail → Upload → Save Draft → Enable Next
        ↓                                         ↓
   Step 3: RTMP Setup → Generate → Save Draft → Enable Next
        ↓                                         ↓
   Step 4: Review → Confirm → Create Stream → Redirect
```

## Dependencies

- **react-hook-form** - Form state management
- **zod** - Schema validation
- **@tanstack/react-query** - API state management
- **sessionStorage API** - Draft persistence

## Integration Points

- `LiveStreamsAPI.create()` - Final stream creation
- `Bunny.net upload API` - Thumbnail upload in step 2
- `WebSocketProvider` - Real-time updates after creation
- `sessionStorage` - Draft recovery mechanism

## Performance Considerations

- **Lazy Loading**: Load step components on demand
  ```typescript
  const Step1 = React.lazy(() => import('./StreamDetailsStep'));
  const Step2 = React.lazy(() => import('./ThumbnailStep'));
  const Step3 = React.lazy(() => import('./RTMPSetupStep'));
  const Step4 = React.lazy(() => import('./ReviewStep'));
  ```

- **Debounced Draft Saving**: Save draft every 500ms of inactivity
  ```typescript
  const saveDraft = useMemo(
    () => debounce((state: GoLiveFormState) => {
      sessionStorage.setItem('stream-draft', JSON.stringify(state));
    }, 500),
    []
  );
  ```

- **Optimistic UI**: Show success immediately, confirm asynchronously
- **Preload Next Step**: Load next step component when current step is complete

## Error Handling

```typescript
// Field-level validation errors
const handleStepValidation = async (step: number, data: any) => {
  try {
    const validated = await stepValidators[step].parseAsync(data);
    return { valid: true, data: validated };
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errors = error.errors.reduce((acc, err) => ({
        ...acc,
        [err.path.join('.')]: err.message
      }), {});
      return { valid: false, errors };
    }
    throw error;
  }
};

// Network error retry with exponential backoff
const createStreamWithRetry = async (data: CompleteStreamData) => {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      return await LiveStreamsAPI.create(data);
    } catch (error) {
      attempt++;
      if (attempt >= maxRetries) throw error;
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
};

// Session recovery on browser crash
useEffect(() => {
  const draft = sessionStorage.getItem('stream-draft');
  if (draft) {
    const confirmed = window.confirm('Recover unsaved stream draft?');
    if (confirmed) {
      setState(JSON.parse(draft));
    } else {
      sessionStorage.removeItem('stream-draft');
    }
  }
}, []);
```

## Type Safety

```typescript
// Shared types
type StreamFormData = StreamDetailsData & ThumbnailData & RTMPConfig;

// Step-specific validators
const stepValidators = {
  1: streamDetailsSchema,
  2: thumbnailSchema,
  3: rtmpConfigSchema,
  4: reviewSchema
};

// Type-safe step transitions
type WizardStep = 1 | 2 | 3 | 4;

const canProceed = (step: WizardStep, state: GoLiveFormState): boolean => {
  switch (step) {
    case 1: return !!state.streamDetails;
    case 2: return !!state.thumbnailData || true; // Optional
    case 3: return !!state.rtmpConfig;
    case 4: return !state.isLoading;
    default: return false;
  }
};
```

## Security Considerations

- **No Sensitive Data in sessionStorage**: Stream keys never saved locally
- **Form Data Sanitization**: All inputs sanitized before submission
- **CSRF Protection**: Secure headers on all API calls
- **Rate Limiting**: Max 5 stream creations per hour per user

## Testing Criteria

- [ ] Wizard navigation (next/previous) works correctly
- [ ] Each step validates independently
- [ ] Draft persists across page refresh
- [ ] Draft recovery prompt appears on reload
- [ ] State machine prevents invalid transitions
- [ ] Validation errors display per-field
- [ ] Loading states show during async operations
- [ ] Cleanup removes draft after successful creation

## Acceptance Criteria

- [ ] 4-step wizard renders with proper step indicators
- [ ] Navigation between steps works smoothly
- [ ] Form data persists in sessionStorage
- [ ] Recovery prompt shows on page reload
- [ ] Each step has independent validation
- [ ] Final submission creates stream successfully
- [ ] Error states handled gracefully
- [ ] Accessibility: keyboard navigation works
- [ ] Mobile responsive design

## Related Tasks

- **Depends On**: None (foundation task)
- **Blocks**: Tasks 2.2, 2.3, 2.4, 2.5 (all wizard steps)
- **Related**: Task 2.6 (StreamSetupComponent)

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md#task-1-goliveform-wizard-structure)
- [Phase 2 README](/docs/live-streaming/phase2/README.md)
- [Finite State Machine Pattern](https://xstate.js.org/docs/guides/introduction-to-state-machines-and-statecharts/)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
