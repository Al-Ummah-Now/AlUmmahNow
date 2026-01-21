/**
 * GoLiveWizard Component (RTL - Arabic)
 * Task 2.1: GoLiveForm Wizard Structure (4 Steps)
 *
 * RTL variant of the GoLiveWizard component for Arabic language support.
 * For this foundational task, the RTL variant uses the same component
 * with RTL-aware styling handled by the main component's dir attribute.
 */

'use client';

import { GoLiveWizard as GoLiveWizardLTR } from '../index';

/**
 * RTL variant simply exports the LTR component
 * The main component handles RTL via the useLanguage hook's isRTL value
 */
export const GoLiveWizard = GoLiveWizardLTR;

GoLiveWizard.displayName = 'GoLiveWizard (RTL)';

export default GoLiveWizard;
