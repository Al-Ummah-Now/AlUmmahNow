'use client';

/**
 * The caption drafts, jobs, minutes and Quran passage Server Actions (./caption-drafts.ts), settled for the browser (./settle-action.ts):
 * a call that cannot complete resolves to { ok: false, status: 0, error: 'network' } instead of
 * rejecting, so no spinner waits forever. Components and hooks import these, never ./caption-drafts
 * directly (src/lib/api/__tests__/settled-imports.test.ts).
 */
import {
  listCaptionDrafts as listCaptionDraftsAction,
  claimReviewTranscript as claimReviewTranscriptAction,
  getCaptionDraft as getCaptionDraftAction,
  saveCaptionDraft as saveCaptionDraftAction,
  deleteCaptionDraft as deleteCaptionDraftAction,
  publishCaptionDraft as publishCaptionDraftAction,
  listCaptionJobs as listCaptionJobsAction,
  startCaptionJob as startCaptionJobAction,
  cancelCaptionJob as cancelCaptionJobAction,
  startCaptionTranslation as startCaptionTranslationAction,
  getCaptionMinutes as getCaptionMinutesAction,
  getQuranPassage as getQuranPassageAction,
} from './caption-drafts';
import { settleAction } from './settle-action';

export type * from './caption-drafts';

export const listCaptionDrafts = settleAction('listCaptionDrafts', listCaptionDraftsAction);
export const claimReviewTranscript = settleAction('claimReviewTranscript', claimReviewTranscriptAction);
export const getCaptionDraft = settleAction('getCaptionDraft', getCaptionDraftAction);
export const saveCaptionDraft = settleAction('saveCaptionDraft', saveCaptionDraftAction);
export const deleteCaptionDraft = settleAction('deleteCaptionDraft', deleteCaptionDraftAction);
export const publishCaptionDraft = settleAction('publishCaptionDraft', publishCaptionDraftAction);
export const listCaptionJobs = settleAction('listCaptionJobs', listCaptionJobsAction);
export const startCaptionJob = settleAction('startCaptionJob', startCaptionJobAction);
export const cancelCaptionJob = settleAction('cancelCaptionJob', cancelCaptionJobAction);
export const startCaptionTranslation = settleAction('startCaptionTranslation', startCaptionTranslationAction);
export const getCaptionMinutes = settleAction('getCaptionMinutes', getCaptionMinutesAction);
export const getQuranPassage = settleAction('getQuranPassage', getQuranPassageAction);
