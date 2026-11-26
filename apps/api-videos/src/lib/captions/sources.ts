import { captionMarkerRanges, type SubtitleTrack, type SystemCreditId } from '@al-ummah/shared-types';
import { logger } from '../logger';

export function containsQuranText(vtt: string): boolean {
	const { text, translation } = captionMarkerRanges(vtt);
	return text.length > 0 || translation.length > 0;
}

/** Older publications tracked all Quran markers in R2, including references. */
export async function publishedCaptionSources(
	bucket: Pick<R2Bucket, 'head' | 'get'> | undefined,
	videoId: string,
	tracks: readonly SubtitleTrack[] = [],
): Promise<SystemCreditId[] | undefined> {
	const ready = tracks.filter((track) => track.status === 'ready');
	if (ready.some((track) => track.hasQuranText === true)) return ['quranFoundation'];
	if (!bucket) return undefined;
	for (const track of ready) {
		if (track.hasQuranText !== undefined || track.version === undefined) continue;
		const key = `${videoId}/${track.language}.vtt`;
		try {
			const metadata = await bucket.head(key);
			if (metadata?.customMetadata?.quran !== '1') continue;
			const object = await bucket.get(key);
			if (object?.customMetadata?.quran === '1' && containsQuranText(await object.text())) return ['quranFoundation'];
		} catch {
			logger.warn('[Captions] Could not read legacy caption source', { videoId, language: track.language });
		}
	}
	return undefined;
}
