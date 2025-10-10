import { Bool, OpenAPIRoute, Str } from "chanfana";
import R2Repository from "../../lib/r2Repo";
import { Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { z } from "zod";
import { env } from 'cloudflare:workers';
import Queue, { MessageType } from "../../lib/queue";

export class ProfileDelete extends OpenAPIRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Delete a Profile",
		request: {
			params: z.object({
				id: Str({ description: "Profile ID" }),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
				userId: Str({ description: "User ID" }),
			}),
		},
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
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Retrieve the validated id
		const { id } = request.params;
		const { channelId, userId } = request.headers;

		// Delete profile from storage
        const bucket = env.profiles;
		type ProfileType = z.infer<typeof BusinessProfile>;
		const repository = new R2Repository<ProfileType>(bucket);
		await repository.deleteObject(id);

		// Send queue message for profile deletion
		const queue = new Queue();
		await queue.send(MessageType.ProfileDelete, {
			profileId: id,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

		return {
			success: true,
		};
	}
}
