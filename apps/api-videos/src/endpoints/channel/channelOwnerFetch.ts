import { Str } from "chanfana";
import { z } from "zod";
import { Channel as BusinessChannel, ResponseError } from "../../lib/types";
import { ChannelView } from "../../lib/model/view";
import { withIndexedVideoCount } from "../../lib/public-views";
import { transformChannelToView } from "../../lib/transformations";
import { isAdminRole } from "../../lib/public-access";
import R2Repository from "../../lib/r2Repo";
import { AuthenticatedRoute, AppContext } from "../../base";

/** The full channel record, for its owner or an admin (channel settings). */
export class ChannelOwnerFetch extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "Get a channel with its private fields (owner or admin)",
		security: [{ bearerAuth: [] }],
		request: {
			params: z.object({ id: Str({ description: "Channel id" }) }),
		},
		responses: {
			"200": { description: "The channel", content: { "application/json": { schema: ChannelView } } },
			"401": { description: "Authentication required", content: { "application/json": { schema: ResponseError } } },
			"403": { description: "Not the channel owner", content: { "application/json": { schema: ResponseError } } },
			"404": { description: "Channel not found", content: { "application/json": { schema: ResponseError } } },
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id } = request.params;
		const auth = this.getAuth(c);

		const channel = await new R2Repository<z.infer<typeof BusinessChannel>>(c.env.channels).getObject(id);
		const isAdmin = isAdminRole(auth.payload?.roles);
		if (!channel || channel.isDeleted || (channel.isHidden && !isAdmin)) {
			return c.json({ success: false, error: "Channel not found" }, 404);
		}
		if (channel.userId !== auth.userId && !isAdmin) {
			return c.json({ success: false, error: "You do not have permission to view this channel's private fields" }, 403);
		}

		return c.json(await withIndexedVideoCount(c.env as never, transformChannelToView(channel)), 200, { "Cache-Control": "private, no-store" });
	}
}
