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
        const profile = request.body;

        // Implement your own object insertion here
        const bucket = env.profiles;
        type ProfileType = z.infer<typeof BusinessProfile>;
        const repository = new R2Repository<ProfileType>(bucket);
        await repository.putObject(id, profile);
        try {
            let updated = await repository.getObject(id);
            return updated;
        }
        catch (error) {
            console.error("Error fetching old profile:", error);
        }

        return profile;
    }
}
