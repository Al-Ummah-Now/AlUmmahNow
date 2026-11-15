/**
 * Move from YouTube (wiki AUN-YT-IMPORT, docs/features/youtube-import.md):
 * what the Studio wizard calls. The endpoints (endpoints/youtube-import/) are
 * thin; the rules live here.
 *
 *   connect     POST oauth/start → Google consent → GET oauth/callback (keeps
 *               the code) → POST oauth/finish (the signed-in starter): the
 *               import row (status listing) and the listing job
 *   list        the queue lists the channel's videos and playlists (jobs.ts)
 *   pick        PUT selection / PUT matches (the browser matched Takeout files)
 *   import      POST start, then the browser uploads each file through the
 *               normal resumable upload with `youtubeImport` on the initiate
 *               (prepareImportUpload / recordImportUpload below)
 *   finish      queue jobs bring thumbnails, captions and playlists; the import
 *               closes (token revoked) once every picked video is done
 *
 * Who: the user who connected, while they may upload to the channel (owner, or
 * a channel role with video.upload) under a creator tier.
 */
import {
	CREATOR_ERROR_CODES,
	YT_IMPORT_ERRORS,
	tierAllowsUploads,
	can,
	channelRoleOf,
	importVisibility,
	linkBackCsv,
	youtubeImportScopes,
	YT_SCOPE_CAPTIONS,
	YT_SCOPE_READONLY,
	type ImportedFrom,
	type VideoVisibility,
	type YtFileMatch,
	type YtImport,
	type YtImportItem,
	type YtImportJob,
	type YtImportPlaylist,
	type YtVisibilityMode,
} from '@al-ummah/shared-types';
import { loadChannelRecord } from '../channelAccess';
import { resolveCreator } from '../creatorTiers';
import { logger } from '../logger';
import { consentUrl, exchangeCode, myChannel, refreshAccess, revokeToken, YtAuthError, type GoogleClientConfig } from './google';
import { decryptToken, encryptToken, pkcePair, randomToken } from './crypto';
import { googleClientSecret, readYtSettings, ytReadyConfig, ytRedirectUri, type YtSettingsEnv } from './settings';
import {
	importView,
	isVisibilityMode,
	latestImportRow,
	readImportRow,
	readItemRow,
	readItemRows,
	readPlaylistRows,
	setImportStatus,
	toItem,
	toPlaylist,
	touchItem,
	ytChannelOf,
	type ImportRow,
	type ItemRow,
} from './rows';

export interface YtQueue {
	send(body: unknown, options?: { delaySeconds?: number }): Promise<unknown>;
	sendBatch?(messages: Iterable<{ body: unknown; delaySeconds?: number }>): Promise<unknown>;
}

export interface YtEnv extends YtSettingsEnv {
	SEARCH_DB?: D1Database;
	YT_IMPORT_QUEUE?: YtQueue;
	VIDEOS_WEB_URL?: string;
	videos?: R2Bucket;
	channels?: R2Bucket;
	[binding: string]: unknown;
}

export class YtHttpError extends Error {
	constructor(readonly status: number, readonly code: string, message = code) {
		super(message);
	}
}

export interface YtCaller {
	userId: string;
	roles?: readonly string[] | null;
}

/** A consent waits this long for Google to send the creator back. */
export const OAUTH_STATE_TTL_MS = 15 * 60_000;
/** Picked items per selection call; matches per matches call. */
export const MAX_SELECTION = 20_000;
export const MAX_MATCHES = 500;
/** States in which an import still runs (and holds a token). */
export const ACTIVE_STATUSES = ['listing', 'ready', 'importing'] as const;

export function ytDb(env: YtEnv): D1Database {
	if (!env.SEARCH_DB) throw new YtHttpError(503, 'unavailable', 'The import store is not configured');
	return env.SEARCH_DB;
}

export async function enqueue(env: YtEnv, job: YtImportJob, delaySeconds?: number): Promise<void> {
	if (!env.YT_IMPORT_QUEUE) throw new YtHttpError(503, 'unavailable', 'The import queue is not configured');
	await env.YT_IMPORT_QUEUE.send(job, delaySeconds ? { delaySeconds: Math.min(43_200, Math.max(0, Math.round(delaySeconds))) } : undefined);
}

