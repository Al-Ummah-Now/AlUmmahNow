/**
 * Social auto-post (wiki AUN-SOCIAL, SOC-1; owner 2026-11-14: X, Telegram, Bluesky, Mastodon, no Meta):
 * planning an event into deliveries, one attempt per delivery against mocked network APIs, the admin kill
 * switch, the X spend cap, reconnects, and the signed outgoing webhooks. No real network calls.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	X_LINK_POST_COST_MICROS,
	X_POST_COST_MICROS,
	normalizeSocialSettings,
	verifyWebhookSignature,
	spendMonth,
	socialFailureReason,
} from '@al-ummah/shared-types';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, MemoryQueue, videoFixture } from './helpers';
import { sealJson, sealText } from '../src/lib/social/crypto';
import { readDelivery, readAccount, readSpend, saveRule, saveTemplate, upsertAccount, writeSetting, readWebhook } from '../src/lib/social/store';
import { attemptPost, attemptWebhook, composePost, giveUpPost, planEvent, requeueWebhookDelivery, webhookSecretBound } from '../src/lib/social/deliver';
import { tokenBound } from '../src/lib/social/connect';
import { writeCredentials, type SocialEnv } from '../src/lib/social/platform';
import type { SocialContent } from '../src/lib/social/content';
import { socialInternalRouter, socialRouter } from '../src/routers/social.router';

const KEK = `1:${Buffer.alloc(32, 7).toString('base64')}`;
const WEB = 'https://videos.example.test';

interface Call {
	url: string;
	method: string;
	body: string;
	headers: Record<string, string>;
}

/** A fetch that answers by URL prefix and records every call. */
function fakeFetch(routes: Array<[string | RegExp, (call: Call) => Response | Promise<Response>]>) {
	const calls: Call[] = [];
	const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const url = String(input);
		const headers: Record<string, string> = {};
		new Headers(init.headers).forEach((v, k) => (headers[k] = v));
		const body = typeof init.body === 'string' ? init.body : init.body ? '[binary]' : '';
		const call = { url, method: init.method ?? 'GET', body, headers };
		calls.push(call);
		const hit = routes.find(([p]) => (typeof p === 'string' ? url.startsWith(p) : p.test(url)));
		if (!hit) return new Response('not mocked', { status: 599 });
		return hit[1](call);
	}) as typeof fetch;
	return { f, calls };
}

const json = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });

function makeEnv() {
	const db = new SqliteD1();
	const queue = new MemoryQueue();
	const channels = new MemoryBucket({ ch1: { id: 'ch1', name: 'Noor Channel', nameLocalized: { ar: 'قناة نور' }, handle: 'noor' } });
	const videos = new MemoryBucket({
		v1: videoFixture({ id: 'v1', channelId: 'ch1', title: 'Friday reminder', titleLocalized: { ar: 'تذكير الجمعة' }, duration: 120, encodeProgress: 100, status: 4, isEncoded: true }),
		priv: videoFixture({ id: 'priv', channelId: 'ch1', title: 'Hidden', isPublic: false }),
	});
	const env = {
		SEARCH_DB: db,
		SOCIAL_TOKEN_KEK: KEK,
		queue,
		channels,
		videos,
		VIDEOS_WEB_URL: WEB,
		ENVIRONMENT: 'test',
	} as unknown as SocialEnv;
	return { env, db, queue, channels, videos };
}

async function connect(env: SocialEnv, network: 'x' | 'telegram' | 'bluesky' | 'mastodon', extra: Record<string, unknown> = {}, expiresAt: number | null = null) {
	const a = await upsertAccount(env, {
		channelId: 'ch1',
		network,
		remoteId: network === 'telegram' ? '-100123' : `${network}-remote`,
		handle: network === 'telegram' ? '@noorchan' : 'noor',
		displayName: 'Noor',
		instance: network === 'mastodon' ? 'masto.example' : null,
		language: 'en',
		tokenCiphertext: null,
		tokenExpiresAt: expiresAt,
		connectedBy: 'owner',
	});
	if (network !== 'telegram') {
		const tokens = { accessToken: 'at-1', refreshToken: 'rt-1', expiresAt, ...(network === 'mastodon' ? { instance: 'masto.example' } : {}), ...extra };
		await env.SEARCH_DB!.prepare('UPDATE social_accounts SET token_ciphertext = ? WHERE id = ?').bind(await sealJson(env, tokens, tokenBound(a.id)), a.id).run();
	}
	return a;
}

