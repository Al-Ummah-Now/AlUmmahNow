'use client';

/**
 * The translation Server Actions (./translate.ts), settled for the browser (./settle-action.ts):
 * a call that cannot complete resolves to { ok: false, status: 0, error: 'network' } instead of
 * rejecting, so no spinner waits forever. Components and hooks import these, never ./translate
 * directly (src/lib/api/__tests__/settled-imports.test.ts).
 */
import {
  translateTexts as translateTextsAction,
  getTranslatedMetadata as getTranslatedMetadataAction,
  getChannelTranslationSettings as getChannelTranslationSettingsAction,
  setChannelTranslationSettings as setChannelTranslationSettingsAction,
  listQuranEditions as listQuranEditionsAction,
  getChannelQuranEditions as getChannelQuranEditionsAction,
  setChannelQuranEdition as setChannelQuranEditionAction,
  resetChannelQuranEdition as resetChannelQuranEditionAction,
} from './translate';
import { settleAction } from './settle-action';

export type * from './translate';

export const translateTexts = settleAction('translateTexts', translateTextsAction);
export const getTranslatedMetadata = settleAction('getTranslatedMetadata', getTranslatedMetadataAction);
export const getChannelTranslationSettings = settleAction('getChannelTranslationSettings', getChannelTranslationSettingsAction);
export const setChannelTranslationSettings = settleAction('setChannelTranslationSettings', setChannelTranslationSettingsAction);
export const listQuranEditions = settleAction('listQuranEditions', listQuranEditionsAction);
export const getChannelQuranEditions = settleAction('getChannelQuranEditions', getChannelQuranEditionsAction);
export const setChannelQuranEdition = settleAction('setChannelQuranEdition', setChannelQuranEditionAction);
export const resetChannelQuranEdition = settleAction('resetChannelQuranEdition', resetChannelQuranEditionAction);
