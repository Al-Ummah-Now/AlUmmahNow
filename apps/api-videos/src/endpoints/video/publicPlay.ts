import { Str } from "chanfana";
import { z } from "zod";
import { PublicRoute, AppContext } from "../../base";
import { ResponseError } from "../../lib/types";
import { logger } from "../../lib/logger";
import {
	SHORTS_DEFAULT_LIMIT,
	SHORTS_MAX_LIMIT,
	ShortsUnavailableError,
	loadPublicPlay,
	publicShortsAfter,
	type PublicPlayEnv,
	type PublicPlayItem,
} from "../../lib/media/public-play";

/** Seconds a response may be reused (browsers, CDNs). Signed URLs inside live 6 to 7 hours. */
export const PUBLIC_PLAY_MAX_AGE = 300;

/** `public, max-age=N` with N never past the earliest URL expiry in the body. */
export function publicPlayCacheControl(items: Pick<PublicPlayItem, "expiresAt">[], nowMs: number = Date.now()): string {
	let maxAge = PUBLIC_PLAY_MAX_AGE;
	for (const item of items) {
		const left = Math.floor((Date.parse(item.expiresAt) - nowMs) / 1000);
		if (Number.isFinite(left)) maxAge = Math.min(maxAge, Math.max(left, 0));
	}
	return `public, max-age=${maxAge}`;
}

export const PublicPlayItemSchema = z.object({
	id: z.string(),
	format: z.enum(["short", "video"]).describe("Short or video (shared-types video-format.ts: <= 180 s and height >= width, the uploader's choice wins)"),
	title: z.string(),
	channelName: z.string(),
	channelHandle: z.string().nullable().describe("The channel's @handle without the @, or null"),
	width: z.number().nullable().describe("Encoded width in pixels"),
	height: z.number().nullable().describe("Encoded height in pixels"),
	durationSeconds: z.number().nullable(),
	poster: z.string().nullable().describe("Still image (signed when on the video CDN)"),
	mp4: z
		.object({ url: z.string(), width: z.number().nullable(), height: z.number().nullable() })
		.nullable()
		.describe("Progressive MP4 with audio for a plain <video src> (Bunny's MP4 fallback, 480p/360p/720p/240p). Null when the video's library has no CDN host."),
	hls: z.string().nullable().describe("Adaptive HLS master playlist (R2 or Bunny, as the delivery switch chose)"),
	expiresAt: z.string().describe("ISO time the signed URLs stop working; fetch again before it"),
	watchUrl: z.string().describe("The watch page on the videos web app (English; swap /en/ for /ar/)"),
});

const notFound = (c: AppContext) => c.json({ success: false, error: "Object not found" }, 404);

/**
 * GET /api/v1/videos/:id/play — what a plain <video> needs to play one public video
 * (the www timeline's hover preview). 404 unless the video is public and published.
 */
export class VideoPublicPlay extends PublicRoute {
	schema = {
		tags: ["Videos"],
		summary: "Play URLs of a public video",
		description:
			"🌐 **Public**: signed MP4 and HLS URLs, poster and size of one public, published video, for other sites' players " +
			"(the www timeline). 404 for anything not public and published. Cacheable for 5 minutes.",
		request: {
			params: z.object({ id: Str({ description: "Video id" }) }),
		},
		responses: {
			"200": { description: "The video's play data", content: { "application/json": { schema: PublicPlayItemSchema } } },
			"404": { description: "Not a public, published video", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const item = await loadPublicPlay(c.env as unknown as PublicPlayEnv, params.id);
		if (!item) return notFound(c);
		return c.json(item, 200, { "Cache-Control": publicPlayCacheControl([item]) });
	}
}

/**
 * GET /api/v1/shorts?after=<id>&limit=<1..20> — the next public Shorts after one (the
 * www Shorts viewer), newest first, each with the same data as /videos/:id/play.
 */
export class ShortsPublicFeed extends PublicRoute {
	schema = {
		tags: ["Videos"],
		summary: "Public Shorts after a Short",
		description:
			"🌐 **Public**: the next public Shorts, newest first (the order of `GET /api/v1/search?type=video&format=short&sort=date`). " +
			"Starts after `after`; from the newest when `after` is missing or not a listed Short. Pass `next` back as `after`.",
		request: {
			query: z.object({
				after: Str({ description: "Id of the Short the viewer is on" }).max(64).optional(),
				limit: z.coerce.number().int().min(1).max(SHORTS_MAX_LIMIT).optional().describe(`How many (1 to ${SHORTS_MAX_LIMIT}, default ${SHORTS_DEFAULT_LIMIT})`),
			}),
		},
		responses: {
			"200": {
				description: "The next Shorts",
				content: {
					"application/json": {
						schema: z.object({
							items: z.array(PublicPlayItemSchema),
							next: z.string().nullable().describe("`after` for the following page; null at the end"),
						}),
					},
				},
			},
			"503": { description: "The Shorts index is not available", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		try {
			const page = await publicShortsAfter(c.env as unknown as PublicPlayEnv, query.after || null, query.limit ?? SHORTS_DEFAULT_LIMIT);
			return c.json(page, 200, { "Cache-Control": publicPlayCacheControl(page.items) });
		} catch (error) {
			if (!(error instanceof ShortsUnavailableError)) throw error;
			logger.error("[PublicPlay] Shorts feed unavailable", { error: error.message });
			c.header("Retry-After", "60");
			return c.json({ success: false, error: "shorts_unavailable" }, 503);
		}
	}
}
