/**
 * Handle history (wiki AUN-SEO, phase 5): a channel that changes its @handle keeps the old one as
 * a redirect. GET /api/channels/by-handle/<old> answers with the channel and its current handle (the
 * page 301s), the old handle is held for the channel for HANDLE_HOLD_DAYS, and once someone claims
 * it the redirect ends.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChannelUpdate } from '../src/endpoints/channel/channelUpdate';
import { ChannelByHandleFetch } from '../src/endpoints/channel/channelHandle';
import { HANDLE_HOLD_DAYS, checkHandleAvailability, claimHandle, dropHandleHistory, handleHistoryKey, isHandleOnHold, releaseReplacedHandle } from '../src/lib/channelHandles';
import { eraseChannelHandleHistory } from '../src/lib/privacy/handle-history';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';

const DAY = 24 * 60 * 60 * 1000;
const channel = (id: string, userId: string, handle: string, over: Record<string, unknown> = {}) => ({
	id, userId, name: `Channel ${id}`, handle, isMain: true, dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', ...over,
});

function setup(over: Record<string, unknown> = {}) {
	return {
		channels: new MemoryBucket({ c1: channel('c1', 'u1', 'oldname', over), c2: channel('c2', 'u2', 'other') }),
		channel_tabs: new MemoryBucket({
			'channel-handles/oldname': { handle: 'oldName', channelId: 'c1', userId: 'u1', dateClaimed: '2026-01-01T00:00:00.000Z' },
			'channel-handles/other': { handle: 'other', channelId: 'c2', userId: 'u2', dateClaimed: '2026-01-01T00:00:00.000Z' },
		}),
		profiles: new MemoryBucket({}),
		videos: new MemoryBucket({}),
		queue: new MemoryQueue(),
	};
}

const rename = (env: unknown, userId: string, id: string, handle: string) =>
	buildApp((r: any) => r.put('/api/channels/:id', ChannelUpdate), { userId })
		.request(`/api/channels/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handle }) }, env as never);

async function byHandle(env: unknown, handle: string, userId: string | null = null) {
	const res = await buildApp((r: any) => r.get('/api/channels/by-handle/:handle', ChannelByHandleFetch), userId ? { userId } : null)
		.request(`/api/channels/by-handle/${handle}`, {}, env as never);
	return { status: res.status, body: (await res.json()) as { id?: string; handle?: string } };
}

describe('handle history', () => {
	it('an old handle answers with the channel and its current handle (the page redirects)', async () => {
		const env = setup();
		assert.equal((await rename(env, 'u1', 'c1', 'NewName')).status, 200);
		const history = env.channel_tabs.read(handleHistoryKey('oldname'));
		assert.equal(history.channelId, 'c1');
		assert.equal(history.handle, 'oldName');
		assert.ok(!env.channel_tabs.read('channel-handles/oldname'), 'the index entry is freed');

		const old = await byHandle(env, 'OLDNAME');
		assert.equal(old.status, 200);
		assert.equal(old.body.id, 'c1');
		assert.equal(old.body.handle, 'NewName');
		const current = await byHandle(env, 'newname');
		assert.equal(current.body.handle, 'NewName');

		// Renamed twice: both old handles lead to the channel
		assert.equal((await rename(env, 'u1', 'c1', 'third')).status, 200);
		assert.equal((await byHandle(env, 'oldname')).body.handle, 'third');
		assert.equal((await byHandle(env, 'NewName')).body.handle, 'third');
	});

	it('another channel cannot claim the old handle during the hold; after it, the claim ends the redirect', async () => {
		const env = setup();
		await rename(env, 'u1', 'c1', 'newname');
		assert.equal((await rename(env, 'u2', 'c2', 'oldname')).status, 409);
		assert.equal((await byHandle(env, 'oldname')).body.id, 'c1');

		// The hold has passed
		const entry = env.channel_tabs.read(handleHistoryKey('oldname'));
		env.channel_tabs.store.set(handleHistoryKey('oldname'), JSON.stringify({ ...entry, dateReleased: new Date(Date.now() - (HANDLE_HOLD_DAYS + 1) * DAY).toISOString() }));
		assert.equal((await rename(env, 'u2', 'c2', 'oldname')).status, 200);
		assert.ok(!env.channel_tabs.read(handleHistoryKey('oldname')), 'the redirect ended');
		const now = await byHandle(env, 'oldname');
		assert.equal(now.body.id, 'c2');
		assert.equal(now.body.handle, 'oldname');
	});

	it('the channel can take its old handle back at once; the redirect ends', async () => {
		const env = setup();
		await rename(env, 'u1', 'c1', 'newname');
		assert.equal((await rename(env, 'u1', 'c1', 'oldName')).status, 200);
		assert.ok(!env.channel_tabs.read(handleHistoryKey('oldname')));
		assert.equal((await byHandle(env, 'oldname')).body.handle, 'oldName');
		// …and the handle it left is now the one that redirects
		assert.equal((await byHandle(env, 'newname')).body.handle, 'oldName');
	});

	it('an old handle of a channel nobody may see is a 404, like the channel', async () => {
		for (const flag of ['isHidden', 'isDeleted', 'isPrivate']) {
			const env = setup();
			await rename(env, 'u1', 'c1', 'newname');
			const stored = env.channels.read('c1');
			env.channels.store.set('c1', JSON.stringify({ ...stored, [flag]: true }));
			assert.equal((await byHandle(env, 'oldname')).status, 404, flag);
		}
		assert.equal((await byHandle(setup(), 'neverused')).status, 404);
	});

	it('a deleted channel drops its old handles: no redirect, no hold, no keys left', async () => {
		const env = setup();
		await rename(env, 'u1', 'c1', 'second');
		await rename(env, 'u1', 'c1', 'third');
		// One old handle was claimed by another channel after its hold: that entry is not c1's any more
		const second = env.channel_tabs.read(handleHistoryKey('second'));
		env.channel_tabs.store.set(handleHistoryKey('second'), JSON.stringify({ ...second, channelId: 'c2' }));
		assert.equal(await dropHandleHistory(env.channel_tabs as never, 'c1'), 1);
		assert.ok(!env.channel_tabs.read(handleHistoryKey('oldname')));
		assert.equal(env.channel_tabs.read(handleHistoryKey('second'))?.channelId, 'c2', 'another channel\'s entry is kept');
		assert.deepEqual([...env.channel_tabs.store.keys()].filter((k) => k.startsWith('channel-handle-history-of/c1/')), []);
		assert.deepEqual(await claimHandle(env.channel_tabs as never, 'oldname', { id: 'c9', userId: 'u9' }), { ok: true, handle: 'oldname' });
	});

	it('hold rules', async () => {
		const at = Date.parse('2026-11-14T00:00:00.000Z');
		const entry = { handle: 'x', channelId: 'c1', dateReleased: new Date(at - DAY).toISOString() };
		assert.equal(isHandleOnHold(entry, 'c2', at), true);
		assert.equal(isHandleOnHold(entry, 'c1', at), false, 'never held against its own channel');
		assert.equal(isHandleOnHold(entry, 'c2', at + HANDLE_HOLD_DAYS * DAY), false);
		assert.equal(isHandleOnHold(null, 'c2', at), false);
		// A default handle claim (new channel) respects the hold too
		const bucket = new MemoryBucket({ [handleHistoryKey('held')]: { handle: 'held', channelId: 'c1', dateReleased: new Date().toISOString() } });
		assert.deepEqual(await claimHandle(bucket as never, 'held', { id: 'c9', userId: 'u9' }), { ok: false, reason: 'taken' });
	});

	it('a channel holds one old handle at a time: renaming again cannot squat more handles', async () => {
		const env = setup();
		await rename(env, 'u1', 'c1', 'second');
		await rename(env, 'u1', 'c1', 'third');
		await rename(env, 'u1', 'c1', 'fourth');
		// Every old handle still redirects
		for (const old of ['oldname', 'second', 'third']) assert.equal((await byHandle(env, old)).body.handle, 'fourth', old);
		// Only the first is held; the others are free for anyone
		assert.equal((await checkHandleAvailability(env.channel_tabs as never, 'oldname', 'c2')).available, false);
		assert.equal((await checkHandleAvailability(env.channel_tabs as never, 'second', 'c2')).available, true);
		assert.equal((await checkHandleAvailability(env.channel_tabs as never, 'third', 'c2')).available, true);
		// Once the held one expires, the next rename is held again
		const first = env.channel_tabs.read(handleHistoryKey('oldname'));
		env.channel_tabs.store.set(handleHistoryKey('oldname'), JSON.stringify({ ...first, dateReleased: new Date(Date.now() - (HANDLE_HOLD_DAYS + 1) * DAY).toISOString() }));
		await rename(env, 'u1', 'c1', 'fifth');
		assert.equal((await checkHandleAvailability(env.channel_tabs as never, 'fourth', 'c2')).available, false);
	});

	it('a claim whose write never landed is given back with no redirect and no hold', async () => {
		const env = setup();
		assert.deepEqual(await claimHandle(env.channel_tabs as never, 'neverused', { id: 'c1', userId: 'u1' }), { ok: true, handle: 'neverused' });
		await releaseReplacedHandle(env.channel_tabs as never, env.channels as never, 'neverused', 'c1', false);
		assert.ok(!env.channel_tabs.read('channel-handles/neverused'));
		assert.ok(!env.channel_tabs.read(handleHistoryKey('neverused')));
		assert.equal((await checkHandleAvailability(env.channel_tabs as never, 'neverused', 'c2')).available, true);
	});

	it('privacy erase drops the channel\'s history with the budgeted helper', async () => {
		const env = setup();
		await rename(env, 'u1', 'c1', 'second');
		const budget = { spend() {} };
		assert.equal(await eraseChannelHandleHistory(env.channel_tabs as never, 'c1', budget as never), 1);
		assert.ok(!env.channel_tabs.read(handleHistoryKey('oldname')));
		assert.deepEqual([...env.channel_tabs.store.keys()].filter((k) => k.startsWith('channel-handle-history')), []);
	});
});
