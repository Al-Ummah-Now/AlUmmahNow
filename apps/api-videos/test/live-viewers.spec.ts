/** People watching a live stream now (AlUmmahNow#30): the watching heartbeat and the count in the live state. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LiveStreamViewers } from '../src/endpoints/live/liveSession';
import { beatLiveViewer, countLiveViewers, liveViewersObject, networkOf, viewerNet } from '../src/lib/live/viewers';
import { MemoryBucket, buildApp } from './helpers';

/** The realtime worker's liveviewers object, reduced to a set per stream. */
function fakeNamespace() {
	const objects = new Map<string, Set<string>>();
	const calls: string[] = [];
	return {
		objects,
		calls,
		broken: false,
		idFromName(name: string) { return { name } as unknown as DurableObjectId; },
		get(id: DurableObjectId) {
			const name = (id as unknown as { name: string }).name;
			const self = this;
			return {
				async fetch(url: string, init?: RequestInit) {
					calls.push(`${name} ${new URL(url).pathname}`);
					if (self.broken) throw new Error('unavailable');
					const set = objects.get(name) ?? new Set<string>();
					objects.set(name, set);
					if (init?.method === 'POST') {
						const body = JSON.parse(String(init.body)) as { viewerId: string; leaving?: boolean };
						if (body.leaving) set.delete(body.viewerId);
						else set.add(body.viewerId);
					}
					return Response.json({ viewers: set.size });
				},
			};
		},
	};
}

const stream = (id: string, over: Record<string, unknown> = {}) => [`livestream:${id}`, JSON.stringify({ id, title: 'Talk', userId: 'alice', channelId: 'ch1', status: 'live', ...over })] as const;

function harness(records: Array<readonly [string, string]>) {
	const ns = fakeNamespace();
	const videos = new MemoryBucket();
	for (const [k, v] of records) videos.store.set(k, v);
	const env = { videos, VIEW_COUNTER: ns };
	const app = buildApp((router) => router.post('/api/live-streams/:id/viewers', LiveStreamViewers), null);
	const beat = (id: string, body: unknown, contentType = 'text/plain') =>
		app.request(`/api/live-streams/${id}/viewers`, { method: 'POST', headers: { 'Content-Type': contentType }, body: typeof body === 'string' ? body : JSON.stringify(body) }, env);
	return { ns, beat };
}

describe('live viewers', () => {
	it('counts each tab once and drops a tab that leaves (sendBeacon text/plain)', async () => {
		const h = harness([stream('s1')]);
		const one = await h.beat('s1', { viewerId: 'tab-aaaaaaaa' });
		assert.equal(one.status, 200);
		assert.equal(((await one.json()) as { result: { viewers: number } }).result.viewers, 1);
		await h.beat('s1', { viewerId: 'tab-aaaaaaaa' }, 'application/json');
		const two = (await (await h.beat('s1', { viewerId: 'tab-bbbbbbbb' })).json()) as { result: { viewers: number } };
		assert.equal(two.result.viewers, 2);
		const left = (await (await h.beat('s1', { viewerId: 'tab-aaaaaaaa', leaving: true })).json()) as { result: { viewers: number } };
		assert.equal(left.result.viewers, 1);
		assert.ok(h.ns.calls.every((c) => c.startsWith(`${liveViewersObject('s1')} `)));
	});

	it('refuses a bad id, a missing or private stream, and a stream that has ended', async () => {
		const h = harness([stream('s1'), stream('p1', { isPrivate: true }), stream('e1', { status: 'ended' })]);
		assert.equal((await h.beat('s1', { viewerId: 'short' })).status, 400);
		assert.equal((await h.beat('s1', 'not json')).status, 400);
		assert.equal((await h.beat('nope', { viewerId: 'tab-aaaaaaaa' })).status, 404);
		assert.equal((await h.beat('p1', { viewerId: 'tab-aaaaaaaa' })).status, 404);
		assert.equal((await h.beat('e1', { viewerId: 'tab-aaaaaaaa' })).status, 409);
		// A tab leaving after the end still clears itself
		assert.equal((await h.beat('e1', { viewerId: 'tab-aaaaaaaa', leaving: true })).status, 200);
		assert.equal(h.ns.objects.get(liveViewersObject('e1'))?.size ?? 0, 0);
	});

	it('answers null instead of failing when the realtime worker is unreachable or unbound', async () => {
		const ns = fakeNamespace();
		ns.broken = true;
		assert.equal(await beatLiveViewer({ VIEW_COUNTER: ns }, 's1', 'tab-aaaaaaaa'), null);
		assert.equal(await countLiveViewers({ VIEW_COUNTER: ns }, 's1'), null);
		assert.equal(await countLiveViewers({}, 's1'), null);
	});

	it('groups an IPv6 address by its /64 and keeps IPv4 addresses apart, never sending the address', async () => {
		assert.equal(networkOf('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
		assert.equal(networkOf('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
		assert.equal(networkOf('2001:db8::5'), '2001:db8:0:0::/64');
		assert.equal(networkOf('203.0.113.7'), '203.0.113.7');
		const a = await viewerNet('2001:db8:1:2::1', 's1');
		assert.equal(a, await viewerNet('2001:db8:1:2:dead:beef::9', 's1'));
		assert.notEqual(a, await viewerNet('2001:db8:1:3::1', 's1'));
		assert.notEqual(a, await viewerNet('2001:db8:1:2::1', 's2'), 'not linkable across streams');
		assert.match(a, /^[a-f0-9]{16}$/);
		assert.equal(await viewerNet(undefined, 's1'), 'none');
	});
});
