/**
 * PATCH /api/videos/bulk and POST /api/videos/bulk/undo: per-video
 * authorization (channel roles), partial failure, validation, replay safety
 * (operation id), titles per language, descriptions, playlists and undo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VideoBulkUndo, VideoBulkUpdate } from '../src/endpoints/video/videoBulkUpdate';
import { applyBulkChanges, revertFields } from '../src/lib/bulkEdit';
import { MemoryBucket, MemoryQueue, buildApp, videoFixture } from './helpers';

class MemoryKV {
	store = new Map<string, string>();
	ttl = new Map<string, number | undefined>();
	async get(key: string, type?: string) {
		const v = this.store.get(key);
		return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
	}
	async put(key: string, value: string, options?: { expirationTtl?: number }) {
		this.store.set(key, value);
		this.ttl.set(key, options?.expirationTtl);
	}
	async delete(key: string) {
		this.store.delete(key);
	}
}

function routes(r: any) {
	r.patch('/api/videos/bulk', VideoBulkUpdate);
	r.post('/api/videos/bulk/undo', VideoBulkUndo);
}

interface World {
	videos: MemoryBucket;
	channels: MemoryBucket;
	playlists: MemoryBucket;
	queue: MemoryQueue;
	kv: MemoryKV;
}

function world(videos: Record<string, unknown>, extra: Partial<World> = {}): World {
	return {
		videos: new MemoryBucket(videos),
		channels: new MemoryBucket({
			'owner-ch': { id: 'owner-ch', userId: 'owner', members: [{ userId: 'ed', role: 'editor' }, { userId: 'mod', role: 'moderator' }] },
			'other-ch': { id: 'other-ch', userId: 'someone-else', members: [] },
		}),
		playlists: new MemoryBucket({}),
		queue: new MemoryQueue(),
		kv: new MemoryKV(),
		...extra,
	};
}

function call(w: World, userId: string | null, path: string, method: string, body: unknown) {
	return buildApp(routes, userId ? { userId } : null).request(
		path,
		{ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
		{ videos: w.videos, channels: w.channels, playlists: w.playlists, queue: w.queue, TUS_SESSIONS: w.kv },
	);
}

const patch = (w: World, userId: string | null, body: unknown) => call(w, userId, '/api/videos/bulk', 'PATCH', body);
const undo = (w: World, userId: string, body: unknown) => call(w, userId, '/api/videos/bulk/undo', 'POST', body);
const byId = (body: any) => Object.fromEntries(body.results.map((r: any) => [r.videoId, r]));

describe('applyBulkChanges: titles, descriptions, fields', () => {
	const now = '2026-11-10T20:00:00.000Z';

	it('renames each language on its own; the legacy title follows English', () => {
		const r = applyBulkChanges({ title: 'Old', titleLocalized: { en: 'Old', ar: 'قديم' } }, {}, now, { title: { ar: 'جديد' } });
		assert.ok(r.ok);
		assert.deepEqual(r.ok && r.video.titleLocalized, { en: 'Old', ar: 'جديد' });
		assert.equal(r.ok && r.video.title, 'Old');
		const en = applyBulkChanges({ title: 'Legacy only' }, {}, now, { title: { en: 'New' } });
		assert.deepEqual(en.ok && [en.video.title, en.video.titleLocalized], ['New', { en: 'New' }]);
		assert.deepEqual(en.ok && en.fields.sort(), ['title', 'titleLocalized']);
	});

	it('keeps the legacy English title when only the Arabic one changes and titleLocalized.en is empty', () => {
		const r = applyBulkChanges({ title: 'English', titleLocalized: { en: '', ar: 'قديم' } }, {}, now, { title: { ar: 'جديد' } });
		assert.deepEqual(r.ok && [r.video.title, r.video.titleLocalized], ['English', { en: 'English', ar: 'جديد' }]);
		const d = applyBulkChanges({ description: 'Body', descriptionLocalized: { en: '' } }, { description: { ar: { mode: 'replace', text: 'نص' } } }, now);
		assert.deepEqual(d.ok && [d.video.description, d.video.descriptionLocalized], ['Body', { en: 'Body', ar: 'نص' }]);
	});

	it('refuses empty and too-long titles', () => {
		assert.deepEqual(applyBulkChanges({ title: 'A' }, {}, now, { title: { en: '  ' } }), { ok: false, error: 'title_empty' });
		assert.deepEqual(applyBulkChanges({ title: 'A' }, {}, now, { title: { en: 'x'.repeat(101) } }), { ok: false, error: 'title_too_long' });
	});

	it('appends, prepends and replaces descriptions per language', () => {
		const r = applyBulkChanges({ description: 'Body', descriptionLocalized: { ar: 'نص' } }, { description: { en: { mode: 'append', text: 'Footer' }, ar: { mode: 'prepend', text: 'مقدمة' } } }, now);
		assert.deepEqual(r.ok && r.video.descriptionLocalized, { en: 'Body\n\nFooter', ar: 'مقدمة\n\nنص' });
		assert.equal(r.ok && r.video.description, 'Body\n\nFooter');
	});

	it('replaces tags, sets language and comments', () => {
		const r = applyBulkChanges({ tags: ['a', 'b'] }, { replaceTags: ['X', 'x', 'Y'], language: 'ar', commentSettings: 'held' }, now);
		assert.deepEqual(r.ok && [r.video.tags, r.video.language, r.video.commentSettings], [['X', 'Y'], 'ar', 'held']);
	});

	it('reverts only fields nobody changed since', () => {
		const before = { tags: ['a'], category: 'fiqh' as string | undefined };
		const r = applyBulkChanges(before, { addTags: ['b'], category: null }, now);
		assert.ok(r.ok);
		if (!r.ok) return;
		const after = { tags: r.video.tags, category: undefined };
		const edited = { ...r.video, tags: ['someone', 'else'] };
		const reverted = revertFields(edited, { tags: ['a'], category: 'fiqh' }, after, now);
		assert.deepEqual(reverted.restored, ['category']);
		assert.deepEqual(reverted.kept, ['tags']);
		assert.equal(reverted.video.category, 'fiqh');
		assert.deepEqual(reverted.video.tags, ['someone', 'else']);
	});
});

describe('PATCH /api/videos/bulk', () => {
	it('authorizes each video by its channel role and reports partial failures', async () => {
		const w = world({
			a: videoFixture({ id: 'a', userId: 'owner', channelId: 'owner-ch' }),
			b: videoFixture({ id: 'b', userId: 'owner', channelId: 'owner-ch' }),
			theirs: videoFixture({ id: 'theirs', userId: 'someone-else', channelId: 'other-ch' }),
		});
		// An editor of owner-ch edits its videos, not another channel's
		const res = await patch(w, 'ed', { ids: ['a', 'b', 'theirs', 'missing'], changes: { category: 'fiqh', language: 'ar' } });
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		const r = byId(body);
		assert.equal(r.a.success, true);
		assert.equal(r.b.success, true);
		assert.equal(r.theirs.code, 'forbidden');
		assert.equal(r.missing.code, 'not_found');
		assert.deepEqual(body.summary, { total: 4, succeeded: 2, failed: 2 });
		assert.equal(w.videos.read('a').category, 'fiqh');
		assert.equal(w.videos.read('theirs').category, undefined);
		assert.equal(w.queue.messages.length, 2, 'one VideoEdit per changed video (indexes, caches)');

		// A moderator holds no video.edit
		const mod = (await (await patch(w, 'mod', { ids: ['a'], changes: { language: 'en' } })).json()) as any;
		assert.equal(mod.results[0].code, 'forbidden');
		assert.equal(w.videos.read('a').language, 'ar');
	});

	it('validates the request', async () => {
		const w = world({ a: videoFixture({ id: 'a' }) });
		assert.equal((await patch(w, 'owner', { ids: ['a'], changes: {} })).status, 400, 'nothing to change');
		assert.equal((await patch(w, 'owner', { ids: [], changes: { language: 'en' } })).status, 400, 'no ids');
		assert.equal((await patch(w, 'owner', { ids: Array.from({ length: 51 }, (_, i) => `v${i}`), changes: { language: 'en' } })).status, 400, 'over the batch size');
		assert.equal((await patch(w, 'owner', { ids: ['a'], changes: { category: 'nope' } })).status, 400, 'unknown category');
		assert.equal((await patch(w, 'owner', { ids: ['a'], changes: { replaceTags: ['x'], addTags: ['y'] } })).status, 400, 'replace with add');
		assert.equal((await patch(w, 'owner', { ids: ['a'], operationId: 'bad id!', changes: { language: 'en' } })).status, 400, 'operation id');
		assert.notEqual((await patch(w, null, { ids: ['a'], changes: { language: 'en' } })).status, 200, 'signed out');
	});

	it('writes per-video titles and reports the ones refused', async () => {
		const w = world({
			a: videoFixture({ id: 'a', title: 'a' }),
			b: videoFixture({ id: 'b', title: 'b' }),
		});
		const body = (await (await patch(w, 'owner', { ids: ['a', 'b'], perVideo: { a: { title: { en: 'Lesson 1', ar: 'درس ١' } }, b: { title: { en: 'x'.repeat(101) } } } })).json()) as any;
		const r = byId(body);
		assert.equal(r.a.success, true);
		assert.equal(r.b.code, 'title_too_long');
		assert.deepEqual(w.videos.read('a').titleLocalized, { en: 'Lesson 1', ar: 'درس ١' });
		assert.equal(w.videos.read('b').title, 'b');
	});

	it('is safe to retry with the same operation id (an append happens once)', async () => {
		const w = world({ a: videoFixture({ id: 'a', description: 'Body' }) });
		const req = { ids: ['a'], operationId: 'op-12345678', changes: { description: { en: { mode: 'append', text: 'Footer' } } } };
		await patch(w, 'owner', req);
		const again = (await (await patch(w, 'owner', req)).json()) as any;
		assert.equal(again.results[0].replayed, true);
		assert.equal(w.videos.read('a').description, 'Body\n\nFooter');
		const key = 'bulk-edit-undo:owner:op-12345678:a';
		assert.ok(w.kv.store.has(key));
		assert.equal(w.kv.ttl.get(key), 86400, 'undo kept for 24 hours');
	});

	it('appends to a playlist in the order the request lists the videos (the rename order)', async () => {
		// The first-listed video finishes last (slow read): the playlist still follows the request
		const videos = new MemoryBucket({
			v1: videoFixture({ id: 'v1', channelId: 'owner-ch' }),
			v2: videoFixture({ id: 'v2', channelId: 'owner-ch' }),
			v3: videoFixture({ id: 'v3', channelId: 'owner-ch' }),
		});
		const realGet = videos.get.bind(videos);
		(videos as any).get = async (key: string, ...rest: unknown[]) => {
			if (key === 'v3') await new Promise((resolve) => setTimeout(resolve, 20));
			return realGet(key, ...(rest as []));
		};
		const w = world({}, {
			videos,
			playlists: new MemoryBucket({ p: { id: 'p', title: 'P', userId: 'owner', channelId: 'owner-ch', videos: [], isPublic: true } }),
		});
		const res = (await (await patch(w, 'owner', { ids: ['v3', 'v1', 'v2'], changes: { addPlaylists: ['p'] } })).json()) as any;
		assert.equal(res.summary.succeeded, 3);
		assert.deepEqual(w.playlists.read('p').videos, ['v3', 'v1', 'v2']);
	});

	it('adds to and removes from playlists the caller manages, on the video\'s channel only', async () => {
		const w = world({
			a: videoFixture({ id: 'a', channelId: 'owner-ch' }),
			b: videoFixture({ id: 'b', channelId: 'owner-ch' }),
		}, {
			playlists: new MemoryBucket({
				p1: { id: 'p1', title: 'P1', userId: 'owner', channelId: 'owner-ch', videos: ['b'], isPublic: true },
				p2: { id: 'p2', title: 'P2', userId: 'owner', channelId: 'owner-ch', videos: ['a'], isPublic: true },
				foreign: { id: 'foreign', title: 'F', userId: 'someone-else', channelId: 'other-ch', videos: [], isPublic: true },
			}),
		});
		const res = (await (await patch(w, 'owner', { ids: ['a', 'b'], operationId: 'op-playlists', changes: { addPlaylists: ['p1'], removePlaylists: ['p2'] } })).json()) as any;
		assert.deepEqual(res.summary, { total: 2, succeeded: 2, failed: 0 }, JSON.stringify(res.results));
		assert.deepEqual(w.playlists.read('p1').videos, ['b', 'a']);
		assert.deepEqual(w.playlists.read('p2').videos, []);

		// A playlist the caller can't manage refuses the whole request
		assert.equal((await patch(w, 'owner', { ids: ['a'], changes: { addPlaylists: ['foreign'] } })).status, 403);
		assert.equal((await patch(w, 'owner', { ids: ['a'], changes: { addPlaylists: ['gone'] } })).status, 400);

		// Undo takes 'a' out of p1 again and puts it back in p2
		const undone = (await (await undo(w, 'owner', { operationId: 'op-playlists', ids: ['a', 'b'] })).json()) as any;
		assert.deepEqual(undone.summary, { total: 2, succeeded: 2, failed: 0 });
		assert.deepEqual(w.playlists.read('p1').videos, ['b']);
		assert.deepEqual(w.playlists.read('p2').videos, ['a']);
	});
});

describe('English and Arabic in one request', () => {
	it('writes both titles and both descriptions atomically, and one undo puts both back', async () => {
		const w = world({
			a: videoFixture({ id: 'a', title: 'Old', titleLocalized: { en: 'Old', ar: 'قديم' }, description: 'Body', descriptionLocalized: { en: 'Body', ar: 'نص' } }),
		});
		const res = (await (await patch(w, 'owner', {
			ids: ['a'],
			operationId: 'op-bilingual',
			perVideo: { a: { title: { en: 'Lesson 1', ar: 'الدرس ١' } } },
			changes: { description: { en: { mode: 'append', text: 'Footer' }, ar: { mode: 'replace', text: 'وصف' } } },
		})).json()) as any;
		assert.deepEqual(res.summary, { total: 1, succeeded: 1, failed: 0 });
		const after = w.videos.read('a');
		assert.deepEqual(after.titleLocalized, { en: 'Lesson 1', ar: 'الدرس ١' });
		assert.equal(after.title, 'Lesson 1');
		assert.deepEqual(after.descriptionLocalized, { en: 'Body\n\nFooter', ar: 'وصف' });

		await undo(w, 'owner', { operationId: 'op-bilingual', ids: ['a'] });
		const back = w.videos.read('a');
		assert.deepEqual(back.titleLocalized, { en: 'Old', ar: 'قديم' });
		assert.equal(back.title, 'Old');
		assert.deepEqual(back.descriptionLocalized, { en: 'Body', ar: 'نص' });
		assert.equal(back.description, 'Body');
	});

	it('refuses the whole video when one language is invalid (nothing half-written)', async () => {
		const w = world({ a: videoFixture({ id: 'a', title: 'Old', titleLocalized: { en: 'Old', ar: 'قديم' } }) });
		const res = (await (await patch(w, 'owner', { ids: ['a'], perVideo: { a: { title: { en: 'Fine', ar: '   ' } } } })).json()) as any;
		assert.equal(res.results[0].code, 'title_empty');
		assert.deepEqual(w.videos.read('a').titleLocalized, { en: 'Old', ar: 'قديم' });
	});
});

describe('POST /api/videos/bulk/undo', () => {
	it('restores the previous values, keeps newer edits, and is a no-op when repeated', async () => {
		const w = world({
			a: videoFixture({ id: 'a', category: 'fiqh', tags: ['x'], isPublic: false }),
			b: videoFixture({ id: 'b', tags: [] }),
		});
		await patch(w, 'owner', { ids: ['a', 'b'], operationId: 'op-undo-1', changes: { category: 'dawah', addTags: ['new'] } });
		// Someone edits b's tags afterwards
		const b = w.videos.read('b');
		await w.videos.put('b', JSON.stringify({ ...b, tags: ['hand-edited'] }));

		const res = (await (await undo(w, 'owner', { operationId: 'op-undo-1', ids: ['a', 'b', 'c'] })).json()) as any;
		const r = byId(res);
		assert.equal(r.a.success, true);
		assert.equal(w.videos.read('a').category, 'fiqh');
		assert.deepEqual(w.videos.read('a').tags, ['x']);
		assert.equal(r.b.code, 'changed_since');
		assert.deepEqual(w.videos.read('b').tags, ['hand-edited'], 'a newer edit is kept');
		assert.equal(w.videos.read('b').category, undefined, 'the untouched-since field is restored');
		assert.equal(r.c.code, 'nothing_to_undo');

		const again = (await (await undo(w, 'owner', { operationId: 'op-undo-1', ids: ['a'] })).json()) as any;
		assert.equal(again.results[0].replayed, true);
		assert.equal(w.videos.read('a').category, 'fiqh');
	});

	it('only undoes the caller\'s own operations', async () => {
		const w = world({ a: videoFixture({ id: 'a', category: 'fiqh' }) });
		await patch(w, 'owner', { ids: ['a'], operationId: 'op-mine-01', changes: { category: 'dawah' } });
		const res = (await (await undo(w, 'ed', { operationId: 'op-mine-01', ids: ['a'] })).json()) as any;
		assert.equal(res.results[0].code, 'nothing_to_undo');
		assert.equal(w.videos.read('a').category, 'dawah');
	});
});
