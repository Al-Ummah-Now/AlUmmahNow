import { Bool } from "chanfana";
import R2Repository from "../../lib/r2Repo";
import { Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { z } from "zod";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";

export class ProfileDelete extends AuthenticatedRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Delete the authenticated user's profile",
		responses: {
			"200": {
				description: "Returns if the profile was deleted successfully",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
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
		// Get user ID from auth - profile ID is always the user ID
		const userId = this.getUserId(c);

		// Delete profile from storage (profile ID = user ID)
		const bucket = c.env.profiles;
		type ProfileType = z.infer<typeof BusinessProfile>;
		const repository = new R2Repository<ProfileType>(bucket);
		await repository.deleteObject(userId);

		// Send queue message for profile deletion
		const queue = new Queue(c.env.queue);
		await queue.send(MessageType.ProfileDelete, {
			profileId: userId,
			userId: userId,
			timestamp: new Date().toISOString(),
		});

		return {
			success: true,
		};
	}
}
