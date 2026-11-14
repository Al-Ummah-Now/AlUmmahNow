import { Str } from "chanfana";
import { z } from "zod";
import { MEDIA_PROVIDER_IDS, PLAYBACK_FALLBACK_REASONS } from "@al-ummah/shared-types";
import { OptionalAuthRoute, AppContext } from "../../base";
import { canOnVideo } from "../../lib/channelAccess";
import { Video as BusinessVideo, ResponseError } from "../../lib/types";
import { transformVideoToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import { logger } from "../../lib/logger";
import { applyPlayback, choosePlayback, countFallback, logDecision, parseExclude, parseFallbackReason } from "../../lib/media/playback";
import { countProviderFailure, reporterKey } from "../../lib/media/health";
import { getSecret } from "../../lib/env-helpers";
import { isRestrictedVideo, isVideoOpenToAnyone, isVideoRemoved } from '../../lib/visibility';

/**
 * GET /api/videos/:id/playback?exclude=<provider>[,<provider>…]&reason=<code>
 *
 * For players that keep one URL (older native builds): when the source they were given fails, the
 * API decides again without the failed providers (docs/media-delivery/PROVIDERS.md), logs it with
 * the player's reason, counts it against the provider that failed (the last one listed; provider
 * health) and returns the next source plus the remaining list. Players that got `sources` walk that
 * list themselves and only report here. Same visibility rules as GET /api/videos/:id.
 */
export class VideoPlayback extends OptionalAuthRoute {
	schema = {
		tags: ["Videos"],
		summary: "Playback sources without the failed ones",
		description:
			"🔓 **Authentication Optional**: What to play when a source failed in the player. " +
			"`exclude` lists the providers that failed (comma separated, the latest last); `reason` (the player's error class) is logged and counted.",
		request: {
			params: z.object({ id: Str({ description: "Video id" }) }),
			query: z.object({
				exclude: z.string().max(64).describe(`Providers that failed, comma separated, the latest last (${MEDIA_PROVIDER_IDS.join(", ")})`),
				reason: z.string().max(32).optional().describe(`Why: ${PLAYBACK_FALLBACK_REASONS.join(", ")} (anything else counts as other)`),
			}),
		},
		responses: {
			"200": {
				description: "The URL to play",
				content: {
					"application/json": {
						schema: z.object({
							id: z.string(),
							playUrl: z.string().optional(),
							thumbnailUrl: z.string().optional(),
							delivery: z.object({ source: z.enum(MEDIA_PROVIDER_IDS) }),
							sources: z.array(z.object({ provider: z.enum(MEDIA_PROVIDER_IDS), src: z.string(), type: z.literal("application/x-mpegURL") })).describe("Remaining sources in the order to try"),
						}),
					},
				},
			},
			"404": { description: "Video not found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id } = request.params;
		const reason = parseFallbackReason(request.query.reason);
		const userId = this.getUserId(c);

		const notFound = () => c.json({ success: false, error: "Object not found" }, 404);
		const repository = new R2Repository<z.infer<typeof BusinessVideo>>(c.env.videos);
		const video = await repository.getObject(id);
		if (!video || isVideoRemoved(video)) return notFound();
		// Not open to anyone (private, draft, scheduled, still processing): owner and allowed members only (#1241)
		if ((isRestrictedVideo(video) || !isVideoOpenToAnyone(video)) && !(await canOnVideo(c.env as never, video, userId, 'video.view_private'))) return notFound();

		const exclude = parseExclude(request.query.exclude);
		if (!exclude.length) return c.json({ success: false, error: "exclude must name a provider" }, 400);
		const failed = exclude[exclude.length - 1]!;
		const choice = await choosePlayback(c.env as never, video as never, { exclude, reason, context: "fallback" });
		logDecision(choice.decision);
		// The answer is never refused (a player is waiting on it); only the count is rate limited
		let count = true;
		if (c.env.WATCH_TIME_LIMITER) {
			try {
				count = (await c.env.WATCH_TIME_LIMITER.limit({ key: `playback-fallback:${id}` })).success;
			} catch (error) {
				logger.warn("[playback] rate limiter unavailable", { error });
			}
		}
		if (count) {
			// A health signal only when the provider really was offered for this video
			const plausible = choice.decision.ready.includes(failed);
			const write = Promise.all([
				countFallback(c.env as never, { day: new Date().toISOString().slice(0, 10), requested: failed, actual: choice.source, reason, column: "server_fallbacks" }),
				plausible
					? getSecret(c.env.MEDIA_SIGN_KEY, "MEDIA_SIGN_KEY")
							.then((key) => reporterKey(c.req.header("CF-Connecting-IP"), key))
							.then((reporter) => (reporter ? countProviderFailure(c.env as never, failed, reporter) : undefined))
							.catch((error) => logger.warn("[playback] Could not count a provider failure", { error: error instanceof Error ? error.message : String(error) }))
					: undefined,
			]);
			try {
				c.executionCtx.waitUntil(write);
			} catch {
				await write;
			}
		}

		const view = applyPlayback(transformVideoToView(video), choice, video as never);
		c.header("Cache-Control", "private, no-store");
		// Nothing left to try: no playUrl (the player shows its error)
		if (!choice.sources.length) return { id: view.id, delivery: { source: choice.source }, sources: [] };
		return { id: view.id, playUrl: view.playUrl, thumbnailUrl: view.thumbnailUrl, delivery: { source: choice.source }, sources: view.sources };
	}
}
