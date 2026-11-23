/**
 * Download one video's subtitle track as a file (AUN-CAPTIONS, QF 2026-11-22).
 *
 * A Quran track is filled at download time exactly as it is served for viewing (the Arabic from our
 * Content Sync copy, a translated track from the channel's edition), unaltered, with Quran
 * Foundation's attribution and the edition in a NOTE block (VTT) or a first zero-length cue (SRT).
 * One video per file; the filled file is never stored (no-store, built per request).
 *
 * Who gets it: first the video's own read rule (lib/videoReadAccess.ts). Then viewer downloads are an
 * admin switch (viewerCaptionDownload), off by default (owner decision 2026-11-22): while it is off,
 * only admins and the video's team with video.edit (owner, channel owner/admin/editor) get the file,
 * for Studio; anyone else gets 404 feature_off, before the track is looked up.
 */
import { z } from 'zod';
import { captionMarkerRanges } from '@al-ummah/shared-types';
import { Enumeration, Str } from '../../lib/chanfana-params';
import { fillServedTrack } from '../../lib/captions/drafts';
import { subtitleDownload, type SubtitleDownloadFormat } from '../../lib/captions/download';
import { editionFor } from '../../lib/quran/translations';
import { logger } from '../../lib/logger';
import { OptionalAuthRoute, type AppContext } from '../../base';
import { loadVideoRecord, videoReadAccess, VIDEO_NOT_FOUND } from '../../lib/videoReadAccess';
import { readCaptionSettings } from '../../lib/captions/jobs';
import { featureOff, viewerCaptionDownloadConfigured } from '../../lib/features';
import { canOnVideo, type AccessVideo } from '../../lib/channelAccess';
import { isAdminRole } from '../../lib/public-access';
import { getAuthContext } from '../../middleware/auth';

const errorBody = z.object({ success: z.boolean(), error: z.string() });

export class SubtitlesDownload extends OptionalAuthRoute {
	schema = {
		tags: ['Subtitles'],
		summary: 'Download a subtitle track as a file',
		description:
			'One video, one language, as an attachment (WebVTT or SubRip). Quran verse text is filled at download time from the Quran Foundation copy, unaltered, with the attribution and edition inside the file. Never cached or stored.',
		request: {
			params: z.object({
				videoId: Str({ description: 'Video ID' }),
				language: Str({ description: 'ISO 639-1 language code (e.g., en, ar, ur)' }),
			}),
			query: z.object({
				format: Enumeration({ description: 'File format', values: ['vtt', 'srt'], default: 'vtt' }),
			}),
		},
		responses: {
			'200': { description: 'The subtitle file (attachment)', content: { 'text/vtt': { schema: z.string() }, 'application/x-subrip': { schema: z.string() } } },
			'404': { description: 'No track in this language, a video hidden from the caller, or (code feature_off) viewer downloads are off and the caller is not on the video\'s team or an admin', content: { 'application/json': { schema: errorBody } } },
			'500': { description: 'Internal server error', content: { 'application/json': { schema: errorBody } } },
		},
	};

	async handle(c: AppContext) {
		try {
			const { params, query } = await this.getValidatedData<typeof this.schema>();
			const { videoId, language } = params;
			const format = ((query.format as string) || 'vtt') as SubtitleDownloadFormat;
			// The video's own read rule (GET /api/videos/:id): hidden from this viewer → the same 404
			const video = await loadVideoRecord<AccessVideo & { channelId?: string }>(c.env as never, videoId);
			const userId = this.getUserId(c);
			if (!(await videoReadAccess(c.env, video as never, userId))) return c.json(VIDEO_NOT_FOUND, 404);
			// Viewer downloads off (the default): only admins and the video's team (Studio)
			if (!viewerCaptionDownloadConfigured(await readCaptionSettings(c.env as never))) {
				const roles = getAuthContext(c)?.payload?.roles as string[] | undefined;
				const allowed = !!userId && (isAdminRole(roles) || (!!video && (await canOnVideo(c.env as never, video, userId, 'video.edit'))));
				if (!allowed) return featureOff(c, 'viewerCaptionDownload');
			}
			const track = await c.env.subtitles.get(`${videoId}/${language}.vtt`);
			if (!track) return c.json({ success: false, error: `Subtitle not found for language: ${language}` }, 404);

			const raw = await track.text();
			const quranTrack = track.customMetadata?.quran === '1';
			const translatedTrack = quranTrack && track.customMetadata?.qtr === '1';
			let edition: Awaited<ReturnType<typeof editionFor>> = null;
			if (translatedTrack) {
				edition = await editionFor(c.env as never, video?.channelId ?? null, language);
			}
			const served = quranTrack
				? await fillServedTrack(raw, language, c.env.MEDIA_PRIVATE, translatedTrack && captionMarkerRanges(raw).translation.length ? { env: c.env as never, edition } : undefined)
				: raw;
			const body = subtitleDownload(served, format, quranTrack ? { edition: translatedTrack ? edition : null } : null);
			return new Response(body, {
				status: 200,
				headers: {
					'Content-Type': format === 'srt' ? 'application/x-subrip; charset=utf-8' : 'text/vtt; charset=utf-8',
					'Content-Disposition': `attachment; filename="${videoId.replace(/[^\w.-]/g, '_')}-${language.replace(/[^\w-]/g, '_')}.${format}"`,
					// Filled per request from a copy that must stay within 7 days of QF: never kept anywhere
					'Cache-Control': 'no-store',
				},
			});
		} catch (error) {
			logger.error('Failed to build subtitle download', error);
			return c.json({ success: false, error: 'Failed to download subtitle' }, 500);
		}
	}
}
