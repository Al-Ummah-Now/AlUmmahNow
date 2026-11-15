/**
 * Social connections (wiki AUN-SOCIAL, SOC-1): OAuth links only after the person who started it confirms, the
 * Telegram code flow (only a chat admin's code counts), and that a deleted channel takes every
 * social row with it (accounts, rules, templates, deliveries, webhooks, codes, audit). Mocked network only.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteD1 } from './search-sqlite-d1';
import { confirmConnect, disconnectChannel, eraseChannelSocial, finishOAuth, handleTelegramUpdate, startConnect } from '../src/lib/social/connect';
import { audit, saveRule, saveTemplate, upsertAccount } from '../src/lib/social/store';
import { writeCredentials, type SocialEnv } from '../src/lib/social/platform';

const KEK = `1:${Buffer.alloc(32, 9).toString('base64')}`;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

function makeEnv() {
	const db = new SqliteD1();
	const env = { SEARCH_DB: db, SOCIAL_TOKEN_KEK: KEK, VIDEOS_API_URL: 'https://videos.api.example.test', VIDEOS_WEB_URL: 'https://videos.example.test', ENVIRONMENT: 'test' } as unknown as SocialEnv;
	return { env, db };
}

/** Telegram's Bot API, recording each method called. `sender` is the status of the person who posted (groups). */
function telegramFetch(member = { status: 'administrator', can_post_messages: true }, sender = 'administrator') {
	const methods: string[] = [];
	const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const method = String(input).split('/').pop()!;
		methods.push(method);
		if (method === 'getMe') return json({ ok: true, result: { id: 42, username: 'aun_bot' } });
		if (method === 'getChatMember') {
			const asked = JSON.parse(String(init?.body ?? '{}')) as { user_id?: number };
			return json({ ok: true, result: asked.user_id === 42 ? member : { status: sender } });
		}
		return json({ ok: true, result: true });
	}) as typeof fetch;
	return { f, methods };
}

