/**
 * useBatchCategories: a row's pick is saved onto its video; a new batch
 * default saves only rows nobody picked; rows without a category read the
 * video's AI suggestion by GET (the AI request was queued at video creation).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { VideoCategory, type UploadQueueItem } from '@al-ummah/shared-types';
import { useBatchCategories, ROW_POLL_MS } from '@/hooks/useBatchCategories';

const getCategorySuggestion = jest.fn();
const saveVideoCategory = jest.fn();
const requestCategorySuggestion = jest.fn();
jest.mock('@/lib/api/category-suggestion-client', () => ({
  getCategorySuggestion: (...args: unknown[]) => getCategorySuggestion(...args),
  saveVideoCategory: (...args: unknown[]) => saveVideoCategory(...args),
  requestCategorySuggestion: (...args: unknown[]) => requestCategorySuggestion(...args),
}));

const file = (videoId: string) => ({ id: `f-${videoId}`, videoId, status: 'pending', metadata: { title: videoId } } as unknown as UploadQueueItem);

beforeEach(() => {
  jest.useFakeTimers();
  getCategorySuggestion.mockReset();
  saveVideoCategory.mockReset().mockResolvedValue(true);
  requestCategorySuggestion.mockReset();
});
afterEach(() => jest.useRealTimers());

it('picks save onto the video; a new default saves only rows nobody picked', async () => {
  const files = [file('v1'), file('v2')];
  const { result, rerender } = renderHook(({ d }) => useBatchCategories(files, d, 'ch1'), { initialProps: { d: VideoCategory.FIQH as VideoCategory | undefined } });
  await waitFor(() => expect(Object.keys(result.current.rows)).toEqual(['v1', 'v2']));
  expect(result.current.rows.v1.category).toBe(VideoCategory.FIQH);

  act(() => result.current.pick('v2', VideoCategory.AQEEDAH));
  await waitFor(() => expect(result.current.rows.v2.save).toBe('saved'));
  expect(saveVideoCategory).toHaveBeenCalledWith('v2', VideoCategory.AQEEDAH, 'ch1');

  saveVideoCategory.mockClear();
  rerender({ d: VideoCategory.RAMADAN });
  await waitFor(() => expect(result.current.rows.v1.save).toBe('saved'));
  expect(saveVideoCategory.mock.calls).toEqual([['v1', VideoCategory.RAMADAN, 'ch1']]);
  expect(result.current.rows.v2.category).toBe(VideoCategory.AQEEDAH);
  // Rows with the default never poll for a suggestion
  await act(async () => { jest.advanceTimersByTime(ROW_POLL_MS * 2); });
  expect(getCategorySuggestion).not.toHaveBeenCalled();
});

it('a row without a default shows the AI suggestion once it is ready, without asking the AI again', async () => {
  getCategorySuggestion
    .mockResolvedValueOnce({ status: 'pending', preselect: null, lowConfidence: false, category: null, confidence: null, options: [], model: null, outcome: 'pending' })
    .mockResolvedValueOnce({ status: 'done', preselect: 'fiqh', lowConfidence: false, category: 'fiqh', confidence: 0.95, options: [{ category: 'fiqh', confidence: 0.95 }], model: 'm', outcome: 'pending' });
  const files = [file('v1')];
  const { result } = renderHook(() => useBatchCategories(files, undefined, 'ch1'));
  await waitFor(() => expect(result.current.rows.v1).toBeDefined());
  await act(async () => { jest.advanceTimersByTime(ROW_POLL_MS); });
  await waitFor(() => expect(getCategorySuggestion).toHaveBeenCalledTimes(1));
  await act(async () => { jest.advanceTimersByTime(ROW_POLL_MS); });
  await waitFor(() => expect(result.current.rows.v1).toMatchObject({ category: VideoCategory.FIQH, aiApplied: true }));
  expect(getCategorySuggestion).toHaveBeenCalledWith({ videoId: 'v1' }, 'ch1');
  expect(requestCategorySuggestion).not.toHaveBeenCalled();
  expect(saveVideoCategory).not.toHaveBeenCalled();
});
