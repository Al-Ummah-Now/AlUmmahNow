/**
 * Move from YouTube (wiki AUN-YT-IMPORT, docs/features/youtube-import.md):
 * the token seal, the admin settings, the Google connection (PKCE, single-use
 * state), the listing jobs, picking, the upload hook's record fields, captions
 * (automatic tracks left out, a spent quota waits), YouTube's thumbnail, the
 * playlists, the close with its notification, the upkeep sweep, erasure, the
 * tier's limits switch and no subscriber announce for imported videos.
 *
 * Real SQL (node:sqlite with the search migrations), in-memory R2 and queue,
 * and a stubbed Google behind fetch.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Hono } from 'hono';
import { YT_SCOPE_CAPTIONS, YT_SCOPE_READONLY, type YtImportJob } from '@al-ummah/shared-types';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { UploadInitiateEndpoint } from '../src/endpoints/video/uploadInitiate';
import { decryptToken, encryptToken, pkcePair } from '../src/lib/youtube-import/crypto';
import { readYtSettings, saveYtSettings, ytReadyConfig, ytSettingsView, YT_SETTINGS_KEY, YtSettingsError } from '../src/lib/youtube-import/settings';
import {
	YtHttpError,
	oauthCallback,
	finishOAuth,
	youtubeItemClaimKey,
	prepareImportUpload,
	readImport,
	recordImportUpload,
	saveMatches,
	saveSelection,
	startImport,
	startOAuth,
	cancelImport,
	linkBack,
	allPickedSettled,
	requireYtEnabled,
	importAvailable,
} from '../src/lib/youtube-import/service';
import { handleYtImportBatch, itemFieldsOf, runYtJob, captionStagingKey, retryYtJob, finalizeWaitS, FINALIZE_WAIT_S, FINALIZE_WAIT_SOON_S } from '../src/lib/youtube-import/jobs';
import { sweepYoutubeImports } from '../src/lib/youtube-import/sweep';
import { eraseYoutubeImports } from '../src/lib/youtube-import/erase';
import { readImportRow, readItemRows, readPlaylistRows } from '../src/lib/youtube-import/rows';
import { clearMediaSettingsCache } from '../src/lib/media/settings';
import { isAnnounceable } from '../src/lib/notification-events';
import { assignTier, readTier, saveTier, validateTier } from '../src/lib/creatorTiers';
import { confirmYoutubeImportItem, uploadSessionLimitMiddleware } from '../src/middleware/upload-limits';

const CLIENT_ID = '123456789012-unittestclient.apps.googleusercontent.com';
const SECRET = 'unit-test-client-secret';
const API = 'https://videos.api.test';
const WEB = 'https://videos.test';
const OWNER = 'user-owner';
const CHANNEL = 'channel-1';
const THUMB = readFileSync(join(__dirname, '..', '..', 'web', 'e2e', 'test-fixtures', 'e2e-thumbnail.jpg'));
const NOW = new Date('2026-11-14T12:00:00Z');
const FUTURE = '2026-12-14T12:00:00Z';
const caller = { userId: OWNER, roles: ['Super Admin'] };

// ---------------------------------------------------------------------------
// A stubbed Google: consent codes, tokens, the YouTube reads and thumbnails
// ---------------------------------------------------------------------------

const VIDEOS = [
	{
		id: 'ytPUB',
		snippet: {
			title: 'Public talk',
			description: 'A talk.\n0:00 Start',
			publishedAt: '2024-03-01T09:00:00Z',
			tags: ['talk'],
			defaultLanguage: 'en',
			liveBroadcastContent: 'none',
			thumbnails: { default: { url: 'https://i.ytimg.com/vi/ytPUB/default.jpg' }, maxres: { url: 'https://i.ytimg.com/vi/ytPUB/maxresdefault.jpg' } },
		},
		contentDetails: { duration: 'PT1M5S' },
		status: { privacyStatus: 'public', uploadStatus: 'processed', madeForKids: false },
		localizations: { ar: { title: 'محاضرة', description: 'وصف' }, en: { title: 'Public talk', description: 'A talk.' } },
	},
	{
		id: 'ytUNL',
		snippet: { title: 'Kids video', description: '', publishedAt: '2024-06-15T12:00:00Z', liveBroadcastContent: 'none', thumbnails: { default: { url: 'https://i.ytimg.com/vi/ytUNL/default.jpg' } } },
		contentDetails: { duration: 'PT40S' },
		status: { privacyStatus: 'unlisted', uploadStatus: 'processed', madeForKids: true },
	},
	{
		id: 'ytPRV',
		snippet: { title: 'Scheduled', description: '', publishedAt: '2026-01-10T08:00:00Z', liveBroadcastContent: 'none' },
		contentDetails: { duration: 'PT40S' },
		status: { privacyStatus: 'private', uploadStatus: 'processed', publishAt: FUTURE },
	},
	{
		// Live: nothing to import
		id: 'ytLIVE',
		snippet: { title: 'Live now', liveBroadcastContent: 'live' },
		status: { privacyStatus: 'public', uploadStatus: 'uploaded' },
	},
];

interface GoogleStub {
	codes: Map<string, string>;
	refreshTokens: Set<string>;
	revoked: string[];
	quota: boolean;
	noChannel: boolean;
	calls: string[];
}

let google: GoogleStub;
const realFetch = globalThis.fetch;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function sha256url(text: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
	return Buffer.from(digest).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function installGoogle() {
	google = { codes: new Map(), refreshTokens: new Set(), revoked: [], quota: false, noChannel: false, calls: [] };
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
		const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '');
		if (url.host === 'oauth2.googleapis.com' && url.pathname === '/token') {
			if (form.get('client_secret') !== SECRET) return json({ error: 'invalid_client' }, 401);
			if (form.get('grant_type') === 'authorization_code') {
				const challenge = google.codes.get(form.get('code') ?? '');
				if (!challenge || challenge !== (await sha256url(form.get('code_verifier') ?? ''))) return json({ error: 'invalid_grant' }, 400);
				google.codes.delete(form.get('code')!);
				google.refreshTokens.add('rt-1');
				return json({ access_token: 'at-1', refresh_token: 'rt-1', scope: `${YT_SCOPE_READONLY} ${YT_SCOPE_CAPTIONS}` });
			}
			if (!google.refreshTokens.has(form.get('refresh_token') ?? '')) return json({ error: 'invalid_grant' }, 400);
			return json({ access_token: 'at-1' });
		}
		if (url.host === 'oauth2.googleapis.com' && url.pathname === '/revoke') {
			google.revoked.push(form.get('token') ?? '');
			google.refreshTokens.delete(form.get('token') ?? '');
			return json({});
		}
		if (url.host === 'www.googleapis.com') {
			const resource = url.pathname.replace('/youtube/v3/', '');
			google.calls.push(resource);
			const q = url.searchParams;
			if (resource === 'channels') {
				if (google.noChannel) return json({ items: [] });
				return json({ items: [{ id: 'UCfixture', snippet: { title: 'Fixture channel' }, contentDetails: { relatedPlaylists: { uploads: 'UUfixture' } }, statistics: { videoCount: '4' } }] });
			}
			if (resource === 'playlistItems') {
				const all = q.get('playlistId') === 'UUfixture' ? VIDEOS.map((v) => v.id) : q.get('playlistId') === 'PLfixture' ? ['ytPUB', 'ytUNL'] : [];
				const start = Number(q.get('pageToken') ?? 0);
				return json({ items: all.slice(start, start + 2).map((videoId) => ({ contentDetails: { videoId } })), ...(start + 2 < all.length ? { nextPageToken: String(start + 2) } : {}) });
			}
			if (resource === 'videos') return json({ items: VIDEOS.filter((v) => (q.get('id') ?? '').split(',').includes(v.id)) });
			if (resource === 'playlists') return json({ items: [{ id: 'PLfixture', snippet: { title: 'Fixture playlist', description: 'Two' }, status: { privacyStatus: 'public' } }] });
			if (resource === 'captions' || resource.startsWith('captions/')) {
				if (google.quota) return json({ error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } }, 403);
				if (resource === 'captions') {
					const tracks =
						q.get('videoId') === 'ytPUB'
							? [
									{ id: 'c-ar', snippet: { language: 'ar', trackKind: 'standard', status: 'serving' } },
									{ id: 'c-en', snippet: { language: 'en-GB', trackKind: 'standard', status: 'serving' } },
									{ id: 'c-asr', snippet: { language: 'fr', trackKind: 'asr', status: 'serving' } },
								]
							: [];
					return json({ items: tracks });
				}
				return new Response(`WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n${resource}\n`, { headers: { 'content-type': 'text/vtt' } });
			}
		}
		if (url.host === 'i.ytimg.com') return new Response(THUMB, { headers: { 'content-type': 'image/jpeg' } });
		return new Response('unexpected fetch', { status: 599 });
	}) as typeof fetch;
}

// ---------------------------------------------------------------------------
// The environment
// ---------------------------------------------------------------------------

class TestQueue {
	sent: { body: YtImportJob; delaySeconds?: number }[] = [];
	async send(body: unknown, options?: { delaySeconds?: number }) {
		this.sent.push({ body: body as YtImportJob, delaySeconds: options?.delaySeconds });
	}
	async sendBatch(messages: Iterable<{ body: unknown }>) {
		for (const m of messages) this.sent.push({ body: m.body as YtImportJob });
	}
	take(kind?: YtImportJob['kind']) {
		const i = this.sent.findIndex((m) => !kind || m.body.kind === kind);
		return i < 0 ? null : this.sent.splice(i, 1)[0]!;
	}
}

function makeEnv(extra: Record<string, unknown> = {}) {
	const db = new SqliteD1();
	const env = {
		SEARCH_DB: db as unknown as D1Database,
		YT_IMPORT_QUEUE: new TestQueue(),
		queue: new MemoryQueue(),
		global_settings: new MemoryBucket({
			[YT_SETTINGS_KEY]: { enabled: true, clientId: CLIENT_ID, updatedAt: null, updatedBy: null },
			'ops/media-delivery.json': { version: 2, providers: { bunny: { enabled: true }, r2: { enabled: true } }, thumbnails: { store: 'r2' } },
		}),
		channels: new MemoryBucket({ [CHANNEL]: { id: CHANNEL, userId: OWNER, name: 'Mine', isDeleted: false } }),
		videos: new MemoryBucket(),
		playlists: new MemoryBucket(),
		subtitles: new MemoryBucket(),
		MEDIA: new MemoryBucket(),
		MEDIA_PUBLIC_HOST: 'media.test',
		GOOGLE_OAUTH_CLIENT_SECRET: SECRET,
		Audience: API,
		VIDEOS_WEB_URL: WEB,
		...extra,
	};
	return { env, db, q: env.YT_IMPORT_QUEUE };
}

type Env = ReturnType<typeof makeEnv>['env'];

/** Consent → callback → finish, as the browser and the wizard go through it. Returns the import id. */
async function connect(env: Env): Promise<string> {
	const { url } = await startOAuth(env as never, caller, { channelId: CHANNEL, captions: true, locale: 'ar' }, NOW);
	const consent = new URL(url);
	const code = `code-${Math.random()}`;
	google.codes.set(code, consent.searchParams.get('code_challenge')!);
	const back = new URL(await oauthCallback(env as never, { code, state: consent.searchParams.get('state')! }, NOW));
	const connectState = back.searchParams.get('connect');
	assert.ok(connectState, `callback answered ${back}`);
	return (await finishOAuth(env as never, caller, connectState!, NOW)).import.id;
}