export async function enqueueMany(env: YtEnv, jobs: YtImportJob[]): Promise<void> {
	if (!jobs.length) return;
	const q = env.YT_IMPORT_QUEUE;
	if (!q) throw new YtHttpError(503, 'unavailable', 'The import queue is not configured');
	for (let i = 0; i < jobs.length; i += 100) {
		const chunk = jobs.slice(i, i + 100);
		if (q.sendBatch) await q.sendBatch(chunk.map((body) => ({ body })));
		else for (const body of chunk) await q.send(body);
	}
}

/**
 * The caller may import into this channel: may upload there and holds a
 * creator tier (the channel owner's tier applies, like uploads). Returns the
 * channel owner.
 */
export async function requireImporter(env: YtEnv, who: YtCaller, channelId: string): Promise<{ ownerId: string }> {
	const channel = await loadChannelRecord(env as never, channelId);
	if (!channel || channel.isDeleted) throw new YtHttpError(404, 'channel_not_found', 'Channel not found');
	if (!can(channelRoleOf(channel, who.userId), 'video.upload')) throw new YtHttpError(403, 'forbidden', 'You cannot upload to this channel');
	const ownerId = channel.userId as string;
	const creator = await resolveCreator(ytDb(env), { userId: who.userId, roles: who.roles, channelOwnerId: ownerId });
	// Everyone holds a tier now (Member by default), so the tier must allow uploads, as on /upload
	if (!tierAllowsUploads(creator.tier)) throw new YtHttpError(403, CREATOR_ERROR_CODES.uploadsByInvitation, 'Uploading is by invitation for now');
	return { ownerId };
}

/** The caller's import (only the user who connected manages it, while they may still import into its channel). */
export async function requireOwnImport(env: YtEnv, who: YtCaller, importId: string): Promise<ImportRow> {
	const row = await readImportRow(ytDb(env), importId);
	if (!row || row.user_id !== who.userId) throw new YtHttpError(404, YT_IMPORT_ERRORS.notFound, 'Import not found');
	// A channel role taken away (or the tier) stops the import's actions too
	await requireImporter(env, who, row.channel_id);
	return row;
}

// ---------------------------------------------------------------------------
// Status and connection
// ---------------------------------------------------------------------------

export async function importStatus(env: YtEnv, who: YtCaller, channelId: string): Promise<{ ready: boolean; captionsAvailable: boolean; import: YtImport | null }> {
	await requireImporter(env, who, channelId);
	const ready = !!(await ytReadyConfig(env));
	const row = await latestImportRow(ytDb(env), who.userId, channelId);
	return { ready, captionsAvailable: ready, import: row ? await importView(ytDb(env), row) : null };
}

