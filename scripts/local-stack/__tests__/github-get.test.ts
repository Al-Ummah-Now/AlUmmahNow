/** GitHub's own trouble is waited out when the stack's bundles are downloaded; anything else fails at once. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { githubGet, HttpStatusError, retryAfterMs, RETRY_MS, type GetDeps } from '../github-get.ts';
import { bundleRelease, download } from '../fetch-auth.ts';
import { releasedRefs } from '../resolve-refs.ts';

const URL_ = 'https://api.github.com/repos/o/r/releases/assets/1';
type Answer = () => Response;
const status = (code: number, headers: Record<string, string> = {}): Answer => () => new Response(code === 204 ? null : 'no', { status: code, headers });
const body = (text: string): Answer => () => new Response(text, { status: 200 });
const down: Answer = () => {
  throw new TypeError('fetch failed');
};
/** A body that is cut off half way. */
const cut: Answer = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('ha')); c.error(new Error('terminated')); } }), { status: 200 });

/** Answers in turn (the last one from then on), on a clock that moves only when somebody sleeps. */
function fake(...answers: Answer[]) {
  let t = 1_000_000;
  const sleeps: number[] = [];
  const sent: { url: string; headers: Record<string, string> }[] = [];
  const deps: GetDeps = {
    fetch: (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string> });
      return answers[Math.min(sent.length, answers.length) - 1]();
    }) as typeof fetch,
    now: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    random: () => 1,
    log: () => {},
  };
  return { deps, sleeps, sent, waited: () => t - 1_000_000 };
}
const get = (deps: GetDeps) => download(URL_, 'tok', deps).then((b) => b.toString());

describe('a download from GitHub', () => {
  for (const [name, trouble] of [['503', status(503)], ['504', status(504)], ['500', status(500)], ['429', status(429)], ['a network error', down], ['a body cut off', cut]] as const) {
    it(`goes on after ${name}`, async () => {
      const f = fake(trouble, trouble, body('bundle'));
      assert.equal(await get(f.deps), 'bundle');
      assert.deepEqual(f.sleeps, [2_000, 4_000]);
      assert.ok(f.sent.every((s) => s.headers.Authorization === 'Bearer tok' && s.headers.Accept === 'application/octet-stream'));
    });
  }

  it('pauses longer each time, half of it random, and stops within three minutes', async () => {
    const f = fake(status(503));
    await assert.rejects(get(f.deps), (e: Error) => e instanceof HttpStatusError && e.status === 503 && /answered 503.*gave up after \d+ tries in \d+ s/.test(e.message));
    assert.deepEqual(f.sleeps.slice(0, 6), [2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    assert.ok(f.waited() <= RETRY_MS && f.waited() > RETRY_MS - 31_000, String(f.waited()));
    const low = fake(status(503), body('x'));
    low.deps.random = () => 0;
    await get(low.deps);
    assert.deepEqual(low.sleeps, [1_000]);
    await assert.rejects(get(fake(down).deps), /GET .*releases\/assets\/1 failed: fetch failed; gave up after/);
  });

  it('waits what Retry-After asks, and not at all when that is too long', async () => {
    const f = fake(status(429, { 'retry-after': '17' }), status(503, { 'retry-after': '0' }), body('x'));
    assert.equal(await get(f.deps), 'x');
    assert.deepEqual(f.sleeps, [17_000, 0]);
    const long = fake(status(429, { 'retry-after': '3600' }), body('x'));
    await assert.rejects(get(long.deps), /answered 429; gave up after 1 try in 0 s \(Retry-After 3600 s\)/);
    assert.deepEqual([long.sleeps, long.sent.length], [[], 1]);
    assert.equal(retryAfterMs('Wed, 25 Nov 2026 12:00:30 GMT', Date.parse('2026-11-25T12:00:00Z')), 30_000);
    assert.equal(retryAfterMs('Wed, 25 Nov 2026 11:00:00 GMT', Date.parse('2026-11-25T12:00:00Z')), 0);
    for (const none of [null, '', ' ', 'soon']) assert.equal(retryAfterMs(none, 0), null);
  });

  it('any other status fails at once, also between tries', async () => {
    for (const code of [400, 401, 403, 404, 410, 422]) {
      const f = fake(status(code, { 'retry-after': '1' }), body('x'));
      await assert.rejects(get(f.deps), (e: Error) => e instanceof HttpStatusError && e.status === code);
      assert.deepEqual([f.sent.length, f.sleeps.length], [1, 0], String(code));
    }
    const later = fake(status(503), status(404), body('x'));
    await assert.rejects(get(later.deps), /answered 404 \(try 2\)/);
    assert.equal(later.sent.length, 2);
  });

  it('asks once when it works', async () => {
    const f = fake(body('bundle'));
    assert.equal(await githubGet(URL_, { accept: 'a/b', read: (r) => r.text() }, f.deps), 'bundle');
    assert.deepEqual([f.sent.length, f.sleeps.length, f.sent[0].headers.Authorization], [1, 0, undefined]);
  });
});

describe('finding the bundle', () => {
  it('only a 404 means that there is none: trouble is waited out or is an error, never an older bundle', async () => {
    const ok = JSON.stringify({ assets: [{ name: 'local-stack.tar.gz', url: URL_ }] });
    assert.equal((await bundleRelease('o/r', 'local-stack-x', 'tok', fake(status(503), body(ok)).deps))!.assets[0].url, URL_);
    assert.equal(await bundleRelease('o/r', 'local-stack-x', 'tok', fake(status(404)).deps), null);
    assert.equal(await bundleRelease('o/r', 'local-stack-x', 'tok', fake(status(502), status(404)).deps), null);
    await assert.rejects(bundleRelease('o/r', 'local-stack-x', 'tok', fake(status(403)).deps), /answered 403/);
    await assert.rejects(bundleRelease('o/r', 'local-stack-x', 'tok', fake(status(503)).deps), /answered 503.*gave up/);
  });

  it('and the released commits are read the same way', async () => {
    const runs = JSON.stringify({ workflow_runs: [{ head_sha: 'a'.repeat(40), head_branch: 'main', event: 'push', conclusion: 'success' }] });
    const f = fake(status(504), body(runs));
    assert.deepEqual(await releasedRefs('auth', f.deps), [{ sha: 'a'.repeat(40), ref: 'main' }]);
    assert.equal(f.sleeps.length, 1);
  });
});
