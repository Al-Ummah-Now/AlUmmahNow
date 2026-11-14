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
 * - TUS_SESSIONS `bulk-edit-undo:<userId>:…` (lib/bulkEditUndo.ts): bulk edit undo records (the
 *   videos' fields before and after), alive for 24 hours. Deleted by prefix.
 * - HUMAN_VERIFIED `h:<userId>` (middleware/bot-protection.ts): the account passed the bot check,
 *   kept for 180 days. Deleted.
 * - global_settings `ops/media-delivery.json` (lib/media/settings.ts): the provider settings name the
 *   admin who saved them last (`updatedBy`). Set to null when that admin is erased; the settings stay.
 *
 * Idempotent; called after every erasure pass by both callers (DELETE /api/privacy/data and the
 * admin erasure job).
 */
import { UPLOAD_MARKER_PREFIX } from '../uploads/reaper';
import { undoUserPrefix } from '../bulkEditUndo';
import { humanVerifiedKey } from '../../middleware/bot-protection';
import { getTusSessionKey, tusUserIndexPrefix, TUS_UPLOAD_INDEX_MARK } from '../bunny/tus';
import { SETTINGS_KEY as MEDIA_SETTINGS_KEY } from '../media/settings';

interface KvLike {
	list(o: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
	delete(key: string): Promise<void>;
}
interface BucketLike {
	delete(key: string | string[]): Promise<void>;
	get?(key: string): Promise<{ json<T>(): Promise<T> } | null>;
	put?(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

export interface UploadTracesEnv {
	global_settings?: BucketLike;
	TUS_SESSIONS?: KvLike;
	HUMAN_VERIFIED?: Pick<KvLike, 'delete'>;
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
	if (env.TUS_SESSIONS && userId) {
		// Bulk edit undo records: same namespace, their own prefix (not counted as sessions)
		const undoPrefix = undoUserPrefix(userId);
		const undo: string[] = [];
		let cursor: string | undefined;
		do {
			const page = await env.TUS_SESSIONS.list({ prefix: undoPrefix, cursor });
			undo.push(...page.keys.map((k) => k.name));
			cursor = page.list_complete ? undefined : page.cursor;
		} while (cursor);
		for (const name of undo) await env.TUS_SESSIONS.delete(name);
	}
	if (env.HUMAN_VERIFIED && userId) await env.HUMAN_VERIFIED.delete(humanVerifiedKey(userId));
	if (env.global_settings?.get && env.global_settings.put && userId) {
		// The settings stay as they are (no re-validation): only who saved them last is forgotten
		const stored = await env.global_settings.get(MEDIA_SETTINGS_KEY);
		const doc = stored ? await stored.json<Record<string, unknown>>().catch(() => null) : null;
		if (doc && doc.updatedBy === userId) {
			await env.global_settings.put(MEDIA_SETTINGS_KEY, JSON.stringify({ ...doc, updatedBy: null }), { httpMetadata: { contentType: 'application/json' } });
		}
	}
	return { markers, sessions };
}
