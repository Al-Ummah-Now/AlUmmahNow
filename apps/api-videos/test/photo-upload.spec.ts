/**
 * Avatar and cover uploads: what the uploader waits for runs together where it can, and the
 * consumer is told only after the record holds the new image (it read the old one before).
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import channelAvatar from '../src/endpoints/channel/channelAvatarUpdate';
import channelCover from '../src/endpoints/channel/channelCoverUpdate';
import profileAvatar from '../src/endpoints/profile/profileAvatarUpdate';
import profileCover from '../src/endpoints/profile/profileCoverUpdate';
import { MemoryBucket } from './helpers';

const OWNER = 'usr_owner';
const realFetch = globalThis.fetch;

/** Every step takes one tick; steps that overlap share a round trip. */
function steps() {
	const log: string[] = [];
	let running = 0;
	let rounds = 0;
	const step = async <T>(name: string, work: () => T | Promise<T>): Promise<T> => {
		if (running === 0) rounds++;
		running++;
		log.push(name);
		try {
			await new Promise((r) => setTimeout(r, 5));
			return await work();
		} finally {
			running--;
		}
	};
	return { log, step, rounds: () => rounds };
}

function slow(bucket: MemoryBucket, name: string, step: ReturnType<typeof steps>['step']) {
	return new Proxy(bucket, {
		get(target, key) {
			const value = (target as never as Record<PropertyKey, unknown>)[key];
			if ((key === 'get' || key === 'put') && typeof value === 'function') {
				return (...args: unknown[]) => step(`${name}.${key}`, () => (value as (...a: unknown[]) => unknown).apply(target, args));
			}
			return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
		},
	});
}

function context(step: ReturnType<typeof steps>['step']) {
	const env = {
		channels: slow(new MemoryBucket({ 'chan-1': { id: 'chan-1', userId: OWNER, name: 'Noor Academy' } }), 'record', step),
		profiles: slow(new MemoryBucket({ [OWNER]: { id: OWNER } }), 'record', step),
		global_settings: slow(new MemoryBucket(), 'settings', step),
		image_storage_key: { get: () => step('secret', () => 'key') },
		ZONE: 'zone',
		SEARCH_DB: { prepare: () => ({ bind: () => ({ run: () => step('owner', () => ({})) }) }) },
		queue: { send: () => step('queue', () => undefined) },
	};
	const file = new File([new Uint8Array(64)], 'me.jpg', { type: 'image/jpeg' });
	return {
		env,
		get: (k: string) => (k === 'auth' ? { userId: OWNER } : undefined),
		req: { param: () => 'chan-1', parseBody: async () => ({ photo: file }) },
		json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
	};
}

describe('photo uploads', () => {
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	for (const [name, handler, field] of [
		['channel avatar', channelAvatar, 'avatarUrl'],
		['channel cover', channelCover, 'coverUrl'],
		['profile avatar', profileAvatar, 'avatarUrl'],
		['profile cover', profileCover, 'coverUrl'],
	] as const) {
		it(`${name}: at most six round trips, the queue last`, async () => {
			const { log, step, rounds } = steps();
			globalThis.fetch = (async () => step('storage', () => new Response('{}', { status: 201 }))) as typeof fetch;
			const res = await handler(context(step) as never);
			const body = (await (res as Response).json()) as Record<string, string>;
			assert.equal((res as Response).status, 200, JSON.stringify(body));
			assert.match(body[field], /^https:\/\/images\.alummahnow\.net\//);
			assert.ok(log.includes('owner'), log.join(' '));
			assert.ok(log.indexOf('queue') > log.lastIndexOf('record.put'), log.join(' '));
			assert.ok(log.indexOf('owner') > log.indexOf('storage'), log.join(' '));
			assert.ok(rounds() <= 6, `${rounds()} round trips: ${log.join(' ')}`);
		});
	}
});
