import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { eraseUploadTraces } from '../src/lib/privacy/upload-traces';
import { createTusProxySession, getTusSessionKey, tusUploadIndexKey, tusUserIndexPrefix } from '../src/lib/bunny/tus';
import { UPLOAD_MARKER_PREFIX } from '../src/lib/uploads/reaper';

/** KV stand-in: put/get/delete/list(prefix, cursor), with the TTLs it was given. */
function fakeKv(pageSize = 2) {
	const store = new Map<string, { value: string; ttl?: number }>();
	return {
		store,
		async put(key: string, value: string, opts?: { expirationTtl?: number }) {
			store.set(key, { value, ttl: opts?.expirationTtl });
		},
		async get(key: string) {
			return store.get(key)?.value ?? null;
		},
		async delete(key: string) {
			store.delete(key);
		},
		async list({ prefix, cursor }: { prefix: string; cursor?: string }) {
			const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
			const start = cursor ? Number(cursor) : 0;
			const keys = all.slice(start, start + pageSize).map((name) => ({ name }));
			const next = start + pageSize;
			return { keys, list_complete: next >= all.length, cursor: next >= all.length ? undefined : String(next) };
		},
	};
}

function fakeBucket(keys: string[]) {
	const store = new Set(keys);
	return {
		store,
		async delete(key: string | string[]) {
			for (const k of Array.isArray(key) ? key : [key]) store.delete(k);
		},
	};
}

const tusConfig = { tusEndpoint: 'https://video.bunnycdn.com/tusupload', tusHeaders: {} as never, expiresAt: new Date(Date.now() + 3600_000).toISOString() };

describe('account erasure: upload markers and TUS sessions (#1059)', () => {
	it('a TUS session is indexed under its user, with the same lifetime', async () => {
		const kv = fakeKv();
		const id = await createTusProxySession(kv as never, { videoId: 'v1', userId: 'usr_a', channelId: 'c1', tusConfig }, 600);
		assert.equal(kv.store.get(getTusSessionKey(id))?.ttl, 600);
		assert.equal(kv.store.get(`${tusUserIndexPrefix('usr_a')}${id}`)?.ttl, 600);
	});

	it("deletes the erased user's sessions (every page) and the reaper markers of their deleted videos, nobody else's", async () => {
		const kv = fakeKv(2);
		const mine = await Promise.all(['v1', 'v2', 'v3'].map((videoId) => createTusProxySession(kv as never, { videoId, userId: 'usr_a', channelId: 'c1', tusConfig })));
		const theirs = await createTusProxySession(kv as never, { videoId: 'v9', userId: 'usr_b', channelId: 'c9', tusConfig });
		const bucket = fakeBucket([`${UPLOAD_MARKER_PREFIX}v1`, `${UPLOAD_MARKER_PREFIX}v2`, `${UPLOAD_MARKER_PREFIX}v9`, 'ops/upload-reaper/config.json']);

		const result = await eraseUploadTraces({ TUS_SESSIONS: kv as never, global_settings: bucket }, 'usr_a', ['v1', 'v2']);
		assert.deepEqual(result, { markers: 2, sessions: 3 });
		for (const id of mine) {
			assert.equal(kv.store.has(getTusSessionKey(id)), false);
			assert.equal(kv.store.has(`${tusUserIndexPrefix('usr_a')}${id}`), false);
		}
		assert.equal(kv.store.has(getTusSessionKey(theirs)), true);
		assert.deepEqual([...bucket.store].sort(), ['ops/upload-reaper/config.json', `${UPLOAD_MARKER_PREFIX}v9`]);

		// Idempotent
		assert.deepEqual(await eraseUploadTraces({ TUS_SESSIONS: kv as never, global_settings: bucket }, 'usr_a', []), { markers: 0, sessions: 0 });
	});

	it("deletes the erased user's TUS proxy upload sessions (tus:upload:<key>) through their index", async () => {
		const kv = fakeKv(2);
		for (const [key, user] of [['k1', 'usr_a'], ['k2', 'usr_a'], ['k9', 'usr_b']] as const) {
			await kv.put(`tus:upload:${key}`, JSON.stringify({ videoId: `v-${key}`, userId: user }));
			await kv.put(tusUploadIndexKey(user, key), '1');
		}
		assert.deepEqual(await eraseUploadTraces({ TUS_SESSIONS: kv as never }, 'usr_a', []), { markers: 0, sessions: 2 });
		assert.deepEqual([...kv.store.keys()].sort(), ['tus:upload:k9', tusUploadIndexKey('usr_b', 'k9')].sort());
	});

	it('works without the bindings (an env that has neither)', async () => {
		assert.deepEqual(await eraseUploadTraces({}, 'usr_a', ['v1']), { markers: 0, sessions: 0 });
	});
});
