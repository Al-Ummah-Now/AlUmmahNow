/**
 * Watch history settings
 * GET /api/watch-history/settings  -> { paused }
 * PUT /api/watch-history/settings  { paused } -> { paused }
 *
 * While paused, POST /api/watch-history and POST /:videoId/progress store
 * nothing and queue nothing. Existing entries are kept.
 */
import { z } from "zod";
import { addAuthToSchema } from "../../lib/openapi-auth";
import { AuthenticatedRoute, AppContext } from "../../base";
import { isWatchHistoryPaused, setWatchHistoryPaused } from "../../lib/watch-history";

const SettingsSchema = z.object({ paused: z.boolean() });

export class GetWatchHistorySettings extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ["Watch History"],
      summary: "Get watch history settings",
      responses: {
        "200": { description: "Current settings", content: { "application/json": { schema: SettingsSchema } } },
        "401": { description: "Unauthorized" },
      },
    },
    "required"
  );

  async handle(c: AppContext) {
    const userId = this.getUserId(c);
    return c.json({ paused: await isWatchHistoryPaused(c.env.profiles, userId) }, 200);
  }
}

export class UpdateWatchHistorySettings extends AuthenticatedRoute {
  schema = addAuthToSchema(
    {
      tags: ["Watch History"],
      summary: "Pause or resume watch history",
      request: {
        body: { content: { "application/json": { schema: SettingsSchema } } },
      },
      responses: {
        "200": { description: "Updated settings", content: { "application/json": { schema: SettingsSchema } } },
        "400": { description: "Invalid request data" },
        "401": { description: "Unauthorized" },
      },
    },
    "required"
  );

  async handle(c: AppContext) {
    const request = await this.getValidatedData<typeof this.schema>();
    const userId = this.getUserId(c);
    const email = (this.getAuth(c) as { email?: string }).email;
    const paused = await setWatchHistoryPaused(c.env.profiles, userId, email, request.body.paused);
    return c.json({ paused }, 200);
  }
}