async function enableAll(env: SocialEnv, xCap = 0) {
	await writeSetting(env, 'platform', JSON.stringify(normalizeSocialSettings({ networks: { x: { enabled: true } }, xMonthlyCapUsd: xCap })), 'admin');
}

describe('planning an event', () => {
	let t: ReturnType<typeof makeEnv>;
	beforeEach(() => (t = makeEnv()));

	it('plans one delivery per enabled rule, queues it, and never twice for the same event', async () => {
		const m = await connect(t.env, 'mastodon');
		const tg = await connect(t.env, 'telegram');
		await saveRule(t.env, m.id, { event: 'video', enabled: true, format: 'link', includeLink: true });
		await saveRule(t.env, tg.id, { event: 'video', enabled: false, format: 'link', includeLink: true });
		await saveRule(t.env, tg.id, { event: 'short', enabled: true, format: 'link', includeLink: true });

		assert.deepEqual(await planEvent(t.env, 'ch1', 'video', 'v1'), { posts: 1, webhooks: 0 });
		assert.equal(t.queue.messages.length, 1);
		assert.equal(t.queue.messages[0].payload.kind, 'post');
		// A redelivered queue message plans nothing new
		assert.deepEqual(await planEvent(t.env, 'ch1', 'video', 'v1'), { posts: 0, webhooks: 0 });
		assert.equal(t.queue.messages.length, 1);
	});

	it('plans nothing for content that is not public', async () => {
		const m = await connect(t.env, 'mastodon');
		await saveRule(t.env, m.id, { event: 'video', enabled: true, format: 'link', includeLink: true });
		assert.deepEqual(await planEvent(t.env, 'ch1', 'video', 'priv'), { posts: 0, webhooks: 0 });
		assert.deepEqual(await planEvent(t.env, 'ch1', 'video', 'missing'), { posts: 0, webhooks: 0 });
	});
});

