/**
 * Batch uploader categories: a batch-wide default plus a picker per row.
 *
 * Each batch video is created when its file is queued, titled after the file,
 * so its text is final from the start: api-videos queues one AI suggestion per
 * video that has no category (same queue, budget and text-hash dedupe as the
 * single form). Rows only read that suggestion; they never ask the AI again.
 */
import type { VideoCategory } from '@al-ummah/shared-types';
import { applySuggestion, pickCategory, type CategoryFormState, type CategorySuggestionView } from './form';

export type RowSave = 'idle' | 'saving' | 'saved' | 'failed';

export interface BatchRowCategory extends CategoryFormState {
  /** The row holds the batch default (it follows later default changes until picked by hand) */
  fromDefault: boolean;
  suggestion: CategorySuggestionView | null;
  /** GET polls spent waiting for the AI's answer */
  polls: number;
  save: RowSave;
}

/** Polls per row before giving up (about 2 minutes at the hook's interval): no answer just means "pick by hand". */
export const MAX_ROW_POLLS = 30;

/** A row as its video was created: with the batch default, or empty for the AI to suggest. */
export function newBatchRow(batchDefault: VideoCategory | undefined): BatchRowCategory {
  return { category: batchDefault, aiApplied: false, touched: false, fromDefault: !!batchDefault, suggestion: null, polls: 0, save: 'idle' };
}

/** The row waits for the AI: created without a category, nobody picked one, answer not in yet. */
export function waitsForSuggestion(row: BatchRowCategory): boolean {
  if (row.touched || row.fromDefault || row.polls >= MAX_ROW_POLLS) return false;
  return !row.suggestion || row.suggestion.status === 'pending';
}

/** The AI's answer arrived (or is still pending). The AI already wrote a confident category onto the video. */
export function withSuggestion(row: BatchRowCategory, suggestion: CategorySuggestionView | null): BatchRowCategory {
  const next = applySuggestion(row, suggestion);
  return { ...row, ...next, suggestion: suggestion ?? row.suggestion, polls: row.polls + 1 };
}

/** The uploader picked (or cleared) this row's category: it is theirs from now on. */
export function pickRow(row: BatchRowCategory, category: VideoCategory | undefined): BatchRowCategory {
  return { ...row, ...pickCategory(category), fromDefault: false, save: 'saving' };
}

/**
 * The batch default changed. Rows nobody picked by hand take the new default
 * (it is the uploader's choice, so it also replaces an AI suggestion); rows
 * picked by hand keep theirs. Clearing the default leaves rows as they are.
 * Returns the row and whether its video must be saved.
 */
export function applyBatchDefault(row: BatchRowCategory, batchDefault: VideoCategory | undefined): { row: BatchRowCategory; save: boolean } {
  if (row.touched || !batchDefault || row.category === batchDefault && !row.aiApplied) return { row, save: false };
  return { row: { ...row, category: batchDefault, aiApplied: false, fromDefault: true, save: 'saving' }, save: true };
}