/** Runs the queued listing jobs until the import is listed. */
async function drainListing(env: Env, q: TestQueue) {
	for (let n = 0; n < 50; n++) {
		const next = q.take('yt-list');
		if (!next) return;
		await runYtJob(env as never, next.body, undefined, NOW);
	}
	assert.fail('listing never ended');
}

async function listedImport(env: Env, q: TestQueue) {
	const importId = await connect(env);
	await drainListing(env, q);
	const items = await readItemRows(env.SEARCH_DB, importId);
	const byYt = Object.fromEntries(items.map((i) => [i.yt_video_id, i]));
	return { importId, items, byYt };
}

const MATCH = (name: string) => ({ zipName: 'takeout-1.zip', entryName: `Takeout/YouTube/videos/${name}.mp4`, fileName: `${name}.mp4`, size: 1000, by: 'id' as const });

beforeEach(() => {
	installGoogle();
	clearMediaSettingsCache();
});
afterEach(() => {
	globalThis.fetch = realFetch;
	clearMediaSettingsCache();
});

// ---------------------------------------------------------------------------

describe('YouTube import: finishing a video still on its way', () => {
	it('looks again every minute at first, then every ten minutes', () => {
		assert.equal(finalizeWaitS(0), FINALIZE_WAIT_SOON_S);
		assert.equal(finalizeWaitS(9 * 60_000), FINALIZE_WAIT_SOON_S);
		assert.equal(finalizeWaitS(10 * 60_000), FINALIZE_WAIT_S);
		assert.equal(finalizeWaitS(5 * 3600_000), FINALIZE_WAIT_S);
		assert.ok(FINALIZE_WAIT_SOON_S < FINALIZE_WAIT_S);
	});

	it('keeps the import open until each ready video has had its thumbnail step', () => {
		const item = (state: string, thumbnail_state: string, video_id: string | null = 'v1') => ({ selected: 1, state, video_id, thumbnail_state });
		assert.equal(allPickedSettled([item('ready', 'pending')]), false, 'yt-finalize still to come: closing would skip it');
		assert.equal(allPickedSettled([item('ready', 'done'), item('ready', 'failed')]), true);
		assert.equal(allPickedSettled([item('ready', 'done'), item('failed', 'pending')]), true, 'a failed item never blocks');
		assert.equal(allPickedSettled([item('ready', 'done'), item('imported', 'pending', null)]), true);
		assert.equal(allPickedSettled([item('processing', 'done')]), false);
	});
});

