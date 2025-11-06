# Task 2.6: StreamSetupComponent (Wizard Controller)

**Phase**: 2 - Go Live Creator Tools
**Type**: Architecture Specification
**Estimated Time**: 5 hours
**Dependencies**: Task 2.5 (Review Step)
**Status**: 📝 Not Started

---

## Goal

Create a reusable wizard controller component that orchestrates the multi-step go-live process, manages state transitions, handles navigation, and provides a consistent UX across all wizard steps.

## Architecture Pattern

**Pattern**: Controller Component with State Machine
**Strategy**: Centralized state management with step validation and transition control

## Component Structure

```typescript
// File: /apps/web/src/components/StreamSetup/index.tsx
interface StreamSetupProps {
  channelId: string;
  userId: string;
  initialStep?: number;
  onComplete: (streamId: string) => void;
  onCancel: () => void;
}

interface StepConfig {
  id: number;
  title: string;
  description: string;
  component: React.ComponentType<any>;
  canSkip: boolean;
  validate: (data: any) => Promise<boolean>;
}

const StreamSetupWizard: React.FC<StreamSetupProps> = ({
  channelId,
  userId,
  initialStep = 1,
  onComplete,
  onCancel
}) => {
  const [currentStep, setCurrentStep] = useState(initialStep);
  const [formData, setFormData] = useState<Partial<StreamFormData>>({});
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const steps: StepConfig[] = [
    {
      id: 1,
      title: 'Stream Details',
      description: 'Title, category, and description',
      component: StreamDetailsStep,
      canSkip: false,
      validate: async (data) => streamDetailsSchema.safeParse(data).success
    },
    {
      id: 2,
      title: 'Thumbnail',
      description: 'Upload or auto-generate',
      component: ThumbnailStep,
      canSkip: true,
      validate: async () => true
    },
    {
      id: 3,
      title: 'RTMP Setup',
      description: 'Configure streaming software',
      component: RTMPSetupStep,
      canSkip: false,
      validate: async (data) => !!data.rtmpConfig
    },
    {
      id: 4,
      title: 'Review',
      description: 'Confirm and create',
      component: ReviewStep,
      canSkip: false,
      validate: async (data) => validateCompleteStream(data)
    }
  ];

  const handleNext = async () => {
    const currentStepConfig = steps[currentStep - 1];
    const isValid = await currentStepConfig.validate(formData);

    if (!isValid) {
      showNotification({ type: 'error', message: 'Please complete all required fields' });
      return;
    }

    setCompletedSteps(prev => new Set([...prev, currentStep]));
    setCurrentStep(prev => Math.min(steps.length, prev + 1));
  };

  const handleBack = () => {
    setCurrentStep(prev => Math.max(1, prev - 1));
  };

  const handleStepClick = (stepId: number) => {
    if (completedSteps.has(stepId - 1) || stepId === 1) {
      setCurrentStep(stepId);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <StepIndicator steps={steps} current={currentStep} completed={completedSteps} />
      <StepContent
        step={steps[currentStep - 1]}
        data={formData}
        onUpdate={setFormData}
        onNext={handleNext}
        onBack={handleBack}
      />
    </div>
  );
};
```

## Data Flow

```
Initialize Wizard → Load Draft State → Set Current Step
       ↓                  ↓                   ↓
Render Step → User Input → Update Form Data
       ↓                                      ↓
Validate → On Success → Mark Complete → Next Step
       ↓                                      ↓
Final Step → Submit → Create Stream → Redirect
```

## Dependencies

- **framer-motion** - Step transitions and animations
- **react-hook-form** - Form state management
- **zod** - Validation
- **@tanstack/react-query** - API state

## Integration Points

- GoLiveForm wizard steps (Tasks 2.2-2.5)
- Stream creation API
- Draft persistence service
- Analytics tracking

## Performance Considerations

```typescript
// Lazy load step components
const LazySteps = {
  1: React.lazy(() => import('./StreamDetailsStep')),
  2: React.lazy(() => import('./ThumbnailStep')),
  3: React.lazy(() => import('./RTMPSetupStep')),
  4: React.lazy(() => import('./ReviewStep'))
};

// Preload next step
useEffect(() => {
  if (currentStep < steps.length) {
    const nextStep = LazySteps[currentStep + 1];
    if (nextStep) {
      nextStep.preload?.();
    }
  }
}, [currentStep]);

// Memoize step validation
const validateStep = useCallback(
  memoize(async (stepId: number, data: any) => {
    const step = steps.find(s => s.id === stepId);
    if (!step) return false;
    return await step.validate(data);
  }),
  [steps]
);
```

## Error Handling

```typescript
// Centralized error boundary
const StepErrorBoundary: React.FC<{ step: number }> = ({ step, children }) => {
  const handleError = (error: Error, errorInfo: React.ErrorInfo) => {
    logError(error, {
      context: 'stream-setup-wizard',
      step,
      errorInfo
    });

    showNotification({
      type: 'error',
      title: 'Something went wrong',
      message: 'Please try again or contact support if the issue persists.',
      actions: [
        { label: 'Retry', onClick: () => window.location.reload() },
        { label: 'Support', onClick: () => openSupportChat() }
      ]
    });
  };

  return (
    <ErrorBoundary FallbackComponent={StepErrorFallback} onError={handleError}>
      {children}
    </ErrorBoundary>
  );
};

// Step transition guards
const canTransitionTo = (targetStep: number, currentStep: number, completedSteps: Set<number>): boolean => {
  // Can always go back
  if (targetStep < currentStep) return true;

  // Can only go forward if previous steps are complete
  for (let i = 1; i < targetStep; i++) {
    if (!completedSteps.has(i) && !steps[i - 1].canSkip) {
      return false;
    }
  }

  return true;
};
```

## Type Safety

```typescript
// Step state types
interface StepState {
  current: number;
  completed: Set<number>;
  data: Partial<StreamFormData>;
  errors: Record<number, string[]>;
  isDirty: boolean;
}

// Navigation types
type NavigationAction =
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'GOTO'; step: number }
  | { type: 'SKIP' };

// Wizard context
interface WizardContext {
  state: StepState;
  dispatch: (action: NavigationAction) => void;
  canProceed: boolean;
  canGoBack: boolean;
  isLastStep: boolean;
}
```

## Testing Criteria

- [ ] Wizard initializes on correct step
- [ ] Step navigation works (next/back/goto)
- [ ] Validation prevents invalid transitions
- [ ] Draft state persists across steps
- [ ] Step indicator shows correct status
- [ ] Completed steps are marked
- [ ] Animations smooth between steps
- [ ] Error boundary catches step errors
- [ ] Final step creates stream
- [ ] Cancel returns to previous page

## Acceptance Criteria

- [ ] 4-step wizard with progress indicator
- [ ] Step validation before transition
- [ ] Completed steps marked with checkmark
- [ ] Click completed steps to navigate back
- [ ] Back button enabled except on step 1
- [ ] Next button validates current step
- [ ] Loading states during validation
- [ ] Error messages per step
- [ ] Cancel confirmation dialog
- [ ] Success redirect after completion

## Related Tasks

- **Depends On**: Tasks 2.1-2.5 (Wizard steps)
- **Blocks**: Tasks 2.8, 2.9 (Go Live pages)
- **Related**: Task 2.7 (StreamControls)

## References

- [ADR-002: Phase 2 Architecture](/docs/architecture/ADR-002-phase2-golive-architecture.md#task-6-streamsetup-component)

---

**Last Updated**: 2025-11-06
**Reviewed By**: N/A
**Implementation Status**: Not Started
