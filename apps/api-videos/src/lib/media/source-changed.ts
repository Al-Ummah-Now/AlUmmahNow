/**
 * The kept original is not the file that was sent: the transcode compares it with the importer's
 * SHA-256 (apps/media/container/source-facts.mjs) and fails with `source_changed`.
 *
 *   a copy of the video is ready   it keeps playing; admins are told (Errors page), nothing else changes
 *   nothing is ready yet           failed + needs_reupload with this code; Bunny's copy, made of the same
 *                                  bytes, takes no part any more (its ref stays, failed), and only an admin's
 *                                  import sends the file again, to our own target. Bunny's copy is deleted
 *                                  once that replacement is ready (r2-delivery.ts applyJobEvent).
 */
import type { VideoMediaProviders } from '@al-ummah/shared-types';
import { bunnyRef } from './providers/bunny';

export const SOURCE_CHANGED = 'source_changed';
export const SOURCE_CHANGED_REASON = 'The uploaded file is not the file that was sent';

/** A transcode's error that says so. */
export const isSourceChangedError = (error: string | null | undefined): boolean => /^source_changed\b/.test(error ?? '');

/** The record waits for an admin's import to send its file again. */
export function isSourceChanged(video: unknown): boolean {
	const issue = (video as { processingIssue?: unknown } | null | undefined)?.processingIssue as { kind?: string; code?: string } | null | undefined;
	return issue?.kind === 'needs_reupload' && issue.code === SOURCE_CHANGED;
}

/** Bunny's copy was made of bytes that are not the file: it is never read, played or uploaded to. */
export function bunnyCopyRefused(video: unknown): boolean {
	const bunny = (video as { media?: VideoMediaProviders } | null | undefined)?.media?.providers.bunny;
	return bunny?.status === 'failed' && bunny.error === SOURCE_CHANGED;
}

/** Bunny's GUID of a copy that counts; null when Bunny holds none, or one that is refused. */
export const usableBunnyRef = (video: unknown): string | null => (bunnyCopyRefused(video) ? null : bunnyRef(video as never));
