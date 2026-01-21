/**
 * GoLiveWizard Component (LTR)
 * Task 2.1: GoLiveForm Wizard Structure (4 Steps)
 *
 * Multi-step wizard for creating live streams using finite state machine pattern.
 * Features: 4-step progression, form validation, draft persistence, keyboard navigation.
 */

'use client';

import React, { useReducer, useEffect, useCallback, useMemo, useState } from 'react';
import { useLanguage } from '@/hooks/useLanguage';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger-client';
import type {
  GoLiveWizardProps,
  GoLiveFormState,
  WizardAction,
  WizardStep,
  DraftRecoveryData,
} from './types';
import { WIZARD_STEPS, DRAFT_STORAGE_KEY } from './types';

/**
 * Initial wizard state
 */
const initialState: GoLiveFormState = {
  currentStep: 1,
  streamDetails: null,
  thumbnailData: null,
  rtmpConfig: null,
  streamId: null,
  errors: {},
  isLoading: false,
  isDirty: false,
  draftRecoveryShown: false,
};

/**
 * Wizard Reducer (FSM pattern)
 * Manages all state transitions for the wizard
 */
function wizardReducer(state: GoLiveFormState, action: WizardAction): GoLiveFormState {
  logger.debug('[GoLiveWizard] Reducer action', { type: action.type, state });

  switch (action.type) {
    case 'NEXT_STEP':
      return {
        ...state,
        currentStep: Math.min(4, state.currentStep + 1) as WizardStep,
      };

    case 'PREV_STEP':
      return {
        ...state,
        currentStep: Math.max(1, state.currentStep - 1) as WizardStep,
      };

    case 'GO_TO_STEP':
      // Can only navigate to completed steps or current step
      if (action.step <= state.currentStep || canNavigateToStep(state, action.step)) {
        return {
          ...state,
          currentStep: action.step,
        };
      }
      return state;

    case 'SET_DETAILS':
      return {
        ...state,
        streamDetails: action.data,
        isDirty: true,
        errors: {}, // Clear errors on data update
      };

    case 'SET_THUMBNAIL':
      return {
        ...state,
        thumbnailData: action.data,
        isDirty: true,
      };

    case 'SET_RTMP':
      return {
        ...state,
        rtmpConfig: action.data,
        streamId: action.data.streamId,
        isDirty: true,
      };

    case 'SET_ERRORS':
      return {
        ...state,
        errors: action.errors,
      };

    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.isLoading,
      };

    case 'MARK_DIRTY':
      return {
        ...state,
        isDirty: true,
      };

    case 'MARK_DRAFT_SHOWN':
      return {
        ...state,
        draftRecoveryShown: true,
      };

    case 'RESTORE_DRAFT':
      return {
        ...action.state,
        draftRecoveryShown: true,
      };

    case 'RESET':
      return initialState;

    default:
      return state;
  }
}

/**
 * Check if user can navigate to a specific step
 */
function canNavigateToStep(state: GoLiveFormState, targetStep: WizardStep): boolean {
  // Can always go to step 1
  if (targetStep === 1) return true;

  // Step 2 requires step 1 completion
  if (targetStep === 2) {
    return state.streamDetails !== null && isStepValid(state, 1);
  }

  // Step 3 requires step 1 completion (step 2 is optional)
  if (targetStep === 3) {
    return state.streamDetails !== null && isStepValid(state, 1);
  }

  // Step 4 requires steps 1 and 3 completion
  if (targetStep === 4) {
    return (
      state.streamDetails !== null &&
      state.rtmpConfig !== null &&
      isStepValid(state, 1) &&
      isStepValid(state, 3)
    );
  }

  return false;
}

/**
 * Check if a step is valid
 */
function isStepValid(state: GoLiveFormState, step: WizardStep): boolean {
  switch (step) {
    case 1:
      // Step 1: Stream details must be present and valid
      if (!state.streamDetails) return false;
      const { title, category } = state.streamDetails;
      return (
        !!title &&
        title.length >= 3 &&
        title.length <= 100 &&
        !!category
      );

    case 2:
      // Step 2: Thumbnail is optional, always valid
      return true;

    case 3:
      // Step 3: RTMP config must be present
      return (
        !!state.rtmpConfig &&
        !!state.rtmpConfig.serverUrl &&
        !!state.rtmpConfig.streamKey &&
        !!state.rtmpConfig.streamId
      );

    case 4:
      // Step 4: All required steps must be complete
      return (
        isStepValid(state, 1) &&
        isStepValid(state, 3) &&
        !state.isLoading
      );

    default:
      return false;
  }
}

