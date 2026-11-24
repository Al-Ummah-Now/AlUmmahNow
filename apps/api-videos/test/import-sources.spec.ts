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
import { onSourceSyncFailed, queueDueSources, runSourceSync, startSourceSync } from '../src/lib/importSources/job';
import { codedReason, sourceErrorFromPreview } from '../src/lib/importSources/errors';
import { PreviewError, retryAfterSeconds } from '../src/lib/link-preview';
import { matchTakeoutFile, normalizeTitle, runTakeoutJob, type MatchRecord } from '../src/lib/importSources/takeout';
import { cancelJob, getJobWithLog } from '../src/lib/admin/jobs';
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
		// A link post: the title is on its card, so the text is the summary alone (never the title twice)
		assert.equal(reminder!.text, 'Be kind & patient.\n\nSecond line');
		assert.equal(reminder!.url, 'https://example.org/p/1');
		assert.equal(reminder!.link?.url, 'https://example.org/p/1', 'a plain item links to itself');
		assert.equal(reminder!.link?.title, 'Friday reminder');
		assert.equal(reminder!.link?.description, null);
		assert.ok(photos!.text.startsWith(photos!.title ?? ''), 'a post with its own images keeps the title in its text');
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
		assert.equal((await readSource(env, source.id))!.cursor, '42:200', 'the next fetch starts after the newest, with the account id kept');
		// The next sync reuses the account id: no lookup, and it asks only for what came after
		const seen: string[] = [];
		stubNetwork((url) => {
			seen.push(url);
			if (url.startsWith('https://social.example/api/v1/accounts/42/statuses')) return Response.json([]);
			return null;
		});
		await runSourceSync(env as never, job({ sourceId: source.id, phase: 'fetch' }));
		assert.ok(!seen.some((u) => u.includes('/accounts/lookup')), 'no lookup once the id is known');
		assert.ok(seen.some((u) => u.includes('since_id=200')));
		assert.equal((await readSource(env, source.id))!.cursor, '42:200', 'nothing new keeps the cursor');
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

	it('spreads a tick’s syncs over the hour: each waits its turn before the first fetch', async () => {
		const { env, job } = harness();
		for (const n of [1, 2, 3]) {
			await insertSource(env, { channelId: 'ch1', network: 'rss', address: `https://feeds.example.org/${n}.xml`, label: `F${n}`, auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'hourly', createdBy: ADMIN }, Date.now() - 2 * 3600_000);
		}
		assert.equal(await queueDueSources(env as never), 3);
		const { results } = await env.SEARCH_DB.prepare("SELECT params FROM admin_jobs WHERE kind = 'import.source-sync'").all<{ params: string }>();
		const waits = results.map((r) => (JSON.parse(r.params) as { waitSeconds?: number }).waitSeconds ?? 0).sort((a, b) => a - b);
		assert.deepEqual(waits, [0, 900, 1800]);
		// The first step of a waiting sync only waits: nothing is fetched yet
		const sourceId = (JSON.parse(results[0]!.params) as { sourceId: string }).sourceId;
		const out = await runSourceSync(env as never, job({ sourceId, phase: 'fetch', fetched: 0, posted: 0, skipped: 0, waitSeconds: 900 }));
		assert.equal(out.done, false);
		assert.equal((out as { delaySeconds?: number }).delaySeconds, 900);
		assert.equal((out as { params: { waitSeconds?: number } }).params.waitSeconds, undefined);
	});

	it('queues no scheduled sync while uploads are off, and the source stays due', async () => {
		const { env } = harness();
		const due = await insertSource(env, { channelId: 'ch1', network: 'rss', address: FEED, label: 'Blog', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'hourly', createdBy: ADMIN }, Date.now() - 2 * 3600_000);
		const off = { ...env, FEATURES_FORCE_OFF: 'upload' };
		assert.equal(await queueDueSources(off as never), 0);
		assert.equal(env.ADMIN_JOBS_QUEUE.sent.length, 0);
		assert.ok((await readSource(env, due.id))!.next_sync_at, 'still due');
		assert.equal(await queueDueSources(env as never), 1, 'queued once uploads are back on');
	});

	it('a scheduled sync already in its spread wait skips quietly if uploads are switched off before it runs', async () => {
		const { env, posts, job } = harness();
		const first = await insertSource(env, { channelId: 'ch1', network: 'rss', address: FEED, label: 'F1', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'hourly', createdBy: ADMIN }, Date.now() - 2 * 3600_000);
		const second = await insertSource(env, { channelId: 'ch1', network: 'rss', address: 'https://feeds.example.org/2.xml', label: 'F2', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'hourly', createdBy: ADMIN }, Date.now() - 2 * 3600_000);
		assert.equal(await queueDueSources(env as never), 2);
		const waitingRow = await env.SEARCH_DB.prepare("SELECT id, params FROM admin_jobs WHERE kind = 'import.source-sync'").all<{ id: string; params: string }>();
		const waiting = waitingRow.results.find((r) => ((JSON.parse(r.params) as { waitSeconds?: number }).waitSeconds ?? 0) > 0)!;
		const waitingParams = JSON.parse(waiting.params) as { sourceId: string; waitSeconds: number };
		assert.equal((await readSource(env, waitingParams.sourceId))!.next_sync_at, null, 'cron cleared next_sync_at while queued');

		// Step 1: waits its place in the 45-minute spread
		const step1 = await runSourceSync(env as never, { ...job(waitingParams), id: waiting.id });
		assert.equal(step1.done, false);
		assert.equal((step1 as { delaySeconds?: number }).delaySeconds, waitingParams.waitSeconds);
		assert.equal((step1 as { params: { waitSeconds?: number } }).params.waitSeconds, undefined);

		// Uploads are switched off before the wait finishes: step 2 must not fetch or post, and keeps the source due
		stubNetwork(() => {
			throw new Error('must not fetch while uploads are off');
		});
		const off = { ...env, FEATURES_FORCE_OFF: 'upload' };
		const step2 = await runSourceSync(off as never, { ...job((step1 as { params: Record<string, unknown> }).params), id: waiting.id });
		assert.deepEqual([step2.done, (step2 as { result: { skipped?: string } }).result.skipped], [true, 'uploads_off']);
		assert.equal(posts().length, 0);
		const after = (await readSource(env, waitingParams.sourceId))!;
		assert.equal(after.last_sync_at, null, 'not marked synced');
		assert.equal(after.last_error, null, 'no error recorded');
		assert.equal(after.sync_job_id, null, 'active job released');
		assert.ok(after.next_sync_at !== null && after.next_sync_at <= Date.now(), 'source stays due for when uploads return');
		// Once uploads are back on, the skipped source is queued again (the other source is still holding its job)
		const otherId = waitingParams.sourceId === first.id ? second.id : first.id;
		assert.equal((await readSource(env, otherId))!.next_sync_at, null);
		assert.equal(await queueDueSources(env as never), 1, 're-queued when uploads are back on');
	});

	it('a sync in its post phase skips quietly if uploads are switched off mid-post, leaving pending items pending', async () => {
		const { env, posts, job } = harness();
		const source = await insertSource(env, { channelId: 'ch1', network: 'rss', address: FEED, label: 'Blog', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'hourly', createdBy: ADMIN });
		const started = await startSourceSync(env as never, source, ADMIN, 'post');
		for (const id of ['p1', 'p2']) {
			await env.SEARCH_DB.prepare(
				`INSERT INTO import_source_items (source_id, item_id, kind, state, payload, original_url, original_at, note, created_at, updated_at)
				 VALUES (?, ?, 'text', 'pending', ?, ?, ?, NULL, 1, 1)`,
			)
				.bind(source.id, id, JSON.stringify({ itemId: id, url: `https://example.org/${id}`, postedAt: Date.parse('2026-11-10T09:00:00Z'), title: `Post ${id}`, text: `Body ${id}`, images: [], link: null, video: null }), `https://example.org/${id}`, Date.parse('2026-11-10T09:00:00Z'))
				.run();
		}
		const off = { ...env, FEATURES_FORCE_OFF: 'upload' };
		const out = await runSourceSync(off as never, { ...job({ sourceId: source.id, phase: 'post', fetched: 2, posted: 0, skipped: 0 }), id: started.id });
		assert.deepEqual([out.done, (out as { result: { skipped?: string } }).result.skipped], [true, 'uploads_off']);
		assert.equal(posts().length, 0);
		assert.deepEqual((await listItems(env, source.id)).map((i) => i.state), ['pending', 'pending']);
		const after = (await readSource(env, source.id))!;
		assert.equal(after.sync_job_id, null);
		assert.equal(after.last_sync_at, null);
		assert.equal(after.last_error, null);

		// Once uploads return, the pending items post cleanly
		const resumed = await runSourceSync(env as never, { ...job({ sourceId: source.id, phase: 'post', fetched: 2, posted: 0, skipped: 0 }), id: started.id });
		assert.equal(resumed.done, true);
		assert.equal(posts().length, 2);
	});

	it('the sync’s lookups on shared tables use indexes, never a scan', async () => {
		const { env } = harness();
		const plan = async (sql: string, ...args: unknown[]) =>
			(await env.SEARCH_DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...args).all<{ detail: string }>()).results.map((r) => r.detail).join(' | ');
		const ours = await plan("SELECT remote_id FROM social_deliveries WHERE network = ? AND remote_id IS NOT NULL AND remote_id IN (?, ?)", 'mastodon', '1', '2');
		assert.match(ours, /USING (COVERING )?INDEX idx_social_deliveries_network_remote/);
		const yts = await plan('SELECT id, yt_channel_json FROM yt_imports WHERE channel_id = ? AND yt_channel_json IS NOT NULL ORDER BY created_at DESC', 'ch1');
		assert.match(yts, /USING INDEX idx_yt_imports_channel/);
		assert.doesNotMatch(yts, /TEMP B-TREE/);
		const all = await plan('SELECT * FROM import_sources ORDER BY created_at DESC LIMIT 200');
		assert.match(all, /USING INDEX idx_import_sources_created/);
		const waitingTakeout = await plan(
			"SELECT s.* FROM import_sources s WHERE s.network = 'youtube' AND s.enabled = 1 AND EXISTS (SELECT 1 FROM import_takeout_files f WHERE f.source_id = s.id AND f.state = 'uploaded') ORDER BY s.address LIMIT 100",
		);
		assert.match(waitingTakeout, /USING INDEX idx_import_sources_network/);
		assert.match(waitingTakeout, /USING COVERING INDEX idx_import_takeout_files_state/);
		assert.doesNotMatch(waitingTakeout, /TEMP B-TREE/);
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

describe('cancelling a sync', () => {
	beforeEach(() => stubNetwork());
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	function routes(env: unknown) {
		const app = new Hono();
		app.route('/s', importSourcesRouter as never);
		return async (path: string, init: RequestInit = {}) => {
			const res = await app.request(path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': ADMIN } }, env as never);
			return { status: res.status, body: (await res.json()) as any };
		};
	}

	it('stops a queued sync as cancelled, says who did it, is idempotent, is no failure, and keeps the schedule', async () => {
		const { env, posts } = harness();
		const call = routes(env);
		const source = await insertSource(env, { channelId: 'ch1', network: 'rss', address: FEED, label: 'Blog', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'daily', createdBy: ADMIN });
		// The cron queued it and cleared its next time
		await env.SEARCH_DB.prepare('UPDATE import_sources SET next_sync_at = NULL WHERE id = ?').bind(source.id).run();
		const synced = await call(`/s/${source.id}/sync`, { method: 'POST' });
		const jobId = synced.body.result.jobId;

		const cancelled = await call(`/s/${source.id}/cancel`, { method: 'POST', body: JSON.stringify({ jobId, byName: 'Amina Staff' }) });
		assert.equal(cancelled.status, 200);
		assert.equal(cancelled.body.result.job.status, 'cancelled');
		const line = cancelled.body.result.job.log.at(-1);
		assert.deepEqual([line.event, line.by], ['cancelled', { id: ADMIN, name: 'Amina Staff' }]);

		await drainJobs(env as never);
		assert.equal(posts().length, 0, 'the queued delivery was dropped');
		const job = await getJobWithLog(env as never, jobId);
		assert.equal(job!.status, 'cancelled');
		assert.equal(job!.lastError, null);
		assert.equal(job!.log!.some((l) => l.event === 'failed' || l.event === 'failed_attempt'), false, 'not a failure');
		const row = await readSource(env, source.id);
		assert.equal(row!.last_error, null, 'no error on the source');
		assert.ok(row!.next_sync_at, 'the daily schedule continues');

		const again = await call(`/s/${source.id}/cancel`, { method: 'POST', body: JSON.stringify({ jobId }) });
		assert.deepEqual([again.status, again.body.result.job.status], [200, 'cancelled']);
		assert.equal(again.body.result.job.log.filter((l: { event: string }) => l.event === 'cancelled').length, 1, 'cancelled once');

		// Sync now starts a new run
		const next = await call(`/s/${source.id}/sync`, { method: 'POST' });
		assert.notEqual(next.body.result.jobId, jobId);
		await drainJobs(env as never);
		assert.equal(posts().length, 4);
		// A finished job: answered as it is
		const done = await call(`/s/${source.id}/cancel`, { method: 'POST', body: JSON.stringify({ jobId: next.body.result.jobId }) });
		assert.deepEqual([done.status, done.body.result.job.status], [200, 'succeeded']);
		// Not this source's job, or no such job
		const other = await insertSource(env, { channelId: 'ch1', network: 'rss', address: 'https://feeds.example.org/other.xml', label: 'O', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		const wrong = await call(`/s/${other.id}/cancel`, { method: 'POST', body: JSON.stringify({ jobId }) });
		assert.deepEqual([wrong.status, wrong.body.code], [404, 'job_not_found']);
	});

	it('stops a running sync between items, and Retry after a cancel starts a new run', async () => {
		const { env, posts, job } = harness();
		const call = routes(env);
		const source = await insertSource(env, { channelId: 'ch1', network: 'rss', address: FEED, label: 'Blog', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		const started = await startSourceSync(env as never, source, ADMIN);
		await call(`/s/${source.id}/cancel`, { method: 'POST', body: JSON.stringify({ jobId: started.id }) });
		// A delivery already running when the cancel landed: it posts nothing more
		const out = await runSourceSync(env as never, { ...job({ sourceId: source.id, phase: 'fetch' }), id: started.id });
		assert.deepEqual([out.done, (out as { result: { cancelled?: boolean } }).result.cancelled], [true, true]);
		assert.equal(posts().length, 0);

		// Cancelled while the source was being read: nothing posted, and the source is not marked synced
		const second = await insertSource(env, { channelId: 'ch1', network: 'rss', address: 'https://feeds.example.org/second.xml', label: 'S', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		const reading = await startSourceSync(env as never, second, ADMIN);
		stubNetwork((url) => {
			if (url !== 'https://feeds.example.org/second.xml') return null;
			// The admin's Cancel lands while the feed is read
			return (async () => {
				await cancelJob(env as never, reading.id, { id: ADMIN, name: null });
				return new Response(RSS, { headers: { 'content-type': 'application/rss+xml' } });
			})() as never;
		});
		const mid = await runSourceSync(env as never, { ...job({ sourceId: second.id, phase: 'fetch' }), id: reading.id });
		assert.deepEqual([mid.done, (mid as { result: { cancelled?: boolean } }).result.cancelled], [true, true]);
		assert.equal(posts().length, 0);
		assert.equal((await readSource(env, second.id))!.last_sync_at, null, 'not marked synced');
		stubNetwork();

		const retried = await call('/s/retry', { method: 'POST', body: JSON.stringify({ jobId: started.id }) });
		assert.equal(retried.status, 200);
		assert.notEqual(retried.body.result.jobId, started.id, 'a new run');
		await drainJobs(env as never);
		assert.equal(posts().length, 4);
	});
});

describe('a sync and its start', () => {
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('waits out a 429’s Retry-After a few times, then fails as the queue would', async () => {
		stubNetwork((url) => (url === FEED ? new Response('slow down', { status: 429, headers: { 'retry-after': '120' } }) : null));
		const { env, job } = harness();
		const source = await insertSource(env, { channelId: 'ch1', network: 'rss', address: FEED, label: 'Blog', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		let params: Record<string, unknown> = { sourceId: source.id, phase: 'fetch' };
		for (const n of [1, 2, 3]) {
			const out = await runSourceSync(env as never, job(params));
			assert.deepEqual([out.done, (out as { delaySeconds?: number }).delaySeconds], [false, 120], `wait ${n}`);
			params = (out as { params: Record<string, unknown> }).params;
			assert.equal(params.rateLimited, n);
		}
		await assert.rejects(runSourceSync(env as never, job(params)), /source_unreachable: .*http_429/);
		assert.equal(retryAfterSeconds('30'), 30);
		assert.equal(retryAfterSeconds(new Date(Date.parse('2026-11-23T10:01:00Z')).toUTCString(), Date.parse('2026-11-23T10:00:00Z')), 60);
		assert.equal(retryAfterSeconds('soon'), undefined);
	});

	it('a finishing sync releases its source: a start then queues a new sync, not the finishing one', async () => {
		stubNetwork();
		const { env, job } = harness();
		const source = await insertSource(env, { channelId: 'ch1', network: 'rss', address: FEED, label: 'Blog', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		const started = await startSourceSync(env as never, source, ADMIN);
		assert.equal((await startSourceSync(env as never, source, ADMIN)).id, started.id, 'one at a time while it runs');
		// Its last step: the job's own status is still running until the queue records the outcome
		const out = await runSourceSync(env as never, { ...job({ sourceId: source.id, phase: 'fetch' }), id: started.id });
		assert.equal(out.done, true);
		const next = await startSourceSync(env as never, (await readSource(env, source.id))!, ADMIN, 'post');
		assert.notEqual(next.id, started.id, 'a Telegram post recorded now gets its own sync');
	});
});

describe('YouTube Takeout files', () => {
	const rec = (itemId: string, title: string | null, state: MatchRecord['state'] = 'awaiting_file', durationMs: number | null = null): MatchRecord => ({ itemId, title, state, durationMs });
	const index = (records: MatchRecord[]) => {
		const byId = new Map(records.map((r) => [r.itemId, r]));
		const byTitle = new Map<string, MatchRecord[]>();
		for (const r of records.filter((x) => x.state === 'awaiting_file')) byTitle.set(normalizeTitle(r.title), [...(byTitle.get(normalizeTitle(r.title)) ?? []), r]);
		return { byId, byTitle };
	};

	it('matches by the Takeout video id, then a video id in the file name, then the title and duration', () => {
		const { byId, byTitle } = index([rec('AAAAAAAAAAA', 'Friday talk'), rec('BBBBBBBBBBB', 'Tafsir: part 2'), rec('CCCCCCCCCCC', 'Q&A', 'awaiting_file', 600_000), rec('DDDDDDDDDDD', 'Q&A', 'awaiting_file', 900_000), rec('EEEEEEEEEEE', 'Old', 'posted')]);
		const none = new Set<string>();
		const m = (file: Partial<{ name: string; youtubeId: string | null; title: string | null; durationMs: number | null }>, taken = none) =>
			matchTakeoutFile({ name: 'x.mp4', youtubeId: null, title: null, durationMs: null, ...file }, byId, byTitle, taken);
		assert.deepEqual(m({ youtubeId: 'AAAAAAAAAAA' }), { state: 'matched', itemId: 'AAAAAAAAAAA', matchedBy: 'video_id' });
		assert.deepEqual(m({ youtubeId: 'ZZZZZZZZZZZ', title: 'Friday talk' }), { state: 'unmatched', note: 'no_record' }, 'the export id is the answer');
		assert.deepEqual(m({ name: 'Anything [BBBBBBBBBBB].mp4' }), { state: 'matched', itemId: 'BBBBBBBBBBB', matchedBy: 'file_name' });
		assert.deepEqual(m({ name: 'Tafsir  part 2.mp4' }), { state: 'matched', itemId: 'BBBBBBBBBBB', matchedBy: 'title' }, 'punctuation and spacing do not count');
		assert.deepEqual(m({ name: 'Q&A.mp4' }), { state: 'ambiguous', candidates: ['CCCCCCCCCCC', 'DDDDDDDDDDD'], note: 'several_records' });
		assert.deepEqual(m({ name: 'Q&A.mp4', durationMs: 899_000 }), { state: 'matched', itemId: 'DDDDDDDDDDD', matchedBy: 'title' }, 'the duration settles it');
		assert.deepEqual(m({ youtubeId: 'EEEEEEEEEEE' }), { state: 'unmatched', note: 'has_file' });
		assert.deepEqual(m({ youtubeId: 'AAAAAAAAAAA' }, new Set(['AAAAAAAAAAA'])), { state: 'unmatched', note: 'file_taken' });
		assert.deepEqual(m({ name: 'Friday talk.mp4' }, new Set(['AAAAAAAAAAA'])), { state: 'unmatched', note: 'file_taken' });
		assert.deepEqual(m({ name: 'Unknown.mp4' }), { state: 'unmatched', note: 'no_record' });
		assert.equal(normalizeTitle('  الدرس ١: التفسير '), 'الدرس ١ التفسير', 'Arabic titles keep their letters and digits');
	});

	it('lists, matches, settles an ambiguous file, uploads and posts the video; a job failure retries', async () => {
		stubNetwork();
		const { env, posts } = harness();
		const app = new Hono();
		app.route('/s', importSourcesRouter as never);
		const call = async (path: string, init: RequestInit = {}) => {
			const res = await app.request(path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': ADMIN } }, env as never);
			return { status: res.status, body: (await res.json()) as any };
		};
		const source = await insertSource(env, { channelId: 'ch1', network: 'youtube', address: 'UCaaaaaaaaaaaaaaaaaaaaaa', label: 'YT', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		const wait = async (itemId: string, title: string) =>
			env.SEARCH_DB.prepare(`INSERT INTO import_source_items (source_id, item_id, kind, state, payload, original_url, original_at, note, created_at, updated_at) VALUES (?, ?, NULL, 'awaiting_file', ?, ?, ?, 'takeout_file', 1, 1)`)
				.bind(source.id, itemId, JSON.stringify({ itemId, url: `https://www.youtube.com/watch?v=${itemId}`, postedAt: Date.parse('2026-11-01T10:00:00Z'), title, text: `${title} description`, images: [], link: null, video: null, awaiting: 'takeout_file' }), `https://www.youtube.com/watch?v=${itemId}`, Date.parse('2026-11-01T10:00:00Z'))
				.run();
		await wait('AAAAAAAAAAA', 'Friday talk');
		await wait('CCCCCCCCCCC', 'Q&A');
		await wait('DDDDDDDDDDD', 'Q&A');

		// Not a YouTube source
		const rss = await insertSource(env, { channelId: 'ch1', network: 'rss', address: FEED, label: 'Blog', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		assert.deepEqual((await call(`/s/${rss.id}/takeout`)).body.code, 'not_youtube');

		const files = [
			{ name: 'Friday talk.mp4', size: 3000, videoId: 'AAAAAAAAAAA', title: 'Friday talk', durationMs: 60_000 },
			{ name: 'Q&A.mp4', size: 4000 },
			{ name: 'Holiday.mp4', size: 5000 },
		];
		const listed = await call(`/s/${source.id}/takeout/files`, { method: 'POST', body: JSON.stringify({ files }) });
		assert.deepEqual([listed.status, listed.body.result.added], [202, 3]);
		const relisted = await call(`/s/${source.id}/takeout/files`, { method: 'POST', body: JSON.stringify({ files }) });
		assert.equal(relisted.body.result.added, 0, 'listing again finds the same rows');
		assert.equal(relisted.body.result.jobId, listed.body.result.jobId, 'one match job per source at a time');
		await drainJobs(env as never);

		const report = (await call(`/s/${source.id}/takeout`)).body.result;
		assert.deepEqual(report.counts, { matched: 1, ambiguous: 1, unmatched: 1 });
		const byName = Object.fromEntries(report.files.map((f: any) => [f.name, f]));
		assert.deepEqual([byName['Friday talk.mp4'].matchedBy, byName['Friday talk.mp4'].item.title], ['video_id', 'Friday talk']);
		assert.deepEqual(byName['Q&A.mp4'].candidates.map((c: any) => c.itemId), ['CCCCCCCCCCC', 'DDDDDDDDDDD']);
		assert.equal(byName['Holiday.mp4'].note, 'no_record');

		const ambiguous = byName['Q&A.mp4'].id;
		const notCandidate = await call(`/s/${source.id}/takeout/files/${ambiguous}/confirm`, { method: 'POST', body: JSON.stringify({ itemId: 'AAAAAAAAAAA' }) });
		assert.deepEqual([notCandidate.status, notCandidate.body.code], [400, 'not_a_candidate']);
		const confirmed = await call(`/s/${source.id}/takeout/files/${ambiguous}/confirm`, { method: 'POST', body: JSON.stringify({ itemId: 'DDDDDDDDDDD' }) });
		assert.deepEqual([confirmed.body.result.file.state, confirmed.body.result.file.matchedBy], ['matched', 'admin']);
		const unmatchedUpload = await call(`/s/${source.id}/takeout/files/${byName['Holiday.mp4'].id}/upload`, { method: 'POST' });
		assert.deepEqual([unmatchedUpload.status, unmatchedUpload.body.code], [409, 'not_matched']);

		// The app opens the upload, sends the file, then says so
		const opened = await call(`/s/${source.id}/takeout/files/${byName['Friday talk.mp4'].id}/upload`, { method: 'POST' });
		assert.equal(opened.status, 200);
		const videoId = opened.body.result.upload.videoId;
		assert.ok(videoId && opened.body.result.upload.tusSessionId, 'a resumable upload');
		const reopened = await call(`/s/${source.id}/takeout/files/${byName['Friday talk.mp4'].id}/upload`, { method: 'POST' });
		assert.equal(reopened.body.result.upload.videoId, videoId, 'opening it again resumes the same video');
		const video = env.videos.read(videoId);
		assert.deepEqual([video.userId, video.uploadedBy, video.importedFrom.platform, video.importedFrom.videoId], [OWNER, ADMIN, 'youtube', 'AAAAAAAAAAA']);

		// Said uploaded before the file landed: the job retries, then fails (DLQ, Errors page with Retry)
		const said = await call(`/s/${source.id}/takeout/files/${byName['Friday talk.mp4'].id}/uploaded`, { method: 'POST' });
		assert.equal(said.status, 202);
		await drainJobs(env as never);
		const failed = await getJobWithLog(env as never, said.body.result.jobId);
		assert.equal(failed!.status, 'failed');
		assert.match(failed!.lastError!, /^upload_incomplete/);
		assert.equal(posts().length, 0);

		// The file lands (the TUS proxy completes the upload); Retry posts it
		for (const [key, raw] of env.videos.store) if (key.includes(videoId)) env.videos.store.set(key, JSON.stringify({ ...JSON.parse(raw), uploadStatus: 'processing' }));
		const retried = await call('/s/retry', { method: 'POST', body: JSON.stringify({ jobId: said.body.result.jobId }) });
		assert.equal(retried.status, 200);
		await drainJobs(env as never);
		const [post] = posts();
		assert.deepEqual([post!.type, post!.videoId, post!.importedFrom], ['video', videoId, undefined]);
		const after = (await call(`/s/${source.id}/takeout`)).body.result;
		assert.equal(after.files.find((f: any) => f.name === 'Friday talk.mp4').state, 'attached');
		const item = (await listItems(env, source.id)).find((i) => i.itemId === 'AAAAAAAAAAA');
		assert.deepEqual([item!.state, item!.videoId, item!.postId], ['posted', videoId, post!.id]);
		assert.equal((await getJobWithLog(env as never, said.body.result.jobId))!.status, 'succeeded');
	});

	it('a cancelled Takeout job stops before its first matching step and leaves files untouched', async () => {
		const { env, job } = harness();
		const app = new Hono();
		app.route('/s', importSourcesRouter as never);
		const call = async (path: string, init: RequestInit = {}) => {
			const res = await app.request(path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': ADMIN } }, env as never);
			return { status: res.status, body: (await res.json()) as any };
		};
		const source = await insertSource(env, { channelId: 'ch1', network: 'youtube', address: 'UCbbbbbbbbbbbbbbbbbbbbbb', label: 'YT', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		await env.SEARCH_DB.prepare(`INSERT INTO import_source_items (source_id, item_id, kind, state, payload, original_url, original_at, note, created_at, updated_at) VALUES (?, ?, NULL, 'awaiting_file', ?, ?, ?, 'takeout_file', 1, 1)`)
			.bind(source.id, 'AAAAAAAAAAA', JSON.stringify({ itemId: 'AAAAAAAAAAA', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', postedAt: Date.parse('2026-11-01T10:00:00Z'), title: 'Friday talk', text: 'desc', images: [], link: null, video: null, awaiting: 'takeout_file' }), 'https://www.youtube.com/watch?v=AAAAAAAAAAA', Date.parse('2026-11-01T10:00:00Z'))
			.run();
		const listed = await call(`/s/${source.id}/takeout/files`, {
			method: 'POST',
			body: JSON.stringify({ files: [{ name: 'Friday talk.mp4', size: 3000, videoId: 'AAAAAAAAAAA', title: 'Friday talk', durationMs: 60_000 }] }),
		});
		assert.equal(listed.status, 202);
		const jobId = listed.body.result.jobId as string;

		const cancelled = await call(`/s/${source.id}/cancel`, { method: 'POST', body: JSON.stringify({ jobId, byName: 'Amina Staff' }) });
		assert.deepEqual([cancelled.status, cancelled.body.result.job.status], [200, 'cancelled']);

		// A delivery that reaches runTakeoutJob after cancel must stop before matchStep
		const out = await runTakeoutJob(env as never, { ...job({ sourceId: source.id }), id: jobId, kind: 'import.takeout-match' });
		assert.deepEqual([out.done, (out as { result: { cancelled?: boolean; matched?: number } }).result.cancelled, (out as { result: { matched?: number } }).result.matched], [true, true, 0]);
		const report = (await call(`/s/${source.id}/takeout`)).body.result;
		assert.deepEqual(report.counts, { new: 1 });
		assert.equal(report.files[0].state, 'new');
		assert.equal(report.files[0].itemId, null);
	});

	it('a Takeout job cancelled during matchStep stops immediately without scheduling another step or reading uploaded files', async () => {
		const { env, posts, job } = harness();
		const app = new Hono();
		app.route('/s', importSourcesRouter as never);
		const call = async (path: string, init: RequestInit = {}) => {
			const res = await app.request(path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': ADMIN } }, env as never);
			return { status: res.status, body: (await res.json()) as any };
		};
		const source = await insertSource(env, { channelId: 'ch1', network: 'youtube', address: 'UCcccccccccccccccccccccc', label: 'YT', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		// Seed TAKEOUT_MATCH_PER_STEP (100) 'new' files so matchStep hits the step limit: without the
		// post-matchStep cancel check, runTakeoutSteps would return again() (done: false) instead of cancelling.
		const files = Array.from({ length: 100 }, (_, i) => ({
			name: `Unmatched ${String(i).padStart(3, '0')}.mp4`,
			size: 1000 + i,
			title: `Unmatched ${i}`,
		}));
		const listed = await call(`/s/${source.id}/takeout/files`, { method: 'POST', body: JSON.stringify({ files }) });
		assert.equal(listed.status, 202);
		const jobId = listed.body.result.jobId as string;

		// Cancel lands while matchStep is running its updates
		let cancelledMidMatch = false;
		const origPrepare = env.SEARCH_DB.prepare.bind(env.SEARCH_DB);
		env.SEARCH_DB.prepare = ((sql: string) => {
			const stmt = origPrepare(sql);
			if (!cancelledMidMatch && sql.startsWith('UPDATE import_takeout_files SET')) {
				const origBind = stmt.bind.bind(stmt);
				stmt.bind = (...args: unknown[]) => {
					const bound = origBind(...args);
					const origRun = bound.run.bind(bound);
					bound.run = async () => {
						const res = await origRun();
						if (!cancelledMidMatch) {
							cancelledMidMatch = true;
							await cancelJob(env as never, jobId, { id: ADMIN, name: 'Amina Staff' });
						}
						return res;
					};
					return bound;
				};
			}
			return stmt;
		}) as typeof env.SEARCH_DB.prepare;

		const out = await runTakeoutJob(env as never, { ...job({ sourceId: source.id }), id: jobId, kind: 'import.takeout-match' });
		env.SEARCH_DB.prepare = origPrepare;
		assert.deepEqual(
			[out.done, (out as { result: { cancelled?: boolean; unmatched?: number; attached?: number } }).result.cancelled, (out as { result: { unmatched?: number } }).result.unmatched, (out as { result: { attached?: number } }).result.attached],
			[true, true, 100, 0],
		);
		assert.equal(posts().length, 0);
	});

	it('a Takeout job skips posting already-uploaded files while uploads are off, keeps matching new files, and resumes automatically via queueDueSources', async () => {
		const { env, posts, job } = harness();
		const app = new Hono();
		app.route('/s', importSourcesRouter as never);
		const call = async (path: string, init: RequestInit = {}) => {
			const res = await app.request(path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': ADMIN } }, env as never);
			return { status: res.status, body: (await res.json()) as any };
		};
		const source = await insertSource(env, { channelId: 'ch1', network: 'youtube', address: 'UCdddddddddddddddddddddd', label: 'YT', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
		const waitItem = async (itemId: string, title: string) =>
			env.SEARCH_DB.prepare(`INSERT INTO import_source_items (source_id, item_id, kind, state, payload, original_url, original_at, note, created_at, updated_at) VALUES (?, ?, NULL, 'awaiting_file', ?, ?, ?, 'takeout_file', 1, 1)`)
				.bind(source.id, itemId, JSON.stringify({ itemId, url: `https://www.youtube.com/watch?v=${itemId}`, postedAt: Date.parse('2026-11-01T10:00:00Z'), title, text: `${title} desc`, images: [], link: null, video: null, awaiting: 'takeout_file' }), `https://www.youtube.com/watch?v=${itemId}`, Date.parse('2026-11-01T10:00:00Z'))
				.run();
		await waitItem('AAAAAAAAAAA', 'Talk A');
		await waitItem('BBBBBBBBBBB', 'Talk B');
		await waitItem('CCCCCCCCCCC', 'Talk C');
		await waitItem('DDDDDDDDDDD', 'Talk D');
		await waitItem('EEEEEEEEEEE', 'Talk E');

		// Match A and B, open uploads, complete their R2 videos, and leave both in 'uploaded'
		await call(`/s/${source.id}/takeout/files`, {
			method: 'POST',
			body: JSON.stringify({
				files: [
					{ name: 'Talk A.mp4', size: 2000, videoId: 'AAAAAAAAAAA', title: 'Talk A' },
					{ name: 'Talk B.mp4', size: 2500, videoId: 'BBBBBBBBBBB', title: 'Talk B' },
				],
			}),
		});
		await drainJobs(env as never);
		const existing = Object.fromEntries((await call(`/s/${source.id}/takeout`)).body.result.files.map((f: any) => [f.name, f.id as string]));
		for (const fileId of [existing['Talk A.mp4']!, existing['Talk B.mp4']!]) {
			const opened = await call(`/s/${source.id}/takeout/files/${fileId}/upload`, { method: 'POST' });
			const vid = opened.body.result.upload.videoId as string;
			for (const [key, raw] of env.videos.store) if (key.includes(vid)) env.videos.store.set(key, JSON.stringify({ ...JSON.parse(raw), uploadStatus: 'processing' }));
			await env.SEARCH_DB.prepare("UPDATE import_takeout_files SET state = 'uploaded' WHERE id = ?").bind(fileId).run();
		}

		// 1a. Uploads off with a 'new' file (Talk E) arriving before takeout_job_id is released:
		//     the first hasNew() branch returns again() immediately without releasing takeout_job_id.
		const listed = await call(`/s/${source.id}/takeout/files`, { method: 'POST', body: JSON.stringify({ files: [{ name: 'Talk C.mp4', size: 3000, videoId: 'CCCCCCCCCCC', title: 'Talk C' }] }) });
		const jobId = listed.body.result.jobId as string;
		const origPrepare = env.SEARCH_DB.prepare.bind(env.SEARCH_DB);
		let insertedE = false;
		let releasedDuringFirstHasNew = false;
		env.SEARCH_DB.prepare = ((sql: string) => {
			const stmt = origPrepare(sql);
			if (sql.startsWith('UPDATE import_sources SET takeout_job_id = NULL')) {
				releasedDuringFirstHasNew = true;
			}
			if (!insertedE && sql.includes("state = 'uploaded'")) {
				const origBind = stmt.bind.bind(stmt);
				stmt.bind = (...args: unknown[]) => {
					const bound = origBind(...args);
					const origAll = bound.all.bind(bound);
					bound.all = async () => {
						const res = await origAll();
						if (!insertedE) {
							insertedE = true;
							await origPrepare(
								`INSERT INTO import_takeout_files (id, source_id, name, size, youtube_id, title, state, created_by, created_at, updated_at)
								 VALUES ('tkf_talk_e', ?, 'Talk E.mp4', 4000, 'EEEEEEEEEEE', 'Talk E', 'new', ?, 1, 1)`,
							)
								.bind(source.id, ADMIN)
								.run();
						}
						return res;
					};
					return bound;
				};
			}
			return stmt;
		}) as typeof env.SEARCH_DB.prepare;

		const off = { ...env, FEATURES_FORCE_OFF: 'upload' };
		const stepFirstHasNew = await runTakeoutJob(off as never, { ...job({ sourceId: source.id }), id: jobId, kind: 'import.takeout-match' });
		env.SEARCH_DB.prepare = origPrepare;
		assert.equal(stepFirstHasNew.done, false, 'first hasNew() continues without releasing takeout_job_id');
		assert.equal(releasedDuringFirstHasNew, false, 'takeout_job_id was not released before returning again()');
		assert.equal((await readSource(env, source.id))!.takeout_job_id, jobId);

		// 1b. Next step matches Talk E, then sees uploads off; a 'new' file (Talk D) listed right as the
		//     uploads-off exit releases takeout_job_id is NOT stranded: the job re-claims takeout_job_id
		//     and returns again() so Talk D is matched on the following step.
		let insertedD = false;
		env.SEARCH_DB.prepare = ((sql: string) => {
			const stmt = origPrepare(sql);
			if (!insertedD && sql.startsWith('UPDATE import_sources SET takeout_job_id = NULL')) {
				const origBind = stmt.bind.bind(stmt);
				stmt.bind = (...args: unknown[]) => {
					const bound = origBind(...args);
					const origRun = bound.run.bind(bound);
					bound.run = async () => {
						const res = await origRun();
						if (!insertedD) {
							insertedD = true;
							await origPrepare(
								`INSERT INTO import_takeout_files (id, source_id, name, size, youtube_id, title, state, created_by, created_at, updated_at)
								 VALUES ('tkf_talk_d', ?, 'Talk D.mp4', 3500, 'DDDDDDDDDDD', 'Talk D', 'new', ?, 1, 1)`,
							)
								.bind(source.id, ADMIN)
								.run();
						}
						return res;
					};
					return bound;
				};
			}
			return stmt;
		}) as typeof env.SEARCH_DB.prepare;

		const stepWithRace = await runTakeoutJob(off as never, { ...job((stepFirstHasNew as { params: Record<string, unknown> }).params), id: jobId, kind: 'import.takeout-match' });
		env.SEARCH_DB.prepare = origPrepare;
		assert.equal(stepWithRace.done, false, 're-claimed takeout_job_id to match newly listed Talk D');
		assert.equal((await readSource(env, source.id))!.takeout_job_id, jobId);

		// Next step matches Talk D, then sees no more 'new' files and exits cleanly with skipped: 'uploads_off'
		const outOff = await runTakeoutJob(off as never, { ...job((stepWithRace as { params: Record<string, unknown> }).params), id: jobId, kind: 'import.takeout-match' });
		assert.deepEqual(
			[outOff.done, (outOff as { result: { skipped?: string; matched?: number; attached?: number } }).result.skipped, (outOff as { result: { matched?: number } }).result.matched, (outOff as { result: { attached?: number } }).result.attached],
			[true, 'uploads_off', 3, 0],
		);
		assert.equal(posts().length, 0);
		assert.equal((await readSource(env, source.id))!.takeout_job_id, null, 'takeout_job_id released');
		const afterOff = Object.fromEntries((await call(`/s/${source.id}/takeout`)).body.result.files.map((f: any) => [f.name, f.state]));
		assert.deepEqual(afterOff, { 'Talk A.mp4': 'uploaded', 'Talk B.mp4': 'uploaded', 'Talk C.mp4': 'matched', 'Talk D.mp4': 'matched', 'Talk E.mp4': 'matched' });
		// While uploads remain off, the hourly sweep queues nothing
		assert.equal(await queueDueSources(off as never), 0);

		// 2. Mid-post switch-off: Talk A posts while uploads are on, then uploads switch off before Talk B
		//    (featureGate reads FEATURES_FORCE_OFF once per uploadsOn check in feature-switch-store.ts).
		let checks = 0;
		const flipMidPost = Object.create(env, {
			FEATURES_FORCE_OFF: {
				get() {
					return ++checks >= 2 ? 'upload' : undefined;
				},
			},
		});
		const outMid = await runTakeoutJob(flipMidPost as never, { ...job({ sourceId: source.id }), id: jobId, kind: 'import.takeout-match' });
		assert.deepEqual(
			[outMid.done, (outMid as { result: { skipped?: string; attached?: number } }).result.skipped, (outMid as { result: { attached?: number } }).result.attached],
			[true, 'uploads_off', 1],
		);
		assert.equal(posts().length, 1);
		assert.equal((await readSource(env, source.id))!.takeout_job_id, null);
		const afterMid = Object.fromEntries((await call(`/s/${source.id}/takeout`)).body.result.files.map((f: any) => [f.name, f.state]));
		assert.deepEqual(afterMid, { 'Talk A.mp4': 'attached', 'Talk B.mp4': 'uploaded', 'Talk C.mp4': 'matched', 'Talk D.mp4': 'matched', 'Talk E.mp4': 'matched' });

		// 3. Automatic resume: when uploads come back on, queueDueSources queues a new Takeout job for Talk B
		//    and draining the queue posts Talk B without double-posting Talk A.
		assert.equal(await queueDueSources(env as never), 1, 'sweep queues waiting Takeout source');
		assert.equal(await queueDueSources(env as never), 0, 'not queued twice while active');
		await drainJobs(env as never);
		assert.equal(posts().length, 2, 'Talk B posted on resume');
		const afterResume = Object.fromEntries((await call(`/s/${source.id}/takeout`)).body.result.files.map((f: any) => [f.name, f.state]));
		assert.deepEqual(afterResume, { 'Talk A.mp4': 'attached', 'Talk B.mp4': 'attached', 'Talk C.mp4': 'matched', 'Talk D.mp4': 'matched', 'Talk E.mp4': 'matched' });
	});

	it('queueWaitingTakeout skips disabled sources and sources whose last Takeout job failed or was cancelled', async () => {
		const { env, posts } = harness();
		const app = new Hono();
		app.route('/s', importSourcesRouter as never);
		const call = async (path: string, init: RequestInit = {}) => {
			const res = await app.request(path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': ADMIN } }, env as never);
			return { status: res.status, body: (await res.json()) as any };
		};
		const seedUploaded = async (address: string, itemId: string, completeUpload: boolean) => {
			const source = await insertSource(env, { channelId: 'ch1', network: 'youtube', address, label: 'YT', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'manual', createdBy: ADMIN });
			await env.SEARCH_DB.prepare(`INSERT INTO import_source_items (source_id, item_id, kind, state, payload, original_url, original_at, note, created_at, updated_at) VALUES (?, ?, NULL, 'awaiting_file', ?, ?, ?, 'takeout_file', 1, 1)`)
				.bind(source.id, itemId, JSON.stringify({ itemId, url: `https://www.youtube.com/watch?v=${itemId}`, postedAt: Date.parse('2026-11-01T10:00:00Z'), title: `Talk ${itemId}`, text: 'desc', images: [], link: null, video: null, awaiting: 'takeout_file' }), `https://www.youtube.com/watch?v=${itemId}`, Date.parse('2026-11-01T10:00:00Z'))
				.run();
			await call(`/s/${source.id}/takeout/files`, { method: 'POST', body: JSON.stringify({ files: [{ name: `${itemId}.mp4`, size: 2000, videoId: itemId, title: `Talk ${itemId}` }] }) });
			await drainJobs(env as never);
			const fileId = (await call(`/s/${source.id}/takeout`)).body.result.files[0].id as string;
			const opened = await call(`/s/${source.id}/takeout/files/${fileId}/upload`, { method: 'POST' });
			if (completeUpload) {
				const vid = opened.body.result.upload.videoId as string;
				for (const [key, raw] of env.videos.store) if (key.includes(vid)) env.videos.store.set(key, JSON.stringify({ ...JSON.parse(raw), uploadStatus: 'processing' }));
			}
			return { source, fileId };
		};

		// 1. Disabled source with an uploaded file: skipped while disabled, resumed once re-enabled
		const disabled = await seedUploaded('UC1111111111111111111111', 'AAAAAAAAAAA', true);
		await env.SEARCH_DB.prepare("UPDATE import_takeout_files SET state = 'uploaded' WHERE id = ?").bind(disabled.fileId).run();
		await env.SEARCH_DB.prepare('UPDATE import_sources SET enabled = 0 WHERE id = ?').bind(disabled.source.id).run();
		assert.equal(await queueDueSources(env as never), 0, 'disabled source is not queued');
		assert.equal(posts().length, 0);

		// 2. Source whose last Takeout job failed (e.g., upload_incomplete): stays on Errors page for Retry, not re-queued hourly
		const failing = await seedUploaded('UC2222222222222222222222', 'BBBBBBBBBBB', false);
		const saidFailed = await call(`/s/${failing.source.id}/takeout/files/${failing.fileId}/uploaded`, { method: 'POST' });
		assert.equal(saidFailed.status, 202);
		await drainJobs(env as never);
		assert.equal((await getJobWithLog(env as never, saidFailed.body.result.jobId))!.status, 'failed');
		assert.equal(await queueDueSources(env as never), 0, 'failed Takeout job is not re-queued every hour');

		// 3. Source whose last Takeout job was cancelled: not silently restarted by the hourly sweep
		const cancelled = await seedUploaded('UC3333333333333333333333', 'CCCCCCCCCCC', true);
		const saidCancel = await call(`/s/${cancelled.source.id}/takeout/files/${cancelled.fileId}/uploaded`, { method: 'POST' });
		assert.equal(saidCancel.status, 202);
		await call(`/s/${cancelled.source.id}/cancel`, { method: 'POST', body: JSON.stringify({ jobId: saidCancel.body.result.jobId, byName: 'Amina Staff' }) });
		assert.equal((await getJobWithLog(env as never, saidCancel.body.result.jobId))!.status, 'cancelled');
		assert.equal(await queueDueSources(env as never), 0, 'cancelled Takeout job is not re-queued');

		// Re-enabling the disabled source lets the sweep resume only that source
		await env.SEARCH_DB.prepare('UPDATE import_sources SET enabled = 1 WHERE id = ?').bind(disabled.source.id).run();
		assert.equal(await queueDueSources(env as never), 1, 're-enabled waiting source is queued');
		await drainJobs(env as never);
		assert.equal(posts().length, 1);
	});
});

describe('Takeout files hold a record once', () => {
	it('refuses a second file holding the same record, in any holding state', async () => {
		const { env } = harness();
		const add = (id: string, state: string, itemId: string | null) =>
			env.SEARCH_DB.prepare(`INSERT INTO import_takeout_files (id, source_id, name, size, state, item_id, created_by, created_at, updated_at) VALUES (?, 'isrc_x', ?, 1, ?, ?, 'a', 1, 1)`).bind(id, `${id}.mp4`, state, itemId).run();
		await add('f1', 'matched', 'AAAAAAAAAAA');
		await assert.rejects(add('f2', 'uploading', 'AAAAAAAAAAA'), /UNIQUE constraint failed/);
		await add('f3', 'failed', 'AAAAAAAAAAA');
		await add('f4', 'unmatched', null);
		await add('f5', 'unmatched', null);
	});
});

describe('why a sync failed, in codes the apps translate', () => {
	afterEach(() => {
		globalThis.fetch = realFetch;
	});

	it('collapses fetch refusals to stable codes, with the detail after the colon', () => {
		const coded = (code: ConstructorParameters<typeof PreviewError>[0], status?: number) => codedReason(new PreviewError(code, status), 'sync_failed');
		assert.equal(coded('unreachable', 503), 'source_unreachable: The source could not be read (http_503)');
		assert.equal(coded('unreachable', 429), 'source_unreachable: The source could not be read (http_429)');
		assert.equal(coded('unreachable'), 'source_unreachable: The source could not be read (no_answer)', 'no answer or a timeout');
		assert.equal(coded('too_many_redirects'), 'source_unreachable: The source could not be read (too_many_redirects)');
		assert.equal(coded('blocked'), 'source_unreachable: The source could not be read (private_address)');
		assert.equal(coded('unreachable', 404), 'source_not_found: The source was not found (http_404)');
		assert.equal(coded('unreachable', 410), 'source_not_found: The source was not found (http_410)');
		assert.equal(coded('unreachable', 401), 'source_forbidden: The source refused access (http_401)');
		assert.equal(coded('unreachable', 403), 'source_forbidden: The source refused access (http_403)');
		assert.equal(coded('unreachable', 400), "source_bad_response: The source gave an answer the sync can't use (http_400)");
		assert.equal(coded('too_large'), "source_bad_response: The source gave an answer the sync can't use (too_large)");
		assert.equal(sourceErrorFromPreview(new PreviewError('unreachable', 502)).code, 'source_unreachable');
	});

	it('keeps a SourceError code, wraps plain errors, and never codes a reason twice', () => {
		assert.equal(codedReason(new SourceError(409, 'channel_unavailable', 'The channel is deleted or suspended'), 'sync_failed'), 'channel_unavailable: The channel is deleted or suspended');
		assert.equal(codedReason(new SourceError(502, 'source_not_a_feed', 'The address is not an RSS or Atom feed'), 'sync_failed'), 'source_not_a_feed: The address is not an RSS or Atom feed');
		assert.equal(codedReason(new Error('The image could not be stored'), 'sync_failed'), 'sync_failed: The image could not be stored');
		assert.equal(codedReason(new Error('D1 is busy'), 'takeout_failed'), 'takeout_failed: D1 is busy');
		assert.equal(codedReason(new Error('upload_incomplete: the video v1 has not finished uploading'), 'takeout_failed'), 'upload_incomplete: the video v1 has not finished uploading');
		assert.equal(codedReason('boom', 'sync_failed'), 'sync_failed: boom');
	});

	for (const [label, answer, expected] of [
		['a 503', () => new Response('down', { status: 503 }), 'source_unreachable: The source could not be read (http_503)'],
		['a 404', () => new Response('gone', { status: 404 }), 'source_not_found: The source was not found (http_404)'],
		['a page that is not a feed', () => new Response('<html><body>hi</body></html>', { headers: { 'content-type': 'text/html' } }), 'source_not_a_feed: The address is not an RSS or Atom feed'],
	] as const) {
		it(`stores ${label} on the job and the source as "<code>: <detail>"`, async () => {
			stubNetwork((url) => (url === FEED ? answer() : null));
			const { env } = harness();
			const source = await insertSource(env, { channelId: 'ch1', network: 'rss', address: FEED, label: 'Blog', auth: 'recorded', socialAccountId: null, ytImportId: null, permission: recorded, schedule: 'daily', createdBy: ADMIN });
			const job = await startSourceSync(env as never, source, ADMIN);
			await drainJobs(env as never);
			const failed = await getJobWithLog(env as never, job.id);
			assert.equal(failed!.status, 'failed');
			assert.equal(failed!.lastError, expected);
			assert.equal(failed!.log!.at(-1)!.error, expected, 'the log line too');
			await onSourceSyncFailed(env as never, failed!, failed!.lastError!);
			assert.equal((await readSource(env, source.id))!.last_error, expected);
		});
	}
});
