import { nameLangField, nameLocale } from "../../lib/name-locale";
import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { PublicProfileView } from "../../lib/model/view";
import { toPublicProfile } from "../../lib/public-views";
import R2Repository from "../../lib/r2Repo";
import { OptionalAuthRoute, AppContext } from "../../base";

export class ProfileFetch extends OptionalAuthRoute {
	schema = {
		tags: ["Profiles"],
		summary: "Get a single profile by id",
		request: {
			params: z.object({
				id: Str({ description: "Profile id" }),
			}),
			query: z.object({ lang: nameLangField }),
		},
		responses: {
			"200": {
				description: "Returns a single profile if found",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								profile: PublicProfileView,
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

	async handle(c: AppContext) {
		try {
			// Get validated data
			const request = await this.getValidatedData<typeof this.schema>();

			// Retrieve the validated id
			const { id } = request.params;

			// Get profile from storage
			const bucket = c.env.profiles;
			type ProfileType = z.infer<typeof BusinessProfile>;
			const repository = new R2Repository<ProfileType>(bucket);
			const profile = await repository.getObject(id);

			// A profile whose data an admin deleted (restorable for 30 days) is not shown
			if (!profile || (profile as { adminDeletion?: unknown }).adminDeletion) {
				return c.json(
					{
						success: false,
						error: "Profile not found",
					},
					404
				);
			}

			// No queue message per profile read: the processor only logged it.

			// Transform to view model for response
			const profileView = toPublicProfile(profile, nameLocale(c));

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
