import { Bool, OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { ProfileUpdateInput } from "../../lib/model/input";
import { ProfileView } from "../../lib/model/view";
import { transformProfileToView } from "../../lib/transformations";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class ProfileUpdate extends OpenAPIRoute {
    schema = {
        tags: ["Profiles"],
        summary: "Update a Profile",
        request: {
            params: z.object({
                id: Str({ description: "Profile id" }),
            }),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
				userId: Str({ description: "User ID" }),
			}),
            body: {
                content: {
                    "application/json": {
                        schema: ProfileUpdateInput,
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Returns the updated profile",
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

        // Retrieve the validated id
        const { id } = request.params;
		const { channelId, userId } = request.headers;

        // Retrieve the validated request body
        const profileUpdateInput = request.body;

        // Get existing profile from storage
        const bucket = env.profiles;
        type ProfileType = z.infer<typeof BusinessProfile>;
        const repository = new R2Repository<ProfileType>(bucket);
        const existingProfile = await repository.getObject(id);

        if (!existingProfile) {
            return c.json({
                success: false,
                error: "Profile not found",
            }, 404);
        }

        // Update the profile with new values
        const updatedProfile = {
            ...existingProfile,
            ...profileUpdateInput,
            dateModified: new Date().toISOString(),
            // Preserve localized fields if provided
            displayNameLocalized: profileUpdateInput.displayNameLocalized ?? existingProfile.displayNameLocalized,
            bioLocalized: profileUpdateInput.bioLocalized ?? existingProfile.bioLocalized,
        };

        await repository.putObject(id, updatedProfile);

        // Transform to view model for response
        const profileView = transformProfileToView(updatedProfile);

        return {
            success: true,
            result: {
                profile: profileView,
            },
        };
    }
}
