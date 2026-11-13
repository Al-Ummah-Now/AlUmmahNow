import { nameLocale } from "../../lib/name-locale";
import { renameCollectionsForUser, userCollectionName } from "../../lib/channelCollection";
import { inBackground } from "../../lib/websocket-notify";
import { bearerOf, namesChanged, syncNamesToAuth } from "../../lib/auth-name-sync";
import { Bool } from "chanfana";
import { z } from "zod";
import { Profile as BusinessProfile, ResponseError } from "../../lib/types";
import { ProfileUpdateInput } from "../../lib/model/input";
import { ProfileView } from "../../lib/model/view";
import { transformProfileToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";

export class ProfileUpdate extends AuthenticatedRoute {
    schema = {
        tags: ["Profiles"],
        summary: "Update the authenticated user's profile",
        request: {
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

    async handle(c: AppContext) {
        // Get validated data
        const request = await this.getValidatedData<typeof this.schema>();

        // Get user ID from auth - profile ID is always the user ID
        const userId = this.getUserId(c);

        // Retrieve the validated request body
        const profileUpdateInput = request.body;

        // Get existing profile from storage (profile ID = user ID)
        const bucket = c.env.profiles;
        type ProfileType = z.infer<typeof BusinessProfile>;
        const repository = new R2Repository<ProfileType>(bucket);
        const existingProfile = await repository.getObject(userId);

        if (!existingProfile) {
            return c.json({
                success: false,
                error: "Profile not found",
            }, 404);
        }

        // Update the profile on the fresh copy with a conditional write
        // (SCALABILITY-AUDIT AV-6), so a concurrent change (watch history,
        // consent, another device) is not overwritten
        const updatedProfile = await repository.updateObject(userId, (fresh) => {
            Object.assign(fresh, profileUpdateInput, {
                dateModified: new Date().toISOString(),
                // Preserve localized fields if provided
                displayNameLocalized: profileUpdateInput.displayNameLocalized ?? fresh.displayNameLocalized,
                bioLocalized: profileUpdateInput.bioLocalized ?? fresh.bioLocalized,
            });
        });
        if (!updatedProfile) {
            return c.json({ success: false, error: "Profile not found" }, 404);
        }

        // The user's Bunny collections follow the display name / handle (lib/channelCollection.ts)
        if (userCollectionName(updatedProfile as never, userId) !== userCollectionName(existingProfile as never, userId)) {
            inBackground(c, 'user-collection-rename', () => renameCollectionsForUser(c.env as never, userId, updatedProfile as never));
        }

        // Every Auth-backed app names the account from Auth: send the names there when they change
        if (namesChanged(existingProfile as never, updatedProfile as never)) {
            const token = bearerOf(c.req.header("Authorization"));
            inBackground(c, 'auth-name-sync', () => syncNamesToAuth(c.env.Issuer, token, updatedProfile as never));
        }

        // Send queue message for profile update
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.ProfileUpdate, {
            profileId: userId,
            userId: userId,
            timestamp: new Date().toISOString(),
        });

        // Transform to view model for response
        const profileView = transformProfileToView(updatedProfile, nameLocale(c));

        return {
            success: true,
            result: {
                profile: profileView,
            },
        };
    }
}