export async function startOAuth(env: YtEnv, who: YtCaller, input: { channelId: string; captions: boolean; locale: 'en' | 'ar' }, now = new Date()): Promise<{ url: string }> {
	const { ownerId } = await requireImporter(env, who, input.channelId);
	const cfg = await ytReadyConfig(env);
	if (!cfg) throw new YtHttpError(409, YT_IMPORT_ERRORS.notEnabled, 'Moving from YouTube is not available yet');
	const db = ytDb(env);
	const state = randomToken(32);
	const { verifier, challenge } = await pkcePair();
	await db.batch([
		db.prepare('DELETE FROM yt_oauth_states WHERE user_id = ? AND expires_at < ?').bind(who.userId, now.toISOString()),
		db
			.prepare('INSERT INTO yt_oauth_states (state, user_id, channel_id, owner_id, locale, captions, verifier, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
			.bind(state, who.userId, input.channelId, ownerId, input.locale, input.captions ? 1 : 0, verifier, new Date(now.getTime() + OAUTH_STATE_TTL_MS).toISOString()),
	]);
	return { url: consentUrl(cfg, { state, challenge, scopes: youtubeImportScopes(input.captions) }) };
}

function studioUrl(env: YtEnv, locale: string, channelId: string, query: Record<string, string>): string {
	const base = (env.VIDEOS_WEB_URL ?? '').replace(/\/$/, '');
	const lang = locale === 'ar' ? 'ar' : 'en';
	return `${base}/${lang}/studio/${encodeURIComponent(channelId)}/content/youtube?${new URLSearchParams(query).toString()}`;
}

interface StateRow {
	state: string;
	user_id: string;
	channel_id: string;
	owner_id: string;
	locale: string;
	captions: number;
	verifier: string;
	code: string | null;
	connect_hash: string | null;
	expires_at: string;
}

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Google's code waits this long for the signed-in creator to finish the connection. */
export const OAUTH_CODE_TTL_MS = 5 * 60_000;

/**
 * Google sent the browser back. Nothing is exchanged here: this request
 * carries no sign-in. The code is kept on the state row (once,
 * OAUTH_CODE_TTL_MS) with the hash of a fresh connect token, and only this
 * browser gets the token (`?connect=`). The state is never handed back: whoever
 * started the consent knows it, so it must not redeem a consent another person
 * gave (a phished victim's YouTube). POST oauth/finish takes the token and
 * checks the caller is the user who started. Always answers where to send the
 * browser: the wizard with `?connect=<token>` or `?error=`.
 */
export async function oauthCallback(env: YtEnv, query: { code?: string; state?: string; error?: string }, now = new Date()): Promise<string> {
	const db = ytDb(env);
	const state = query.state && query.state.length <= 128 ? query.state : '';
	const row = state ? await db.prepare('SELECT * FROM yt_oauth_states WHERE state = ?').bind(state).first<StateRow>() : null;
	const nowIso = now.toISOString();
	if (!row || row.code || Date.parse(row.expires_at) < now.getTime()) {
		// Unknown, expired, or a second callback for the same consent: the consent is over
		if (row) await db.prepare('DELETE FROM yt_oauth_states WHERE state = ?').bind(state).run();
		logger.info('[YouTubeImport] Callback without a valid state', { hasState: !!state, found: !!row });
		return `${(env.VIDEOS_WEB_URL ?? '').replace(/\/$/, '')}/en/studio?${new URLSearchParams({ error: 'failed' })}`;
	}
	const back = (q: Record<string, string>) => studioUrl(env, row.locale, row.channel_id, q);
	if (query.error || !query.code || query.code.length > 2048) {
		await db.prepare('DELETE FROM yt_oauth_states WHERE state = ?').bind(state).run();
		return back({ error: YT_IMPORT_ERRORS.denied });
	}
	const connect = randomToken(32);
	// Single use: only the first callback stores its code
	const kept = await db
		.prepare('UPDATE yt_oauth_states SET code = ?, connect_hash = ?, expires_at = ? WHERE state = ? AND code IS NULL AND expires_at >= ?')
		.bind(query.code, await sha256Hex(connect), new Date(now.getTime() + OAUTH_CODE_TTL_MS).toISOString(), state, nowIso)
		.run();
	if (!Number(kept.meta?.changes ?? 0)) return back({ error: 'failed' });
	return back({ connect });
}

/**
 * The signed-in creator finishes the connection the callback prepared, with
 * the connect token only the consenting browser received: only the user who
 * started the consent, while they may still import into its channel. The
 * consent is used up whatever happens. Answers the import.
 */
export async function finishOAuth(env: YtEnv, who: YtCaller, connect: string, now = new Date()): Promise<{ import: YtImport }> {
	const db = ytDb(env);
	// The connect token from the callback (never the state); single use
	const row =
		connect && connect.length <= 128
			? await db.prepare('DELETE FROM yt_oauth_states WHERE connect_hash = ? RETURNING *').bind(await sha256Hex(connect)).first<StateRow>()
			: null;
	if (!row || !row.code || Date.parse(row.expires_at) < now.getTime()) throw new YtHttpError(404, YT_IMPORT_ERRORS.connectExpired, 'This connection has expired; connect again');
	if (row.user_id !== who.userId) {
		logger.warn('[YouTubeImport] Connection finished by another user; refused', { startedBy: row.user_id, finishedBy: who.userId, channelId: row.channel_id });
		throw new YtHttpError(403, 'forbidden', 'This connection was started by another account');
	}
	const { ownerId } = await requireImporter(env, who, row.channel_id);
	const cfg = await ytReadyConfig(env);
	if (!cfg) throw new YtHttpError(409, YT_IMPORT_ERRORS.notEnabled, 'Moving from YouTube is not available yet');
	let tokens: Awaited<ReturnType<typeof exchangeCode>>;
	try {
		tokens = await exchangeCode(cfg, row.code, row.verifier);
	} catch (error) {
		if (error instanceof YtAuthError) throw new YtHttpError(400, YT_IMPORT_ERRORS.denied, 'Google refused the connection');
		throw error;
	}
	const granted = new Set(tokens.scope.split(/\s+/).filter(Boolean));
	// Google's granular consent lets the creator untick a scope
	if (granted.size && !granted.has(YT_SCOPE_READONLY) && !granted.has(YT_SCOPE_CAPTIONS)) {
		if (tokens.refreshToken) await revokeToken(tokens.refreshToken);
		throw new YtHttpError(400, YT_IMPORT_ERRORS.denied, 'YouTube access was not granted');
	}
	if (!tokens.refreshToken) {
		logger.warn('[YouTubeImport] Google gave no refresh token', { userId: row.user_id });
		throw new YtHttpError(502, 'failed', 'Google gave no lasting access; connect again');
	}
	const captions = Number(row.captions) === 1 && (granted.size === 0 || granted.has(YT_SCOPE_CAPTIONS));
	const channel = await myChannel(tokens.accessToken);
	if (!channel) {
		await revokeToken(tokens.refreshToken);
		throw new YtHttpError(409, YT_IMPORT_ERRORS.noChannel, 'This Google account has no YouTube channel');
	}
	const importId = await connectImport(env, cfg, {
		userId: row.user_id,
		channelId: row.channel_id,
		ownerId,
		captions,
		scopes: [...granted].join(' '),
		refreshToken: tokens.refreshToken,
		ytChannel: {
			id: channel.id,
			title: channel.snippet?.title ?? '',
			thumbnailUrl: channel.snippet?.thumbnails?.default?.url ?? channel.snippet?.thumbnails?.medium?.url ?? null,
			videoCount: channel.statistics?.videoCount ? Number(channel.statistics.videoCount) : null,
			uploadsPlaylistId: channel.contentDetails?.relatedPlaylists?.uploads ?? null,
		},
		now,
	});
	logger.info('[YouTubeImport] Connected', { importId, userId: row.user_id, channelId: row.channel_id, captions });
	return { import: await importView(db, (await readImportRow(db, importId)) as ImportRow) };
}

/**
 * Stores the connection: a running import of the same YouTube channel gets
 * the new token (and is listed again unless it is importing); otherwise a new
 * import starts (a running one of another YouTube channel is cancelled).
 */
async function connectImport(
	env: YtEnv,
	cfg: GoogleClientConfig,
	c: {
		userId: string;
		channelId: string;
		ownerId: string;
		captions: boolean;
		scopes: string;
		refreshToken: string;
		ytChannel: { id: string; title: string; thumbnailUrl: string | null; videoCount: number | null; uploadsPlaylistId: string | null };
		now: Date;
	},
): Promise<string> {
	const db = ytDb(env);
	const at = c.now.toISOString();
	const running = await db
		.prepare(`SELECT * FROM yt_imports WHERE user_id = ? AND channel_id = ? AND status IN ('listing', 'ready', 'importing') ORDER BY created_at DESC LIMIT 1`)
		.bind(c.userId, c.channelId)
		.first<ImportRow>();
	if (running && ytChannelOf(running)?.id === c.ytChannel.id) {
		const sealed = await encryptToken(cfg.clientSecret, running.id, c.refreshToken);
		const relist = running.status !== 'importing';
		await db
			.prepare(
				`UPDATE yt_imports SET refresh_token_enc = ?, token_iv = ?, scopes = ?, captions = ?, yt_channel_json = ?, error = NULL, updated_at = ?${relist ? ", status = 'listing'" : ''} WHERE id = ?`,
			)
			.bind(sealed.ciphertext, sealed.iv, c.scopes, c.captions ? 1 : 0, JSON.stringify(c.ytChannel), at, running.id)
			.run();
		if (relist) await enqueue(env, { kind: 'yt-list', importId: running.id, phase: 'videos' });
		return running.id;
	}
	if (running) await endImport(env, running, 'cancelled', 'replaced');
	const id = crypto.randomUUID();
	const sealed = await encryptToken(cfg.clientSecret, id, c.refreshToken);
	await db
		.prepare(
			`INSERT INTO yt_imports (id, user_id, channel_id, owner_id, status, yt_channel_json, captions, visibility_mode, refresh_token_enc, token_iv, scopes, created_at, updated_at)
			 VALUES (?, ?, ?, ?, 'listing', ?, ?, 'keep', ?, ?, ?, ?, ?)`,
		)
		.bind(id, c.userId, c.channelId, c.ownerId, JSON.stringify(c.ytChannel), c.captions ? 1 : 0, sealed.ciphertext, sealed.iv, c.scopes, at, at)
		.run();
	await enqueue(env, { kind: 'yt-list', importId: id, phase: 'videos' });
	return id;
}

/** A Google access token for this import. Throws YtAuthError when the connection is gone. */
export async function accessTokenFor(env: YtEnv, row: ImportRow): Promise<string> {
	if (!row.refresh_token_enc || !row.token_iv) throw new YtAuthError('Not connected to Google');
	const settings = await readYtSettings(env);
	const clientSecret = await googleClientSecret(env);
	if (!settings.clientId || !clientSecret) throw new YtAuthError('Google sign-in is not configured');
	const refresh = await decryptToken(clientSecret, row.id, { ciphertext: row.refresh_token_enc, iv: row.token_iv });
	if (!refresh) throw new YtAuthError('The stored Google token cannot be read');
	return refreshAccess({ clientId: settings.clientId, clientSecret, redirectUri: ytRedirectUri(env) }, refresh);
}

/** Revokes and deletes the import's Google token. Never throws. */
export async function dropToken(env: YtEnv, row: Pick<ImportRow, 'id' | 'refresh_token_enc' | 'token_iv'>): Promise<void> {
	if (row.refresh_token_enc && row.token_iv) {
		const clientSecret = await googleClientSecret(env);
		const refresh = clientSecret ? await decryptToken(clientSecret, row.id, { ciphertext: row.refresh_token_enc, iv: row.token_iv }) : null;
		if (refresh) await revokeToken(refresh);
	}
	await ytDb(env).prepare('UPDATE yt_imports SET refresh_token_enc = NULL, token_iv = NULL WHERE id = ?').bind(row.id).run();
}

/** Ends an import: token revoked and deleted, status set. Videos already imported stay. */
export async function endImport(env: YtEnv, row: ImportRow, status: 'finished' | 'cancelled' | 'failed', error: string | null = null): Promise<void> {
	await dropToken(env, row);
	await setImportStatus(ytDb(env), row.id, status, { error });
}

// ---------------------------------------------------------------------------
// The import page
// ---------------------------------------------------------------------------

/** How many video records one page load refreshes (the rest on the next poll). */
export const REFRESH_PER_READ = 50;

/** The item's state as its video record tells it. */
export function stateFromVideo(
	video: { uploadStatus?: string; isDeleted?: boolean; abandoned?: boolean; processingIssue?: { kind?: string } } | null,
): { state: 'uploading' | 'processing' | 'ready' | 'failed'; error: string | null } {
	if (!video || video.isDeleted) return { state: 'failed', error: 'video_removed' };
	if (video.abandoned || video.uploadStatus === 'failed' || video.processingIssue?.kind === 'needs_reupload') return { state: 'failed', error: 'upload_failed' };
	if (video.uploadStatus === 'ready') return { state: 'ready', error: null };
	if (video.uploadStatus === 'processing') return { state: 'processing', error: null };
	return { state: 'uploading', error: null };
}

/**
 * Brings uploading/processing items up to date from their video records (at
 * most REFRESH_PER_READ reads, the oldest-updated first) and stores the change.
 */
export async function refreshItemStates(env: YtEnv, items: ItemRow[], now = new Date()): Promise<ItemRow[]> {
	if (!env.videos) return items;
	const due = items
		.filter((i) => i.video_id && (i.state === 'uploading' || i.state === 'processing' || i.state === 'selected'))
		.sort((a, b) => a.updated_at.localeCompare(b.updated_at))
		.slice(0, REFRESH_PER_READ);
	const db = ytDb(env);
	const at = now.toISOString();
	for (const item of due) {
		const object = await env.videos.get(item.video_id as string);
		const video = object ? ((await object.json()) as Parameters<typeof stateFromVideo>[0]) : null;
		const next = stateFromVideo(video);
		if (next.state === item.state && next.error === item.error) continue;
		await touchItem(db, item.id, { state: next.state, error: next.error }, at);
		item.state = next.state;
		item.error = next.error;
		item.updated_at = at;
	}
	return items;
}

/** Every picked item is done (ready, failed, or never uploaded and left). */
/**
 * Every picked item has landed: its video is ready (and yt-finalize has had its go at YouTube's
 * thumbnail, which a finished import no longer gets) or it failed.
 */
export function allPickedSettled(items: Pick<ItemRow, 'selected' | 'state' | 'video_id' | 'thumbnail_state'>[]): boolean {
	const picked = items.filter((i) => Number(i.selected) === 1);
	return (
		picked.length > 0 &&
		picked.every((i) => (i.state === 'ready' && !(i.video_id && i.thumbnail_state === 'pending')) || i.state === 'failed' || i.state === 'imported')
	);
}

export async function readImport(env: YtEnv, who: YtCaller, importId: string): Promise<{ import: YtImport; items: YtImportItem[]; playlists: YtImportPlaylist[] }> {
	const row = await requireOwnImport(env, who, importId);
	const db = ytDb(env);
	let items = await readItemRows(db, importId);
	if (row.status === 'importing') {
		items = await refreshItemStates(env, items);
		// Everything picked has landed: finish (playlists, token revoked; idempotent)
		if (allPickedSettled(items)) await enqueue(env, { kind: 'yt-close', importId });
	}
	const playlists = await readPlaylistRows(db, importId);
	return { import: await importView(db, row), items: items.map(toItem), playlists: playlists.map(toPlaylist) };
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

const PICKABLE = ['ready', 'importing'];

export async function saveSelection(
	env: YtEnv,
	who: YtCaller,
	importId: string,
	input: { itemIds: string[]; playlistIds: string[]; visibilityMode: YtVisibilityMode },
	now = new Date(),
): Promise<YtImport> {
	const row = await requireOwnImport(env, who, importId);
	if (!PICKABLE.includes(row.status)) throw new YtHttpError(409, 'not_pickable', 'This import cannot change its selection now');
	if (!isVisibilityMode(input.visibilityMode)) throw new YtHttpError(400, 'invalid_request', 'visibilityMode must be keep or private');
	const db = ytDb(env);
	const at = now.toISOString();
	const items = JSON.stringify([...new Set(input.itemIds)].slice(0, MAX_SELECTION));
	const playlists = JSON.stringify([...new Set(input.playlistIds)].slice(0, MAX_SELECTION));
	await db.batch([
		// Unpicked: only items nothing was uploaded for yet (an upload under way stays picked)
		db
			.prepare(
				`UPDATE yt_import_items SET selected = 0, state = 'available', updated_at = ?
				 WHERE import_id = ? AND state = 'selected' AND video_id IS NULL AND id NOT IN (SELECT value FROM json_each(?))`,
			)
			.bind(at, importId, items),
		// Picked: an item an earlier import already brought ('imported') is refused silently
		db
			.prepare(`UPDATE yt_import_items SET selected = 1, state = 'selected', updated_at = ? WHERE import_id = ? AND state = 'available' AND id IN (SELECT value FROM json_each(?))`)
			.bind(at, importId, items),
		db
			.prepare(`UPDATE yt_import_playlists SET selected = CASE WHEN yt_playlist_id IN (SELECT value FROM json_each(?)) THEN 1 ELSE 0 END WHERE import_id = ? AND playlist_id IS NULL`)
			.bind(playlists, importId),
		db.prepare('UPDATE yt_imports SET visibility_mode = ?, updated_at = ? WHERE id = ?').bind(input.visibilityMode, at, importId),
	]);
	return importView(db, (await readImportRow(db, importId)) as ImportRow);
}

export async function saveMatches(env: YtEnv, who: YtCaller, importId: string, matches: { itemId: string; match: YtFileMatch | null }[], now = new Date()): Promise<{ updated: number }> {
	const row = await requireOwnImport(env, who, importId);
	if (!PICKABLE.includes(row.status)) throw new YtHttpError(409, 'not_pickable', 'This import cannot change its files now');
	if (matches.length > MAX_MATCHES) throw new YtHttpError(400, 'invalid_request', `At most ${MAX_MATCHES} matches per call`);
	if (!matches.length) return { updated: 0 };
	const db = ytDb(env);
	const at = now.toISOString();
	const results = await db.batch(
		matches.map((m) =>
			db
				.prepare(`UPDATE yt_import_items SET match_json = ?, updated_at = ? WHERE id = ? AND import_id = ? AND state IN ('available', 'selected', 'failed')`)
				.bind(m.match ? JSON.stringify(m.match) : null, at, m.itemId, importId),
		),
	);
	return { updated: results.reduce((n, r) => n + Number(r.meta?.changes ?? 0), 0) };
}

/**
 * Starts (or continues, after more picks) the import: picked items without a
 * file are unpicked, steps are marked pending and captions are queued.
 */
export async function startImport(env: YtEnv, who: YtCaller, importId: string, now = new Date()): Promise<YtImport> {
	const row = await requireOwnImport(env, who, importId);
	if (!PICKABLE.includes(row.status)) throw new YtHttpError(409, 'not_startable', 'This import cannot start now');
	const db = ytDb(env);
	const at = now.toISOString();
	await db
		.prepare(`UPDATE yt_import_items SET selected = 0, state = 'available', updated_at = ? WHERE import_id = ? AND state = 'selected' AND match_json IS NULL AND video_id IS NULL`)
		.bind(at, importId)
		.run();
	const ready = await db
		.prepare(`SELECT COUNT(*) AS n FROM yt_import_items WHERE import_id = ? AND selected = 1 AND state NOT IN ('imported')`)
		.bind(importId)
		.first<{ n: number }>();
	if (!Number(ready?.n ?? 0)) throw new YtHttpError(409, 'nothing_selected', 'Pick at least one video with its file');
	const captions = Number(row.captions) === 1;
	await db.batch([
		db
			.prepare(`UPDATE yt_import_items SET thumbnail_state = 'pending', updated_at = ? WHERE import_id = ? AND selected = 1 AND thumbnail_state = 'none' AND thumbnail_url IS NOT NULL`)
			.bind(at, importId),
		db.prepare(`UPDATE yt_import_playlists SET state = 'pending' WHERE import_id = ? AND selected = 1 AND state = 'none'`).bind(importId),
		db.prepare(`UPDATE yt_imports SET status = 'importing', error = NULL, updated_at = ? WHERE id = ?`).bind(at, importId),
	]);
	if (captions) {
		const { results } = await db
			.prepare(`UPDATE yt_import_items SET captions_state = 'pending', updated_at = ? WHERE import_id = ? AND selected = 1 AND captions_state = 'none' RETURNING id`)
			.bind(at, importId)
			.all<{ id: string }>();
		await enqueueMany(env, (results ?? []).map((r) => ({ kind: 'yt-captions', importId, itemId: r.id }) as YtImportJob));
	}
	logger.info('[YouTubeImport] Started', { importId, picked: Number(ready?.n ?? 0), captions });
	return importView(db, (await readImportRow(db, importId)) as ImportRow);
}

/** A failed item is picked again: its upload resumes the same video, its failed steps run again. */
export async function retryItem(env: YtEnv, who: YtCaller, importId: string, itemId: string, now = new Date()): Promise<YtImportItem> {
	const row = await requireOwnImport(env, who, importId);
	if (row.status !== 'importing') throw new YtHttpError(409, 'not_importing', 'This import is not running');
	const db = ytDb(env);
	const item = await readItemRow(db, importId, itemId);
	if (!item) throw new YtHttpError(404, YT_IMPORT_ERRORS.notFound, 'Item not found');
	const stepFailed = item.thumbnail_state === 'failed' || item.captions_state === 'failed';
	if (item.state !== 'failed' && !stepFailed) throw new YtHttpError(409, 'not_failed', 'Only a failed item can be tried again');
	const at = now.toISOString();
	const fields: Parameters<typeof touchItem>[2] = { attempts: 0 };
	if (item.state === 'failed') Object.assign(fields, { state: 'selected', selected: 1, error: null });
	if (item.thumbnail_state === 'failed') fields.thumbnail_state = 'pending';
	if (item.captions_state === 'failed') fields.captions_state = 'pending';
	await touchItem(db, itemId, fields, at);
	if (item.captions_state === 'failed') await enqueue(env, { kind: 'yt-captions', importId, itemId });
	if (item.video_id && (item.thumbnail_state === 'failed' || item.state !== 'failed')) await enqueue(env, { kind: 'yt-finalize', importId, itemId });
	return toItem((await readItemRow(db, importId, itemId)) as ItemRow);
}

export async function cancelImport(env: YtEnv, who: YtCaller, importId: string): Promise<YtImport> {
	const row = await requireOwnImport(env, who, importId);
	if ((ACTIVE_STATUSES as readonly string[]).includes(row.status)) {
		await endImport(env, row, 'cancelled');
		logger.info('[YouTubeImport] Cancelled', { importId });
	}
	return importView(ytDb(env), (await readImportRow(ytDb(env), importId)) as ImportRow);
}

/** The link-back CSV: one line per item whose video is here (ready). */
export async function linkBack(env: YtEnv, who: YtCaller, importId: string, locale: 'en' | 'ar'): Promise<string> {
	await requireOwnImport(env, who, importId);
	const base = (env.VIDEOS_WEB_URL ?? '').replace(/\/$/, '');
	const items = await readItemRows(ytDb(env), importId);
	return linkBackCsv(
		items
			.filter((i) => i.video_id && i.state === 'ready')
			.map((i) => ({ ytVideoId: i.yt_video_id, url: `${base}/${locale}/video/${i.video_id}`, title: i.title })),
	);
}

// ---------------------------------------------------------------------------
// The upload of one item (POST /api/videos/upload/initiate with `youtubeImport`)
// ---------------------------------------------------------------------------

export interface ImportUpload {
	importRow: ImportRow;
	item: ItemRow;
	/** Record fields from the item snapshot (the body's own values are ignored) */
	metadata: {
		title: string;
		description: string;
		tags: string;
		titleLocalized?: Record<string, string>;
		descriptionLocalized?: Record<string, string>;
		language?: string;
		visibility: VideoVisibility;
		importedFrom: ImportedFrom;
		/** YouTube's publish date when it is public here at once (the order on the channel follows YouTube) */
		publishedAt?: string;
		/** Made for kids on YouTube: comments start off, as YouTube has them (wiki AUN-YT-IMPORT); the creator can turn them on */
		commentSettings?: 'off';
	};
	/** A YouTube schedule still in the future: published here at that time */
	scheduleAt: string | null;
}

/**
 * The upload claim of an item (lib/uploads/initiateOnce.ts): parallel
 * initiates of the same item make one video, the others reuse it.
 */
export async function youtubeItemClaimKey(importId: string, itemId: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['youtube-import', importId, itemId])));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Title length our records take (the same cap the upload page applies). */
const TITLE_MAX = 200;

