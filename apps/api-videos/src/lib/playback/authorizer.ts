/**
 * Playback authorization (Epic 9.6).
 *
 * Native apps ask for a short-lived playback grant instead of reading a URL
 * off the video record, so delivery can change (decision D2: Bunny today, or
 * R2 + Cloudflare CDN) by swapping the adapter, without an app release.
 *
 * - canPlay is the one visibility gate (removed for everyone, private for the
 *   owner only, same rules as GET /api/videos/:id); adapters never see a
 *   video the viewer may not watch.
 * - BunnyPlaybackAuthorizer wraps today's Bunny CDN token signing.
 * - Downloads (offline entitlements bound to an install, Epic 14) need the D2
 *   decision; adapters throw PlaybackUnsupportedError until then.
 */
import { bunnyDirectoryToken, signedBunnyUrl, tokenExpiry } from '../bunny-signing';
import { isVideoRemoved, type VisibilityFields } from '../visibility';

export interface PlaybackVideo extends VisibilityFields {
	id: string;
	userId?: string;
	playUrl?: string;
}

export interface PlaybackViewer {
	userId: string | null;
}

export interface PlaybackGrant {
	manifestUrl: string;
	/** Unix seconds after which the URL stops working; null when the source is not token-protected. */
	expiresAt: number | null;
	/** Headers the player must send with every request (none for Bunny). */
	headers?: Record<string, string>;
}

export interface DownloadGrant {
	url: string;
	expiresAt: number;
	/** Opaque offline licence the app stores with the file. */
	license: string;
}

export class PlaybackUnsupportedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PlaybackUnsupportedError';
	}
}

export interface PlaybackAuthorizer {
	readonly name: string;
	/** Null when the video has no playable source yet (still processing). */
	playback(video: PlaybackVideo, viewer: PlaybackViewer): Promise<PlaybackGrant | null>;
	download(video: PlaybackVideo, viewer: PlaybackViewer, installId: string, rendition: string): Promise<DownloadGrant>;
}

/** Whether the viewer may watch the video at all. */
export function canPlay(video: PlaybackVideo | null | undefined, viewer: PlaybackViewer): video is PlaybackVideo {
	if (!video || isVideoRemoved(video)) return false;
	if (video.isPublic === false) return !!viewer.userId && video.userId === viewer.userId;
	return true;
}

const BUNNY_VIDEO_ID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export interface BunnyPlaybackConfig {
	/** Library host whose URLs carry CDN tokens (BUNNY_SIGN_HOSTNAME || bunny_hostname). */
	signHost?: string;
	/** BUNNY_SIGN_URLS === "true" and BUNNY_TOKEN_KEY present. */
	tokenKey?: string;
	now?: () => number;
}

export class BunnyPlaybackAuthorizer implements PlaybackAuthorizer {
	readonly name = 'bunny';
	constructor(private readonly config: BunnyPlaybackConfig) {}

	async playback(video: PlaybackVideo): Promise<PlaybackGrant | null> {
		const playUrl = video.playUrl;
		if (!playUrl) return null;
		const { signHost, tokenKey } = this.config;
		if (!signHost || !tokenKey) return { manifestUrl: playUrl, expiresAt: null };
		// Only the canonical playlist of the signing library gets a directory token
		const match = new RegExp(`^https://${signHost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(${BUNNY_VIDEO_ID})/playlist\\.m3u8$`).exec(playUrl);
		if (!match) return { manifestUrl: playUrl, expiresAt: null };
		const nowSeconds = Math.floor((this.config.now?.() ?? Date.now()) / 1000);
		const expires = tokenExpiry(nowSeconds);
		const token = await bunnyDirectoryToken(tokenKey, match[1], expires);
		return { manifestUrl: signedBunnyUrl(signHost, match[1], 'playlist.m3u8', token, expires), expiresAt: expires };
	}

	async download(): Promise<DownloadGrant> {
		throw new PlaybackUnsupportedError('Downloads are not available until the delivery decision (D2) is made');
	}
}
