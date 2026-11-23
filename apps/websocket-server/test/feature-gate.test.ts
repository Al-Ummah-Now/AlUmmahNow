/** Realtime feature gate (FEAT-2, wiki AUN-FEATURES §5.1): no mapping → no read; a mapped off feature is named. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CHANNEL_FEATURES, channelFeatureOff } from '../src/lib/feature-gate';

describe('channelFeatureOff', () => {
  it('version 1 maps no channel and reads nothing', async () => {
    assert.deepEqual(CHANNEL_FEATURES, []);
    const db = { prepare() { throw new Error('must not read'); } };
    assert.equal(await channelFeatureOff({ SEARCH_DB: db }, 'live:abc'), null);
  });

  it('names a mapped feature that is off, and lets an on one through', async () => {
    const map = [{ prefix: 'live:', key: 'live' as const }];
    assert.equal(await channelFeatureOff({ FEATURES_FORCE_OFF: 'live' }, 'live:abc', map), 'live');
    assert.equal(await channelFeatureOff({}, 'live:abc', map), null);
    assert.equal(await channelFeatureOff({ FEATURES_FORCE_OFF: 'live' }, 'video:abc', map), null);
  });
});
