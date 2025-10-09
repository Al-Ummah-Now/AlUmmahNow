import { Bool, Num, OpenAPIRoute, Str } from "chanfana";
import { string, z } from "zod";
import { Profile as BusinessProfile, PaginationResponse, ResponseError } from "../../lib/types";
import { ProfileView } from "../../lib/model/view";
import { transformProfileToView } from "../../lib/transformations";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";

export class ProfilesList extends OpenAPIRoute {
	schema = {
		tags: ["Profiles"],
		summary: "List Profiles",
		request: {
			query: z.object({
				limit: Num({
					description: "Limit the number of profiles to return",
					default: 10,
				}),
				cursor: string({
					description: "The last cursor returned from the previous request",
				}).optional(),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
				userId: Str({ description: "User ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns a list of profiles",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								profiles: z.array(ProfileView),
								pagination: z.object({
									limit: z.number(),
									cursor: z.string().optional(),
									hasMore: z.boolean(),
								}),
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

		// Retrieve the validated parameters
		const { limit, cursor } = request.query;
		const { channelId, userId } = request.headers;

		// Get profiles from storage
        const bucket = env.profiles;
		type ProfileType = z.infer<typeof BusinessProfile>;
		const repository = new R2Repository<ProfileType>(bucket);
		const profiles = !cursor ? await repository.listObjects(limit) : await repository.listObjects(limit, cursor);
		
		// Transform profiles to view models
		const profileViews = (profiles.items || []).map(profile => transformProfileToView(profile));

		return {
			success: true,
			result: {
				profiles: profileViews,
				pagination: {
					limit,
					cursor: profiles.cursor || undefined,
					hasMore: (profiles.items?.length || 0) === limit,
				},
			},
		};
	}
}
