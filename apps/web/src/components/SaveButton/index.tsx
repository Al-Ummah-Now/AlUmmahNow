'use client';

import React, { useState, useEffect } from 'react';

export type SaveButtonState = 'idle' | 'saving' | 'success' | 'error';

export interface SaveButtonProps {
  /** Current state of the button */
  state?: SaveButtonState;
  /** Click handler for save action */
  onClick?: () => void | Promise<void>;
  /** Text to display in idle state */
  idleText?: string;
  /** Text to display in saving state */
  savingText?: string;
  /** Text to display in success state */
  successText?: string;
  /** Text to display in error state */
  errorText?: string;
  /** Error message to display below button */
  errorMessage?: string;
  /** Custom className for additional styling */
  className?: string;
  /** Duration in ms to show success/error state before returning to idle */
  feedbackDuration?: number;
  /** Whether button is disabled */
  disabled?: boolean;
  /** Button type attribute */
  type?: 'button' | 'submit' | 'reset';
  /** Full width button */
  fullWidth?: boolean;
}

/**
 * Reusable save button with loading, success, and error states
 *
 * @example
 * ```tsx
 * const [saveState, setSaveState] = useState<SaveButtonState>('idle');
 *
 * const handleSave = async () => {
 *   setSaveState('saving');
 *   try {
 *     await saveData();
 *     setSaveState('success');
 *   } catch (error) {
 *     setSaveState('error');
 *   }
 * };
 *
 * <SaveButton
 *   state={saveState}
 *   onClick={handleSave}
 *   idleText="Save Profile"
 *   errorMessage={errorMsg}
 * />
 * ```
 */
export const SaveButton: React.FC<SaveButtonProps> = ({
  state = 'idle',
  onClick,
  idleText = 'Save',
  savingText = 'Saving...',
  successText = 'Saved!',
  errorText = 'Error',
  errorMessage,
  className = '',
  feedbackDuration = 3000,
  disabled = false,
  type = 'button',
  fullWidth = false,
}) => {
  const [internalState, setInternalState] = useState<SaveButtonState>(state);

  // Sync internal state with prop state
  useEffect(() => {
    setInternalState(state);
  }, [state]);

  // Auto-reset to idle after success/error
  useEffect(() => {
    if (internalState === 'success' || internalState === 'error') {
      const timer = setTimeout(() => {
        setInternalState('idle');
      }, feedbackDuration);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [internalState, feedbackDuration]);

  const handleClick = async (): Promise<void> => {
    if (disabled || internalState === 'saving' || !onClick) return;

    setInternalState('saving');
    try {
      await onClick();
      setInternalState('success');
    } catch (error) {
      setInternalState('error');
    }
  };

  const getButtonText = () => {
    switch (internalState) {
      case 'saving':
        return savingText;
      case 'success':
        return successText;
      case 'error':
        return errorText;
      default:
        return idleText;
    }
  };

  const getButtonStyles = () => {
    const baseStyles = 'px-6 py-3 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2';
    const widthStyles = fullWidth ? 'w-full' : '';

    switch (internalState) {
      case 'saving':
        return `${baseStyles} ${widthStyles} bg-gray-400 dark:bg-gray-600 text-white cursor-not-allowed`;
      case 'success':
        return `${baseStyles} ${widthStyles} bg-green-500 dark:bg-green-600 text-white`;
      case 'error':
        return `${baseStyles} ${widthStyles} bg-red-500 dark:bg-red-600 text-white`;
      default:
        return `${baseStyles} ${widthStyles} bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`;
    }
  };

  const getIcon = () => {
    switch (internalState) {
      case 'saving':
        return (
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
        );
      case 'success':
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'error':
        return (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <button
        type={type}
        onClick={handleClick}
        disabled={disabled || internalState === 'saving'}
        className={getButtonStyles()}
      >
        {getIcon()}
        <span>{getButtonText()}</span>
      </button>

      {internalState === 'error' && errorMessage && (
        <div className="text-red-500 dark:text-red-400 text-sm text-center">
          {errorMessage}
        </div>
      )}
    </div>
  );
};

export default SaveButton;
