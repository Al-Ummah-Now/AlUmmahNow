/**
 * Social import sources (wiki TOOLS-ADMIN TA-9): feeds parsed without scraping, sources authorized only
 * by the owner's own connection or a recorded permission, every item posted once on the channel through
 * the normal post writer (images copied to the media host, a video through the upload path), items our
 * own auto-post sent never imported back, and an imported post never announced back to its account.
 * Network calls are stubbed.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import type { AdminJob, CommunityPost } from '@al-ummah/shared-types';
import { SqliteD1 } from './search-sqlite-d1';
import { JobsQueue, MemoryBucket, MemoryQueue, drainJobs } from './helpers';
import { fetchSource, htmlToText, parseFeed } from '../src/lib/importSources/fetchers';
import { authorizeSource, normalizeAddress } from '../src/lib/importSources/authorize';
import { recordTelegramPost, telegramItem } from '../src/lib/importSources/telegram';
import { insertSource, listItems, readSource, SourceError } from '../src/lib/importSources/store';
import { resolveSourceUrl } from '../src/lib/importSources/media';
import { queueDueSources, runSourceSync, startSourceSync } from '../src/lib/importSources/job';
import { planEvent } from '../src/lib/social/deliver';
import importSourcesRouter from '../src/routers/importSources.router';

// Workers' FixedLengthStream, for Node (length checks are the runtime's job)
(globalThis as Record<string, unknown>).FixedLengthStream ??= class {
	constructor() {
		return new TransformStream();
	}
};

const ADMIN = 'usr_' + 'a'.repeat(32);
const OWNER = 'usr_' + 'b'.repeat(32);
const FEED = 'https://feeds.example.org/scholar.xml';
const realFetch = globalThis.fetch;

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Scholar</title>
<item><guid>post-1</guid><title>Friday reminder</title><link>https://example.org/p/1</link><description><![CDATA[<p>Be kind &amp; patient.</p><p>Second line</p>]]></description><pubDate>Mon, 10 Nov 2026 09:00:00 GMT</pubDate></item>
<item><guid>post-2</guid><title>Photos</title><link>https://example.org/p/2</link><description>From the gathering</description><pubDate>Tue, 11 Nov 2026 09:00:00 GMT</pubDate><enclosure url="https://cdn.example.org/a.png" type="image/png" length="70"/></item>
<item><guid>post-3</guid><title>Article</title><link>https://example.org/p/3</link><pubDate>Wed, 12 Nov 2026 09:00:00 GMT</pubDate></item>
<item><guid>post-4</guid><title>Internal</title><link>http://127.0.0.1/admin</link><description>x</description><pubDate>Thu, 13 Nov 2026 09:00:00 GMT</pubDate><enclosure url="http://10.0.0.5/v.mp4" type="video/mp4"/></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><title>A</title>
<entry><id>tag:a,2026:1</id><title>Hello</title><link rel="alternate" href="https://a.example/1"/><link rel="enclosure" type="video/mp4" href="https://a.example/1.mp4" length="1000"/><published>2026-11-12T10:00:00Z</published><summary>Watch</summary></entry>
</feed>`;

/** A 1×1 PNG with real dimensions in its header (the image check reads the bytes). */
function png(width = 4, height = 3): Uint8Array {
	const b = new Uint8Array(33);
	b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
	new DataView(b.buffer).setUint32(16, width);
	new DataView(b.buffer).setUint32(20, height);
	return b;
}

/** R2 stand-in that keeps bytes (the originals bucket). */
class BytesBucket {
	store = new Map<string, Uint8Array>();
	async put(key: string, value: ReadableStream<Uint8Array> | string) {
		if (typeof value === 'string') this.store.set(key, new TextEncoder().encode(value));
		else this.store.set(key, new Uint8Array(await new Response(value).arrayBuffer()));
		return { key };
	}
	async get(key: string) {
		const v = this.store.get(key);
		return v ? { key, arrayBuffer: async () => v.slice().buffer, text: async () => new TextDecoder().decode(v), json: async () => JSON.parse(new TextDecoder().decode(v)) } : null;
	}
	async list(opts: { prefix?: string; cursor?: string; limit?: number } = {}) {
		const keys = [...this.store.keys()].filter((k) => !opts.prefix || k.startsWith(opts.prefix)).sort();
		return { objects: keys.map((key) => ({ key, size: this.store.get(key)!.byteLength, uploaded: new Date() })), truncated: false, cursor: undefined };
	}
	async delete(keys: string | string[]) {
		for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k);
	}
}

