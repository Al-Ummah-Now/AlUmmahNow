/**
 * Download one video's subtitle track as a file (AUN-CAPTIONS, QF 2026-11-22).
 *
 * A Quran track is filled at download time exactly as it is served for viewing (the Arabic from our
 * Content Sync copy, a translated track from the channel's edition), unaltered, with Quran
 * Foundation's attribution and the edition in a NOTE block (VTT) or a first zero-length cue (SRT).
 * One video per file; the filled file is never stored (no-store, built per request).
 */
import { z } from 'zod';
import { captionMarkerRanges } from '@al-ummah/shared-types';
import { Enumeration, Str } from '../../lib/chanfana-params';
import { fillServedTrack } from '../../lib/captions/drafts';
import { subtitleDownload, type SubtitleDownloadFormat } from '../../lib/captions/download';
import { editionFor } from '../../lib/quran/translations';
import { logger } from '../../lib/logger';
import { PublicRoute, type AppContext } from '../../base';

const errorBody = z.object({ success: z.boolean(), error: z.string() });

export class SubtitlesDownload extends PublicRoute {
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
			'404': { description: 'No track in this language', content: { 'application/json': { schema: errorBody } } },
			'500': { description: 'Internal server error', content: { 'application/json': { schema: errorBody } } },
		},
	};

	async handle(c: AppContext) {
		try {
			const { params, query } = await this.getValidatedData<typeof this.schema>();
			const { videoId, language } = params;
			const format = ((query.format as string) || 'vtt') as SubtitleDownloadFormat;
			const track = await c.env.subtitles.get(`${videoId}/${language}.vtt`);
			if (!track) return c.json({ success: false, error: `Subtitle not found for language: ${language}` }, 404);

			const raw = await track.text();
			const quranTrack = track.customMetadata?.quran === '1';
			const translatedTrack = quranTrack && track.customMetadata?.qtr === '1';
			let edition: Awaited<ReturnType<typeof editionFor>> = null;
			if (translatedTrack) {
				const videoObj = await c.env.videos?.get(videoId).catch(() => null);
				const channelId = videoObj ? ((await videoObj.json().catch(() => null)) as { channelId?: string } | null)?.channelId : null;
				edition = await editionFor(c.env as never, channelId, language);
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