/**
 * Checks an initiate's `youtubeImport` and builds the record fields from the
 * item: 404 youtube_import_not_found unless the item belongs to a running
 * import of this caller on this channel; 409 youtube_item_taken when its video
 * is already here.
 */
export async function prepareImportUpload(env: YtEnv, who: YtCaller, channelId: string, ref: { importId: string; itemId: string }, now = new Date()): Promise<ImportUpload> {
	const db = ytDb(env);
	const importRow = await readImportRow(db, ref.importId);
	if (!importRow || importRow.user_id !== who.userId || importRow.channel_id !== channelId || importRow.status !== 'importing') {
		throw new YtHttpError(404, YT_IMPORT_ERRORS.notFound, 'Import not found');
	}
	await requireImporter(env, who, channelId);
	const item = await readItemRow(db, ref.importId, ref.itemId);
	if (!item || Number(item.selected) !== 1) throw new YtHttpError(404, YT_IMPORT_ERRORS.notFound, 'Import item not found');
	if (item.state === 'imported' || item.state === 'ready' || item.state === 'processing') throw new YtHttpError(409, YT_IMPORT_ERRORS.itemTaken, 'This video is already here');
	const plain = toItem(item);
	const { visibility, scheduleAt } = importVisibility(plain, importRow.visibility_mode === 'private' ? 'private' : 'keep', now);
	const metadata: ImportUpload['metadata'] = {
		title: (plain.title || plain.ytVideoId).slice(0, TITLE_MAX),
		description: plain.description,
		tags: plain.tags.join(','),
		...(Object.keys(plain.titleLocalized).length ? { titleLocalized: plain.titleLocalized } : {}),
		...(Object.keys(plain.descriptionLocalized).length ? { descriptionLocalized: plain.descriptionLocalized } : {}),
		...(plain.language ? { language: plain.language } : {}),
		visibility,
		importedFrom: { platform: 'youtube', videoId: plain.ytVideoId, publishedAt: plain.publishedAt, madeForKids: plain.madeForKids, importId: importRow.id },
		...(visibility === 'public' && !scheduleAt && plain.publishedAt ? { publishedAt: plain.publishedAt } : {}),
		...(plain.madeForKids ? { commentSettings: 'off' as const } : {}),
	};
	return { importRow, item, metadata, scheduleAt };
}

/**
 * Records the video an item's upload created or reused, and queues its
 * finishing step (thumbnail, captions; it waits for the video itself).
 * Returns false when the item's video is already processing or here.
 */
export async function recordImportUpload(env: YtEnv, upload: ImportUpload, videoId: string, now = new Date()): Promise<boolean> {
	const res = await ytDb(env)
		.prepare(
			`UPDATE yt_import_items SET video_id = ?, state = 'uploading', error = NULL, updated_at = ?
			 WHERE id = ? AND selected = 1 AND state IN ('selected', 'uploading', 'failed')`,
		)
		.bind(videoId, now.toISOString(), upload.item.id)
		.run();
	if (!Number(res.meta?.changes ?? 0)) return false;
	await enqueue(env, { kind: 'yt-finalize', importId: upload.importRow.id, itemId: upload.item.id }, FINALIZE_FIRST_DELAY_S);
	return true;
}

/** The finishing step first runs this long after the upload starts (it re-queues itself while the video is on its way). */
export const FINALIZE_FIRST_DELAY_S = 60;