interface Stub {
	stored: string[];
	bunnyPut: number[];
	served: string[];
	video: Uint8Array;
}

function stubNetwork(extra: (url: string, init?: RequestInit) => Response | null = () => null): Stub {
	const stub: Stub = { stored: [], bunnyPut: [], served: [], video: new Uint8Array(3000).map((_, i) => i % 251) };
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		const method = init?.method ?? 'GET';
		const custom = extra(url, init);
		if (custom) return custom;
		if (url === FEED) return new Response(RSS, { headers: { 'content-type': 'application/rss+xml' } });
		if (url === 'https://cdn.example.org/a.png') return new Response(png(), { headers: { 'content-type': 'image/png' } });
		if (url.startsWith('https://storage.bunnycdn.com/') && method === 'PUT') {
			stub.stored.push(new URL(url).pathname);
			return new Response('{}', { status: 201 });
		}
		if (url === 'https://media.example.org/talk.mp4') {
			stub.served.push((init?.headers as Record<string, string> | undefined)?.Range ?? 'all');
			const range = (init?.headers as Record<string, string> | undefined)?.Range;
			if (range === 'bytes=0-0') return new Response(stub.video.slice(0, 1), { status: 206, headers: { 'content-range': `bytes 0-0/${stub.video.byteLength}` } });
			return new Response(stub.video, { status: 200, headers: { 'content-length': String(stub.video.byteLength) } });
		}
		// Bunny Stream: create a video, read it, collections, and the PUT of the file
		if (/\/library\/\d+\/videos\/?(\?.*)?$/.test(url) && method === 'POST') return new Response(JSON.stringify({ guid: crypto.randomUUID(), status: 0 }), { status: 200 });
		const one = url.match(/\/library\/\d+\/videos\/([0-9a-f-]{36})$/);
		if (one && method === 'PUT') {
			// Read the body as fetch would
			stub.bunnyPut.push((await new Response(init!.body as ReadableStream).arrayBuffer()).byteLength);
			return new Response('{"success":true}', { status: 200 });
		}
		if (one) return new Response(JSON.stringify({ guid: one[1], status: 0 }), { status: 200 });
		if (/\/collections/.test(url)) return new Response(JSON.stringify({ guid: crypto.randomUUID(), items: [], totalItems: 0 }), { status: 200 });
		throw new Error(`unexpected fetch ${method} ${url}`);
	}) as typeof fetch;
	return stub;
}

function memoryKv() {
	const data = new Map<string, string>();
	return { data, get: async (k: string) => data.get(k) ?? null, put: async (k: string, v: string) => void data.set(k, v), delete: async (k: string) => void data.delete(k) };
}

function harness() {
	const db = new SqliteD1();
	const env = {
		SEARCH_DB: db,
		ADMIN_JOBS_QUEUE: new JobsQueue(),
		videos: new MemoryBucket(),
		channels: new MemoryBucket({ ch1: { id: 'ch1', userId: OWNER, name: 'Scholar', handle: 'scholar' } }),
		community_posts: new MemoryBucket(),
		global_settings: new MemoryBucket(),
		MEDIA_ORIGINALS: new BytesBucket(),
		TUS_SESSIONS: memoryKv(),
		queue: new MemoryQueue(),
		image_storage_key: 'storage-key',
		ZONE: 'zone',
		'bunny-stream-key': 'key',
		bunny_stream_library_id: '123',
		bunny_hostname: 'vz-test.b-cdn.net',
	};
	const posts = () =>
		[...env.community_posts.store.entries()]
			.filter(([k]) => /^posts\/ch1\/[^/]+\.json$/.test(k) && !k.endsWith('index.json'))
			.map(([, v]) => JSON.parse(v) as CommunityPost);
	const job = (params: Record<string, unknown>): AdminJob =>
		({ id: 'job-1', kind: 'import.source-sync', targetKind: 'channel', targetId: 'ch1', params, status: 'running', attempts: 1, lastError: null, result: null, actorId: ADMIN, createdAt: '', updatedAt: '', finishedAt: null }) as AdminJob;
	return { db, env, posts, job };
}

