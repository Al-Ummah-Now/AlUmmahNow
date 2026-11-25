/** Moderator actions on stored documents (lib/contentModeration.ts). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryR2 } from './r2-fake';
import { applyContentModeration } from '../src/lib/contentModeration';
import { setVideoFormats } from '../src/lib/videoFormat';

const opts = { moderatorId: 'mod-1', at: '2026-11-24T00:00:00.000Z' };

describe('moderator actions', () => {
  for (const action of ['removed', 'warning', 'banned', 'deleted'] as const) {
    it(`${action}: applies to a video, channel or playlist, never to another record of the videos bucket`, async () => {
      const bucket = new MemoryR2();
      for (const id of ['v1', 'livestream:s1', 'index:recent-videos', 'metadata:x']) bucket.data.set(id, JSON.stringify({ id }));
      assert.equal((await applyContentModeration(bucket as never, 'v1', action, opts))!.written, true);
      for (const key of ['livestream:s1', 'index:recent-videos', 'metadata:x']) {
        // A report filed before such a key was refused ends as not found
        assert.equal(await applyContentModeration(bucket as never, key, action, opts), null);
        assert.equal(bucket.data.get(key), JSON.stringify({ id: key }));
      }
      assert.equal(await applyContentModeration(bucket as never, 'none', action, opts), null);
    });
  }

  it('the format tool neither', async () => {
    const bucket = new MemoryR2();
    bucket.data.set('livestream:s1', JSON.stringify({ id: 's1' }));
    assert.deepEqual((await setVideoFormats(bucket as never, async () => undefined, ['livestream:s1'], 'short', 'admin-1')).map((r) => [r.changed, r.error]), [[false, 'Video not found']]);
    assert.equal(bucket.data.get('livestream:s1'), JSON.stringify({ id: 's1' }));
  });
});
