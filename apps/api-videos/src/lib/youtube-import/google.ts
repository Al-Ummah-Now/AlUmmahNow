/**
 * Google OAuth and the YouTube Data API v3, as Move from YouTube uses them
 * (wiki AUN-YT-IMPORT). Read only: channels, playlistItems, videos, playlists,
 * captions. Nothing here writes to YouTube.
 *
 * Quota (default 10,000 units a day per Google project): list calls cost 1,
 * captions.list 50, captions.download 200. A quotaExceeded answer is a
 * YtQuotaError: the job waits for the reset (midnight Pacific) and goes on.
 *
 * The hosts are the real Google ones; the local stack answers them with its
 * fake Google (scripts/local-stack/fake-external.ts), so no env switches here.
 */
import { logger } from '../logger';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

/** Google answered that the daily quota is spent. */
export class YtQuotaError extends Error {
	constructor() {
		super('YouTube API quota exceeded');
		this.name = 'YtQuotaError';
	}
}

/** The creator's consent is gone (revoked at Google, expired, or the token cannot be read). */
export class YtAuthError extends Error {
	constructor(message = 'Google access was revoked or expired') {
		super(message);
		this.name = 'YtAuthError';
	}
}

/** Anything else Google refused; `retryable` for 5xx and rate limits. */
export class YtApiError extends Error {
	constructor(readonly status: number, readonly reason: string, readonly retryable: boolean) {
		super(`YouTube API ${status} ${reason}`);
		this.name = 'YtApiError';
	}
}

export interface GoogleClientConfig {
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}

export function consentUrl(cfg: GoogleClientConfig, opts: { state: string; challenge: string; scopes: string[] }): string {
	const u = new URL(GOOGLE_AUTH_URL);
	u.searchParams.set('client_id', cfg.clientId);
	u.searchParams.set('redirect_uri', cfg.redirectUri);
	u.searchParams.set('response_type', 'code');
	u.searchParams.set('scope', opts.scopes.join(' '));
	u.searchParams.set('state', opts.state);
	u.searchParams.set('code_challenge', opts.challenge);
	u.searchParams.set('code_challenge_method', 'S256');
	// A refresh token: the import runs for hours or days after the consent
	u.searchParams.set('access_type', 'offline');
	u.searchParams.set('prompt', 'consent');
	u.searchParams.set('include_granted_scopes', 'false');
	return u.toString();
}

interface TokenAnswer {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	scope?: string;
	error?: string;
}

async function tokenCall(body: Record<string, string>): Promise<TokenAnswer & { status: number }> {
	const res = await fetch(GOOGLE_TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(body).toString(),
	});
	const json = (await res.json().catch(() => ({}))) as TokenAnswer;
	return { ...json, status: res.status };
}

/** The consent's code for tokens. Throws YtAuthError when Google refuses it. */
export async function exchangeCode(cfg: GoogleClientConfig, code: string, verifier: string): Promise<{ accessToken: string; refreshToken: string | null; scope: string }> {
	const t = await tokenCall({
		grant_type: 'authorization_code',
		code,
		code_verifier: verifier,
		client_id: cfg.clientId,
		client_secret: cfg.clientSecret,
		redirect_uri: cfg.redirectUri,
	});
	if (t.status !== 200 || !t.access_token) {
		if (t.status >= 500) throw new YtApiError(t.status, 'token_exchange', true);
		throw new YtAuthError(`Google refused the code (${t.error ?? t.status})`);
	}
	return { accessToken: t.access_token, refreshToken: t.refresh_token ?? null, scope: t.scope ?? '' };
}

/** A fresh access token from the refresh token. */
export async function refreshAccess(cfg: GoogleClientConfig, refreshToken: string): Promise<string> {
	const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: cfg.clientId, client_secret: cfg.clientSecret });
	if (t.status === 200 && t.access_token) return t.access_token;
	if (t.status >= 500 || t.status === 429) throw new YtApiError(t.status, 'token_refresh', true);
	throw new YtAuthError(`Google refused the refresh token (${t.error ?? t.status})`);
}