const recorded = { by: 'The scholar, by email', note: 'Agreed on 2026-11-20 to mirror the blog' };

describe('parsing feeds', () => {
	it('reads RSS items as text, image and link posts, newest first, and drops private addresses', () => {
		const items = parseFeed(RSS, FEED);
		assert.deepEqual(items.map((i) => i.itemId), ['post-4', 'post-3', 'post-2', 'post-1']);
		const [internal, article, photos, reminder] = items;
		assert.equal(reminder!.text, 'Friday reminder\n\nBe kind & patient.\n\nSecond line');
		assert.equal(reminder!.url, 'https://example.org/p/1');
		assert.equal(reminder!.link?.url, 'https://example.org/p/1', 'a plain item links to itself');
		assert.deepEqual(photos!.images, [{ url: 'https://cdn.example.org/a.png' }]);
		assert.equal(photos!.link, null);
		assert.equal(article!.postedAt, Date.parse('2026-11-12T09:00:00Z'));
		assert.equal(internal!.url, null, 'a link to a private address is dropped');
		assert.equal(internal!.video, null, 'so is a private enclosure');
	});

	it('reads Atom entries with a video enclosure', () => {
		const [entry] = parseFeed(ATOM, 'https://a.example/feed');
		assert.equal(entry!.itemId, 'tag:a,2026:1');
		assert.deepEqual(entry!.video, { url: 'https://a.example/1.mp4', bytes: 1000, mimeType: 'video/mp4' });
		assert.equal(entry!.url, 'https://a.example/1');
	});

	it('drops any link, image or video a network gives that is not a public web address', async () => {
		const f = (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/accounts/lookup')) return Response.json({ id: '42' });
			if (url.includes('/accounts/42/statuses'))
				return Response.json([
					{ id: '2', url: 'https://social.example/@s/2', created_at: '2026-11-12T10:00:00Z', content: '<p>card</p>', visibility: 'public', media_attachments: [], card: { url: 'javascript:alert(1)', title: 'x', image: 'http://169.254.169.254/x' } },
					{ id: '1', url: 'https://social.example/@s/1', created_at: '2026-11-11T10:00:00Z', content: '<p>media</p>', visibility: 'public', media_attachments: [{ type: 'image', url: 'http://10.0.0.5/a.png' }, { type: 'image', url: 'https://files.social.example/b.png' }, { type: 'video', url: 'file:///etc/passwd' }] },
				]);
			if (url.includes('app.bsky.feed.getAuthorFeed'))
				return Response.json({ feed: [{ post: { uri: 'at://did:plc:aaaaaaaaaaaaaaaaaaaaaaaa/app.bsky.feed.post/3k', author: { did: 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', handle: 'a.bsky.social' }, record: { text: 'hi', createdAt: '2026-11-12T10:00:00Z' }, embed: { $type: 'app.bsky.embed.external#view', external: { uri: 'data:text/html,<script>x</script>', title: 't', thumb: 'javascript:1' } } } }] });
			throw new Error(`unexpected ${url}`);
		}) as typeof fetch;
		const { items } = await fetchSource('mastodon', 'scholar@social.example', null, f);
		const byId = Object.fromEntries(items.map((i) => [i.itemId, i]));
		assert.equal(byId['2']!.link, null, 'a javascript: card is not a link');
		assert.deepEqual(byId['1']!.images.map((i) => i.url), ['https://files.social.example/b.png']);
		assert.equal(byId['1']!.video, null);
		const bsky = await fetchSource('bluesky', 'did:plc:aaaaaaaaaaaaaaaaaaaaaaaa', null, f);
		assert.equal(bsky.items[0]!.link, null, 'a data: embed is not a link');
	});

	it('turns HTML into plain text', () => {
		assert.equal(htmlToText('<p>a&nbsp;b</p><script>x</script><p>c<br/>d &#1587;</p>'), 'a b\n\nc\nd س');
		// A block hidden inside another and a stray "<" never come through; escaped ones are text
		assert.equal(htmlToText('a<scr<script>x</script>ipt>alert(1)</script>b'), 'ab');
		assert.equal(htmlToText('1 < 2 &lt;3'), '1 2 <3');
		assert.equal(htmlToText('x <a href="u">y</a> <<b>z</b> <i'), 'x y z i');
		assert.ok(!htmlToText('<<script>>a<</script>/script>><img src=x onerror=1>').includes('<'));
		// Nesting deeper than the passes: everything from the block left over is dropped
		const deep = 'a' + '<script>'.repeat(20) + 'x' + '</script>'.repeat(20) + 'b';
		assert.ok(!htmlToText(deep).includes('x'));
	});
});

describe('authorizing a source', () => {
	it('normalizes each network address and refuses others', () => {
		assert.equal(normalizeAddress('mastodon', '@Scholar@Social.Example'), 'Scholar@social.example');
		assert.equal(normalizeAddress('bluesky', '@Name.Bsky.Social'), 'name.bsky.social');
		assert.equal(normalizeAddress('youtube', 'UC' + 'x'.repeat(22)), 'UC' + 'x'.repeat(22));
		assert.throws(() => normalizeAddress('rss', 'http://localhost/feed'), (e) => e instanceof SourceError && e.code === 'invalid_address');
		assert.throws(() => normalizeAddress('telegram', '@channel'), (e) => e instanceof SourceError);
	});

	it("uses the owner's own connection, else needs a recorded permission; Telegram only connected", async () => {
		const { env, db } = harness();
		await db.prepare(`INSERT INTO social_accounts (id, channel_id, network, remote_id, handle, display_name, instance, status, created_at, updated_at) VALUES ('acc1', 'ch1', 'mastodon', '42', 'scholar', 'The Scholar', 'https://social.example', 'active', 1, 1)`).run();
		const connected = await authorizeSource(env, { channelId: 'ch1', network: 'mastodon', address: 'scholar@social.example' });
		assert.deepEqual([connected.auth, connected.socialAccountId, connected.label], ['connected', 'acc1', 'The Scholar']);
		await assert.rejects(authorizeSource(env, { channelId: 'ch1', network: 'rss', address: FEED }), (e) => e instanceof SourceError && e.code === 'permission_required');
		const withPermission = await authorizeSource(env, { channelId: 'ch1', network: 'rss', address: FEED, permission: recorded });
		assert.deepEqual([withPermission.auth, withPermission.permission], ['recorded', recorded]);
		await assert.rejects(authorizeSource(env, { channelId: 'ch1', network: 'telegram', address: '-1001234567', permission: recorded }), (e) => e instanceof SourceError && e.code === 'not_connected');
	});
});

describe('syncing a source', () => {
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('posts every item once on the channel, with its link and time, and skips none twice', async () => {
		const stub = stubNetwork();
		const { env, posts, job } = harness();
		const source = await insertSource(env, { channelId: 'ch1', network: 'rss', address: FEED, label: 'Blog', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'daily', createdBy: ADMIN });
		const out = await runSourceSync(env as never, job({ sourceId: source.id, phase: 'fetch' }));
		assert.equal(out.done, true);
		assert.deepEqual((out as { result: Record<string, number> }).result, { sourceId: source.id, fetched: 4, posted: 4, skipped: 0 });

		const made = posts().sort((a, b) => (a.importedFrom!.postedAt! < b.importedFrom!.postedAt! ? -1 : 1));
		assert.deepEqual(made.map((p) => p.type), ['link', 'image', 'link', 'text']);
		assert.equal(made[3]!.link, undefined, 'its private link was dropped, its text kept');
		assert.ok(made.every((p) => p.userId === OWNER && p.channelId === 'ch1' && p.status === 'published'), "the channel's own posts");
		assert.deepEqual(made[0]!.importedFrom, { platform: 'rss', url: 'https://example.org/p/1', postedAt: '2026-11-10T09:00:00.000Z', sourceId: source.id });
		assert.equal(made[1]!.images![0]!.url.startsWith('https://images.alummahnow.net/community-posts/ch1/import-'), true, 'copied to the media host');
		assert.deepEqual([made[1]!.images![0]!.width, made[1]!.images![0]!.height], [4, 3]);
		assert.equal(stub.stored.length, 1);
		assert.equal(env.queue.messages.filter((m) => m.type !== undefined).length >= 3, true, 'announced like a Studio post');

		const items = await listItems(env, source.id);
		assert.equal(items.filter((i) => i.state === 'posted').length, 4);
		assert.equal(items.find((i) => i.itemId === 'post-4')!.originalUrl, null);
		const row = await readSource(env, source.id);
		assert.ok(row!.last_sync_at && row!.next_sync_at! > row!.last_sync_at, 'the next daily sync is set');

		// Again: nothing new, nothing posted twice
		const again = await runSourceSync(env as never, job({ sourceId: source.id, phase: 'fetch' }));
		assert.deepEqual((again as { result: Record<string, number> }).result, { sourceId: source.id, fetched: 0, posted: 0, skipped: 0 });
		assert.equal(posts().length, 4);
	});

	it('never imports what our own auto-post sent to that network', async () => {
		const statuses = [
			{ id: '200', url: 'https://social.example/@scholar/200', created_at: '2026-11-12T10:00:00Z', content: '<p>New video: watch here</p>', visibility: 'public', media_attachments: [] },
			{ id: '199', url: 'https://social.example/@scholar/199', created_at: '2026-11-11T10:00:00Z', content: '<p>A thought</p>', visibility: 'public', media_attachments: [] },
			{ id: '198', created_at: '2026-11-10T10:00:00Z', content: '<p>Boost</p>', reblog: {}, media_attachments: [] },
		];
		stubNetwork((url) => {
			if (url.startsWith('https://social.example/api/v1/accounts/lookup')) return Response.json({ id: '42' });
			if (url.startsWith('https://social.example/api/v1/accounts/42/statuses')) return Response.json(statuses);
			return null;
		});
		const { env, db, posts, job } = harness();
		await db.prepare(`INSERT INTO social_deliveries (id, channel_id, account_id, network, event, entity_id, format, status, remote_id, created_at, updated_at) VALUES ('d1', 'ch1', 'acc1', 'mastodon', 'video', 'vid-1', 'link', 'sent', '200', 1, 1)`).run();
		const source = await insertSource(env, { channelId: 'ch1', network: 'mastodon', address: 'scholar@social.example', label: 'M', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		await runSourceSync(env as never, job({ sourceId: source.id, phase: 'fetch' }));
		assert.deepEqual(posts().map((p) => p.content), ['A thought']);
		const items = await listItems(env, source.id);
		assert.deepEqual(Object.fromEntries(items.map((i) => [i.itemId, i.note])), { '200': 'posted_by_us', '199': null, '198': 'reply_or_repost' });
		assert.equal((await readSource(env, source.id))!.cursor, '200', 'the next fetch starts after the newest');
	});

	it('brings a video through the upload path: stored original, Bunny copy, upload complete, video post', async () => {
		const stub = stubNetwork();
		const { env, posts, job } = harness();
		const source = await insertSource(env, { channelId: 'ch1', network: 'rss', address: FEED, label: 'Blog', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		const payload = { itemId: 'talk', url: 'https://example.org/talk', postedAt: Date.parse('2026-11-12T09:00:00Z'), title: 'Talk', text: 'Talk\n\nFull talk', images: [], link: null, video: { url: 'https://media.example.org/talk.mp4', bytes: null, mimeType: 'video/mp4' } };
		await env.SEARCH_DB.prepare(`INSERT INTO import_source_items (source_id, item_id, kind, state, payload, created_at, updated_at) VALUES (?, 'talk', 'video', 'pending', ?, 1, 1)`).bind(source.id, JSON.stringify(payload)).run();
		const out = await runSourceSync(env as never, job({ sourceId: source.id, phase: 'post' }));
		assert.equal(out.done, true);
		const [post] = posts();
		assert.equal(post!.type, 'video');
		const video = env.videos.read(post!.videoId!);
		assert.equal(video.userId, OWNER, "owned by the channel's owner");
		assert.equal(video.uploadedBy, ADMIN, 'uploaded by the admin');
		assert.equal(video.uploadStatus, 'processing', 'the upload completed');
		assert.deepEqual(video.importedFrom, post!.importedFrom);
		const parts = [...env.MEDIA_ORIGINALS.store.keys()].filter((k) => k.includes(`/${post!.videoId}/imp`));
		assert.equal(parts.length, 1, 'the original is stored');
		assert.equal(env.MEDIA_ORIGINALS.store.get(parts[0]!)!.byteLength, stub.video.byteLength);
		assert.deepEqual(stub.bunnyPut, [stub.video.byteLength], 'Bunny got the whole file');
		const [item] = await listItems(env, source.id);
		assert.deepEqual([item!.state, item!.videoId, item!.postId], ['posted', post!.videoId, post!.id]);
	});

	it('queues due sources once per tick', async () => {
		const { env } = harness();
		const due = await insertSource(env, { channelId: 'ch1', network: 'rss', address: FEED, label: 'Blog', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'hourly', createdBy: ADMIN }, Date.now() - 2 * 3600_000);
		await insertSource(env, { channelId: 'ch1', network: 'rss', address: 'https://feeds.example.org/other.xml', label: 'Other', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		assert.equal(await queueDueSources(env as never), 1);
		assert.equal(await queueDueSources(env as never), 0, 'not queued twice');
		assert.equal(env.ADMIN_JOBS_QUEUE.sent.length, 1);
		const row = await readSource(env, due.id);
		assert.ok(row!.last_job_id);
		const again = await startSourceSync(env as never, row!, ADMIN);
		assert.equal(again.id, row!.last_job_id, 'one sync per source at a time');
	});
});

describe('a revoked connection', () => {
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('stops a connected source at its next sync or post, and keeps it off until the owner connects again', async () => {
		stubNetwork(() => {
			throw new Error('nothing is fetched for a revoked source');
		});
		const { env, db, posts, job } = harness();
		await db.prepare(`INSERT INTO social_accounts (id, channel_id, network, remote_id, handle, display_name, instance, status, created_at, updated_at) VALUES ('acc1', 'ch1', 'mastodon', '42', 'scholar', 'S', 'https://social.example', 'active', 1, 1)`).run();
		await db.prepare(`INSERT INTO social_accounts (id, channel_id, network, remote_id, handle, display_name, status, created_at, updated_at) VALUES ('tg1', 'ch1', 'telegram', '-1001234567', 'chan', 'TG', 'active', 1, 1)`).run();
		const mastodon = await insertSource(env, { channelId: 'ch1', network: 'mastodon', address: 'scholar@social.example', label: 'M', auth: 'connected', socialAccountId: 'acc1', ytImportId: null, permission: null, schedule: 'hourly', createdBy: ADMIN });
		const telegram = await insertSource(env, { channelId: 'ch1', network: 'telegram', address: '-1001234567', label: 'TG', auth: 'connected', socialAccountId: 'tg1', ytImportId: null, permission: null, schedule: 'manual', createdBy: ADMIN });
		// The owner disconnects both
		await db.prepare(`UPDATE social_accounts SET status = 'revoked'`).run();

		const out = await runSourceSync(env as never, job({ sourceId: mastodon.id, phase: 'fetch' }));
		assert.equal((out as { result: { skipped: unknown } }).result.skipped, 'not_connected');
		const off = await readSource(env, mastodon.id);
		assert.deepEqual([off!.enabled, off!.next_sync_at], [0, null]);
		assert.match(off!.last_error!, /^not_connected/);
		assert.deepEqual(await recordTelegramPost(env, { message_id: 1, date: 1763000000, chat: { id: -1001234567, type: 'channel' }, text: 'After disconnect' }), []);
		assert.equal((await readSource(env, telegram.id))!.enabled, 0);
		assert.deepEqual(await listItems(env, telegram.id), []);
		assert.equal(posts().length, 0);

		const app = new Hono();
		app.route('/s', importSourcesRouter as never);
		const on = (id: string) => app.request(`/s/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled: true }), headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': ADMIN } }, env);
		const refused = await on(mastodon.id);
		assert.deepEqual([refused.status, ((await refused.json()) as { code: string }).code], [409, 'not_connected']);
		// Connected again: it can be turned back on
		await db.prepare(`UPDATE social_accounts SET status = 'active' WHERE id = 'acc1'`).run();
		assert.equal((await on(mastodon.id)).status, 200);
	});
});

describe('Telegram', () => {
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('records channel posts of an imported chat; an album is one item; a big video waits for its file', async () => {
		const { env, db } = harness();
		await db.prepare(`INSERT INTO social_accounts (id, channel_id, network, remote_id, handle, display_name, status, created_at, updated_at) VALUES ('tg1', 'ch1', 'telegram', '-1001234567', 'scholarchan', 'Scholar', 'active', 1, 1)`).run();
		const source = await insertSource(env, { channelId: 'ch1', network: 'telegram', address: '-1001234567', label: 'TG', auth: 'connected', socialAccountId: 'tg1', ytImportId: null, permission: null, schedule: 'manual', createdBy: ADMIN });
		const chat = { id: -1001234567, type: 'channel', username: 'scholarchan' };
		assert.deepEqual(await recordTelegramPost(env, { message_id: 10, date: 1763000000, chat, media_group_id: 'g1', caption: 'Album', photo: [{ file_id: 'small', width: 90, height: 90 }, { file_id: 'big', width: 1280, height: 720 }] }), [source.id]);
		assert.deepEqual(await recordTelegramPost(env, { message_id: 11, date: 1763000000, chat, media_group_id: 'g1', photo: [{ file_id: 'second', width: 1280, height: 720 }] }), [], 'joins the album');
		await recordTelegramPost(env, { message_id: 12, date: 1763000100, chat, caption: 'Long talk', video: { file_id: 'v', file_size: 50 * 1024 * 1024 } });
		await recordTelegramPost(env, { message_id: 13, date: 1763000200, chat: { id: -100999, type: 'channel' }, text: 'Not imported' });
		const items = await listItems(env, source.id);
		assert.deepEqual(items.map((i) => [i.itemId, i.state, i.note]).sort(), [['12', 'awaiting_file', 'too_large_for_bot_api'], ['album:g1', 'pending', null]]);
		const row = await db.prepare(`SELECT payload FROM import_source_items WHERE item_id = 'album:g1'`).first<{ payload: string }>();
		assert.deepEqual(JSON.parse(row!.payload).images, [{ url: 'tg-file:big' }, { url: 'tg-file:second' }]);
		assert.equal(items.find((i) => i.itemId === 'album:g1')!.originalUrl, 'https://t.me/scholarchan/10');
	});

	it('resolves Telegram file ids only for a Telegram source', async () => {
		let asked = 0;
		const f = (async () => {
			asked++;
			return Response.json({ ok: true, result: { file_path: 'photos/x.jpg', file_size: 10 } });
		}) as unknown as typeof fetch;
		assert.equal(await resolveSourceUrl({}, 'rss', 'tg-file:abc', f), null, 'a feed cannot name a Telegram file');
		assert.equal(await resolveSourceUrl({}, 'mastodon', 'tg-file:abc', f), null);
		assert.equal(await resolveSourceUrl({}, 'telegram', 'https://example.org/a.png', f), null, 'a Telegram item names files only by id');
		assert.equal(await resolveSourceUrl({}, 'rss', 'http://example.org/a.png', f), null, 'https only');
		assert.equal(asked, 0);
	});

	it('never keeps a file URL (it holds the bot token)', () => {
		const item = telegramItem({ message_id: 1, chat: { id: 1, type: 'channel' }, photo: [{ file_id: 'abc', width: 1, height: 1 }] });
		assert.deepEqual(item.images, [{ url: 'tg-file:abc' }]);
		assert.equal(item.url, null, 'a private channel has no public link');
	});
});

describe('social announcements', () => {
	it('never send an imported post back to the account it came from', async () => {
		const { env, db } = harness();
		const now = Date.now();
		for (const [id, network, remote] of [['accM', 'mastodon', '42'], ['accT', 'telegram', '-1001']] as const) {
			await db.prepare(`INSERT INTO social_accounts (id, channel_id, network, remote_id, handle, display_name, status, created_at, updated_at) VALUES (?, 'ch1', ?, ?, 'h', 'H', 'active', ?, ?)`).bind(id, network, remote, now, now).run();
			await db.prepare(`INSERT INTO social_rules (account_id, event, enabled, format, updated_at) VALUES (?, 'post', 1, 'link', ?)`).bind(id, now).run();
		}
		const source = await insertSource(env, { channelId: 'ch1', network: 'mastodon', address: 'scholar@social.example', label: 'M', auth: 'connected', socialAccountId: 'accM', ytImportId: null, permission: null, schedule: 'manual', createdBy: ADMIN });
		await db.prepare(`INSERT INTO import_source_items (source_id, item_id, kind, state, post_id, created_at, updated_at) VALUES (?, '199', 'text', 'posted', 'post-x', 1, 1)`).bind(source.id).run();
		await env.community_posts.put('posts/ch1/post-x.json', JSON.stringify({ id: 'post-x', channelId: 'ch1', userId: OWNER, type: 'text', content: 'A thought', status: 'published', visibility: 'public', createdAt: new Date().toISOString(), channelName: 'Scholar' }));
		await env.community_posts.put('post-locations/post-x.json', JSON.stringify({ channelId: 'ch1' }));
		const planned = await planEvent({ ...env, WEB_URL: 'https://videos.example.test' } as never, 'ch1', 'post', 'post-x');
		const { results } = await db.prepare(`SELECT account_id FROM social_deliveries WHERE entity_id = 'post-x'`).all<{ account_id: string }>();
		assert.deepEqual(results.map((r) => r.account_id), planned.posts ? ['accT'] : []);
		assert.ok(!results.some((r) => r.account_id === 'accM'));
	});
});

describe('internal routes', () => {
	beforeEach(() => stubNetwork());
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('adds a recorded source, lists it, syncs it, and refuses a duplicate or a missing permission', async () => {
		const { env } = harness();
		const app = new Hono();
		app.route('/s', importSourcesRouter as never);
		const call = async (path: string, init: RequestInit = {}) => {
			const res = await app.request(path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': ADMIN } }, env);
			return { status: res.status, body: (await res.json()) as any };
		};
		const noPermission = await call('/s', { method: 'POST', body: JSON.stringify({ channelId: 'ch1', network: 'rss', address: FEED }) });
		assert.deepEqual([noPermission.status, noPermission.body.code], [403, 'permission_required']);
		const created = await call('/s', { method: 'POST', body: JSON.stringify({ channelId: 'ch1', network: 'rss', address: FEED, schedule: 'weekly', permission: recorded }) });
		assert.equal(created.status, 201);
		const source = created.body.result.source;
		assert.deepEqual([source.auth, source.schedule, source.permission.by, source.label], ['recorded', 'weekly', recorded.by, FEED]);
		const dup = await call('/s', { method: 'POST', body: JSON.stringify({ channelId: 'ch1', network: 'rss', address: FEED, permission: recorded }) });
		assert.deepEqual([dup.status, dup.body.code], [409, 'source_exists']);
		const missing = await call('/s', { method: 'POST', body: JSON.stringify({ channelId: 'nope', network: 'rss', address: FEED, permission: recorded }) });
		assert.equal(missing.status, 404);
		const listed = await call('/s?channelId=ch1');
		assert.equal(listed.body.result.sources.length, 1);
		const synced = await call(`/s/${source.id}/sync`, { method: 'POST' });
		assert.equal(synced.status, 202);
		await drainJobs(env as never);
		const items = await call(`/s/${source.id}/items?state=posted`);
		assert.equal(items.body.result.items.length, 4);
		const off = await call(`/s/${source.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
		assert.deepEqual([off.body.result.source.enabled, off.body.result.source.nextSyncAt], [false, null]);
		const deleted = await call(`/s/${source.id}`, { method: 'DELETE' });
		assert.equal(deleted.body.result.deleted, true);
	});
});
