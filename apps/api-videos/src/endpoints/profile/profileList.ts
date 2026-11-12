import { nameLangField, nameLocale } from "../../lib/name-locale";
import { Bool, Num } from "chanfana";
import { string, z } from "zod";
import { Profile as BusinessProfile, PaginationResponse, ResponseError } from "../../lib/types";
import { PublicProfileView } from "../../lib/model/view";
import { toPublicProfile } from "../../lib/public-views";
import R2Repository from "../../lib/r2Repo";
import { PublicRoute, AppContext } from "../../base";

export class ProfilesList extends PublicRoute {
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
				lang: nameLangField,
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
								profiles: z.array(PublicProfileView),
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

	async handle(c: AppContext) {
		// Get validated data
		const request = await this.getValidatedData<typeof this.schema>();

		// Retrieve the validated parameters
		const { limit, cursor } = request.query;

		// Get profiles from storage
        const bucket = c.env.profiles;
		type ProfileType = z.infer<typeof BusinessProfile>;
		const repository = new R2Repository<ProfileType>(bucket);
		const profiles = !cursor ? await repository.listObjects(limit) : await repository.listObjects(limit, cursor);
		
		// Transform profiles to view models
		// Profiles whose data an admin deleted (restorable for 30 days) are left out
		const profileViews = (profiles.items || []).filter((profile) => !(profile as { adminDeletion?: unknown }).adminDeletion).map(profile => toPublicProfile(profile, nameLocale(c)));

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
