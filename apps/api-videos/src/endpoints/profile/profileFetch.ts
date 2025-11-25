import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { ProfileView } from "../../lib/model/view";
import { transformProfileToView } from "../../lib/transformations";
import { getAuthContext, getUserId } from "../../middleware/auth";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class ProfileFetch extends OpenAPIRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Get a single profile by id",
		request: {
			params: z.object({
				id: Str({ description: "Profile id" }),
			}),
		},
		responses: {
			"200": {
				description: "Returns a single profile if found",
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
			"404": {
				description: "Profile not found",
				content: {
					"application/json": {
						schema: ResponseError,
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

	async handle(c) {
		try {
			// Get validated data
			const request = await this.getValidatedData<typeof this.schema>();

			// Retrieve the validated id
			const { id } = request.params;

			// Get user from auth context (optional for GET endpoints)
			const authContext = getAuthContext(c);
			const userId = authContext?.userId;

			// Get profile from storage
			const bucket = c.env.profiles;
			type ProfileType = z.infer<typeof BusinessProfile>;
			const repository = new R2Repository<ProfileType>(bucket);
			const profile = await repository.getObject(id);

			if (!profile) {
				return c.json(
					{
						success: false,
						error: "Profile not found",
					},
					404
				);
			}

			// Send queue message for profile view analytics
			const queue = new Queue(c.env.queue);
			await queue.send(MessageType.ProfileView, {
				profileId: id,
				userId: userId,
				timestamp: new Date().toISOString(),
			});

			// Transform to view model for response
			const profileView = transformProfileToView(profile);

			return {
				success: true,
				result: {
					profile: profileView,
				},
			};
		} catch (error) {
			// Add context to error before re-throwing
			const enrichedError = error instanceof Error ? error : new Error(String(error));
			enrichedError.message = `[ProfileFetch] ${enrichedError.message}`;
			(enrichedError as any).profileId = (await this.getValidatedData<typeof this.schema>()).params.id;
			throw enrichedError;
		}
	}
}