describe('posting', () => {
	let t: ReturnType<typeof makeEnv>;
	beforeEach(() => (t = makeEnv()));

	async function planned(network: 'x' | 'telegram' | 'bluesky' | 'mastodon', rule: { format?: 'link' | 'video'; includeLink?: boolean } = {}, expiresAt: number | null = null) {
		const a = await connect(t.env, network, {}, expiresAt);
		await saveRule(t.env, a.id, { event: 'video', enabled: true, format: rule.format ?? 'link', includeLink: rule.includeLink ?? true });
		await planEvent(t.env, 'ch1', 'video', 'v1');
		return { account: a, deliveryId: t.queue.messages.at(-1).payload.deliveryId as string };
	}

	it('Mastodon: posts the default template with the short link and an idempotency key', async () => {
		const { deliveryId } = await planned('mastodon');
		const net = fakeFetch([['https://masto.example/api/v1/statuses', () => json({ id: '777', url: 'https://masto.example/@noor/777' })]]);
		assert.deepEqual(await attemptPost(t.env, deliveryId, net.f), { outcome: 'sent' });
		const call = net.calls.find((c) => c.url.endsWith('/statuses'))!;
		const body = JSON.parse(call.body);
		assert.match(body.status, /^Friday reminder\n\nhttps?:\/\//);
		assert.equal(body.visibility, 'public');
		assert.equal(call.headers['idempotency-key'], deliveryId);
		assert.equal(call.headers.authorization, 'Bearer at-1');
		const d = (await readDelivery(t.env, deliveryId))!;
		assert.equal(d.status, 'sent');
		assert.equal(d.remote_url, 'https://masto.example/@noor/777');
		// Sent is final: another attempt (a duplicate queue message) does nothing
		assert.deepEqual(await attemptPost(t.env, deliveryId, net.f), { outcome: 'skipped' });
	});

	it('Arabic accounts post the Arabic title and the Arabic template', async () => {
		const { account, deliveryId } = await planned('mastodon');
		await t.env.SEARCH_DB!.prepare("UPDATE social_accounts SET language = 'ar' WHERE id = ?").bind(account.id).run();
		await saveTemplate(t.env, 'ch1', { event: 'video', lang: 'ar', body: 'جديد: {title}\n{url}' }, 'owner');
		const net = fakeFetch([['https://masto.example/api/v1/statuses', () => json({ id: '1' })]]);
		await attemptPost(t.env, deliveryId, net.f);
		const body = JSON.parse(net.calls[0].body);
		assert.match(body.status, /^جديد: تذكير الجمعة\n/);
		assert.equal(body.language, 'ar');
	});

	it('Telegram: the bot sends the message with a large link preview', async () => {
		await writeCredentials(t.env, 'telegram', { botToken: '123:abc', botUsername: 'aun_bot', webhookSecret: 's' } as never, 'admin');
		const { deliveryId } = await planned('telegram');
		const net = fakeFetch([['https://api.telegram.org/bot123:abc/sendMessage', () => json({ ok: true, result: { message_id: 55, chat: { id: -100123, username: 'noorchan' } } })]]);
		assert.deepEqual(await attemptPost(t.env, deliveryId, net.f), { outcome: 'sent' });
		const body = JSON.parse(net.calls[0].body);
		assert.equal(body.chat_id, '-100123');
		assert.equal(body.link_preview_options.prefer_large_media, true);
		assert.equal((await readDelivery(t.env, deliveryId))!.remote_url, 'https://t.me/noorchan/55');
	});

	it('Telegram: a bot that lost its rights marks the connection for reconnecting', async () => {
		await writeCredentials(t.env, 'telegram', { botToken: '123:abc', botUsername: 'aun_bot', webhookSecret: 's' } as never, 'admin');
		const { account, deliveryId } = await planned('telegram');
		const net = fakeFetch([['https://api.telegram.org/', () => json({ ok: false, error_code: 403, description: 'Forbidden: bot is not a member of the channel chat' }, 403)]]);
		const r = await attemptPost(t.env, deliveryId, net.f);
		assert.equal(r.outcome, 'failed');
		assert.match(r.error!, /^reconnect_needed/);
		assert.equal((await readAccount(t.env, account.id))!.status, 'needs_reconnect');
	});

	it("a network's 429 is retried with its Retry-After", async () => {
		const { deliveryId } = await planned('mastodon');
		const net = fakeFetch([['https://masto.example/', () => json({ error: 'Too many requests' }, 429, { 'retry-after': '120' })]]);
		const r = await attemptPost(t.env, deliveryId, net.f);
		assert.equal(r.outcome, 'retry');
		assert.equal(r.retryAfterSeconds, 120);
		// The next attempt may claim it again
		const ok = fakeFetch([['https://masto.example/', () => json({ id: '9' })]]);
		assert.deepEqual(await attemptPost(t.env, deliveryId, ok.f), { outcome: 'sent' });
		assert.equal((await readDelivery(t.env, deliveryId))!.attempts, 2);
	});

	it('the admin kill switch blocks posting without calling the network', async () => {
		const { deliveryId } = await planned('mastodon');
		await writeSetting(t.env, 'platform', JSON.stringify({ enabled: false }), 'admin');
		const net = fakeFetch([]);
		assert.deepEqual(await attemptPost(t.env, deliveryId, net.f), { outcome: 'blocked', error: 'paused_by_admin' });
		assert.equal(net.calls.length, 0);
	});

	it('content made private after planning is never posted', async () => {
		const { deliveryId } = await planned('mastodon');
		const v = JSON.parse(t.videos.store.get('v1')!);
		t.videos.store.set('v1', JSON.stringify({ ...v, isPublic: false }));
		const net = fakeFetch([]);
		assert.deepEqual(await attemptPost(t.env, deliveryId, net.f), { outcome: 'skipped' });
		assert.equal((await readDelivery(t.env, deliveryId))!.status, 'cancelled');
		assert.equal(net.calls.length, 0);
	});

	it('the last failure is kept for Studio', async () => {
		const { deliveryId } = await planned('mastodon');
		const net = fakeFetch([['https://masto.example/', () => json({ error: 'down' }, 503)]]);
		await attemptPost(t.env, deliveryId, net.f);
		const d = (await giveUpPost(t.env, deliveryId, 'Mastodon post: HTTP 503 down'))!;
		assert.equal(d.status, 'failed');
		assert.match(d.last_error!, /HTTP 503/);
	});

	it('the admin overview names the channel and gives the reason, keeping the raw text', async () => {
		const { deliveryId } = await planned('mastodon');
		await giveUpPost(t.env, deliveryId, 'media is 112 MB; mastodon takes up to 40 MB');
		const res = await socialInternalRouter.request('/admin', {}, t.env as never);
		assert.equal(res.status, 200);
		const body = (await res.json()) as { recentFailures: Array<Record<string, unknown>> };
		const f = body.recentFailures.find((r) => r.id === deliveryId)!;
		assert.equal(f.channel_name, 'Noor Channel');
		assert.deepEqual(f.channel_name_localized, { ar: 'قناة نور' });
		assert.equal(f.reason, 'video_too_large');
		assert.match(String(f.last_error), /112 MB/);
	});
});

describe('failures explained (Studio and the admin page)', () => {
	it('maps stored errors to a reason, never shows raw codes', () => {
		assert.equal(socialFailureReason('reconnect_needed: token revoked'), 'reconnect_needed');
		assert.equal(socialFailureReason('x publish: HTTP 401 Unauthorized'), 'reconnect_needed');
		assert.equal(socialFailureReason('auth: token expired'), 'reconnect_needed');
		assert.equal(socialFailureReason('media is 112 MB; bluesky takes up to 50 MB'), 'video_too_large');
		assert.equal(socialFailureReason('x_budget_reached'), 'x_budget_reached');
		assert.equal(socialFailureReason('Mastodon post: HTTP 503 down'), 'generic');
		assert.equal(socialFailureReason(null), 'generic');
	});
});

describe('X: paid posts under the admin cap', () => {
	let t: ReturnType<typeof makeEnv>;
	beforeEach(() => (t = makeEnv()));

	async function xDelivery(cap: number, rule: { format: 'link' | 'video'; includeLink: boolean } = { format: 'link', includeLink: true }) {
		await enableAll(t.env, cap);
		await writeCredentials(t.env, 'x', { clientId: 'cid', clientSecret: 'cs' }, 'admin');
		const a = await connect(t.env, 'x', {}, Date.now() + 3600_000);
		await saveRule(t.env, a.id, { event: 'video', enabled: true, ...rule });
		await planEvent(t.env, 'ch1', 'video', 'v1');
		return { account: a, deliveryId: t.queue.messages.at(-1).payload.deliveryId as string };
	}

	it('X is off and the cap is $0 until an admin sets them', async () => {
		const a = await connect(t.env, 'x');
		await saveRule(t.env, a.id, { event: 'video', enabled: true, format: 'link', includeLink: true });
		await planEvent(t.env, 'ch1', 'video', 'v1');
		const r = await attemptPost(t.env, t.queue.messages[0].payload.deliveryId, fakeFetch([]).f);
		assert.deepEqual(r, { outcome: 'blocked', error: 'paused_by_admin' });
	});

	it('a link post costs the link price and is recorded against the month', async () => {
		const { deliveryId } = await xDelivery(10);
		const net = fakeFetch([['https://api.x.com/2/tweets', () => json({ data: { id: '1850' } })]]);
		assert.deepEqual(await attemptPost(t.env, deliveryId, net.f), { outcome: 'sent' });
		assert.deepEqual(await readSpend(t.env, 'x'), { costMicros: X_LINK_POST_COST_MICROS, posts: 1 });
		assert.equal((await readDelivery(t.env, deliveryId))!.remote_url, 'https://x.com/noor/status/1850');
	});

	it('a spent cap blocks the post, flags the admin once, and calls nothing', async () => {
		const { deliveryId } = await xDelivery(0.1);
		const net = fakeFetch([]);
		assert.deepEqual(await attemptPost(t.env, deliveryId, net.f), { outcome: 'blocked', error: 'x_budget_reached', flagAdmin: true });
		assert.equal(net.calls.length, 0);
		assert.deepEqual(await readSpend(t.env, 'x'), { costMicros: 0, posts: 0 });
	});

	it('from 90% of the cap link posts pause first', async () => {
		const { deliveryId } = await xDelivery(1);
		await t.env.SEARCH_DB!.prepare('INSERT INTO social_spend (month, network, cost_micros, posts) VALUES (?, ?, ?, 1)').bind(spendMonth(), 'x', 750_000).run();
		const r = await attemptPost(t.env, deliveryId, fakeFetch([]).f);
		assert.equal(r.error, 'x_budget_reached');
	});

	it('a failed post gives its reservation back', async () => {
		const { deliveryId } = await xDelivery(10);
		const net = fakeFetch([['https://api.x.com/2/tweets', () => json({ title: 'Service Unavailable' }, 503)]]);
		assert.equal((await attemptPost(t.env, deliveryId, net.f)).outcome, 'retry');
		assert.equal((await readSpend(t.env, 'x')).costMicros, 0);
	});

	it('an expired token is refreshed and saved before posting', async () => {
		await enableAll(t.env, 10);
		await writeCredentials(t.env, 'x', { clientId: 'cid', clientSecret: 'cs' }, 'admin');
		const a = await connect(t.env, 'x', {}, Date.now() + 30_000);
		await saveRule(t.env, a.id, { event: 'video', enabled: true, format: 'link', includeLink: true });
		await planEvent(t.env, 'ch1', 'video', 'v1');
		const net = fakeFetch([
			['https://api.x.com/2/oauth2/token', () => json({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 7200, scope: 'tweet.write' })],
			['https://api.x.com/2/tweets', () => json({ data: { id: '1' } })],
		]);
		assert.deepEqual(await attemptPost(t.env, t.queue.messages[0].payload.deliveryId, net.f), { outcome: 'sent' });
		assert.match(net.calls[0].body, /grant_type=refresh_token/);
		assert.match(net.calls[0].body, /refresh_token=rt-1/);
		assert.equal(net.calls[1].headers.authorization, 'Bearer at-2');
		assert.ok((await readAccount(t.env, a.id))!.token_expires_at! > Date.now() + 3600_000);
	});

	it('a refused refresh asks the creator to reconnect', async () => {
		await enableAll(t.env, 10);
		await writeCredentials(t.env, 'x', { clientId: 'cid', clientSecret: 'cs' }, 'admin');
		const a = await connect(t.env, 'x', {}, Date.now() - 1000);
		await saveRule(t.env, a.id, { event: 'video', enabled: true, format: 'link', includeLink: true });
		await planEvent(t.env, 'ch1', 'video', 'v1');
		const net = fakeFetch([['https://api.x.com/2/oauth2/token', () => json({ error: 'invalid_grant', error_description: 'Value passed for the token was invalid.' }, 400)]]);
		const r = await attemptPost(t.env, t.queue.messages[0].payload.deliveryId, net.f);
		assert.match(r.error!, /^reconnect_needed/);
		assert.equal((await readAccount(t.env, a.id))!.status, 'needs_reconnect');
		assert.equal((await readSpend(t.env, 'x')).costMicros, 0);
	});
});

describe('composing a post', () => {
	const content: SocialContent = {
		event: 'video',
		entityId: 'v1',
		channelId: 'ch1',
		channel: { id: 'ch1', name: { en: 'Noor', ar: 'نور' }, url: `${WEB}/en/@noor` },
		title: { en: 'Friday reminder', ar: 'تذكير الجمعة' },
		url: { en: 'https://s.example/v/v1', ar: 'https://s.example/v/v1?lang=ar' },
		canonicalUrl: { en: `${WEB}/en/video/v1`, ar: `${WEB}/ar/video/v1` },
		thumbnailUrl: `${WEB}/thumb/v1.jpg`,
		video: { url: 'https://media.example/v1.mp4', durationSeconds: 120, width: 1920, height: 1080 },
	};
	const d = (o: Record<string, unknown>) => ({ id: 'sd_1', network: 'x', format: 'video', include_link: 0, event: 'video', ...o }) as never;

	it('an X video post leaves the link out (the cheaper price) unless the rule adds it', async () => {
		const plain = await composePost(content, d({}), 'en', '{title}\n\n{url}', async () => 1000);
		assert.equal(plain.request.text, 'Friday reminder');
		assert.equal(plain.hasUrl, false);
		assert.ok(plain.request.video);
		const linked = await composePost(content, d({ include_link: 1 }), 'en', '{title}\n\n{url}', async () => 1000);
		assert.equal(linked.hasUrl, true);
	});

	it('a video longer than the network takes fails with "switch to a link post"; no silent fallback', async () => {
		const long = { ...content, video: { ...content.video!, durationSeconds: 400 } };
		await assert.rejects(composePost(long, d({ network: 'bluesky' }), 'en', '{title}', async () => 1000), /video_too_long.*Switch this post to a link post/);
		await assert.rejects(composePost(content, d({ network: 'telegram' }), 'en', '{title}', async () => 60 * 1048576), /video_too_large/);
	});

	it('text is cut to the network limit, keeping the link', async () => {
		const longTitle = { ...content, title: { en: 'word '.repeat(200), ar: 'x' } };
		const r = await composePost(longTitle, d({ network: 'bluesky', format: 'link' }), 'en', '{title}\n\n{url}', async () => null);
		assert.ok([...new Intl.Segmenter().segment(r.request.text)].length <= 300);
		assert.ok(r.request.text.endsWith(content.url.en));
	});

	it('live and post events are always link posts', async () => {
		const r = await composePost({ ...content, event: 'live' }, d({ event: 'live', network: 'mastodon' }), 'en', '{title} {url}', async () => null);
		assert.equal(r.request.video, undefined);
		assert.equal(r.request.link, content.url.en);
	});

	it('the cost of an X post depends on the link', () => {
		assert.equal(X_POST_COST_MICROS, 15_000);
		assert.equal(X_LINK_POST_COST_MICROS, 200_000);
	});
});

describe('outgoing webhooks', () => {
	let t: ReturnType<typeof makeEnv>;
	beforeEach(() => (t = makeEnv()));

	async function hook(events = 'video.published', url = 'https://hooks.zapier.test/catch/1') {
		const id = 'wh_1';
		await t.env.SEARCH_DB!.prepare(
			`INSERT INTO social_webhooks (id, channel_id, url, events, secret_ciphertext, enabled, failure_count, created_by, created_at, updated_at) VALUES (?, 'ch1', ?, ?, ?, 1, 0, 'owner', 1, 1)`,
		)
			.bind(id, url, events, await sealText(t.env, 'whsec_test', webhookSecretBound(id)))
			.run();
		return id;
	}

	it('a subscribed event is delivered signed, with the public facts only', async () => {
		await hook();
		assert.deepEqual(await planEvent(t.env, 'ch1', 'video', 'v1'), { posts: 0, webhooks: 1 });
		const id = t.queue.messages[0].payload.deliveryId;
		const net = fakeFetch([['https://hooks.zapier.test/', () => new Response('ok')]]);
		assert.deepEqual(await attemptWebhook(t.env, id, net.f), { outcome: 'sent' });
		const call = net.calls[0];
		assert.equal(call.headers['x-aun-event'], 'video.published');
		assert.equal(call.headers['x-aun-delivery'], id);
		assert.ok(await verifyWebhookSignature('whsec_test', call.body, call.headers['x-aun-signature'], Math.floor(Date.now() / 1000)));
		assert.ok(!(await verifyWebhookSignature('other', call.body, call.headers['x-aun-signature'], Math.floor(Date.now() / 1000))));
		const payload = JSON.parse(call.body);
		assert.equal(payload.data.title, 'Friday reminder');
		assert.equal(payload.data.titleLocalized.ar, 'تذكير الجمعة');
		assert.equal(payload.data.thumbnailUrl, `${WEB}/thumb/v1.jpg`);
		assert.equal(payload.channel.url, `${WEB}/en/@noor`);
		assert.equal((await readWebhook(t.env, 'wh_1'))!.last_status, '200');
	});

	it('an unsubscribed event plans nothing', async () => {
		await hook('post.published');
		assert.deepEqual(await planEvent(t.env, 'ch1', 'video', 'v1'), { posts: 0, webhooks: 0 });
	});

	it('5xx and 429 retry; other 4xx fail; 410 Gone switches the hook off', async () => {
		await hook();
		await planEvent(t.env, 'ch1', 'video', 'v1');
		const id = t.queue.messages[0].payload.deliveryId;
		const r1 = await attemptWebhook(t.env, id, fakeFetch([['https://hooks', () => new Response('', { status: 503, headers: { 'retry-after': '60' } })]]).f);
		assert.deepEqual(r1, { outcome: 'retry', error: 'HTTP 503', retryAfterSeconds: 60 });
		const r2 = await attemptWebhook(t.env, id, fakeFetch([['https://hooks', () => new Response('', { status: 400 })]]).f);
		assert.deepEqual(r2, { outcome: 'failed', error: 'HTTP 400' });
		assert.ok(await requeueWebhookDelivery(t.env, id));
		const r3 = await attemptWebhook(t.env, id, fakeFetch([['https://hooks', () => new Response('', { status: 410 })]]).f);
		assert.equal(r3.outcome, 'failed');
		const w = (await readWebhook(t.env, 'wh_1'))!;
		assert.equal(w.enabled, 0);
		assert.match(w.last_status!, /410/);
	});

	it('redirects are not followed and a network error retries', async () => {
		await hook();
		await planEvent(t.env, 'ch1', 'video', 'v1');
		const id = t.queue.messages[0].payload.deliveryId;
		let redirect: RequestRedirect | undefined;
		const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
			redirect = init?.redirect;
			throw new TypeError('connection reset');
		}) as typeof fetch;
		const r = await attemptWebhook(t.env, id, f);
		assert.equal(redirect, 'manual');
		assert.equal(r.outcome, 'retry');
		assert.match(r.error!, /connection reset/);
	});
});

describe('the networks Help may name (public)', () => {
	it('lists only networks that are switched on and set up, and none when posting is off', async () => {
		const { env } = makeEnv();
		const list = async () => ((await (await socialRouter.request('/networks', {}, env as never)).json()) as { networks: string[] }).networks;
		// Defaults: X off; Bluesky and Mastodon need no site credentials; Telegram needs the bot
		assert.deepEqual(await list(), ['bluesky', 'mastodon']);
		await writeSetting(env, 'platform', JSON.stringify(normalizeSocialSettings({ enabled: false })), 'test');
		assert.deepEqual(await list(), []);
	});
});
