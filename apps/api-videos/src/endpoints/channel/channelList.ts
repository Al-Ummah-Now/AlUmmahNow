import { Num, Str } from "chanfana";
import { string, z } from "zod";
import { Channel as BusinessChannel, PaginationResponse, ResponseError } from "../../lib/types";
import { ChannelView } from "../../lib/model/view";
import { transformChannelsToView } from "../../lib/transformations";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { OptionalAuthRoute, AppContext } from "../../base";

export class ChannelsList extends OptionalAuthRoute {
	schema = {
		tags: ["Channels"],
		summary: "List Channels",
		request: {
			query: z.object({
				limit: Num({
					description: "Limit the number of Channels to return",
					default: 10,
				}),
				cursor: string({
					description: "The last cursor returned from the previous request",
				}).optional(),
			}),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
			}),
		},
		responses: {
			"200": {
				description: "Returns a list of Channels",
				content: {
					"application/json": {
						schema: PaginationResponse.extend({ data: z.array(ChannelView) }),
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
		const userId = this.getUserId(c);
		const { channelId } = request.headers;

		// Implement your own object list here
		const bucket = c.env.channels;
		type ChannelType = z.infer<typeof BusinessChannel>;
		const repository = new R2Repository<ChannelType>(bucket);
		let Channels = !cursor ? await repository.listObjects(limit) : await repository.listObjects(limit, cursor);

		// Filter channels by userId if provided, and apply privacy/moderation filters
		let filteredChannels = (Channels.items || []).filter(channel => {
			// Filter out soft-deleted channels
			if (channel.isDeleted) {
				return false;
			}

			// Filter out moderation-hidden channels
			if (channel.isHidden) {
				return false;
			}

			// Filter out private channels (except for owner)
			if (channel.isPrivate && channel.userId !== userId) {
				return false;
			}

			return true;
		});

		// Additional filter by userId if requested (to show only user's channels)
		if (userId) {
			filteredChannels = filteredChannels.filter(channel => channel.userId === userId);
		}

		// Transform business channels to view models
		const channelViews = transformChannelsToView(filteredChannels);

		let response: PaginationResponse<any>;
		if (!filteredChannels || filteredChannels.length === 0) {
			response = {
				cursor: "",
				limit,
				data: [],
			};
		} else {
			response = {
				cursor: Channels.cursor,
				limit,
				data: channelViews,
			};
		}

		return response;
	}
}
