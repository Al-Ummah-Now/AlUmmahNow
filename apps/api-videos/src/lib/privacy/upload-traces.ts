/**
 * Account erasure (#1059): upload state that names the user outside the records eraseUserData()
 * deletes.
 *
 * - global_settings `ops/upload-reaper/created/<videoId>` (lib/uploads/reaper.ts): the reaper's
 *   marker `{ userId, channelId, at }` for each upload. Deleted for the erased user's videos.
 * - TUS_SESSIONS `tus:session:<id>` (lib/bunny/tus.ts): `{ videoId, userId, channelId, ... }`, alive
 *   for 7 days. Found through the per-user index `tus:user:<userId>:<id>` that createTusProxySession
 *   writes beside each session; both are deleted. Sessions created before the index expire on their own.
 * - TUS_SESSIONS `tus:upload:<uploadKey>` (endpoints/video/tus/tusProxy.ts): the proxy's upload session
 *   `{ videoId, userId, bunnyUploadUrl, ... }`, alive for 7 days, indexed as `tus:user:<userId>:upload:<key>`.
 *
 * Idempotent; called after every erasure pass by both callers (DELETE /api/privacy/data and the
 * admin erasure job).
 */
import { UPLOAD_MARKER_PREFIX } from '../uploads/reaper';
import { getTusSessionKey, tusUserIndexPrefix, TUS_UPLOAD_INDEX_MARK } from '../bunny/tus';

interface KvLike {
	list(o: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
	delete(key: string): Promise<void>;
}
interface BucketLike {
	delete(key: string | string[]): Promise<void>;
}

export interface UploadTracesEnv {
	global_settings?: BucketLike;
	TUS_SESSIONS?: KvLike;
}

export async function eraseUploadTraces(env: UploadTracesEnv, userId: string, deletedVideoIds: string[]): Promise<{ markers: number; sessions: number }> {
	let markers = 0;
	if (env.global_settings && deletedVideoIds.length) {
		await env.global_settings.delete(deletedVideoIds.map((id) => `${UPLOAD_MARKER_PREFIX}${id}`));
		markers = deletedVideoIds.length;
	}
	let sessions = 0;
	if (env.TUS_SESSIONS && userId) {
		const prefix = tusUserIndexPrefix(userId);
		// List every page first, then delete: deleting while paging could skip keys
		const names: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await env.TUS_SESSIONS.list({ prefix, cursor });
			names.push(...page.keys.map((k) => k.name));
			cursor = page.list_complete ? undefined : page.cursor;
		} while (cursor);
		for (const name of names) {
			const rest = name.slice(prefix.length);
			await env.TUS_SESSIONS.delete(rest.startsWith(TUS_UPLOAD_INDEX_MARK) ? `tus:upload:${rest.slice(TUS_UPLOAD_INDEX_MARK.length)}` : getTusSessionKey(rest));
			await env.TUS_SESSIONS.delete(name);
			sessions++;
		}
	}
	return { markers, sessions };
}
