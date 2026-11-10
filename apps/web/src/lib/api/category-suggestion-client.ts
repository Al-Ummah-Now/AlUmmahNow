'use client';

/**
 * AI category suggestions for the upload and edit forms ("AI suggests, uploader
 * confirms"), called from the browser straight to api-videos like the upload
 * steps (lib/api/upload-client.ts): a plain HTTP call survives a deploy, a
 * Server Action id does not. api-videos queues the AI job and answers `pending`
 * (poll) or the stored result; no answer just means "pick by hand".
 */
import { callUploadApi } from '@/lib/api/upload-client';
import type { CategoryFormText, CategorySuggestionView } from '@/lib/category-suggestion/form';

/** POST the form's text; answers at once when this text was classified before, else `pending`. */
export async function requestCategorySuggestion(draftKey: string, text: CategoryFormText, channelId = ''): Promise<CategorySuggestionView | null> {
  const { accessToken: _token, ...res } = await callUploadApi<CategorySuggestionView>(
    { method: 'POST', path: '/api/videos/category-suggestions', channelId, body: { draftKey, ...text } },
    'Category suggestion unavailable',
  );
  return res.success ? res.result ?? null : null;
}

/** Poll the suggestion of a form (draftKey) or of one of the caller's videos (videoId). */
export async function getCategorySuggestion(query: { draftKey: string } | { videoId: string }, channelId = ''): Promise<CategorySuggestionView | null> {
  const params = new URLSearchParams('draftKey' in query ? { draftKey: query.draftKey } : { videoId: query.videoId });
  const { accessToken: _token, ...res } = await callUploadApi<CategorySuggestionView>(
    { method: 'GET', path: `/api/videos/category-suggestions?${params.toString()}`, channelId, retries: 1 },
    'Category suggestion unavailable',
  );
  return res.success ? res.result ?? null : null;
}

/** Save a video's category as the uploader's choice (null clears it). Works while the file is still uploading. */
export async function saveVideoCategory(videoId: string, category: string | null, channelId: string): Promise<boolean> {
  const { accessToken: _token, ...res } = await callUploadApi<unknown>(
    { method: 'PUT', path: `/api/videos/${encodeURIComponent(videoId)}`, channelId, body: { category }, retries: 2 },
    'Category not saved',
  );
  return res.success;
}
