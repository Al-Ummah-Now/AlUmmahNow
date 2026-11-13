/**
 * What a video leaves outside its own record, removed when the video is deleted for good.
 *
 * - subtitles `<videoId>/…`: the tracks and their metadata (`uploadedBy` names the uploader).
 * - global_settings `ops/upload-reaper/created/<videoId>` (lib/uploads/reaper.ts): the upload
 *   marker `{ userId, channelId, at }`.
 * - scheduled-videos `<yyyy-mm-dd>/<hh>/<videoId>.json` (lib/videoSchedule.ts): the scheduler's
 *   entry `{ title, userId, … }` of a video still scheduled when it was deleted.
 * - global_settings `ops/playlist-adds/<videoId>/…` (lib/playlistUploadAdds.ts): the upload's
 *   playlist adds `{ requestedBy, … }`.
 * - global_settings `ops/upload-fingerprints/<key>.json` (lib/uploads/initiateOnce.ts): the file
 *   claim `{ userId, channelId, videoId }`, found through the record's `uploadFingerprint`, released
 *   only while it still points at this video.
 *
 * Every delete path calls this: the purge job (lib/admin/service.ts purgeVideo, which the creator's
 * "Delete permanently" and the 30-day cleanup run), the GDPR erase (lib/privacy/user-data.ts) and
 * the run-account erase (lib/privacy/run-user-erase.ts). Idempotent; missing buckets are skipped.
 */
import { UPLOAD_MARKER_PREFIX } from './uploads/reaper';
import { releaseClaimFor } from './uploads/initiateOnce';
import { PLAYLIST_ADD_PREFIX } from './playlistUploadAdds';

interface ListableBucket {
	list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
	delete(keys: string | string[]): Promise<void>;
}
async function deletePrefix(bucket: ListableBucket, prefix: string): Promise<string[]> {
	const keys: string[] = [];
	let cursor: string | undefined;
	do {
		const page = await bucket.list({ prefix, cursor, limit: 1000 });
		keys.push(...page.objects.map((o) => o.key));
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	if (keys.length) await bucket.delete(keys);
	return keys;
}

interface DeletableBucket {
	delete(keys: string | string[]): Promise<void>;
}

export interface VideoSideRecordsEnv {
	subtitles?: unknown;
	global_settings?: unknown;
	SCHEDULED_VIDEOS?: unknown;
	'scheduled-videos'?: unknown;
}

/** The scheduler's key for a video scheduled at `date` (UTC day and hour). */
export function scheduleKey(date: Date, videoId: string): string {
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}/${pad(date.getUTCHours())}/${videoId}.json`;
}

/** Deletes the video's subtitles, upload marker and scheduler entry. Returns the keys deleted. */
export async function deleteVideoSideRecords(
	env: VideoSideRecordsEnv,
	videoId: string,
	record?: { scheduledPublishDate?: unknown; uploadFingerprint?: unknown } | null,
): Promise<string[]> {
	if (!videoId) return [];
	const deleted: string[] = [];
	const subtitles = env.subtitles as ListableBucket | undefined;
	if (subtitles) deleted.push(...(await deletePrefix(subtitles, `${videoId}/`)).map((k) => `subtitles/${k}`));
	const settings = env.global_settings as (ListableBucket & { get(key: string): Promise<{ etag: string; json<T>(): Promise<T> } | null> }) | undefined;
	if (settings) {
		await settings.delete(`${UPLOAD_MARKER_PREFIX}${videoId}`);
		deleted.push(`global_settings/${UPLOAD_MARKER_PREFIX}${videoId}`);
		deleted.push(...(await deletePrefix(settings, `${PLAYLIST_ADD_PREFIX}${videoId}/`)).map((k) => `global_settings/${k}`));
		if (typeof record?.uploadFingerprint === 'string' && record.uploadFingerprint) {
			if (await releaseClaimFor(settings as never, record.uploadFingerprint, videoId)) deleted.push(`global_settings/upload-fingerprint/${record.uploadFingerprint}`);
		}
	}
	const scheduled = (env.SCHEDULED_VIDEOS ?? env['scheduled-videos']) as DeletableBucket | undefined;
	const when = typeof record?.scheduledPublishDate === 'string' ? new Date(record.scheduledPublishDate) : null;
	if (scheduled && when && !Number.isNaN(when.getTime())) {
		const key = scheduleKey(when, videoId);
		await scheduled.delete(key);
		deleted.push(`scheduled-videos/${key}`);
	}
	return deleted;
}
