import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BunnyStreamClient } from '../src/lib/bunny/stream';

const realFetch = globalThis.fetch;
function captureBodies(): unknown[] {
  const bodies: unknown[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
    return new Response(JSON.stringify({ guid: 'g' }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return bodies;
}

describe('Bunny name prefix (stage shares the QA library)', () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('prefixes created and renamed videos and collections once', async () => {
    const bodies = captureBodies();
    const client = new BunnyStreamClient('k').forEnv({ BUNNY_NAME_PREFIX: '[stage] ' });
    await client.createVideo(1, { title: 'Lecture', thumbnailTime: 0 });
    await client.updateVideo(1, 'v', { title: '[stage] Lecture' });
    await client.createCollection(1, { name: 'Channel' });
    await client.updateVideo(1, 'v', { collectionId: 'c' });
    assert.deepEqual(bodies, [
      { title: '[stage] Lecture', thumbnailTime: 0 },
      { title: '[stage] Lecture' },
      { name: '[stage] Channel' },
      { collectionId: 'c' },
    ]);
  });

  it('leaves names alone when the env sets no prefix (QA, production)', async () => {
    const bodies = captureBodies();
    await new BunnyStreamClient('k').forEnv({ BUNNY_NAME_PREFIX: '' }).createVideo(1, { title: 'Lecture' });
    await new BunnyStreamClient('k').forEnv({}).createCollection(1, { name: 'Channel' });
    assert.deepEqual(bodies, [{ title: 'Lecture' }, { name: 'Channel' }]);
  });
});
