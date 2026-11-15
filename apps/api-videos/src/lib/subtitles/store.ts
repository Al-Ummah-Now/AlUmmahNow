/**
 * Storing one subtitle track on a video: the WebVTT file, the original as a
 * backup, the track in the subtitle metadata and on the video record. Used by
 * the subtitle upload endpoint and by the YouTube import (captions brought
 * from YouTube, lib/youtube-import/jobs.ts).
 */
import type { SubtitleMetadata, SubtitleTrack, VideoObject } from '@al-ummah/shared-types';
import R2Repository from '../r2Repo';
import { patchVideo } from '../videoWrites';
import { SubtitleService } from './index';

export interface StoreSubtitleInput {
	/** The subtitle file as text (.srt, .vtt, .sbv) */
	file: string;
	language: string;
	label?: string;
	isDefault?: boolean;
	/** Who added it (recorded on the track) */
	userId: string;
	/** Origin the track URL is served from (the API's own) */
	apiBaseUrl: string;
}

export type StoreSubtitleResult =
	| { status: 'ok'; track: SubtitleTrack; video: VideoObject }
	| { status: 'missing' | 'forbidden' };

export async function storeSubtitleTrack(
	env: { videos: R2Bucket; subtitles: R2Bucket },
	video: Pick<VideoObject, 'id' | 'userId'>,
	input: StoreSubtitleInput,
): Promise<StoreSubtitleResult> {
	const subtitleService = new SubtitleService();
	const videoId = video.id;
	const result = await subtitleService.processSubtitle(input.file, input.language, input.userId);

	await env.subtitles.put(`${videoId}/${input.language}.vtt`, result.webvttContent, { httpMetadata: { contentType: 'text/vtt' } });
	// The original file, as a backup
	await env.subtitles.put(`${videoId}/original/${input.language}.${result.originalFormat}`, input.file, { httpMetadata: { contentType: 'text/plain' } });

	// Subtitles are served by the API itself (no separate CDN)
	const track: SubtitleTrack = {
		...result.track,
		url: `${input.apiBaseUrl}/api/videos/${videoId}/subtitles/${input.language}`,
		label: input.label || result.track.label,
		isDefault: input.isDefault || false,
	};

	// Conditional writes (SCALABILITY-AUDIT AV-3): two languages stored at once both
	// stay, and concurrent changes to the video are not overwritten.
	const metadata = await new R2Repository<SubtitleMetadata>(env.subtitles).updateObject(
		`${videoId}/metadata.json`,
		(current) => {
			let next = subtitleService.addTrack(current, track);
			if (input.isDefault) next = subtitleService.setDefaultTrack(next, input.language);
			Object.assign(current, next);
		},
		{ initial: () => subtitleService.createMetadata(videoId, []) },
	);

	const saved = await patchVideo(
		new R2Repository<VideoObject>(env.videos),
		videoId,
		{
			subtitles: metadata.tracks,
			hasSubtitles: true,
			subtitleLanguages: metadata.tracks.map((t) => t.language),
			dateModified: new Date().toISOString(),
		},
		{ ownerId: video.userId },
	);
	if (saved.status !== 'ok') return { status: saved.status === 'forbidden' ? 'forbidden' : 'missing' };
	return { status: 'ok', track, video: saved.video as VideoObject };
}