/**
 * GoLiveWizard Component
 *
 * Features:
 * - 4-step wizard with FSM pattern
 * - Form validation per step
 * - Draft persistence (sessionStorage)
 * - Draft recovery on page reload
 * - Keyboard navigation
 * - Mobile-responsive
 * - RTL support (via separate component)
 * - Accessibility (ARIA, focus management)
 */
/**
 * Confirmation dialog types
 */
type ConfirmDialogType = 'draft-recovery' | 'leave-warning' | null;

export const GoLiveWizard: React.FC<GoLiveWizardProps> = ({
  channelId,
  userId,
  onSuccess,
  onCancel,
  initialData,
  className,
}) => {
  const { t, isRTL } = useLanguage();

  // Initialize state with initialData if provided
  const getInitialState = useCallback((): GoLiveFormState => {
    if (initialData) {
      return {
        ...initialState,
        streamDetails: initialData.title ? {
          title: initialData.title,
          description: initialData.description,
          category: initialData.category || '',
          tags: initialData.tags,
          scheduledStartTime: initialData.scheduledStartTime,
          notifySubscribers: initialData.notifySubscribers,
        } : null,
        thumbnailData: initialData.thumbnailUrl ? {
          thumbnailUrl: initialData.thumbnailUrl,
        } : null,
        rtmpConfig: initialData.serverUrl ? {
          serverUrl: initialData.serverUrl,
          streamKey: initialData.streamKey || '',
          streamId: initialData.streamId || '',
        } : null,
        streamId: initialData.streamId || null,
      };
    }
    return initialState;
  }, [initialData]);

  const [state, dispatch] = useReducer(wizardReducer, initialState, getInitialState);

  // Confirmation dialog state (replaces window.confirm)
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogType>(null);
  const [pendingDraft, setPendingDraft] = useState<DraftRecoveryData | null>(null);

  logger.info('[GoLiveWizard] Component mounted', { channelId, userId, isRTL, hasInitialData: !!initialData });

  /**
   * Save draft to sessionStorage
   */
  const saveDraft = useCallback(() => {
    try {
      const draftData: DraftRecoveryData = {
        state,
        savedAt: new Date().toISOString(),
        channelId,
        userId,
      };
      sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftData));
      logger.debug('[GoLiveWizard] Draft saved', { savedAt: draftData.savedAt });
    } catch (error) {
      logger.error('[GoLiveWizard] Failed to save draft', { error });
    }
  }, [state, channelId, userId]);

  /**
   * Load draft from sessionStorage
   */
  const loadDraft = useCallback((): DraftRecoveryData | null => {
    try {
      const draftJson = sessionStorage.getItem(DRAFT_STORAGE_KEY);
      if (!draftJson) return null;

      const draft: DraftRecoveryData = JSON.parse(draftJson);

      // Validate draft belongs to current user and channel
      if (draft.channelId !== channelId || draft.userId !== userId) {
        logger.warn('[GoLiveWizard] Draft mismatch, ignoring', { draft, channelId, userId });
        return null;
      }

      logger.info('[GoLiveWizard] Draft loaded', { savedAt: draft.savedAt });
      return draft;
    } catch (error) {
      logger.error('[GoLiveWizard] Failed to load draft', { error });
      return null;
    }
  }, [channelId, userId]);

  /**
   * Clear draft from sessionStorage
   */
  const clearDraft = useCallback(() => {
    try {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      logger.debug('[GoLiveWizard] Draft cleared');
    } catch (error) {
      logger.error('[GoLiveWizard] Failed to clear draft', { error });
    }
  }, []);

  /**
   * Handle draft recovery on mount
   */
  useEffect(() => {
    const draft = loadDraft();
    if (draft && !state.draftRecoveryShown) {
      // Show recovery dialog (non-blocking)
      setPendingDraft(draft);
      setConfirmDialog('draft-recovery');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount

  /**
   * Handle draft recovery confirmation
   */
  const handleDraftRecoveryConfirm = useCallback((confirmed: boolean) => {
    if (confirmed && pendingDraft) {
      dispatch({ type: 'RESTORE_DRAFT', state: pendingDraft.state });
    } else {
      clearDraft();
      dispatch({ type: 'MARK_DRAFT_SHOWN' });
    }
    setPendingDraft(null);
    setConfirmDialog(null);
  }, [pendingDraft, clearDraft]);

  /**
   * Auto-save draft every 30 seconds
   */
  useEffect(() => {
    if (!state.isDirty) return;

    const interval = setInterval(() => {
      saveDraft();
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, [state.isDirty, saveDraft]);

  /**
   * Warn before leaving page with unsaved changes
   */
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (state.isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.isDirty]);

  /**
   * Handle keyboard navigation
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to cancel (with confirmation if dirty)
      if (e.key === 'Escape') {
        handleCancel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.isDirty]);

  /**
   * Handle next step
   */
  const handleNext = useCallback(() => {
    if (!isStepValid(state, state.currentStep)) {
      logger.warn('[GoLiveWizard] Cannot proceed, step invalid', { step: state.currentStep });
      return;
    }

    dispatch({ type: 'NEXT_STEP' });
    saveDraft();
  }, [state, saveDraft]);

  /**
   * Handle previous step
   */
  const handleBack = useCallback(() => {
    dispatch({ type: 'PREV_STEP' });
  }, []);

  /**
   * Handle cancel - shows confirmation dialog if dirty
   */
  const handleCancel = useCallback(() => {
    if (state.isDirty) {
      setConfirmDialog('leave-warning');
      return;
    }

    clearDraft();
    onCancel();
  }, [state.isDirty, clearDraft, onCancel]);

  /**
   * Handle leave confirmation
   */
  const handleLeaveConfirm = useCallback((confirmed: boolean) => {
    setConfirmDialog(null);
    if (confirmed) {
      clearDraft();
      onCancel();
    }
  }, [clearDraft, onCancel]);

  /**
   * Handle form submission (step 4)
   */
  const handleSubmit = useCallback(async () => {
    logger.info('[GoLiveWizard] Submitting form', { state });

    dispatch({ type: 'SET_LOADING', isLoading: true });

    try {
      // Create stream via API (placeholder - will be implemented in future tasks)
      // await createLiveStream({ ...state.streamDetails, ...state.rtmpConfig });

      clearDraft();
      onSuccess(state.streamId || 'placeholder-stream-id');
    } catch (error) {
      logger.error('[GoLiveWizard] Failed to create stream', { error });
      dispatch({
        type: 'SET_ERRORS',
        errors: { submit: t.live?.wizard?.errors?.failedToCreate || 'Failed to create stream' },
      });
    } finally {
      dispatch({ type: 'SET_LOADING', isLoading: false });
    }
  }, [state, clearDraft, onSuccess, t]);

  /**
   * Determine if can proceed to next step
   */
  const canProceed = useMemo(() => {
    return isStepValid(state, state.currentStep);
  }, [state]);

  /**
   * Get step configuration
   */
  const currentStepConfig = useMemo(() => {
    return WIZARD_STEPS.find((s) => s.step === state.currentStep);
  }, [state.currentStep]);

  return (
    <div
      className={cn(
        'w-full max-w-4xl mx-auto',
        'bg-white dark:bg-gray-900',
        'rounded-lg shadow-lg',
        'p-4 md:p-6 lg:p-8',
        className
      )}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Header */}
      <header className="mb-6 md:mb-8">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2">
          {t.live?.wizard?.title || 'Go Live - Set Up Your Stream'}
        </h1>
        <p className="text-sm md:text-base text-gray-600 dark:text-gray-400">
          {t.live?.wizard?.subtitle || 'Follow these steps to start your live stream'}
        </p>
      </header>

      {/* Step Indicator (Placeholder - will be implemented as separate component) */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {WIZARD_STEPS.map((step, index) => (
            <div
              key={step.step}
              className={cn(
                'flex items-center',
                index !== WIZARD_STEPS.length - 1 && 'flex-1'
              )}
            >
              <button
                className={cn(
                  'w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center font-semibold transition-colors',
                  state.currentStep === step.step
                    ? 'bg-primary text-white'
                    : isStepValid(state, step.step)
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-300 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
                  canNavigateToStep(state, step.step) && 'cursor-pointer hover:opacity-80'
                )}
                onClick={() => dispatch({ type: 'GO_TO_STEP', step: step.step })}
                disabled={!canNavigateToStep(state, step.step)}
                aria-label={`Step ${step.step}: ${currentStepConfig?.titleKey}`}
                aria-current={state.currentStep === step.step ? 'step' : undefined}
              >
                {step.step}
              </button>
              {index !== WIZARD_STEPS.length - 1 && (
                <div
                  className={cn(
                    'h-1 flex-1 mx-2',
                    state.currentStep > step.step
                      ? 'bg-green-500'
                      : 'bg-gray-300 dark:bg-gray-700'
                  )}
                  aria-hidden="true"
                />
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 text-center text-sm text-gray-600 dark:text-gray-400">
          {t.live?.wizard?.stepOf?.replace('{current}', String(state.currentStep)).replace('{total}', '4') ||
            `Step ${state.currentStep} of 4`}
        </div>
      </div>

      {/* Step Content (Placeholder - actual step components will be implemented in future tasks) */}
      <div className="mb-8 min-h-[400px]">
        <p className="text-gray-600 dark:text-gray-400">
          Step {state.currentStep} content will be implemented in tasks 2.2-2.5
        </p>
      </div>

      {/* Navigation */}
      <footer className="flex items-center justify-between pt-6 border-t border-gray-200 dark:border-gray-700">
        <button
          onClick={handleCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          type="button"
        >
          {t.common?.cancel || 'Cancel'}
        </button>

        <div className="flex items-center gap-3">
          {state.currentStep > 1 && (
            <button
              onClick={handleBack}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              type="button"
            >
              {t.live?.wizard?.previousStep || t.common?.back || 'Back'}
            </button>
          )}

          {state.currentStep < 4 ? (
            <button
              onClick={handleNext}
              disabled={!canProceed}
              className={cn(
                'px-4 py-2 text-sm font-medium text-white rounded-md transition-colors',
                canProceed
                  ? 'bg-primary hover:bg-primary/90'
                  : 'bg-gray-400 dark:bg-gray-700 cursor-not-allowed'
              )}
              type="button"
            >
              {t.live?.wizard?.nextStep || t.common?.next || 'Next'}
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canProceed || state.isLoading}
              className={cn(
                'px-6 py-2 text-sm font-medium text-white rounded-md transition-colors',
                canProceed && !state.isLoading
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-gray-400 dark:bg-gray-700 cursor-not-allowed'
              )}
              type="button"
            >
              {state.isLoading
                ? (t.live?.wizard?.goingLive || 'Going Live...')
                : (t.live?.wizard?.finishSetup || 'Finish Setup')}
            </button>
          )}
        </div>
      </footer>

      {/* Error Display */}
      {Object.keys(state.errors).length > 0 && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
          <p className="text-sm text-red-800 dark:text-red-200">
            {state.errors.submit || Object.values(state.errors)[0]}
          </p>
        </div>
      )}

      {/* Confirmation Dialog */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
        >
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <h2 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              {confirmDialog === 'draft-recovery'
                ? (t.live?.wizard?.recoverDraft || 'Recover Draft')
                : (t.live?.wizard?.leavingWarning || 'Leave Without Saving?')}
            </h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              {confirmDialog === 'draft-recovery'
                ? (t.live?.wizard?.recoverDraftMessage?.replace(
                    '{time}',
                    pendingDraft ? new Date(pendingDraft.savedAt).toLocaleTimeString() : ''
                  ) || 'You have an unsaved draft. Continue where you left off?')
                : (t.live?.wizard?.leavingWarningMessage || 'You have unsaved changes. Are you sure you want to leave?')}
            </p>
            <div className={cn('flex gap-3', isRTL ? 'flex-row-reverse' : 'justify-end')}>
              <button
                onClick={() =>
                  confirmDialog === 'draft-recovery'
                    ? handleDraftRecoveryConfirm(false)
                    : handleLeaveConfirm(false)
                }
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 rounded-md hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                type="button"
              >
                {confirmDialog === 'draft-recovery'
                  ? (t.live?.wizard?.startFresh || 'Start Fresh')
                  : (t.live?.wizard?.stayOnPage || 'Stay')}
              </button>
              <button
                onClick={() =>
                  confirmDialog === 'draft-recovery'
                    ? handleDraftRecoveryConfirm(true)
                    : handleLeaveConfirm(true)
                }
                className={cn(
                  'px-4 py-2 text-sm font-medium text-white rounded-md transition-colors',
                  confirmDialog === 'draft-recovery'
                    ? 'bg-primary hover:bg-primary/90'
                    : 'bg-red-600 hover:bg-red-700'
                )}
                type="button"
                autoFocus
              >
                {confirmDialog === 'draft-recovery'
                  ? (t.live?.wizard?.continueWithDraft || 'Continue with Draft')
                  : (t.live?.wizard?.leavePage || 'Leave')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

GoLiveWizard.displayName = 'GoLiveWizard';

export default GoLiveWizard;
