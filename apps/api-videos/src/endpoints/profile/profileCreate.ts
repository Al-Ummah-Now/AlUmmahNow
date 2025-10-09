import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { ProfileInput } from "../../lib/model/input";
import { ProfileView } from "../../lib/model/view";
import { transformProfileToView, createEntityDefaults } from "../../lib/transformations";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class ProfileCreate extends OpenAPIRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Create a new Profile",
		description: "🔒 **Authentication Required**: This endpoint requires a valid JWT token in the Authorization header (Bearer <token>).",
		request: {
			headers: z.object({
				userId: Str({ description: "User ID (automatically set from JWT token)" }).optional(),
			}),
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

	async handle(c) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Retrieve the validated request body
		const profileInput = request.body;
		const { userId } = request.headers;

		// Create business profile object
		const entityDefaults = createEntityDefaults();
		
		const businessProfile = {
			id: userId, // Use userId as profile ID
			...entityDefaults,
			...profileInput,
			channels: [],
		};

		// Implement your own object insertion here
        const bucket = env.profiles;
		type ProfileType = z.infer<typeof BusinessProfile>;
		const repository = new R2Repository<ProfileType>(bucket);
		await repository.putObject(businessProfile.id, businessProfile);

		// Send queue message for profile creation
		const queue = new Queue();
		await queue.send(MessageType.ProfileCreate, {
			profileId: businessProfile.id,
			userId: userId,
			timestamp: new Date().toISOString(),
		});

		// Transform to view model for response
		const profileView = transformProfileToView(businessProfile);

		// Return the new profile
		return {
			success: true,
			result: {
				profile: profileView,
			},
		};
	}
}
