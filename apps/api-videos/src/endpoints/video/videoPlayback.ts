/**
 * POST /api/videos/:id/playback (Epic 9.6): a short-lived playback grant for
 * native apps. Same visibility rules as GET /api/videos/:id (404 for removed,
 * missing or someone else's private video, so existence is not revealed).
 */
import { Str } from "chanfana";
import { z } from "zod";
import { OptionalAuthRoute, AppContext } from "../../base";
import R2Repository from "../../lib/r2Repo";
import { getSecret } from "../../lib/env-helpers";
import { logger } from "../../lib/logger";
import { ResponseError } from "../../lib/types";
import { BunnyPlaybackAuthorizer, canPlay, type PlaybackAuthorizer, type PlaybackVideo } from "../../lib/playback/authorizer";

/** Today's delivery is Bunny; D2 swaps this for the chosen adapter. */
export async function resolvePlaybackAuthorizer(env: AppContext["env"]): Promise<PlaybackAuthorizer> {
	const e = env as AppContext["env"] & { BUNNY_SIGN_HOSTNAME?: string };
	const signHost = e.BUNNY_SIGN_HOSTNAME || e.bunny_hostname;
	const tokenKey = e.BUNNY_SIGN_URLS === "true" && signHost ? await getSecret(e.BUNNY_TOKEN_KEY, "BUNNY_TOKEN_KEY") : "";
	return new BunnyPlaybackAuthorizer({ signHost, tokenKey: tokenKey || undefined });
}

const Grant = z.object({
	videoId: z.string(),
	provider: z.string(),
	manifestUrl: z.string(),
	expiresAt: z.number().nullable().describe("Unix seconds; null when the URL does not expire"),
	headers: z.record(z.string()).optional(),
});

export class VideoPlayback extends OptionalAuthRoute {
	schema = {
		tags: ["Videos"],
		summary: "Get a short-lived playback grant",
		description: "Native apps call this before playing instead of using the record's playUrl. Request again when expiresAt passes.",
		request: { params: z.object({ id: Str({ description: "Video id" }) }) },
		responses: {
			"200": { description: "Playback grant", content: { "application/json": { schema: z.object({ success: z.literal(true), result: Grant }) } } },
			"404": { description: "Video not found", content: { "application/json": { schema: ResponseError } } },
			"409": { description: "Video has no playable source yet (processing)", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const video = await new R2Repository<PlaybackVideo>(c.env.videos).getObject(params.id);
		if (!canPlay(video, { userId: this.getUserId(c) ?? null })) {
			return c.json({ success: false, error: "Object not found" }, 404);
		}
		const authorizer = await resolvePlaybackAuthorizer(c.env);
		const grant = await authorizer.playback(video, { userId: this.getUserId(c) ?? null });
		if (!grant) return c.json({ success: false, error: "not_playable" }, 409);
		logger.debug("[VideoPlayback] Grant issued", { videoId: params.id, provider: authorizer.name, signed: grant.expiresAt !== null });
		return { success: true as const, result: { videoId: params.id, provider: authorizer.name, ...grant } };
	}
}
