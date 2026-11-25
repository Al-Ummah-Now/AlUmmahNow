import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PROBE_RETRIES, applyPurgeGrace, failing, parseArgs, probeFetch, readResources, report, splitByAccount, type Leftovers } from '../run-leftovers.ts';

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
  it('retries the probe while a fresh workers.dev URL answers 404 or 5xx, then takes the real answer', async () => {
    const answers = [404, 404, 503, 200];
    const calls: string[] = [];
    const sleeps: number[] = [];
    const res = await probeFetch('https://probe.example/r2', { method: 'POST' }, {
      fetch: (async (url: string) => { calls.push(url); return new Response('{}', { status: answers.shift() ?? 200 }); }) as typeof fetch,
      sleep: async (ms) => void sleeps.push(ms),
    });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 4);
    assert.deepEqual(sleeps, [5000, 5000, 5000]);
  });
  it('gives up after a minute of 404 and hands the last answer back; a real error is not retried', async () => {
    let n = 0;
    const always404 = await probeFetch('https://probe.example/r2', {}, { fetch: (async () => { n++; return new Response('', { status: 404 }); }) as typeof fetch, sleep: async () => undefined });
    assert.equal(always404.status, 404);
    assert.equal(n, PROBE_RETRIES + 1);
    let m = 0;
    const unauthorized = await probeFetch('https://probe.example/r2', {}, { fetch: (async () => { m++; return new Response('', { status: 401 }); }) as typeof fetch, sleep: async () => undefined });
    assert.equal(unauthorized.status, 401);
    assert.equal(m, 1);
  });
});