/** Revokes the grant at Google. Never throws: the token is deleted on our side anyway. */
export async function revokeToken(token: string): Promise<boolean> {
	try {
		const res = await fetch(GOOGLE_REVOKE_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ token }).toString(),
		});
		// 400 invalid_token: already revoked, which is the goal
		return res.ok || res.status === 400;
	} catch (error) {
		logger.warn('[YouTubeImport] Token revoke failed', { error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

interface ApiErrorBody {
	error?: { code?: number; message?: string; errors?: Array<{ reason?: string }> };
}

async function throwFor(res: Response): Promise<never> {
	const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
	const reason = body.error?.errors?.[0]?.reason ?? '';
	if (res.status === 403 && (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded')) throw new YtQuotaError();
	if (res.status === 401) throw new YtAuthError();
	const retryable = res.status >= 500 || res.status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded';
	throw new YtApiError(res.status, reason || 'error', retryable);
}

/** One YouTube Data API GET (JSON). */
export async function ytGet<T>(accessToken: string, path: string, params: Record<string, string | undefined>): Promise<T> {
	const u = new URL(`${YOUTUBE_API}/${path}`);
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
	const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
	if (!res.ok) await throwFor(res);
	return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// The API resources Move from YouTube reads
// ---------------------------------------------------------------------------

export interface YtThumbs {
	[size: string]: { url?: string; width?: number; height?: number } | undefined;
}

export interface YtChannelResource {
	id: string;
	snippet?: { title?: string; thumbnails?: YtThumbs };
	contentDetails?: { relatedPlaylists?: { uploads?: string } };
	statistics?: { videoCount?: string };
}

export interface YtVideoResource {
	id: string;
	snippet?: {
		title?: string;
		description?: string;
		publishedAt?: string;
		tags?: string[];
		defaultLanguage?: string;
		defaultAudioLanguage?: string;
		thumbnails?: YtThumbs;
		liveBroadcastContent?: string;
	};
	contentDetails?: { duration?: string };
	status?: { privacyStatus?: string; publishAt?: string; madeForKids?: boolean; selfDeclaredMadeForKids?: boolean; uploadStatus?: string };
	localizations?: Record<string, { title?: string; description?: string }>;
}

export interface YtPlaylistResource {
	id: string;
	snippet?: { title?: string; description?: string };
	status?: { privacyStatus?: string };
	contentDetails?: { itemCount?: number };
}

export interface YtCaptionResource {
	id: string;
	snippet?: { language?: string; name?: string; trackKind?: string; isDraft?: boolean; status?: string };
}

interface Page<T> {
	items?: T[];
	nextPageToken?: string;
}

export async function myChannel(accessToken: string): Promise<YtChannelResource | null> {
	const page = await ytGet<Page<YtChannelResource>>(accessToken, 'channels', { part: 'snippet,contentDetails,statistics', mine: 'true' });
	return page.items?.[0] ?? null;
}

/** One page (≤ 50) of a playlist's video ids, in playlist order. */
export async function playlistVideoIds(accessToken: string, playlistId: string, pageToken?: string): Promise<{ ids: string[]; next: string | null }> {
	const page = await ytGet<Page<{ contentDetails?: { videoId?: string } }>>(accessToken, 'playlistItems', {
		part: 'contentDetails',
		playlistId,
		maxResults: '50',
		pageToken,
	});
	return { ids: (page.items ?? []).map((i) => i.contentDetails?.videoId).filter((v): v is string => !!v), next: page.nextPageToken ?? null };
}

/** Full records of up to 50 videos. */
export async function videosById(accessToken: string, ids: string[]): Promise<YtVideoResource[]> {
	if (!ids.length) return [];
	const page = await ytGet<Page<YtVideoResource>>(accessToken, 'videos', {
		part: 'snippet,contentDetails,status,localizations',
		id: ids.slice(0, 50).join(','),
		maxResults: '50',
	});
	return page.items ?? [];
}

/** One page of the creator's own playlists. */
export async function myPlaylists(accessToken: string, pageToken?: string): Promise<{ items: YtPlaylistResource[]; next: string | null }> {
	const page = await ytGet<Page<YtPlaylistResource>>(accessToken, 'playlists', { part: 'snippet,status,contentDetails', mine: 'true', maxResults: '50', pageToken });
	return { items: page.items ?? [], next: page.nextPageToken ?? null };
}

/** A video's caption tracks (50 units). */
export async function captionTracks(accessToken: string, videoId: string): Promise<YtCaptionResource[]> {
	const page = await ytGet<Page<YtCaptionResource>>(accessToken, 'captions', { part: 'snippet', videoId });
	return page.items ?? [];
}

/** One caption track as WebVTT (200 units; needs the youtube.force-ssl scope). */
export async function downloadCaption(accessToken: string, captionId: string): Promise<string> {
	const res = await fetch(`${YOUTUBE_API}/captions/${encodeURIComponent(captionId)}?tfmt=vtt`, { headers: { Authorization: `Bearer ${accessToken}` } });
	if (!res.ok) await throwFor(res);
	return res.text();
}

/** Seconds until YouTube's quota resets (midnight America/Los_Angeles), at least 60. */
export function secondsUntilQuotaReset(now = new Date()): number {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
			.formatToParts(now)
			.filter((p) => p.type !== 'literal')
			.map((p) => [p.type, Number(p.value)]),
	) as { hour: number; minute: number; second: number };
	const elapsed = (parts.hour % 24) * 3600 + parts.minute * 60 + parts.second;
	// A few minutes past midnight, so the reset has surely happened
	return Math.max(60, 86400 - elapsed + 300);
}
