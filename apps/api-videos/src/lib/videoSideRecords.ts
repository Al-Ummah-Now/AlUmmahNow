/**
 * What a video leaves outside its own record, removed when the video is deleted for good.
 *
 * - subtitles `<videoId>/…`: the tracks and their metadata (`uploadedBy` names the uploader).
 * - global_settings `ops/upload-reaper/created/<videoId>` (lib/uploads/reaper.ts): the upload
 *   marker `{ userId, channelId, at }`.
 * - scheduled-videos `<yyyy-mm-dd>/<hh>/<videoId>.json` (lib/videoSchedule.ts): the scheduler's
 *   entry `{ title, userId, … }` of a video still scheduled when it was deleted.
 *
 * Every delete path calls this: the purge job (lib/admin/service.ts purgeVideo, which the creator's
 * "Delete permanently" and the 30-day cleanup run), the GDPR erase (lib/privacy/user-data.ts) and
 * the run-account erase (lib/privacy/run-user-erase.ts). Idempotent; missing buckets are skipped.
 */
import { UPLOAD_MARKER_PREFIX } from './uploads/reaper';

interface ListableBucket {
	list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
	delete(keys: string | string[]): Promise<void>;
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
	record?: { scheduledPublishDate?: unknown } | null,
): Promise<string[]> {
	if (!videoId) return [];
	const deleted: string[] = [];
	const subtitles = env.subtitles as ListableBucket | undefined;
	if (subtitles) {
		let cursor: string | undefined;
		const keys: string[] = [];
		do {
			const page = await subtitles.list({ prefix: `${videoId}/`, cursor, limit: 1000 });
			keys.push(...page.objects.map((o) => o.key));
			cursor = page.truncated ? page.cursor : undefined;
		} while (cursor);
		if (keys.length) await subtitles.delete(keys);
		deleted.push(...keys.map((k) => `subtitles/${k}`));
	}
	const settings = env.global_settings as DeletableBucket | undefined;
	if (settings) {
		await settings.delete(`${UPLOAD_MARKER_PREFIX}${videoId}`);
		deleted.push(`global_settings/${UPLOAD_MARKER_PREFIX}${videoId}`);
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
