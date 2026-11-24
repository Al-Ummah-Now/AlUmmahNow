import { nameLocale } from "../../lib/name-locale";
import { Bool } from "../../lib/chanfana-params";
import { z } from "zod";
import { Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { ProfileInput } from "../../lib/model/input";
import { ProfileView } from "../../lib/model/view";
import { transformProfileToView, createEntityDefaults } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";
import { writeSignupTier } from "../../lib/creatorTiers";
import { logger } from "../../lib/logger";
import { inBackground } from "../../lib/websocket-notify";
import { withAccountEmail } from "../../lib/account-email";
import { bearerOf, syncNamesToAuth } from "../../lib/auth-name-sync";

export class ProfileCreate extends AuthenticatedRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Create a new Profile",
		description: "🔒 **Authentication Required**: This endpoint requires a valid JWT token in the Authorization header (Bearer <token>).",
		request: {
			body: {
				content: {
					"application/json": {
						schema: ProfileInput,
					},
				},
			},
		},
		responses: {
			"200": {
				description: "Returns the created profile",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								profile: ProfileView,
							}),
						}),
					},
				},
			},
			"400": {
				description: "Bad request - invalid input data",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
			"500": {
				description: "Internal server error",
				content: {
					"application/json": {
						schema: ResponseError,
					},
				},
			},
		},
	};

	async handle(c: AppContext) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Get user ID from auth
		const userId = this.getUserId(c);

		// The validated request body, with the signed-in account's email (a submitted one is ignored)
		const profileInput = withAccountEmail(request.body, this.getAuth(c));

		// Create business profile object
		const entityDefaults = createEntityDefaults();
		
		const businessProfile = {
			...entityDefaults,
			...profileInput,
			id: userId, // Use userId as profile ID - MUST be last to override any other id
			channels: [],
		};

		// Implement your own object insertion here
        const bucket = c.env.profiles;
		type ProfileType = z.infer<typeof BusinessProfile>;
		const repository = new R2Repository<ProfileType>(bucket);
		// Create-only for a new profile; an existing one (made by an earlier
		// create, a watch-history add or a subscribe) keeps its channels,
		// history and consent and only takes the submitted fields
		// (SCALABILITY-AUDIT AV-6). A blind put here wiped them.
		const stored = await repository.updateObject(userId, (fresh) => {
			if (fresh === (businessProfile as ProfileType)) return true;
			Object.assign(fresh, profileInput, { id: userId, dateModified: new Date().toISOString() });
			return true;
		}, { initial: () => businessProfile as ProfileType });

		// Every account has a tier (owner, 2026-11-15): a new one gets the current default, written now and
		// never changed by a later default. An invited account already has its invite's tier (kept).
		try {
			await writeSignupTier(c.env.SEARCH_DB as D1Database, userId);
		} catch (error) {
			// The account still works as Free (the minimum) until the backfill writes its row
			logger.error('[Profile] Could not write the sign-up tier', { userId, error: error instanceof Error ? error.message : String(error) });
		}

		// The names reach Auth too (only the ones set: a new, empty profile never wipes an Auth name)
		const token = bearerOf(c.req.header("Authorization"));
		inBackground(c, 'auth-name-sync', () => syncNamesToAuth(c.env.Issuer, token, (stored ?? businessProfile) as never, { clear: false }));

		// Send queue message for profile creation
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.ProfileCreate, {
			profileId: businessProfile.id,
			userId: userId,
			timestamp: new Date().toISOString(),
		});

		// Transform to view model for response
		const profileView = transformProfileToView(stored ?? (businessProfile as ProfileType), nameLocale(c));

		// Return the new profile
		return {
			success: true,
			result: {
				profile: profileView,
			},
		};
	}
}
