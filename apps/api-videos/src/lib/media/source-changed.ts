/**
 * The bytes that arrived are not the file that was sent: the transcode compares our kept original with
 * the importer's SHA-256 (apps/media/container/source-facts.mjs) and fails with `source_changed`.
 * Every copy was made of those bytes, so the video is failed and asks for its file again whatever
 * Bunny says, until a new upload reopens it (or a later transcode finds the bytes right after all).
 */
import type { VideoMediaProviders } from '@al-ummah/shared-types';
import { bunnyRef } from './providers/bunny';

export const SOURCE_CHANGED = 'source_changed';
export const SOURCE_CHANGED_REASON = 'The uploaded file is not the file that was sent';

export interface SourceIssue {
	kind: string;
	reason?: string;
	at: string;
	code?: string;
}

/** A transcode's error that says so. */
export const isSourceChangedError = (error: string | null | undefined): boolean => /^source_changed\b/.test(error ?? '');

/** The record is waiting for its file to be sent again because other bytes arrived. */
export function isSourceChanged(video: { processingIssue?: unknown } | null | undefined): boolean {
	const issue = video?.processingIssue as Partial<SourceIssue> | null | undefined;
	return issue?.kind === 'needs_reupload' && issue.code === SOURCE_CHANGED;
}

/**
 * What a re-upload takes off the record: Bunny's copy of the wrong bytes, which takes no second
 * upload once it has encoded one. The new upload then goes to our own target (lib/media/ingest.ts
 * uploadsToBunny). Nothing when the video is not source_changed or Bunny holds no copy of its own.
 */
export function withoutBunnyCopy(
	video: { id: string; processingIssue?: unknown; media?: unknown; [key: string]: unknown },
	at: string,
): { fields: Record<string, unknown>; guid: string } | null {
	const media = video.media as VideoMediaProviders | undefined;
	const bunny = media?.providers.bunny;
	if (!isSourceChanged(video) || !media || !bunny || !media.providers.r2) return null;
	const guid = bunnyRef(video as never);
	if (!guid || guid === video.id) return null;
	const { bunny: _gone, ...providers } = media.providers;
	return {
		guid,
		fields: { media: { ...media, providers }, bunnyRemoved: { at, guid, libraryId: bunny.libraryId } },
	};
}
