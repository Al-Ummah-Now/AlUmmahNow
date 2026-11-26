import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';

const requireNext = createRequire(import.meta.url);
const component = 'client/components/render-tree.js';
const url = new URL('https://admin.test/moderation');
// Synthetic lifecycle event for the dependency regression test. It never opens a prompt.
// eslint-disable-next-line no-restricted-syntax
const departure = 'beforeunload';

// Exercise the patched Next request task with the same ordering as WebKit.
// Run both builds because Next can bundle either one.
for (const dist of ['dist', 'dist/esm']) {
  describe(`Next refresh navigation (${dist})`, () => {
    function start(refresh = true) {
      const source = readFileSync(requireNext.resolve(`next/${dist}/${component}`), 'utf8');
      const task = source.match(/async function fetchMissingDynamicData\([\s\S]+?\n}/)?.[0];
      assert.ok(task, 'Next moved its refresh request task');
      const policy = { Default: 0, RefreshAll: 3 };
      const page = new EventTarget();
      let requestSignal: AbortSignal | undefined;
      let failRequest: (reason: unknown) => void = () => {};
      const fetchServerResponse = (_url: URL, options: { signal?: AbortSignal }) => {
        requestSignal = options.signal;
        return new Promise<string>((_resolve, reject) => { failRequest = reject; });
      };
      const request = runInNewContext(
        `(${task})(null, null, null, url, null, freshness, null, null, null, undefined)`,
        {
          window: page, location: { origin: url.origin }, url, URL, AbortController,
          FreshnessPolicy: policy, freshness: refresh ? policy.RefreshAll : policy.Default,
          fetchServerResponse, _fetchserverresponse: { fetchServerResponse },
        },
      ) as Promise<{ exitStatus: number }>;
      const fail = () => failRequest(new TypeError('Load failed'));
      return { request, requestSignal, page, fail };
    }

    it('cancels an in-flight refresh before pagehide and suppresses the hard fallback', async () => {
      const { request, page, requestSignal, fail } = start();
      const navigation = new Event(departure, { cancelable: true });
      assert.equal(page.dispatchEvent(navigation), true);
      assert.equal(requestSignal?.aborted, true);
      fail();
      assert.equal((await request).exitStatus, -1);
    });

    it('preserves the hard fallback on an ordinary network failure and cleans up the listener', async () => {
      const { request, page, requestSignal, fail } = start();
      fail();
      assert.equal((await request).exitStatus, 2);
      page.dispatchEvent(new Event(departure));
      assert.equal(requestSignal?.aborted, false);
    });

    it('does not cancel regular navigation requests', async () => {
      const { request, page, requestSignal, fail } = start(false);
      page.dispatchEvent(new Event(departure));
      assert.equal(requestSignal, undefined);
      fail();
      assert.equal((await request).exitStatus, 2);
    });
  });
}
