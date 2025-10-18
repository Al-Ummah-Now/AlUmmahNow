/**
 * Resume Playback Prompt Component (RTL Variant)
 *
 * RTL (Right-to-Left) variant for Arabic language support.
 * Mirrors layout and adjusts styling for RTL reading direction.
 *
 * This is a wrapper component that ensures proper RTL behavior
 * while maintaining the same functionality as the LTR version.
 *
 * Issue #58: Resume Playback UI
 */

'use client';

import { ResumePrompt as LTRResumePrompt } from '../../ResumePrompt';
import type { ResumePromptProps } from '../../ResumePrompt';

/**
 * RTL Resume Prompt Component
 *
 * This component is identical to the LTR version but ensures
 * the lang prop is set to 'ar' for Arabic translations and
 * RTL layout is properly applied via the dir attribute.
 */
export function ResumePrompt(props: Omit<ResumePromptProps, 'lang'>): JSX.Element {
  return <LTRResumePrompt {...props} lang="ar" />;
}

export default ResumePrompt;
