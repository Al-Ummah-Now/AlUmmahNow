import { Bool, OpenAPIRoute } from "chanfana";
import R2Repository from "../../lib/r2Repo";
import { Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { z } from "zod";
import Queue, { MessageType } from "../../lib/queue";

export class ProfileDelete extends OpenAPIRoute {
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

	async handle(c) {
		// Get auth context - profile ID is always the user ID
		const auth = c.get('auth');
		const userId = auth?.userId;
		if (!userId) {
			return c.json({ error: 'Unauthorized' }, 401);
		}

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
