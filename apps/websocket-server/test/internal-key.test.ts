/**
 * /broadcast pushes any message to any connected client, so it needs INTERNAL_API_KEY (security audit):
 * a missing, wrong, truncated or padded key is a 401, and the comparison is constant time
 * (constantTimeEqual in shared-types); a missing binding never matches an empty header.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index';
import { constantTimeEqual } from '@al-ummah/shared-types';

const KEY = 'k'.repeat(40);
const post = (headers: Record<string, string>, env: Record<string, unknown> = { INTERNAL_API_KEY: KEY }) =>
  app.request('/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{"items":[]}' }, env as never);

test('/broadcast refuses a missing, wrong, truncated or padded key', async () => {
  for (const headers of [{}, { 'X-API-Key': '' }, { 'X-API-Key': 'wrong' }, { 'X-API-Key': KEY.slice(0, -1) }, { 'X-API-Key': `${KEY}x` }]) {
    assert.equal((await post(headers)).status, 401, JSON.stringify(headers));
  }
});

test('/broadcast refuses everything when INTERNAL_API_KEY is not bound', async () => {
  assert.equal((await post({ 'X-API-Key': '' }, {})).status, 401);
  assert.equal((await post({ 'X-API-Key': 'anything' }, {})).status, 401);
  assert.equal((await post({ 'X-API-Key': '' }, { INTERNAL_API_KEY: { get: async () => '' } })).status, 401);
});

test('/broadcast gets past the key check with the right key (string or Secrets Store binding)', async () => {
  assert.notEqual((await post({ 'X-API-Key': KEY })).status, 401);
  assert.notEqual((await post({ 'X-API-Key': KEY }, { INTERNAL_API_KEY: { get: async () => KEY } })).status, 401);
});

test('constantTimeEqual', () => {
  assert.equal(constantTimeEqual(KEY, KEY), true);
  assert.equal(constantTimeEqual('', ''), false, 'an empty expected value never matches');
  assert.equal(constantTimeEqual(undefined, KEY), false);
  assert.equal(constantTimeEqual(null, KEY), false);
  assert.equal(constantTimeEqual(KEY, undefined), false);
  assert.equal(constantTimeEqual(KEY.slice(0, -1), KEY), false);
  assert.equal(constantTimeEqual(`${KEY}x`, KEY), false);
  assert.equal(constantTimeEqual('é', 'é'), false);
});

test('/broadcast rejects malformed authenticated input before it reaches the directory', async () => {
  const env = { INTERNAL_API_KEY: KEY } as never;
  for (const body of [
    '{',
    'null',
    JSON.stringify({ channel: 42, message: { type: 'update' } }),
    JSON.stringify({ channel: 'video:', message: { type: 'update' } }),
    JSON.stringify({ items: [{ channel: 'video:valid' }] }),
  ]) {
    const res = await app.request('/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
      body,
    }, env);
    assert.equal(res.status, 400);
  }
});
