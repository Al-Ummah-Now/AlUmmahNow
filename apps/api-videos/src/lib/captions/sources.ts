import { captionMarkerRanges, type SubtitleTrack, type SystemCreditId } from '@al-ummah/shared-types';

export function containsQuranText(vtt: string): boolean {
	const { text, translation } = captionMarkerRanges(vtt);
	return text.length > 0 || translation.length > 0;
}

/** Older publications tracked all Quran markers in R2, including references. */
export async function publishedCaptionSources(
	bucket: R2Bucket,
	videoId: string,
	tracks: readonly SubtitleTrack[] = [],
): Promise<SystemCreditId[] | undefined> {
	const ready = tracks.filter((track) => track.status === 'ready');
	if (ready.some((track) => track.hasQuranText === true)) return ['quranFoundation'];
	for (const track of ready) {
		if (track.hasQuranText !== undefined || track.version === undefined) continue;
		const object = await bucket.get(`${videoId}/${track.language}.vtt`);
		if (object?.customMetadata?.quran === '1' && containsQuranText(await object.text())) return ['quranFoundation'];
	}
	return undefined;
}
