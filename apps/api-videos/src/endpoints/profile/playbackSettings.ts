/**
 * The signed-in viewer's playback settings (lib/playback-settings.ts)
 * GET /api/profile/playback  -> { autoplayNext }
 * PUT /api/profile/playback  { autoplayNext } -> { autoplayNext }
 */
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { AuthenticatedRoute, AppContext } from "../../base";
import { getPlaybackSettings, setPlaybackSettings } from "../../lib/playback-settings";
import { logger } from "../../lib/logger";

const PlaybackSettingsSchema = z.object({
	autoplayNext: z.boolean().describe("When a video ends, the next one plays after the 3 s countdown (default true)"),
});

export class PlaybackSettingsGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ["Profiles"],
			summary: "Get the current user's playback settings",
			responses: {
				"200": { description: "Playback settings", content: { "application/json": { schema: PlaybackSettingsSchema } } },
				"401": { description: "Unauthorized" },
			},
		},
		"required",
	);

	async handle(c: AppContext) {
		return c.json(await getPlaybackSettings(c.env.profiles, this.getUserId(c)), 200);
	}
}

export class PlaybackSettingsUpdate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ["Profiles"],
			summary: "Update the current user's playback settings",
			request: { body: { content: { "application/json": { schema: PlaybackSettingsSchema } } } },
			responses: {
				"200": { description: "Updated settings", content: { "application/json": { schema: PlaybackSettingsSchema } } },
				"400": { description: "Invalid request data" },
				"401": { description: "Unauthorized" },
			},
		},
		"required",
	);

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const email = (this.getAuth(c) as { email?: string }).email;
		const settings = await setPlaybackSettings(c.env.profiles, userId, email, { autoplayNext: body.autoplayNext });
		logger.debug("[PlaybackSettings] Updated", { userId, autoplayNext: settings.autoplayNext });
		return c.json(settings, 200);
	}
}