describe('YouTube import: token seal and settings', () => {
	it('seals the refresh token to its import', async () => {
		const sealed = await encryptToken(SECRET, 'imp-1', 'refresh-token');
		assert.notEqual(sealed.ciphertext, 'refresh-token');
		assert.equal(await decryptToken(SECRET, 'imp-1', sealed), 'refresh-token');
		assert.equal(await decryptToken(SECRET, 'imp-2', sealed), null, 'another import cannot open it');
		assert.equal(await decryptToken('other-secret', 'imp-1', sealed), null);
		const { verifier, challenge } = await pkcePair();
		assert.equal(challenge, await sha256url(verifier));
	});

	it('is ready only with the switch on, a client id and a real secret', async () => {
		const { env } = makeEnv();
		assert.ok(await ytReadyConfig(env as never));
		assert.equal(await ytReadyConfig({ ...env, GOOGLE_OAUTH_CLIENT_SECRET: 'unset' } as never), null, 'the placeholder counts as no secret');
		const view = await ytSettingsView({ ...env, GOOGLE_OAUTH_CLIENT_SECRET: 'unset' } as never);
		assert.equal(view.secretPresent, false);
		assert.equal(view.ready, false);
		assert.equal(view.redirectUri, `${API}/api/youtube-import/oauth/callback`);
		assert.equal('secret' in view, false);
	});

	it('falls back to the local-stack defaults only while no settings were saved', async () => {
		const bare = { global_settings: new MemoryBucket(), YOUTUBE_IMPORT_DEFAULT_ENABLED: 'true', YOUTUBE_IMPORT_DEFAULT_CLIENT_ID: CLIENT_ID };
		assert.deepEqual(await readYtSettings(bare as never), { enabled: true, clientId: CLIENT_ID, updatedAt: null, updatedBy: null });
		const { previous, settings } = await saveYtSettings(bare as never, { enabled: false }, 'admin-1', '2026-11-14T00:00:00Z');
		assert.equal(previous.enabled, true);
		assert.deepEqual(settings, { enabled: false, clientId: CLIENT_ID, updatedAt: '2026-11-14T00:00:00Z', updatedBy: 'admin-1' });
		assert.equal((await readYtSettings(bare as never)).enabled, false);
		await assert.rejects(saveYtSettings(bare as never, { clientId: 'nope' }, 'admin-1'), YtSettingsError);
		await assert.rejects(saveYtSettings(bare as never, { enabled: 'yes' }, 'admin-1'), YtSettingsError);
	});
});

