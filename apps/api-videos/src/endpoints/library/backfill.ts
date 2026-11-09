/**
 * POST /internal/library/backfill  (X-API-Key = INTERNAL_API_KEY, see index.ts INTERNAL_PATHS)
 *
 * One-off backfill of the per-user indexes from existing R2 data:
 * - target "likes":         videos[*].likes      -> liked_videos
 * - target "subscriptions": channels[*].subscriptions -> channel_subscriptions, counts and
 *                            channel_subscribers (default bell), once per channel
 *                            (importLegacySubscriptions; the hourly cron does the same)
 *
 * Inserts are idempotent (INSERT OR IGNORE), so the endpoint can be re-run.
 * Each call scans at most `pages` bucket pages; call again with `nextCursor`
 * until it returns null.
 */

import { Str } from "chanfana";
import { z } from "zod";
import { PublicRoute, AppContext } from "../../base";
import { logger } from "../../lib/logger";
import { importLegacySubscriptions } from "../../lib/subscription-store";
import { isInternalRecord } from "../../lib/visibility";

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const INSERT_CHUNK = 50;

interface StoredLike {
	userId?: string;
	dateCreated?: string;
}
interface StoredVideo {
	id?: string;
	likes?: StoredLike[];
	isDeleted?: boolean;
}
interface StoredChannel {
	id?: string;
	subscriptions?: Array<{ userId?: string; dateCreated?: string }>;
}

function toMillis(date: string | undefined, fallback: number): number {
	const t = date ? Date.parse(date) : NaN;
	return Number.isFinite(t) ? t : fallback;
}

export function collectLikeRows(video: StoredVideo, now: number): Array<[string, string, number]> {
	if (!video?.id || video.isDeleted || isInternalRecord(video)) return [];
	const seen = new Map<string, number>();
	for (const like of video.likes || []) {
		if (!like?.userId) continue;
		const at = toMillis(like.dateCreated, now);
		const prev = seen.get(like.userId);
		if (prev === undefined || at < prev) seen.set(like.userId, at);
	}
	return [...seen.entries()].map(([userId, at]) => [userId, video.id as string, at]);
}

export class LibraryBackfill extends PublicRoute {
	schema = {
		tags: ["Internal"],
		summary: "Backfill liked-videos and channel-subscriber indexes (X-API-Key)",
		request: {
			body: {
				content: {
					"application/json": {
						schema: z.object({
							target: z.enum(["likes", "subscriptions"]),
							cursor: Str().optional(),
							pages: z.number().int().min(1).max(MAX_PAGES).optional(),
						}),
					},
				},
			},
		},
		responses: { "200": { description: "Rows inserted and the cursor to continue with" } },
	};

	async handle(c: AppContext) {
		const db = c.env.NOTIFICATIONS_DB;
		if (!db) return c.json({ success: false, error: "NOTIFICATIONS_DB not bound" }, 503);
		const { body } = await this.getValidatedData<typeof this.schema>();
		const bucket = body.target === "likes" ? c.env.videos : c.env.channels;
		const pages = body.pages ?? MAX_PAGES;
		const now = Date.now();

		let cursor: string | undefined = body.cursor;
		let scanned = 0;
		let inserted = 0;
		let done = false;

		for (let page = 0; page < pages; page++) {
			const listing = await bucket.list({ limit: PAGE_SIZE, cursor });
			const objects = await Promise.all(
				listing.objects.map(async (o) => {
					try {
						const obj = await bucket.get(o.key);
						return obj ? await obj.json() : null;
					} catch {
						return null;
					}
				}),
			);
			scanned += objects.length;

			if (body.target === "subscriptions") {
				for (let i = 0; i < objects.length; i++) {
					const channel = objects[i] as StoredChannel | null;
					if (!channel) continue;
					if (await importLegacySubscriptions(db, { ...channel, id: listing.objects[i].key }, now)) inserted++;
				}
			}
			const rows = body.target === "likes" ? objects.flatMap((o) => (o ? collectLikeRows(o as StoredVideo, now) : [])) : [];
			for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
				const statements = rows.slice(i, i + INSERT_CHUNK).map((row) =>
					db.prepare("INSERT OR IGNORE INTO liked_videos (user_id, video_id, liked_at) VALUES (?, ?, ?)").bind(...row),
				);
				const results = await db.batch(statements);
				inserted += results.reduce((n, r) => n + Number(r.meta?.changes || 0), 0);
			}

			if (!listing.truncated) {
				done = true;
				cursor = undefined;
				break;
			}
			cursor = (listing as { cursor?: string }).cursor;
		}

		logger.info("[LibraryBackfill] Batch finished", { target: body.target, scanned, inserted, done });
		return { success: true, result: { target: body.target, scanned, inserted, nextCursor: done ? null : cursor ?? null } };
	}
}
