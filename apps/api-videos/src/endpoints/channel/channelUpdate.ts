import { Bool, Str } from "chanfana";
import { z } from "zod";
import { Channel as BusinessChannel, ResponseError } from "../../lib/types";
import { ChannelUpdateInput } from "../../lib/model/input";
import { ChannelView } from "../../lib/model/view";
import { transformChannelToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { AuthenticatedRoute, AppContext } from "../../base";

export class ChannelUpdate extends AuthenticatedRoute {
    schema = {
        tags: ["Channels"],
        summary: "Update a Channel",
        request: {
            params: z.object({
                id: Str({ description: "Channel id" }),
            }),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
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
		const { channelId } = request.headers;

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

        // Update the channel with new values
        const updatedChannel = {
            ...existingChannel,
            ...channelUpdateInput,
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
