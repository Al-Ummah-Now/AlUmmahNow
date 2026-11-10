import { can, channelRoleOf } from "@al-ummah/shared-types";
import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Channel as BusinessChannel, ResponseError } from "../../lib/types";
import { ChannelUpdateInput } from "../../lib/model/input";
import { ChannelView } from "../../lib/model/view";
import { withIndexedVideoCount } from "../../lib/public-views";
import { transformChannelToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import { patchOwnedRecord } from '../../lib/videoWrites';
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";
import { canClaimOfficialHandles, claimHandle, handleKey, normalizeHandleInput, releaseReplacedHandle, validateHandleFormat } from "../../lib/channelHandles";
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

        // The owner, or a channel admin (channel.edit). Channel roles come from the record, not the token.
        const role = channelRoleOf(existingChannel, userId);
        if (!can(role, 'channel.edit')) {
            return c.json({
                success: false,
                error: "You do not have permission to update this channel",
            }, 403);
        }

        const { handle: requestedHandle, contactEmail, location, isMain: requestedIsMain, ...restInput } = channelUpdateInput;
        // The @handle and which channel is the owner's main one are the owner's alone
        const changesHandle = requestedHandle !== undefined && normalizeHandleInput(requestedHandle) !== (existingChannel.handle || '');
        if ((changesHandle && !can(role, 'channel.handle')) || (requestedIsMain !== undefined && role !== 'owner' && requestedIsMain !== (existingChannel.isMain === true))) {
            return c.json({
                success: false,
                error: "Only the channel owner can change this",
            }, 403);
        }

        // @handle claim/change (case-only changes keep the same index entry)
        let claimed: string | undefined;
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
            logger.info('[ChannelUpdate] Handle claimed', { channelId: id, handle: claim.handle, previous: existingChannel.handle });
            claimed = claim.handle;
        }

        // Update the channel with new values, on the fresh copy with a conditional
        // write (SCALABILITY-AUDIT AV-5), so concurrent changes are not overwritten
        const saved = await patchOwnedRecord(repository, id, (fresh) => ({
            ...restInput,
            ...(requestedIsMain !== undefined && role === 'owner' ? { isMain: requestedIsMain } : {}),
            // Without a handle change keep the fresh one: a concurrent change must not be reverted
            handle: claimed ?? fresh.handle,
            // Empty strings clear optional About fields
            contactEmail: contactEmail === undefined ? fresh.contactEmail : (contactEmail || undefined),
            location: location === undefined ? fresh.location : (location || undefined),
            dateModified: new Date().toISOString(),
            // Preserve localized fields if provided
            nameLocalized: channelUpdateInput.nameLocalized ?? fresh.nameLocalized,
            descriptionLocalized: channelUpdateInput.descriptionLocalized ?? fresh.descriptionLocalized,
        }), { ownerId: existingChannel.userId });
        // SCALABILITY-AUDIT AV-13: of concurrent handle changes the last write
        // stands; each frees the handle its write replaced, so no claim is left over
        if (claimed) {
            if (saved.status === 'ok') {
                const replaced = saved.previous.handle;
                if (replaced && handleKey(replaced) !== handleKey(claimed)) {
                    await releaseReplacedHandle(c.env.channel_tabs, c.env.channels, replaced, id);
                }
            } else {
                // Our write did not land: give back the handle we claimed for it
                await releaseReplacedHandle(c.env.channel_tabs, c.env.channels, claimed, id);
            }
        }
        if (saved.status === 'missing') {
            return c.json({ success: false, error: "Channel not found" }, 404);
        }
        if (saved.status === 'forbidden') {
            return c.json({ success: false, error: "You do not have permission to update this channel" }, 403);
        }
        const updatedChannel = saved.video;
        
        // Send queue message for channel update
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.ChannelUpdate, {
			channelId: id,
			userId: userId,
			timestamp: new Date().toISOString(),
		});
        
        // Transform to view model for response
        const channelView = await withIndexedVideoCount(c.env as never, transformChannelToView(updatedChannel));

        return {
            success: true,
            result: {
                channel: channelView,
            },
        };
    }
}
