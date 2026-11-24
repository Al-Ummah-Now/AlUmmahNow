/**
 * Who uploaded each image on images.alummahnow.net (SEARCH_DB `image_owners`, migration 0037;
 * docs/specs/CSAM-RESPONSE.md §3). Avatar, cover and post-image paths carry only a random id, so a
 * matched URL reaches its uploader through this index: written on upload (recordImageOwner), and
 * for images uploaded before it by the images.index-owners job (backfillImageOwnersStep).
 */
import type { JobOutcome } from '../admin/jobs';
import { logger } from '../logger';

export const IMAGE_OWNER_KINDS = ['profile_avatar', 'profile_cover', 'channel_avatar', 'channel_cover', 'post_image', 'video_thumbnail'] as const;
export type ImageOwnerKind = (typeof IMAGE_OWNER_KINDS)[number];

export interface ImageOwner {
	path: string;
	kind: ImageOwnerKind;
	ownerId: string | null;
	channelId: string | null;
	createdAt: string;
}

type Db = D1Database;

/** The path of one of our image URLs (`/…`), or null for anything else. */
export function imagePathOf(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		const u = new URL(url.startsWith('http') ? url : `https://${url.replace(/^\/+/, '')}`);
		if (!/^images\.alummahnow\.(?:net|org)$/i.test(u.hostname)) return null;
		return decodeURIComponent(u.pathname) || null;
	} catch {
		return null;
	}
}

/**
 * The upload's own marker: an upload writes its time with the offset `+00:00`, everything else
 * (the backfill, and every row from before the marker) with `Z`. A row without it is a guess from
 * whichever record names the image, good enough to find an uploader to ask about and not to delete
 * a file on (lib/privacy/erase-media.ts): a record can name any URL.
 */
const uploadedAt = (now: Date) => now.toISOString().replace(/Z$/, '+00:00');
export const isUploadRow = (createdAt: string): boolean => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+00:00$/.test(createdAt);

/** Records who uploaded an image. Never fails the upload: a lost row is logged (the backfill finds it). */
export async function recordImageOwner(db: Db | undefined, url: string, owner: { kind: ImageOwnerKind; ownerId: string | null; channelId?: string | null }, now = new Date()): Promise<void> {
	const path = imagePathOf(url);
	if (!db || !path) return;
	try {
		await db
			.prepare('INSERT OR REPLACE INTO image_owners (path, kind, owner_id, channel_id, created_at) VALUES (?, ?, ?, ?, ?)')
			.bind(path, owner.kind, owner.ownerId, owner.channelId ?? null, uploadedAt(now))
			.run();
	} catch (error) {
		logger.warn('[ImageOwners] Could not record an image owner', { path, kind: owner.kind, error: error instanceof Error ? error.message : String(error) });
	}
}

export async function lookupImageOwner(db: Db | undefined, path: string): Promise<ImageOwner | null> {
	if (!db) return null;
	const row = await db
		.prepare('SELECT path, kind, owner_id, channel_id, created_at FROM image_owners WHERE path = ?')
		.bind(path)
		.first<{ path: string; kind: ImageOwnerKind; owner_id: string | null; channel_id: string | null; created_at: string }>();
	return row ? { path: row.path, kind: row.kind, ownerId: row.owner_id, channelId: row.channel_id, createdAt: row.created_at } : null;
}

/** An image deleted by a takedown: its row goes with the file. */
export async function forgetImageOwner(db: Db | undefined, path: string): Promise<void> {
	if (!db) return;
	await db.prepare('DELETE FROM image_owners WHERE path = ?').bind(path).run();
}

/**
 * Account erasure: the account's name leaves the index. A channel's image keeps its row without it: the
 * row still proves which channel the file is, so it goes when that channel does. A profile image's own
 * upload row stays until the erasure's media job has deleted the file, and goes with it: it is what that
 * job proves the file by, and finds a surviving profile or a takedown by (lib/privacy/erase-media.ts).
 */
export async function eraseImageOwners(db: { prepare(sql: string): { bind(...v: unknown[]): { run(): Promise<unknown> } } }, userId: string): Promise<void> {
	await db.prepare('UPDATE image_owners SET owner_id = NULL WHERE owner_id = ? AND channel_id IS NOT NULL').bind(userId).run();
	await db.prepare(`DELETE FROM image_owners WHERE owner_id = ? AND created_at NOT LIKE '%+00:00'`).bind(userId).run();
}

