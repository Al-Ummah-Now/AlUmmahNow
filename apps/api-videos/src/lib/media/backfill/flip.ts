/**
 * "Play R2 first" after a backfill, through the existing provider settings (docs/media-delivery/PROVIDERS.md):
 *   video    the video's override: priority [r2, bunny] — only for videos verified at their current rendition
 *   channel  the channel override: priority [r2, bunny]
 *   global   the playback rules: priority [r2, bunny]
 * Bunny stays the fallback in every case, and a video whose R2 copy is not ready keeps playing Bunny
 * (playback only offers providers whose copy is ready). Undo puts each one back.
 */
import type { MediaOverride, MediaProviderId, MediaSettings, VideoR2State } from '@al-ummah/shared-types';
import R2Repository from '../../r2Repo';
import { readMediaSettings, saveMediaSettings } from '../settings';
import { setVideoOverride } from '../video-override';
import type { BackfillEnv } from './types';

export const R2_FIRST: MediaProviderId[] = ['r2', 'bunny'];
export const MAX_FLIP_VIDEOS = 200;

const r2First = (order: MediaProviderId[]): MediaProviderId[] => [...R2_FIRST, ...order.filter((p) => !R2_FIRST.includes(p))];

/** Verified at the record's current rendition? */
export async function verifiedNow(env: BackfillEnv, videoId: string): Promise<boolean> {
	const row = await env.SEARCH_DB!.prepare('SELECT rev FROM media_r2_verified WHERE video_id = ?1').bind(videoId).first<{ rev: string }>();
	if (!row) return false;
	const video = await new R2Repository<{ r2?: VideoR2State }>(env.videos).getObject(videoId);
	return video?.r2?.status === 'ready' && video.r2.rev === row.rev;
}

export interface FlipResult {
	flipped: string[];
	refused: { videoId: string; problem: string }[];
}

/** Per video. `undo` clears the override the flip set (and only an R2-first one). */
export async function flipVideos(env: BackfillEnv, videoIds: string[], actorId: string, undo = false): Promise<FlipResult> {
	const out: FlipResult = { flipped: [], refused: [] };
	for (const videoId of videoIds.slice(0, MAX_FLIP_VIDEOS)) {
		if (!undo && !(await verifiedNow(env, videoId))) {
			out.refused.push({ videoId, problem: 'not_verified' });
			continue;
		}
		if (undo) {
			const video = await new R2Repository<{ mediaOverride?: MediaOverride }>(env.videos).getObject(videoId);
			if (!video?.mediaOverride || video.mediaOverride.order?.[0] !== 'r2') {
				out.refused.push({ videoId, problem: 'not_r2_first' });
				continue;
			}
		}
		const override: MediaOverride | null = undo ? null : { strategy: 'priority', order: R2_FIRST, note: 'R2 first after a verified backfill' };
		const res = await setVideoOverride(env as never, videoId, override, actorId);
		if (res.ok) out.flipped.push(videoId);
		else if ('problem' in res) out.refused.push({ videoId, problem: res.problem });
	}
	return out;
}

/** Per channel, in the channel overrides. */
export async function flipChannel(env: BackfillEnv, channelId: string, actorId: string, undo = false): Promise<MediaSettings> {
	const current = await readMediaSettings(env, true);
	const channels = { ...current.channels };
	const existing = channels[channelId] ?? {};
	if (undo) {
		const { strategy: _s, order: _o, weights: _w, ...rest } = existing;
		if (Object.keys(rest).filter((k) => k !== 'updatedAt' && k !== 'updatedBy' && k !== 'note').length) channels[channelId] = rest;
		else delete channels[channelId];
	} else {
		channels[channelId] = { ...existing, strategy: 'priority', order: r2First(existing.order ?? current.playback.order), note: existing.note ?? 'R2 first after a backfill' };
	}
	return saveMediaSettings(env, { ...current, channels }, actorId);
}

/** Everywhere: the global playback rules. Undo puts Bunny first again (R2 stays the fallback). */
export async function flipGlobal(env: BackfillEnv, actorId: string, undo = false): Promise<MediaSettings> {
	const current = await readMediaSettings(env, true);
	const order: MediaProviderId[] = undo ? ['bunny', ...current.playback.order.filter((p) => p !== 'bunny')] : r2First(current.playback.order);
	return saveMediaSettings(env, { ...current, playback: { ...current.playback, strategy: 'priority', order } }, actorId);
}

/** Verified vs not, for a channel (the page shows it before a channel flip). */
export async function channelVerification(env: BackfillEnv, channelId: string): Promise<{ videos: number; verified: number }> {
	const total = await env.SEARCH_DB!.prepare("SELECT COUNT(*) AS n FROM content_ownership WHERE kind = 'video' AND channel_id = ?1 AND is_deleted = 0").bind(channelId).first<{ n: number }>();
	const verified = await env.SEARCH_DB!.prepare('SELECT COUNT(*) AS n FROM media_r2_verified WHERE channel_id = ?1').bind(channelId).first<{ n: number }>();
	return { videos: Number(total?.n) || 0, verified: Number(verified?.n) || 0 };
}