describe('YouTube import: connecting', () => {
	it('asks Google with PKCE and the captions scope, and refuses when the feature is off', async () => {
		const { env } = makeEnv();
		const { url } = await startOAuth(env as never, caller, { channelId: CHANNEL, captions: true, locale: 'en' }, NOW);
		const u = new URL(url);
		assert.equal(u.host, 'accounts.google.com');
		assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
		assert.equal(u.searchParams.get('access_type'), 'offline');
		assert.equal(u.searchParams.get('scope'), `${YT_SCOPE_READONLY} ${YT_SCOPE_CAPTIONS}`);
		assert.equal(u.searchParams.get('redirect_uri'), `${API}/api/youtube-import/oauth/callback`);

		const off = makeEnv({ GOOGLE_OAUTH_CLIENT_SECRET: 'unset' });
		await assert.rejects(startOAuth(off.env as never, caller, { channelId: CHANNEL, captions: false, locale: 'en' }, NOW), (e: YtHttpError) => e.status === 404 && e.code === 'feature_off');
	});

	it('while off or not configured, answers a quiet 404 and the callback goes back to Studio without a word about it', async () => {
		for (const off of [makeEnv({ GOOGLE_OAUTH_CLIENT_SECRET: 'unset' }), makeEnv()]) {
			if (off.env.GOOGLE_OAUTH_CLIENT_SECRET === SECRET) await off.env.global_settings.put(YT_SETTINGS_KEY, JSON.stringify({ enabled: false, clientId: CLIENT_ID, updatedAt: null, updatedBy: null }));
			await assert.rejects(requireYtEnabled(off.env as never), (e: YtHttpError) => e.status === 404 && e.code === 'feature_off');
			await assert.rejects(prepareImportUpload(off.env as never, caller, CHANNEL, { importId: 'x', itemId: 'y' }, NOW), (e: YtHttpError) => e.status === 404 && e.code === 'feature_off');
		}
		// On: only for whoever may import into the channel; anyone else gets the same quiet 404
		const on = makeEnv();
		assert.deepEqual(await importAvailable(on.env as never, caller, CHANNEL), { available: true });
		await assert.rejects(importAvailable(on.env as never, { userId: 'stranger' }, CHANNEL), (e: YtHttpError) => e.status === 404 && e.code === 'feature_off');
		await assert.rejects(importAvailable(on.env as never, { userId: OWNER, roles: [] }, CHANNEL), (e: YtHttpError) => e.status === 404 && e.code === 'feature_off');
		// Switched off between the consent and Google's redirect
		const { env } = makeEnv();
		const { url } = await startOAuth(env as never, caller, { channelId: CHANNEL, captions: false, locale: 'ar' }, NOW);
		await env.global_settings.put(YT_SETTINGS_KEY, JSON.stringify({ enabled: false, clientId: CLIENT_ID, updatedAt: null, updatedBy: null }));
		const back = new URL(await oauthCallback(env as never, { code: 'c', state: new URL(url).searchParams.get('state')! }, NOW));
		assert.equal(back.href, `${WEB}/ar/studio/${CHANNEL}/dashboard`);
	});

	it('refuses users who may not upload to the channel, or hold no creator tier', async () => {
		const { env } = makeEnv();
		await assert.rejects(startOAuth(env as never, { userId: 'stranger' }, { channelId: CHANNEL, captions: false, locale: 'en' }), (e: YtHttpError) => e.status === 403);
		await assert.rejects(startOAuth(env as never, { userId: OWNER, roles: [] }, { channelId: CHANNEL, captions: false, locale: 'en' }), (e: YtHttpError) => e.code === 'uploads_by_invitation');
		await assert.rejects(startOAuth(env as never, caller, { channelId: 'missing', captions: false, locale: 'en' }), (e: YtHttpError) => e.status === 404);
	});

	it('the callback only keeps the code; the starter finishes: sealed token, state used up, listing queued', async () => {
		const { env, q, db } = makeEnv();
		const { url } = await startOAuth(env as never, caller, { channelId: CHANNEL, captions: true, locale: 'ar' }, NOW);
		const consent = new URL(url);
		const state = consent.searchParams.get('state')!;
		google.codes.set('code-1', consent.searchParams.get('code_challenge')!);
		const back = new URL(await oauthCallback(env as never, { code: 'code-1', state }, NOW));
		assert.equal(`${back.origin}${back.pathname}`, `${WEB}/ar/studio/${CHANNEL}/content/youtube`);
		const connect = back.searchParams.get('connect')!;
		assert.match(connect, /^[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
		assert.notEqual(connect, state, 'the state is never handed back');
		assert.equal(back.searchParams.get('state'), null);
		assert.equal(google.codes.size, 1, 'nothing is exchanged by the unauthenticated callback');
		assert.equal(q.sent.length, 0);
		const stored = db.db.prepare('SELECT connect_hash FROM yt_oauth_states').get() as { connect_hash: string };
		assert.ok(stored.connect_hash && !stored.connect_hash.includes(connect), 'only the token’s hash is stored');

		const { import: imp } = await finishOAuth(env as never, caller, connect, NOW);
		const row = (await readImportRow(env.SEARCH_DB, imp.id))!;
		assert.equal(row.status, 'listing');
		assert.equal(row.captions, 1);
		assert.ok(row.refresh_token_enc && !row.refresh_token_enc.includes('rt-1'), 'the token is sealed');
		assert.equal(await decryptToken(SECRET, imp.id, { ciphertext: row.refresh_token_enc!, iv: row.token_iv! }), 'rt-1');
		assert.deepEqual(q.sent.map((m) => m.body), [{ kind: 'yt-list', importId: imp.id, phase: 'videos' }]);
		assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM yt_oauth_states').get()!.n, 0, 'the state is used up');

		// Replays: the callback again, and the finish again
		const again = new URL(await oauthCallback(env as never, { code: 'code-1', state }, NOW));
		assert.equal(again.pathname, '/en/studio');
		assert.equal(again.searchParams.get('error'), 'failed');
		await assert.rejects(finishOAuth(env as never, caller, connect, NOW), (e: YtHttpError) => e.status === 404 && e.code === 'youtube_connect_expired');
	});

	it('the starter cannot redeem a consent someone else gave: the state does not finish, the victim’s browser burns it', async () => {
		const { env, q, db } = makeEnv({ channels: new MemoryBucket({ [CHANNEL]: { id: CHANNEL, userId: OWNER, isDeleted: false }, 'victim-channel': { id: 'victim-channel', userId: 'victim', isDeleted: false } }) });
		// The attacker starts a consent for their own channel and phishes the victim into it
		const { url } = await startOAuth(env as never, caller, { channelId: CHANNEL, captions: false, locale: 'en' }, NOW);
		const consent = new URL(url);
		const state = consent.searchParams.get('state')!;
		google.codes.set('victim-code', consent.searchParams.get('code_challenge')!);
		// The victim consents with their Google account; only the victim's browser gets the connect token
		const back = new URL(await oauthCallback(env as never, { code: 'victim-code', state }, NOW));
		const connect = back.searchParams.get('connect')!;
		assert.ok(connect && connect !== state);

		// The attacker knows the state and finishes with their own (matching) account: refused, nothing exchanged
		await assert.rejects(finishOAuth(env as never, caller, state, NOW), (e: YtHttpError) => e.status === 404 && e.code === 'youtube_connect_expired');
		assert.equal(google.codes.size, 1, 'the victim’s code was never exchanged');
		assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM yt_oauth_states').get()!.n, 1);

		// The victim's signed-in Studio finishes with the token: another account started it, 403, the consent is burnt
		await assert.rejects(finishOAuth(env as never, { userId: 'victim', roles: ['Super Admin'] }, connect, NOW), (e: YtHttpError) => e.status === 403);
		assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM yt_oauth_states').get()!.n, 0);
		assert.equal(google.codes.size, 1);

		// Nothing is left to redeem, with the state or the token
		await assert.rejects(finishOAuth(env as never, caller, state, NOW), (e: YtHttpError) => e.status === 404);
		await assert.rejects(finishOAuth(env as never, caller, connect, NOW), (e: YtHttpError) => e.status === 404);
		assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM yt_imports').get()!.n, 0);
		assert.equal(q.sent.length, 0);
	});

	it('the starter who lost the channel cannot finish', async () => {
		const { env } = makeEnv();
		const { url } = await startOAuth(env as never, caller, { channelId: CHANNEL, captions: false, locale: 'en' }, NOW);
		const consent = new URL(url);
		google.codes.set('c', consent.searchParams.get('code_challenge')!);
		const state = new URL(await oauthCallback(env as never, { code: 'c', state: consent.searchParams.get('state')! }, NOW)).searchParams.get('connect')!;
		await env.channels.put(CHANNEL, JSON.stringify({ id: CHANNEL, userId: 'someone-else', isDeleted: false }));
		await assert.rejects(finishOAuth(env as never, caller, state, NOW), (e: YtHttpError) => e.status === 403);
	});

	it('answers denied, no channel and expired consents with an error for the wizard', async () => {
		const { env } = makeEnv();
		const start = async () => new URL((await startOAuth(env as never, caller, { channelId: CHANNEL, captions: false, locale: 'en' }, NOW)).url);
		let consent = await start();
		const denied = new URL(await oauthCallback(env as never, { error: 'access_denied', state: consent.searchParams.get('state')! }, NOW));
		assert.equal(denied.searchParams.get('error'), 'youtube_denied');

		google.noChannel = true;
		consent = await start();
		google.codes.set('c2', consent.searchParams.get('code_challenge')!);
		const state = new URL(await oauthCallback(env as never, { code: 'c2', state: consent.searchParams.get('state')! }, NOW)).searchParams.get('connect')!;
		await assert.rejects(finishOAuth(env as never, caller, state, NOW), (e: YtHttpError) => e.status === 409 && e.code === 'youtube_no_channel');
		assert.deepEqual(google.revoked, ['rt-1'], 'the unused grant is revoked');

		consent = await start();
		const late = new URL(await oauthCallback(env as never, { code: 'x', state: consent.searchParams.get('state')! }, new Date(NOW.getTime() + 16 * 60_000)));
		assert.equal(late.searchParams.get('error'), 'failed');

		// A kept code waits 5 minutes for the finish
		consent = await start();
		google.codes.set('c3', consent.searchParams.get('code_challenge')!);
		const slow = new URL(await oauthCallback(env as never, { code: 'c3', state: consent.searchParams.get('state')! }, NOW)).searchParams.get('connect')!;
		await assert.rejects(finishOAuth(env as never, caller, slow, new Date(NOW.getTime() + 6 * 60_000)), (e: YtHttpError) => e.code === 'youtube_connect_expired');
	});
});

describe('YouTube import: listing and picking', () => {
	it('lists videos (not live ones) and playlists page by page, then is ready', async () => {
		const { env, q } = makeEnv();
		const { importId, items, byYt } = await listedImport(env, q);
		assert.equal((await readImportRow(env.SEARCH_DB, importId))!.status, 'ready');
		assert.deepEqual(items.map((i) => i.yt_video_id).sort(), ['ytPRV', 'ytPUB', 'ytUNL']);
		assert.equal(byYt.ytUNL.made_for_kids, 1);
		assert.equal(byYt.ytUNL.yt_visibility, 'unlisted');
		assert.equal(byYt.ytPRV.publish_at, FUTURE);
		assert.equal(byYt.ytPUB.thumbnail_url, 'https://i.ytimg.com/vi/ytPUB/maxresdefault.jpg');
		assert.equal(byYt.ytPUB.duration_seconds, 65);
		const playlists = await readPlaylistRows(env.SEARCH_DB, importId);
		assert.equal(playlists.length, 1);
		assert.deepEqual(JSON.parse(playlists[0]!.video_ids_json!), ['ytPUB', 'ytUNL']);
		assert.equal(itemFieldsOf(VIDEOS[3] as never), null);
	});

	it('picks videos, unpicks those without a file on start and queues captions', async () => {
		const { env, q } = makeEnv();
		const { importId, byYt } = await listedImport(env, q);
		await saveSelection(env as never, caller, importId, { itemIds: [byYt.ytPUB.id, byYt.ytUNL.id, byYt.ytPRV.id], playlistIds: ['PLfixture'], visibilityMode: 'keep' }, NOW);
		const { updated } = await saveMatches(env as never, caller, importId, [
			{ itemId: byYt.ytPUB.id, match: MATCH('Public talk') },
			{ itemId: byYt.ytPRV.id, match: MATCH('Scheduled') },
		]);
		assert.equal(updated, 2);
		const started = await startImport(env as never, caller, importId, NOW);
		assert.equal(started.status, 'importing');
		const items = Object.fromEntries((await readItemRows(env.SEARCH_DB, importId)).map((i) => [i.yt_video_id, i]));
		assert.equal(items.ytUNL.selected, 0, 'no file: left out');
		assert.equal(items.ytPUB.thumbnail_state, 'pending');
		assert.deepEqual(q.sent.filter((m) => m.body.kind === 'yt-captions').map((m) => (m.body as { itemId: string }).itemId).sort(), [items.ytPUB.id, items.ytPRV.id].sort());
		assert.equal((await readPlaylistRows(env.SEARCH_DB, importId))[0]!.state, 'pending');

		// Another user's import is not found
		await assert.rejects(readImport(env as never, { userId: 'other' }, importId), (e: YtHttpError) => e.status === 404);
	});

	it('a creator whose channel role was taken away can no longer act on the import', async () => {
		const { env, q } = makeEnv();
		const { importId, byYt } = await listedImport(env, q);
		await env.channels.put(CHANNEL, JSON.stringify({ id: CHANNEL, userId: 'new-owner', isDeleted: false }));
		const forbidden = (e: YtHttpError) => e.status === 403;
		await assert.rejects(saveSelection(env as never, caller, importId, { itemIds: [byYt.ytPUB.id], playlistIds: [], visibilityMode: 'keep' }, NOW), forbidden);
		await assert.rejects(saveMatches(env as never, caller, importId, [{ itemId: byYt.ytPUB.id, match: MATCH('x') }]), forbidden);
		await assert.rejects(startImport(env as never, caller, importId, NOW), forbidden);
		await assert.rejects(cancelImport(env as never, caller, importId), forbidden);
		await assert.rejects(readImport(env as never, caller, importId), forbidden);
	});

	it('refuses to start with nothing picked', async () => {
		const { env, q } = makeEnv();
		const { importId } = await listedImport(env, q);
		await assert.rejects(startImport(env as never, caller, importId, NOW), (e: YtHttpError) => e.code === 'nothing_selected');
	});
});

describe('YouTube import: uploads, captions, thumbnails, playlists and the close', () => {
	async function importing(env: Env, q: TestQueue, mode: 'keep' | 'private' = 'keep') {
		const listed = await listedImport(env, q);
		const ids = [listed.byYt.ytPUB.id, listed.byYt.ytUNL.id, listed.byYt.ytPRV.id];
		await saveSelection(env as never, caller, listed.importId, { itemIds: ids, playlistIds: ['PLfixture'], visibilityMode: mode }, NOW);
		await saveMatches(env as never, caller, listed.importId, ids.map((itemId, i) => ({ itemId, match: MATCH(`file-${i}`) })));
		await startImport(env as never, caller, listed.importId, NOW);
		q.sent.length = 0;
		return listed;
	}

	it('builds the record fields from YouTube: visibility, schedule, publish date, kids, localizations', async () => {
		const { env, q } = makeEnv();
		const { importId, byYt } = await importing(env, q);
		const pub = await prepareImportUpload(env as never, caller, CHANNEL, { importId, itemId: byYt.ytPUB.id }, NOW);
		assert.equal(pub.metadata.visibility, 'public');
		assert.equal(pub.metadata.publishedAt, '2024-03-01T09:00:00Z', 'public at once: YouTube’s date keeps the order');
		assert.equal(pub.metadata.titleLocalized?.ar, 'محاضرة');
		assert.equal(pub.metadata.tags, 'talk');
		assert.equal(pub.metadata.language, 'en');
		assert.deepEqual(pub.metadata.importedFrom, { platform: 'youtube', videoId: 'ytPUB', publishedAt: '2024-03-01T09:00:00Z', madeForKids: false, importId });
		assert.equal(pub.scheduleAt, null);

		const kids = await prepareImportUpload(env as never, caller, CHANNEL, { importId, itemId: byYt.ytUNL.id }, NOW);
		assert.equal(kids.metadata.visibility, 'unlisted');
		assert.equal(kids.metadata.importedFrom.madeForKids, true);
		assert.equal(kids.metadata.commentSettings, 'off');
		assert.equal(pub.metadata.commentSettings, undefined);
		assert.equal(kids.metadata.publishedAt, undefined);

		const scheduled = await prepareImportUpload(env as never, caller, CHANNEL, { importId, itemId: byYt.ytPRV.id }, NOW);
		assert.equal(scheduled.metadata.visibility, 'private');
		assert.equal(Date.parse(scheduled.scheduleAt!), Date.parse(FUTURE));

		// Another channel, another user: not found
		await assert.rejects(prepareImportUpload(env as never, caller, 'other-channel', { importId, itemId: byYt.ytPUB.id }, NOW), (e: YtHttpError) => e.status === 404);
		await assert.rejects(prepareImportUpload(env as never, { userId: 'other' }, CHANNEL, { importId, itemId: byYt.ytPUB.id }, NOW), (e: YtHttpError) => e.status === 404);
	});

	it('refuses the upload once the creator lost the channel', async () => {
		const { env, q } = makeEnv();
		const { importId, byYt } = await importing(env, q);
		await env.channels.put(CHANNEL, JSON.stringify({ id: CHANNEL, userId: 'new-owner', isDeleted: false }));
		await assert.rejects(prepareImportUpload(env as never, caller, CHANNEL, { importId, itemId: byYt.ytPUB.id }, NOW), (e: YtHttpError) => e.status === 403);
	});

	it('two parallel initiates of one item make one video (the claim), and the item records it', async () => {
		const { env, q } = makeEnv({
			TUS_SESSIONS: { data: new Map(), get: async () => null, put: async () => undefined, delete: async () => undefined },
			'bunny-stream-key': 'key',
			bunny_stream_library_id: '123',
			bunny_hostname: 'vz-test.b-cdn.net',
		});
		const { importId, byYt } = await importing(env, q);
		const google = globalThis.fetch;
		let bunnyCreates = 0;
		globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (URL.canParse(url) && new URL(url).hostname === 'video.bunnycdn.com') {
				const method = init?.method ?? 'GET';
				if (/\/library\/\d+\/videos\/?(\?.*)?$/.test(url) && method === 'POST') {
					bunnyCreates++;
					await new Promise((r) => setTimeout(r, 30));
					return new Response(JSON.stringify({ guid: crypto.randomUUID(), status: 0 }), { status: 200 });
				}
				if (method === 'GET') return new Response(JSON.stringify({ status: 0 }), { status: 200 });
				return new Response(JSON.stringify({}), { status: 200 });
			}
			return google(input, init);
		}) as typeof fetch;
		const app = buildApp((router) => router.post('/api/videos/upload/initiate', UploadInitiateEndpoint), { userId: OWNER, roles: ['Super Admin'] });
		const initiate = async () => {
			const res = await app.request(
				'/api/videos/upload/initiate',
				{ method: 'POST', headers: { 'Content-Type': 'application/json', channelId: CHANNEL }, body: JSON.stringify({ title: 'ignored', fileSize: 4096, mimeType: 'video/mp4', youtubeImport: { importId, itemId: byYt.ytPUB.id } }) },
				env,
			);
			return { status: res.status, body: (await res.json()) as any };
		};
		const [a, b] = await Promise.all([initiate(), initiate()]);
		assert.equal(a.status, 200, JSON.stringify(a.body));
		assert.equal(b.status, 200, JSON.stringify(b.body));
		assert.equal(a.body.result.videoId, b.body.result.videoId);
		assert.equal(bunnyCreates, 1);
		const item = (await readItemRows(env.SEARCH_DB, importId)).find((i) => i.id === byYt.ytPUB.id)!;
		assert.equal(item.video_id, a.body.result.videoId);
		assert.equal(env.videos.read(a.body.result.videoId).title, 'Public talk', 'the snapshot decides the title');

		// Another user's initiate of the same item is not found
		const stranger = buildApp((router) => router.post('/api/videos/upload/initiate', UploadInitiateEndpoint), { userId: 'stranger' });
		const res = await stranger.request(
			'/api/videos/upload/initiate',
			{ method: 'POST', headers: { 'Content-Type': 'application/json', channelId: CHANNEL }, body: JSON.stringify({ title: 't', fileSize: 4096, mimeType: 'video/mp4', youtubeImport: { importId, itemId: byYt.ytPUB.id } }) },
			env,
		);
		assert.equal(res.status, 404);
	});

	it('keeps everything private when the creator asked for it', async () => {
		const { env, q } = makeEnv();
		const { importId, byYt } = await importing(env, q, 'private');
		const pub = await prepareImportUpload(env as never, caller, CHANNEL, { importId, itemId: byYt.ytPUB.id }, NOW);
		assert.equal(pub.metadata.visibility, 'private');
		assert.equal(pub.metadata.publishedAt, undefined);
	});

	it('records the upload once, then finishes the video: captions (no automatic ones), thumbnail, playlist, close', async () => {
		const { env, q } = makeEnv();
		const { importId, byYt } = await importing(env, q);
		const ids = { pub: byYt.ytPUB.id, unl: byYt.ytUNL.id, prv: byYt.ytPRV.id };
		const videoIds: Record<string, string> = {};
		for (const [key, itemId] of Object.entries(ids)) {
			const upload = await prepareImportUpload(env as never, caller, CHANNEL, { importId, itemId }, NOW);
			const videoId = `video-${key}`;
			videoIds[key] = videoId;
			await env.videos.put(videoId, JSON.stringify({ id: videoId, userId: OWNER, channelId: CHANNEL, title: upload.metadata.title, uploadStatus: 'processing', width: 1920, height: 1080, dateCreated: NOW.toISOString(), thumbnailType: 'auto' }));
			assert.equal(await recordImportUpload(env as never, upload, videoId, NOW), true);
		}
		const finalize = q.sent.filter((m) => m.body.kind === 'yt-finalize');
		assert.equal(finalize.length, 3);
		assert.ok(finalize.every((m) => m.delaySeconds === 60));
		q.sent.length = 0;

		// Captions: ar and en staged and attached; the automatic track is left out
		await runYtJob(env as never, { kind: 'yt-captions', importId, itemId: ids.pub }, undefined, NOW);
		assert.ok(env.subtitles.store.has(captionStagingKey(importId, 'ytPUB', 'ar')));
		assert.ok(env.subtitles.store.has(captionStagingKey(importId, 'ytPUB', 'en')));
		assert.ok(!env.subtitles.store.has(captionStagingKey(importId, 'ytPUB', 'fr')));
		const withCaptions = env.videos.read(videoIds.pub);
		assert.deepEqual((withCaptions.subtitles ?? []).map((s: { language: string }) => s.language).sort(), ['ar', 'en']);

		// Thumbnail: YouTube's custom one, in the video's shape
		for (const itemId of Object.values(ids)) await runYtJob(env as never, { kind: 'yt-finalize', importId, itemId }, undefined, NOW);
		const pubVideo = env.videos.read(videoIds.pub);
		assert.equal(pubVideo.thumbnailType, 'custom');
		assert.match(pubVideo.thumbnailUrl, /^https:\/\/media\.test\//);
		const rows = Object.fromEntries((await readItemRows(env.SEARCH_DB, importId)).map((i) => [i.yt_video_id, i]));
		assert.equal(rows.ytPUB.thumbnail_state, 'done');

		// Every picked video is here: the playlist is made, with the videos in YouTube's order
		assert.ok(q.sent.some((m) => m.body.kind === 'yt-playlists'));
		await runYtJob(env as never, { kind: 'yt-playlists', importId }, undefined, NOW);
		await runYtJob(env as never, { kind: 'yt-playlists', importId }, undefined, NOW);
		const playlistRow = (await readPlaylistRows(env.SEARCH_DB, importId))[0]!;
		assert.equal(playlistRow.state, 'done');
		const playlist = env.playlists.read(playlistRow.playlist_id!);
		assert.deepEqual(playlist.videos, [videoIds.pub, videoIds.unl]);
		assert.equal(playlist.importedFrom.playlistId, 'PLfixture');
		assert.equal(env.playlists.store.size, 1, 'a redelivery makes no second playlist');

		// The videos become ready: the close revokes the token and tells the creator
		for (const id of Object.values(videoIds)) {
			const v = env.videos.read(id);
			await env.videos.put(id, JSON.stringify({ ...v, uploadStatus: 'ready' }));
		}
		await runYtJob(env as never, { kind: 'yt-close', importId }, undefined, NOW);
		const row = (await readImportRow(env.SEARCH_DB, importId))!;
		assert.equal(row.status, 'finished');
		assert.equal(row.refresh_token_enc, null);
		assert.deepEqual(google.revoked, ['rt-1']);
		const notification = env.queue.messages.find((m: { payload?: { notificationKey?: string } }) => m.payload?.notificationKey === 'youtubeImportFinished');
		assert.ok(notification, 'the creator is told');
		assert.equal(notification.payload.params.ready, '3');
		assert.equal(notification.payload.recipientUserId, OWNER);

		const csv = await linkBack(env as never, caller, importId, 'en');
		assert.ok(csv.includes(`https://www.youtube.com/watch?v=ytPUB`));
		assert.ok(csv.includes(`${WEB}/en/video/${videoIds.pub}`));
	});

	it('never puts YouTube’s thumbnail over one the creator set', async () => {
		const { env, q } = makeEnv();
		const { importId, byYt } = await importing(env, q);
		const upload = await prepareImportUpload(env as never, caller, CHANNEL, { importId, itemId: byYt.ytPUB.id }, NOW);
		await env.videos.put('v1', JSON.stringify({ id: 'v1', userId: OWNER, channelId: CHANNEL, uploadStatus: 'ready', width: 1920, height: 1080, thumbnailType: 'custom', thumbnailUrl: 'https://images.test/mine.jpg' }));
		await recordImportUpload(env as never, upload, 'v1', NOW);
		await runYtJob(env as never, { kind: 'yt-finalize', importId, itemId: byYt.ytPUB.id }, undefined, NOW);
		assert.equal(env.videos.read('v1').thumbnailUrl, 'https://images.test/mine.jpg');
		assert.equal(env.MEDIA.store.size, 0);
	});

	it('waits for the video before the thumbnail while its size is unknown', async () => {
		const { env, q } = makeEnv();
		const { importId, byYt } = await importing(env, q);
		const upload = await prepareImportUpload(env as never, caller, CHANNEL, { importId, itemId: byYt.ytPUB.id }, NOW);
		await env.videos.put('v1', JSON.stringify({ id: 'v1', userId: OWNER, channelId: CHANNEL, uploadStatus: 'processing', dateCreated: NOW.toISOString() }));
		await recordImportUpload(env as never, upload, 'v1', NOW);
		q.sent.length = 0;
		await runYtJob(env as never, { kind: 'yt-finalize', importId, itemId: byYt.ytPUB.id }, undefined, NOW);
		assert.deepEqual(q.sent, [{ body: { kind: 'yt-finalize', importId, itemId: byYt.ytPUB.id }, delaySeconds: FINALIZE_WAIT_SOON_S }], 'a new video: look again in a minute');
		q.sent.length = 0;
		await runYtJob(env as never, { kind: 'yt-finalize', importId, itemId: byYt.ytPUB.id }, undefined, new Date(NOW.getTime() + 30 * 60_000));
		assert.deepEqual(q.sent, [{ body: { kind: 'yt-finalize', importId, itemId: byYt.ytPUB.id }, delaySeconds: FINALIZE_WAIT_S }], 'a slow one: every ten minutes');
	});

	it('a second upload of a video already here is refused', async () => {
		const { env, q } = makeEnv();
		const { importId, byYt } = await importing(env, q);
		const upload = await prepareImportUpload(env as never, caller, CHANNEL, { importId, itemId: byYt.ytPUB.id }, NOW);
		await recordImportUpload(env as never, upload, 'v1', NOW);
		await (env.SEARCH_DB as unknown as SqliteD1).db.prepare(`UPDATE yt_import_items SET state = 'ready' WHERE id = ?`).run(byYt.ytPUB.id);
		await assert.rejects(prepareImportUpload(env as never, caller, CHANNEL, { importId, itemId: byYt.ytPUB.id }, NOW), (e: YtHttpError) => e.status === 409 && e.code === 'youtube_item_taken');
		assert.equal(await recordImportUpload(env as never, upload, 'v2', NOW), false);
	});

	it('waits for the quota reset when captions spend it', async () => {
		const { env, q } = makeEnv();
		const { importId, byYt } = await importing(env, q);
		google.quota = true;
		await runYtJob(env as never, { kind: 'yt-captions', importId, itemId: byYt.ytPUB.id }, undefined, NOW);
		const item = (await readItemRows(env.SEARCH_DB, importId)).find((i) => i.id === byYt.ytPUB.id)!;
		assert.equal(item.captions_state, 'waiting_quota');
		const again = q.take('yt-captions')!;
		assert.ok(again.delaySeconds! >= 60 && again.delaySeconds! <= 43_200, `delay ${again.delaySeconds}`);
	});

	it('retries with a backoff, then gives up: the step fails for the creator and the admin gets a Retry', async () => {
		const { env, q } = makeEnv();
		const { importId, byYt } = await importing(env, q);
		globalThis.fetch = (async () => new Response('down', { status: 503 })) as typeof fetch;
		const job = { kind: 'yt-captions', importId, itemId: byYt.ytPUB.id } as YtImportJob;
		const outcome: string[] = [];
		const msg = (attempts: number) => ({ body: job, attempts, ack: () => outcome.push('ack'), retry: (o?: { delaySeconds?: number }) => outcome.push(`retry:${o?.delaySeconds}`) });
		await handleYtImportBatch({ messages: [msg(1)] }, env as never, undefined);
		assert.deepEqual(outcome, ['retry:60']);
		outcome.length = 0;
		await handleYtImportBatch({ messages: [msg(6)] }, env as never, undefined);
		assert.deepEqual(outcome, ['ack']);
		const item = (await readItemRows(env.SEARCH_DB, importId)).find((i) => i.id === byYt.ytPUB.id)!;
		assert.equal(item.captions_state, 'failed');

		// The admin's Retry puts it back to pending and queues it
		installGoogle();
		q.sent.length = 0;
		assert.equal(await retryYtJob(env as never, { job }, undefined), true);
		assert.equal((await readItemRows(env.SEARCH_DB, importId)).find((i) => i.id === byYt.ytPUB.id)!.captions_state, 'pending');
		assert.deepEqual(q.sent.map((m) => m.body), [job]);
		await cancelImport(env as never, caller, importId);
		assert.equal(await retryYtJob(env as never, { job }, undefined), false, 'nothing to retry once it is over');
	});

	it('a revoked Google grant stops the listing and asks the creator to connect again', async () => {
		const { env, q } = makeEnv();
		const importId = await connect(env);
		google.refreshTokens.clear();
		await runYtJob(env as never, q.take('yt-list')!.body, undefined, NOW);
		const row = (await readImportRow(env.SEARCH_DB, importId))!;
		assert.equal(row.status, 'failed');
		assert.equal(row.error, 'youtube_not_connected');
		assert.equal(row.refresh_token_enc, null);
	});
});

describe('YouTube import: upkeep and erasure', () => {
	it('deletes stale consents, ends idle imports and empties old snapshots', async () => {
		const { env, q, db } = makeEnv();
		const { importId } = await listedImport(env, q);
		// The listing stamps rows with the wall clock: pin them to the test's clock, so "idle for 14 days"
		// is measured from NOW and the test does not start failing once the real date passes NOW
		db.db.prepare('UPDATE yt_imports SET updated_at = ? WHERE id = ?').run(NOW.toISOString(), importId);
		db.db.prepare('UPDATE yt_import_items SET updated_at = ? WHERE import_id = ?').run(NOW.toISOString(), importId);
		await startOAuth(env as never, caller, { channelId: CHANNEL, captions: false, locale: 'en' }, NOW);
		const later = new Date(NOW.getTime() + 15 * 86_400_000);
		const first = await sweepYoutubeImports(env as never, later);
		assert.equal(first.statesDeleted, 1);
		assert.equal(first.ended, 1);
		const row = (await readImportRow(env.SEARCH_DB, importId))!;
		assert.equal(row.status, 'cancelled');
		assert.equal(row.refresh_token_enc, null);
		assert.deepEqual(google.revoked, ['rt-1']);
		db.db.prepare('UPDATE yt_imports SET finished_at = ? WHERE id = ?').run(NOW.toISOString(), importId);
		const second = await sweepYoutubeImports(env as never, new Date(NOW.getTime() + 31 * 86_400_000));
		assert.equal(second.purged, 1);
		assert.equal((await readItemRows(env.SEARCH_DB, importId)).length, 0, 'items never imported are gone');
	});

	it('erases every import of the account and its staged captions', async () => {
		const { env, q, db } = makeEnv();
		const { importId } = await listedImport(env, q);
		await env.subtitles.put(captionStagingKey(importId, 'ytPUB', 'ar'), 'WEBVTT');
		await env.subtitles.put('video-x/ar.vtt', 'WEBVTT');
		assert.equal(await eraseYoutubeImports(env.SEARCH_DB, env as never, OWNER), 1);
		for (const table of ['yt_imports', 'yt_import_items', 'yt_import_playlists', 'yt_oauth_states']) {
			assert.equal(db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0, table);
		}
		assert.deepEqual([...env.subtitles.store.keys()], ['video-x/ar.vtt']);
		assert.deepEqual(google.revoked, ['rt-1']);
	});
});

describe('YouTube import: tiers and announcements', () => {
	it('stores whether imports count against the tier limits', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		assert.throws(() => validateTier('x', { name: 'X', perHour: 1, perDay: 1, maxConcurrent: 1, maxChannels: 1, importCountsAgainstLimits: 'no' } as never), /importCountsAgainstLimits/);
		await saveTier(db, 'free-imports', { name: 'Free imports', perHour: 1, perDay: 1, maxConcurrent: 5, maxChannels: 1, importCountsAgainstLimits: false }, 'admin', { create: true });
		assert.equal((await readTier(db, 'free-imports'))!.importCountsAgainstLimits, false);
		await saveTier(db, 'counted', { name: 'Counted', perHour: 1, perDay: 1, maxConcurrent: 5, maxChannels: 1 }, 'admin', { create: true });
		assert.equal((await readTier(db, 'counted'))!.importCountsAgainstLimits, true, 'imports count by default');
	});

	it('gives an import its session back only once the initiate confirmed a valid item, on a tier that says so', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		await saveTier(db, 'free-imports', { name: 'Free imports', perHour: 1, perDay: 1, maxConcurrent: 5, maxChannels: 1, importCountsAgainstLimits: false }, 'admin', { create: true });
		await saveTier(db, 'counted', { name: 'Counted', perHour: 1, perDay: 1, maxConcurrent: 5, maxChannels: 1 }, 'admin', { create: true });
		await assignTier(db, 'alice', 'free-imports', 'admin');
		await assignTier(db, 'carol', 'free-imports', 'admin');
		await assignTier(db, 'bob', 'counted', 'admin');
		const app = new Hono();
		app.use('*', async (c, next) => {
			const user = c.req.header('x-user')!;
			c.set('userId' as never, user as never);
			c.set('auth' as never, { userId: user, payload: { sub: user } } as never);
			await next();
		});
		app.use('/api/videos/upload/initiate', uploadSessionLimitMiddleware());
		// Stand-in for the initiate: `item` says what the import item check found
		app.post('/api/videos/upload/initiate', async (c) => {
			const item = c.req.header('x-item');
			if (item === 'missing') return c.json({ success: false, code: 'youtube_import_not_found' }, 404);
			if (item === 'valid') confirmYoutubeImportItem(c);
			return c.json({ success: true, result: { videoId: 'v' } });
		});
		const initiate = (user: string, item: 'valid' | 'missing' | 'none', youtubeBody = item !== 'none') =>
			app.request(
				'/api/videos/upload/initiate',
				{ method: 'POST', headers: { 'x-user': user, 'x-item': item, 'content-type': 'application/json' }, body: JSON.stringify({ title: 't', ...(youtubeBody ? { youtubeImport: { importId: 'i', itemId: 'x' } } : {}) }) },
				{ SEARCH_DB: db, UPLOAD_RATE_LIMIT: 'on' },
			);
		for (let n = 0; n < 3; n++) assert.equal((await initiate('alice', 'valid')).status, 200, `alice import ${n}`);
		assert.equal((await initiate('alice', 'missing')).status, 404, 'an invalid item is refused (and refunded)');
		assert.equal((await initiate('alice', 'none')).status, 200);
		assert.equal((await initiate('alice', 'none')).status, 429, 'normal uploads still count');
		// The body alone proves nothing: an import the initiate did not confirm counts
		assert.equal((await initiate('carol', 'none', true)).status, 200);
		assert.equal((await initiate('carol', 'valid')).status, 429, 'the unconfirmed one used the hour');
		assert.equal((await initiate('bob', 'valid')).status, 200);
		assert.equal((await initiate('bob', 'valid')).status, 429, 'imports count on this tier');
	});

	it('the item is the upload claim: one key per item, the same for every retry', async () => {
		assert.equal(await youtubeItemClaimKey('imp', 'item-1'), await youtubeItemClaimKey('imp', 'item-1'));
		assert.notEqual(await youtubeItemClaimKey('imp', 'item-1'), await youtubeItemClaimKey('imp', 'item-2'));
		assert.notEqual(await youtubeItemClaimKey('imp', 'item-1'), await youtubeItemClaimKey('imp2', 'item-1'));
		assert.match(await youtubeItemClaimKey('imp', 'item-1'), /^[0-9a-f]{64}$/);
	});

	it('never announces an imported video to subscribers', () => {
		const video = { id: 'v', userId: 'u', channelId: 'c', title: 't', uploadStatus: 'ready', visibility: 'public', isPrivate: false, isPublic: true };
		assert.equal(isAnnounceable(video as never), true);
		assert.equal(isAnnounceable({ ...video, importedFrom: { platform: 'youtube', videoId: 'x' } } as never), false);
	});
});