// --- Backfill (job images.index-owners) ------------------------------------------------

interface BackfillEnv {
	SEARCH_DB?: Db;
	profiles?: R2Bucket;
	channels?: R2Bucket;
	community_posts?: R2Bucket;
}
type Phase = 'profiles' | 'channels' | 'posts';
const PHASES: Phase[] = ['profiles', 'channels', 'posts'];
const PAGE = 50;

/** The images one stored record shows (current and waiting for review). */
export function imagesOfRecord(phase: Phase, key: string, record: Record<string, any>): Array<{ url: string; kind: ImageOwnerKind; ownerId: string | null; channelId: string | null }> {
	const out: Array<{ url: string; kind: ImageOwnerKind; ownerId: string | null; channelId: string | null }> = [];
	const pending = (field: string) => record?.pendingImages?.[field]?.url as string | undefined;
	if (phase === 'profiles') {
		for (const [field, kind] of [['avatarUrl', 'profile_avatar'], ['coverUrl', 'profile_cover']] as const) {
			for (const url of [record?.[field], pending(field)]) if (typeof url === 'string') out.push({ url, kind, ownerId: key, channelId: null });
		}
	} else if (phase === 'channels') {
		for (const [field, kind] of [['avatarUrl', 'channel_avatar'], ['coverUrl', 'channel_cover']] as const) {
			for (const url of [record?.[field], pending(field)]) if (typeof url === 'string') out.push({ url, kind, ownerId: record?.userId ?? null, channelId: key });
		}
	} else {
		const channelId = key.split('/')[1] ?? null;
		for (const image of Array.isArray(record?.images) ? record.images : []) {
			if (typeof image?.url === 'string') out.push({ url: image.url, kind: 'post_image', ownerId: record?.userId ?? null, channelId });
		}
	}
	return out.filter((i) => imagePathOf(i.url));
}

/** One page of the backfill; returns the next step until every bucket is read. Idempotent (INSERT OR IGNORE: an upload's own row wins). */
export async function backfillImageOwnersStep(env: BackfillEnv, params: { phase?: Phase; cursor?: string; indexed?: number }): Promise<JobOutcome> {
	const phase = params.phase ?? 'profiles';
	const bucket = phase === 'profiles' ? env.profiles : phase === 'channels' ? env.channels : env.community_posts;
	if (!env.SEARCH_DB) throw new Error('SEARCH_DB is not bound');
	let indexed = params.indexed ?? 0;
	let next: { phase: Phase; cursor?: string } | null = null;
	if (bucket) {
		const page = await bucket.list({ limit: PAGE, ...(params.cursor ? { cursor: params.cursor } : {}), ...(phase === 'posts' ? { prefix: 'posts/' } : {}) });
		const keys = page.objects.map((o) => o.key).filter((k) => (phase === 'posts' ? /^posts\/[^/]+\/[^/]+\.json$/.test(k) && !k.endsWith('/index.json') : !k.includes('/')));
		const statements: D1PreparedStatement[] = [];
		for (const key of keys) {
			const object = await bucket.get(key);
			if (!object) continue;
			let record: Record<string, any>;
			try {
				record = await object.json();
			} catch {
				continue;
			}
			const id = phase === 'posts' ? key.replace(/\.json$/, '') : key;
			for (const image of imagesOfRecord(phase, id, record)) {
				statements.push(
					env.SEARCH_DB.prepare('INSERT OR IGNORE INTO image_owners (path, kind, owner_id, channel_id, created_at) VALUES (?, ?, ?, ?, ?)').bind(
						imagePathOf(image.url),
						image.kind,
						image.ownerId,
						image.channelId,
						new Date().toISOString(),
					),
				);
			}
		}
		if (statements.length) await env.SEARCH_DB.batch(statements);
		indexed += statements.length;
		if (page.truncated && page.cursor) next = { phase, cursor: page.cursor };
	}
	if (!next) {
		const after = PHASES[PHASES.indexOf(phase) + 1];
		if (after) next = { phase: after };
	}
	return next ? { done: false, params: { ...next, indexed }, result: { phase: next.phase, indexed } } : { done: true, result: { indexed } };
}