const count = (db: SqliteD1, table: string, channelId: string) =>
	(db.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE channel_id = ?`).get(channelId) as { n: number }).n;

describe('Telegram code flow', () => {
	let t: ReturnType<typeof makeEnv>;
	beforeEach(async () => {
		t = makeEnv();
		await writeCredentials(t.env, 'telegram', { botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' }, 'admin');
	});

	it('a code posted in a channel where the bot is an admin connects that channel, once', async () => {
		const tg = telegramFetch();
		const started = await startConnect(t.env, { network: 'telegram', channelId: 'ch1', userId: 'owner', language: 'ar', returnLang: 'ar' }, tg.f);
		assert.equal(started.kind, 'telegram');
		const code = started.kind === 'telegram' ? started.code : '';
		assert.match(code, /^AUN-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
		assert.ok(tg.methods.includes('setWebhook'));

		const update = { update_id: 1, channel_post: { message_id: 9, chat: { id: -100555, type: 'channel', title: 'نور', username: 'noorchan' }, text: `link ${code}` } };
		const out = await handleTelegramUpdate(t.env, update, tg.f);
		assert.ok(out.connected);
		assert.ok(tg.methods.includes('deleteMessage'), 'the code is removed from the chat');
		const row = t.db.db.prepare('SELECT channel_id, remote_id, handle, language, connected_by FROM social_accounts WHERE id = ?').get(out.connected!) as Record<string, unknown>;
		assert.deepEqual({ ...row }, { channel_id: 'ch1', remote_id: '-100555', handle: 'noorchan', language: 'ar', connected_by: 'owner' });
		// Single use
		assert.deepEqual(await handleTelegramUpdate(t.env, update, tg.f), {});
	});

	it('without the right to post, nothing connects and the code stays usable', async () => {
		const started = await startConnect(t.env, { network: 'telegram', channelId: 'ch1', userId: 'owner', language: 'en', returnLang: 'en' }, telegramFetch().f);
		const code = started.kind === 'telegram' ? started.code : '';
		const update = { update_id: 2, channel_post: { message_id: 3, chat: { id: -100777, type: 'channel', title: 'X' }, text: code } };
		assert.deepEqual(await handleTelegramUpdate(t.env, update, telegramFetch({ status: 'member', can_post_messages: false }).f), {});
		assert.ok((await handleTelegramUpdate(t.env, update, telegramFetch().f)).connected);
	});

	it('the bot losing its admin rights marks the connection revoked', async () => {
		await upsertAccount(t.env, { channelId: 'ch1', network: 'telegram', remoteId: '-100888', handle: '', displayName: 'C', instance: null, language: 'en', tokenCiphertext: null, tokenExpiresAt: null, connectedBy: 'owner' });
		const out = await handleTelegramUpdate(t.env, { update_id: 3, my_chat_member: { chat: { id: -100888, type: 'channel' }, new_chat_member: { status: 'left' } } }, telegramFetch().f);
		assert.equal(out.revoked, 1);
	});

	it('in a group, only a code posted by one of its admins connects', async () => {
		const started = await startConnect(t.env, { network: 'telegram', channelId: 'ch1', userId: 'owner', language: 'en', returnLang: 'en' }, telegramFetch().f);
		const code = started.kind === 'telegram' ? started.code : '';
		const update = { update_id: 4, message: { message_id: 5, chat: { id: -200, type: 'supergroup', title: 'G' }, from: { id: 7 }, text: code } };
		assert.deepEqual(await handleTelegramUpdate(t.env, update, telegramFetch(undefined, 'member').f), {}, 'a member posting the code');
		assert.deepEqual(await handleTelegramUpdate(t.env, { ...update, message: { ...update.message, from: undefined } }, telegramFetch().f), {}, 'no sender');
		assert.ok((await handleTelegramUpdate(t.env, update, telegramFetch(undefined, 'creator').f)).connected, 'the group owner');
	});
});

describe('OAuth connect', () => {
	const INSTANCE = 'social.example.org';
	function mastodonFetch() {
		return (async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.endsWith('/api/v1/apps')) return json({ client_id: 'cid', client_secret: 'csec' });
			if (url.endsWith('/oauth/token')) return json({ access_token: 'tok', scope: 'write:statuses' });
			if (url.endsWith('/verify_credentials')) return json({ id: '77', username: 'noor', acct: 'noor', display_name: 'Noor' });
			return json({}, 404);
		}) as typeof fetch;
	}
	async function backFromNetwork(t: ReturnType<typeof makeEnv>) {
		const started = await startConnect(t.env, { network: 'mastodon', channelId: 'ch1', userId: 'owner', language: 'en', returnLang: 'ar', instance: INSTANCE }, mastodonFetch());
		assert.equal(started.kind, 'redirect');
		const state = new URL(started.kind === 'redirect' ? started.authorizeUrl : '').searchParams.get('state')!;
		return finishOAuth(t.env, 'mastodon', new URLSearchParams({ state, code: 'c1' }), async () => true, mastodonFetch());
	}
	const accounts = (t: ReturnType<typeof makeEnv>) => (t.db.db.prepare('SELECT COUNT(*) AS n FROM social_accounts').get() as { n: number }).n;

	it('the callback links nothing; only the person who started it, on that channel, can confirm, once', async () => {
		const t = makeEnv();
		const result = await backFromNetwork(t);
		assert.equal(result.channelId, 'ch1');
		assert.equal(result.lang, 'ar');
		assert.ok(result.confirm);
		assert.equal(accounts(t), 0, 'nothing linked by the callback');

		await assert.rejects(confirmConnect(t.env, result.confirm!, { userId: 'someone-else', channelId: 'ch1' }), { code: 'connect_expired' });
		await assert.rejects(confirmConnect(t.env, result.confirm!, { userId: 'owner', channelId: 'ch2' }), { code: 'connect_expired' });
		assert.equal(accounts(t), 0);

		const account = await confirmConnect(t.env, result.confirm!, { userId: 'owner', channelId: 'ch1' });
		assert.deepEqual({ channel: account.channel_id, remote: account.remote_id, handle: account.handle, by: account.connected_by }, { channel: 'ch1', remote: '77', handle: `noor@${INSTANCE}`, by: 'owner' });
		await assert.rejects(confirmConnect(t.env, result.confirm!, { userId: 'owner', channelId: 'ch1' }), { code: 'connect_expired' }, 'single use');
		assert.equal(accounts(t), 1);
	});

	it('an expired confirmation links nothing', async () => {
		const t = makeEnv();
		const result = await backFromNetwork(t);
		t.db.db.prepare('UPDATE social_pending SET expires_at = ? WHERE id = ?').run(Date.now() - 1, result.confirm!);
		await assert.rejects(confirmConnect(t.env, result.confirm!, { userId: 'owner', channelId: 'ch1' }), { code: 'connect_expired' });
		assert.equal(accounts(t), 0);
	});
});

describe('a deleted channel', () => {
	it('takes every social row with it, and other channels keep theirs', async () => {
		const { env, db } = makeEnv();
		await writeCredentials(env, 'telegram', { botToken: '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij' }, 'admin');
		for (const ch of ['ch1', 'ch2']) {
			const a = await upsertAccount(env, { channelId: ch, network: 'telegram', remoteId: `-1${ch}`, handle: '', displayName: ch, instance: null, language: 'en', tokenCiphertext: null, tokenExpiresAt: null, connectedBy: 'owner' });
			await saveRule(env, a.id, { event: 'video', enabled: true, format: 'link', includeLink: false } as never);
			await saveTemplate(env, ch, { event: 'video', lang: 'en', body: 'New: {title} {url}' }, 'owner');
			await audit(env, ch, 'owner', 'account.connect', a.id);
			const now = Date.now();
			db.db.prepare(`INSERT INTO social_deliveries (id, channel_id, account_id, network, event, entity_id, format, status, attempts, created_at, updated_at) VALUES (?, ?, ?, 'telegram', 'video', 'v1', 'link', 'sent', 1, ?, ?)`).run(`d-${ch}`, ch, a.id, now, now);
			db.db.prepare(`INSERT INTO social_webhooks (id, channel_id, url, secret_ciphertext, events, enabled, created_by, created_at, updated_at) VALUES (?, ?, 'https://hooks.example.com/x', 's', '["video.published"]', 1, 'owner', ?, ?)`).run(`w-${ch}`, ch, now, now);
			db.db.prepare(`INSERT INTO social_webhook_deliveries (id, webhook_id, channel_id, event, entity_id, status, attempts, created_at, updated_at) VALUES (?, ?, ?, 'video.published', 'v1', 'sent', 1, ?, ?)`).run(`wd-${ch}`, `w-${ch}`, ch, now, now);
			db.db.prepare(`INSERT INTO social_pending (id, kind, channel_id, user_id, network, language, expires_at) VALUES (?, 'telegram', ?, 'owner', 'telegram', 'en', ?)`).run(`p-${ch}`, ch, now + 60_000);
		}
		const tg = telegramFetch();
		assert.equal(await disconnectChannel(env, 'ch1', 'system', tg.f), 1);
		assert.ok(tg.methods.includes('leaveChat'));
		for (const table of ['social_accounts', 'social_templates', 'social_deliveries', 'social_webhooks', 'social_webhook_deliveries', 'social_pending', 'social_audit']) {
			assert.equal(count(db, table, 'ch1'), 0, `${table} of the deleted channel`);
			assert.equal(count(db, table, 'ch2'), 1, `${table} of the other channel`);
		}
		const rules = db.db.prepare('SELECT COUNT(*) AS n FROM social_rules').get() as { n: number };
		assert.equal(rules.n, 1, 'only the other channel keeps its rule');
	});

	it('the erasure hook never throws (no search database, or a failing one)', async () => {
		await eraseChannelSocial({}, 'ch1');
		await eraseChannelSocial({ SEARCH_DB: { prepare() { throw new Error('down'); } } }, 'ch1');
	});
});
