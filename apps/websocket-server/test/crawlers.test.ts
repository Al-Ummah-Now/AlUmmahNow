import { test } from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index';

test('realtime robots.txt disallows everything', async () => {
  const res = await app.request('/robots.txt');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'User-agent: *\nDisallow: /\n');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

test('every realtime response is noindex', async () => {
  const res = await app.request('/');
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  const missing = await app.request('/no-such-route');
  assert.equal(missing.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});
