/**
 * GoLiveWizard Unit Tests
 * Task 2.1: GoLiveForm Wizard Structure (4 Steps)
 *
 * Tests for wizard state machine, validation, and navigation logic.
 */

import { describe, it, expect } from '@jest/globals';
import type { GoLiveFormState, WizardStep } from '../types';

/**
 * Helper function to check if a step is valid
 * Duplicated from main component for testing purposes
 */
function isStepValid(state: GoLiveFormState, step: WizardStep): boolean {
  switch (step) {
    case 1:
      if (!state.streamDetails) return false;
      const { title, category } = state.streamDetails;
      return (
        !!title &&
        title.length >= 3 &&
        title.length <= 100 &&
        !!category
      );

    case 2:
      return true; // Thumbnail is optional

    case 3:
      return (
        !!state.rtmpConfig &&
        !!state.rtmpConfig.serverUrl &&
        !!state.rtmpConfig.streamKey &&
        !!state.rtmpConfig.streamId
      );

    case 4:
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
 * Helper function to check if user can navigate to a specific step
 * Duplicated from main component for testing purposes
 */
function canNavigateToStep(state: GoLiveFormState, targetStep: WizardStep): boolean {
  if (targetStep === 1) return true;

  if (targetStep === 2) {
    return state.streamDetails !== null && isStepValid(state, 1);
  }

  if (targetStep === 3) {
    return state.streamDetails !== null && isStepValid(state, 1);
  }

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

describe('GoLiveWizard - Step Validation', () => {
  it('should validate step 1 with valid stream details', () => {
    const state: GoLiveFormState = {
      currentStep: 1,
      streamDetails: {
        title: 'Test Stream',
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: null,
      streamId: null,
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(isStepValid(state, 1)).toBe(true);
  });

  it('should invalidate step 1 with missing title', () => {
    const state: GoLiveFormState = {
      currentStep: 1,
      streamDetails: {
        title: '',
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: null,
      streamId: null,
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(isStepValid(state, 1)).toBe(false);
  });

  it('should invalidate step 1 with title too short', () => {
    const state: GoLiveFormState = {
      currentStep: 1,
      streamDetails: {
        title: 'AB', // Less than 3 characters
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: null,
      streamId: null,
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(isStepValid(state, 1)).toBe(false);
  });

  it('should invalidate step 1 with title too long', () => {
    const state: GoLiveFormState = {
      currentStep: 1,
      streamDetails: {
        title: 'A'.repeat(101), // More than 100 characters
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: null,
      streamId: null,
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(isStepValid(state, 1)).toBe(false);
  });

  it('should invalidate step 1 with missing category', () => {
    const state: GoLiveFormState = {
      currentStep: 1,
      streamDetails: {
        title: 'Test Stream',
        category: '',
      },
      thumbnailData: null,
      rtmpConfig: null,
      streamId: null,
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(isStepValid(state, 1)).toBe(false);
  });

  it('should always validate step 2 (thumbnail optional)', () => {
    const state: GoLiveFormState = {
      currentStep: 2,
      streamDetails: {
        title: 'Test Stream',
        category: 'Islamic Lectures',
      },
      thumbnailData: null, // No thumbnail
      rtmpConfig: null,
      streamId: null,
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(isStepValid(state, 2)).toBe(true);
  });

  it('should validate step 3 with valid RTMP config', () => {
    const state: GoLiveFormState = {
      currentStep: 3,
      streamDetails: {
        title: 'Test Stream',
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: {
        serverUrl: 'rtmp://example.com/live',
        streamKey: 'test-key-12345',
        streamId: 'stream-123',
      },
      streamId: 'stream-123',
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(isStepValid(state, 3)).toBe(true);
  });

  it('should invalidate step 3 with missing RTMP config', () => {
    const state: GoLiveFormState = {
      currentStep: 3,
      streamDetails: {
        title: 'Test Stream',
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: null,
      streamId: null,
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(isStepValid(state, 3)).toBe(false);
  });

  it('should validate step 4 with all required steps complete', () => {
    const state: GoLiveFormState = {
      currentStep: 4,
      streamDetails: {
        title: 'Test Stream',
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: {
        serverUrl: 'rtmp://example.com/live',
        streamKey: 'test-key-12345',
        streamId: 'stream-123',
      },
      streamId: 'stream-123',
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(isStepValid(state, 4)).toBe(true);
  });

  it('should invalidate step 4 when loading', () => {
    const state: GoLiveFormState = {
      currentStep: 4,
      streamDetails: {
        title: 'Test Stream',
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: {
        serverUrl: 'rtmp://example.com/live',
        streamKey: 'test-key-12345',
        streamId: 'stream-123',
      },
      streamId: 'stream-123',
      errors: {},
      isLoading: true, // Loading state
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(isStepValid(state, 4)).toBe(false);
  });
});

describe('GoLiveWizard - Step Navigation', () => {
  it('should allow navigation to step 1 from any state', () => {
    const state: GoLiveFormState = {
      currentStep: 3,
      streamDetails: null,
      thumbnailData: null,
      rtmpConfig: null,
      streamId: null,
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(canNavigateToStep(state, 1)).toBe(true);
  });

  it('should allow navigation to step 2 when step 1 is complete', () => {
    const state: GoLiveFormState = {
      currentStep: 1,
      streamDetails: {
        title: 'Test Stream',
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: null,
      streamId: null,
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(canNavigateToStep(state, 2)).toBe(true);
  });

  it('should not allow navigation to step 2 when step 1 is incomplete', () => {
    const state: GoLiveFormState = {
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

    expect(canNavigateToStep(state, 2)).toBe(false);
  });

  it('should allow navigation to step 3 when step 1 is complete (step 2 optional)', () => {
    const state: GoLiveFormState = {
      currentStep: 1,
      streamDetails: {
        title: 'Test Stream',
        category: 'Islamic Lectures',
      },
      thumbnailData: null, // Step 2 skipped
      rtmpConfig: null,
      streamId: null,
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(canNavigateToStep(state, 3)).toBe(true);
  });

  it('should allow navigation to step 4 when steps 1 and 3 are complete', () => {
    const state: GoLiveFormState = {
      currentStep: 3,
      streamDetails: {
        title: 'Test Stream',
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: {
        serverUrl: 'rtmp://example.com/live',
        streamKey: 'test-key-12345',
        streamId: 'stream-123',
      },
      streamId: 'stream-123',
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(canNavigateToStep(state, 4)).toBe(true);
  });

  it('should not allow navigation to step 4 when step 3 is incomplete', () => {
    const state: GoLiveFormState = {
      currentStep: 3,
      streamDetails: {
        title: 'Test Stream',
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: null, // Step 3 incomplete
      streamId: null,
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(canNavigateToStep(state, 4)).toBe(false);
  });
});

describe('GoLiveWizard - FSM Pattern', () => {
  it('should enforce step order (cannot skip to step 4 from step 1)', () => {
    const state: GoLiveFormState = {
      currentStep: 1,
      streamDetails: {
        title: 'Test Stream',
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: null, // Step 3 not complete
      streamId: null,
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    expect(canNavigateToStep(state, 4)).toBe(false);
  });

  it('should allow non-linear navigation to completed steps', () => {
    const state: GoLiveFormState = {
      currentStep: 4,
      streamDetails: {
        title: 'Test Stream',
        category: 'Islamic Lectures',
      },
      thumbnailData: null,
      rtmpConfig: {
        serverUrl: 'rtmp://example.com/live',
        streamKey: 'test-key-12345',
        streamId: 'stream-123',
      },
      streamId: 'stream-123',
      errors: {},
      isLoading: false,
      isDirty: false,
      draftRecoveryShown: false,
    };

    // Can navigate back to any completed step
    expect(canNavigateToStep(state, 1)).toBe(true);
    expect(canNavigateToStep(state, 2)).toBe(true);
    expect(canNavigateToStep(state, 3)).toBe(true);
    expect(canNavigateToStep(state, 4)).toBe(true);
  });
});
