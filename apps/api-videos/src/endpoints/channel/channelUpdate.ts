import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Channel as BusinessChannel, ResponseError } from "../../lib/types";
import { ChannelUpdateInput } from "../../lib/model/input";
import { ChannelView } from "../../lib/model/view";
import { transformChannelToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";
import { canClaimOfficialHandles, claimHandle, handleKey, normalizeHandleInput, releaseHandle, validateHandleFormat } from "../../lib/channelHandles";
import { logger } from "../../lib/logger";

export class ChannelUpdate extends AuthenticatedRoute {
    schema = {
        tags: ["Channels"],
        summary: "Update a Channel",
        request: {
            params: z.object({
                id: Str({ description: "Channel id" }),
            }),
            body: {
                content: {
                    "application/json": {
                        schema: ChannelUpdateInput,
                    },
                },
            },
        },
        responses: {
            "200": {
                description: "Returns the updated Channel",
                content: {
                    "application/json": {
                        schema: z.object({
                            success: Bool(),
                            result: z.object({
                                channel: ChannelView,
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
            "409": {
                description: "The requested @handle is invalid, reserved or taken (error = handle_unavailable, reason = too_short | too_long | invalid_characters | reserved | taken)",
                content: {
                    "application/json": {
                        schema: ResponseError,
                    },
                },
            },
            "403": {
                description: "Forbidden - user does not own this channel",
                content: {
                    "application/json": {
                        schema: ResponseError,
                    },
                },
            },
            "404": {
                description: "Channel not found",
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

        // Retrieve the validated id
        const { id } = request.params;
        const userId = this.getUserId(c);

        // Retrieve the validated request body
        const channelUpdateInput = request.body;

        // Implement your own object update here
        const bucket = c.env.channels;
        type ChannelType = z.infer<typeof BusinessChannel>;
        const repository = new R2Repository<ChannelType>(bucket);
        
        // Get existing channel
        const existingChannel = await repository.getObject(id);
        if (!existingChannel) {
            return c.json({
                success: false,
                error: "Channel not found",
            }, 404);
        }

        // Verify user owns this channel
        if (existingChannel.userId !== userId) {
            return c.json({
                success: false,
                error: "You do not have permission to update this channel",
            }, 403);
        }

        const { handle: requestedHandle, contactEmail, location, ...restInput } = channelUpdateInput;

        // @handle claim/change (case-only changes keep the same index entry)
        let handle = existingChannel.handle;
        if (requestedHandle !== undefined && normalizeHandleInput(requestedHandle) !== (existingChannel.handle || '')) {
            const allowOfficial = canClaimOfficialHandles(c.get('auth')?.payload?.roles);
            const claim = await claimHandle(c.env.channel_tabs, requestedHandle, existingChannel, { allowOfficial });
            if (claim.ok && allowOfficial && validateHandleFormat(claim.handle) === 'reserved') {
                logger.info('[ChannelUpdate] Official handle claimed by Super Admin', { channelId: id, handle: claim.handle, userId });
            }
            if (claim.ok === false) {
                logger.info('[ChannelUpdate] Handle unavailable', { channelId: id, reason: claim.reason });
                return c.json({
                    success: false,
                    error: "handle_unavailable",
                    reason: claim.reason,
                }, 409);
            }
            if (existingChannel.handle && handleKey(existingChannel.handle) !== handleKey(claim.handle)) {
                await releaseHandle(c.env.channel_tabs, existingChannel.handle, id);
            }
            logger.info('[ChannelUpdate] Handle claimed', { channelId: id, handle: claim.handle, previous: existingChannel.handle });
            handle = claim.handle;
        }

        // Update the channel with new values
        const updatedChannel = {
            ...existingChannel,
            ...restInput,
            handle,
            // Empty strings clear optional About fields
            contactEmail: contactEmail === undefined ? existingChannel.contactEmail : (contactEmail || undefined),
            location: location === undefined ? existingChannel.location : (location || undefined),
            dateModified: new Date().toISOString(),
            // Preserve localized fields if provided
            nameLocalized: channelUpdateInput.nameLocalized ?? existingChannel.nameLocalized,
            descriptionLocalized: channelUpdateInput.descriptionLocalized ?? existingChannel.descriptionLocalized,
        };

        await repository.putObject(id, updatedChannel);
        
        // Send queue message for channel update
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.ChannelUpdate, {
			channelId: id,
			userId: userId,
			timestamp: new Date().toISOString(),
		});
        
        // Transform to view model for response
        const channelView = transformChannelToView(updatedChannel);

        return {
            success: true,
            result: {
                channel: channelView,
            },
        };
    }
}
