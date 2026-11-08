import { Bool } from "chanfana";
import { z } from "zod";
import { Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { ProfileView } from "../../lib/model/view";
import { transformProfileToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import { AuthenticatedRoute, AppContext } from "../../base";

/** The signed-in user's own profile, including account details. */
export class ProfileCurrentFetch extends AuthenticatedRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Get the current user's profile",
		security: [{ bearerAuth: [] }],
		responses: {
			"200": {
				description: "The current user's profile",
				content: { "application/json": { schema: z.object({ success: Bool(), result: z.object({ profile: ProfileView }) }) } },
			},
			"401": { description: "Authentication required", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Profile not found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const profile = await new R2Repository<z.infer<typeof BusinessProfile>>(c.env.profiles).getObject(this.getUserId(c));
		if (!profile) {
			return c.json({ success: false, error: "Profile not found" }, 404);
		}
		return c.json({ success: true, result: { profile: transformProfileToView(profile) } }, 200, { "Cache-Control": "private, no-store" });
	}
}
