import { buildBulkRequest, emptyBulkForm, fieldProblem, isEmptyRequest, readyFields, type BulkFormState } from '../form';
import { failureReasons, groupByChannel, newOperationId, runInBatches } from '../runner';

describe('bulk form', () => {
  const subjects = [{ id: 'a', title: { en: 'A' } }, { id: 'b', title: { en: 'B' } }];

  it('sends only ticked, ready fields', () => {
    const form: BulkFormState = { ...emptyBulkForm('en'), category: 'fiqh', language: 'ar', ticked: ['language'] };
    expect(buildBulkRequest(form, subjects)).toEqual({ changes: { language: 'ar' }, titles: {}, publishAt: {} });
    expect(isEmptyRequest(buildBulkRequest({ ...form, ticked: [] }, subjects))).toBe(true);
  });

  it('knows when a ticked field has nothing to apply', () => {
    const form = { ...emptyBulkForm('en'), ticked: ['category', 'tags', 'playlists'] as BulkFormState['ticked'] };
    expect(fieldProblem(form, 'category')).toBe('category_empty');
    expect(readyFields(form)).toEqual([]);
    // Replacing tags with nothing clears them on purpose
    expect(readyFields({ ...form, tagsMode: 'replace' })).toEqual(['tags']);
  });

  it('maps tag modes and description edits', () => {
    const base = emptyBulkForm('en');
    const form: BulkFormState = {
      ...base,
      ticked: ['tags', 'description', 'visibility', 'playlists'],
      tagsMode: 'remove',
      tags: 'a, b',
      visibility: 'public',
      playlistsAdd: ['p1'],
      description: { en: { enabled: true, mode: 'prepend', text: 'Intro' }, ar: { enabled: true, mode: 'replace', text: '' } },
    };
    expect(buildBulkRequest(form, subjects).changes).toEqual({
      removeTags: ['a', 'b'],
      isPublic: true,
      addPlaylists: ['p1'],
      description: { en: { mode: 'prepend', text: 'Intro' }, ar: { mode: 'replace', text: '' } },
    });
  });
});

describe('bulk runner', () => {
  it('batches per channel, keeps going after a failed batch and reports progress', async () => {
    const ids = Array.from({ length: 7 }, (_, i) => `v${i}`);
    const groups = groupByChannel(ids, (id) => (Number(id.slice(1)) < 5 ? 'c1' : 'c2'));
    expect(groups.map((g) => [g.channelId, g.ids.length])).toEqual([['c1', 5], ['c2', 2]]);
    const progress: number[] = [];
    const send = jest.fn(async (batch: string[], channelId: string) => {
      if (channelId === 'c2') throw new Error('network');
      return { success: true, results: batch.map((videoId) => ({ videoId, success: videoId !== 'v1', code: videoId === 'v1' ? 'forbidden' : undefined })) };
    });
    const result = await runInBatches(groups, send, { batchSize: 3, onProgress: (p) => progress.push(p.done) });
    expect(send).toHaveBeenCalledTimes(3);
    expect(progress).toEqual([3, 5, 7]);
    expect([result.succeeded, result.failed]).toEqual([4, 3]);
    expect(failureReasons(result.outcomes.values())).toEqual([{ code: 'failed', count: 2 }, { code: 'forbidden', count: 1 }]);
  });

  it('stops between batches when cancelled', async () => {
    const controller = new AbortController();
    const send = jest.fn(async (batch: string[]) => {
      controller.abort();
      return { success: true, results: batch.map((videoId) => ({ videoId, success: true })) };
    });
    const result = await runInBatches([{ channelId: 'c', ids: ['a', 'b', 'c'] }], send, { batchSize: 1, signal: controller.signal });
    expect(result).toMatchObject({ cancelled: true, done: 1, total: 3 });
  });

  it('makes operation ids the API accepts', () => {
    expect(newOperationId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});
