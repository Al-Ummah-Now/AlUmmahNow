/** Live admin hints from admin-api (docs/admin/LIVE_OPS.md Part B). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorLiveEvents, publishAdminLiveInBackground } from '../src/lib/admin-live';

const group = (id: string, test = 0) => ({ id, test, kind: 'http', app: 'api-videos', environment: 'qa' }) as never;

test('an ingest announces each new real group and then asks pages to refresh', () => {
  const events = errorLiveEvents({ accepted: 3, created: [group('g1'), group('g2', 1)], reopened: [] }, 0);
  assert.deepEqual(events, [
    { kind: 'error', key: 'group:g1', groupId: 'g1', isNew: true, errorKind: 'http', app: 'api-videos', environment: 'qa' },
    { kind: 'changed', key: 'changed' },
  ]);
});

test('a batch that changed nothing sends nothing; resolved items alone still refresh', () => {
  assert.deepEqual(errorLiveEvents({ accepted: 0, created: [], reopened: [] }, 0), []);
  assert.deepEqual(errorLiveEvents({ accepted: 0, created: [], reopened: [] }, 2), [{ kind: 'changed', key: 'changed' }]);
});

test('a request publishes after its response, inside waitUntil, and without an execution context too', async () => {
  const bodies: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response('{}');
  }) as typeof fetch;
  try {
    const waited: Promise<unknown>[] = [];
    const env = { WEBSOCKET_URL: 'https://realtime.test', INTERNAL_API_KEY: 'k' };
    publishAdminLiveInBackground({ env, executionCtx: { waitUntil: (p) => waited.push(p) } }, 'moderation', { kind: 'changed', key: 'contact' });
    publishAdminLiveInBackground({ env, get executionCtx(): never { throw new Error('no context'); } }, 'moderation', { kind: 'changed', key: 'reports' });
    assert.equal(waited.length, 1);
    await Promise.all(waited);
    await new Promise((r) => setTimeout(r, 0));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(bodies.map((b) => b.items[0].message.data.events[0].key).sort(), ['contact', 'reports']);
  assert.equal(bodies[0].items[0].channel, 'admin:moderation');
});
