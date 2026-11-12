import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyPurgeGrace, failing, parseArgs, readResources, report, splitByAccount, type Leftovers } from '../run-leftovers.ts';

describe('run leftovers (deployed)', () => {
  it('only QA or stage, only a run id marker', () => {
    assert.equal(parseArgs(['--env', 'qa', '--marker', '123-1']).marker, '123-1');
    assert.throws(() => parseArgs(['--env', 'production', '--marker', '123-1']));
    assert.throws(() => parseArgs(['--env', 'qa', '--marker', "x' OR 1=1"]));
  });
  it('counts accounts, content and tiers; queued purges are reported, not counted', () => {
    const lines = report('123-1', { accounts: ['e2e+123-1-a@e2e.alummahnow.net'], content: [], pendingPurge: [{ kind: 'video', id: 'v1' }], erasePending: [], tiers: [], bunnyVideos: [], bunnyCollections: [], r2Objects: [] });
    assert.match(lines[0], /: 1 \(\+1 deleted, purge queued\)/);
  });
  it('reads recorded resources', () => {
    assert.deepEqual(readResources('video 0c1e1b5e-1111-4222-8333-444455556666\nchannel ch_123456\nbad\nvideo x'), { videos: ['0c1e1b5e-1111-4222-8333-444455556666'], channels: ['ch_123456'] });
  });
  it('allows Bunny videos and R2 objects of a video whose purge is queued, nothing else', () => {
    const l: Leftovers = {
      accounts: [], content: [], pendingPurge: [], erasePending: [], tiers: [], bunnyCollections: [],
      bunnyVideos: [{ guid: 'aaa', title: 'E2E 123-1', status: 4 }, { guid: 'bbb', title: 'E2E 123-1', status: 4 }],
      r2Objects: [{ bucket: 'media-qa', key: 'pub/aaa/1/master.m3u8' }, { bucket: 'videos-qa', key: 'thumbnails/bbb/custom.jpg' }],
    };
    assert.equal(applyPurgeGrace(l, new Set(['aaa'])).allowed, 2);
    assert.equal(failing(l), 2);
  });
  it('content and tiers of a deleted run account are erase pending (the sweep erases them); a live account\'s fail', () => {
    const l: Leftovers = {
      accounts: ['e2e+123-1-live@e2e.alummahnow.net'], pendingPurge: [], erasePending: [], bunnyVideos: [], bunnyCollections: [], r2Objects: [],
      content: [
        { kind: 'profile', id: 'usr_gone', owner: 'usr_gone', state: 'live' },
        { kind: 'channel', id: 'ch-gone', owner: 'usr_gone', state: 'live' },
        { kind: 'channel', id: 'ch-live', owner: 'usr_live', state: 'live' },
      ],
      tiers: ['usr_gone', 'usr_live'],
    };
    splitByAccount(l, new Set(['usr_live']));
    assert.deepEqual(l.content.map((c) => c.id), ['ch-live']);
    assert.deepEqual(l.tiers, ['usr_live']);
    assert.deepEqual(l.erasePending.map((e) => `${e.kind}:${e.id}`), ['profile:usr_gone', 'channel:ch-gone', 'creator tier:usr_gone']);
    assert.equal(failing(l), 3, 'the live account, its channel and its tier');
    assert.match(report('123-1', l)[0], /: 3 \(\+3 of deleted run accounts, erase pending\)/);
  });
});
