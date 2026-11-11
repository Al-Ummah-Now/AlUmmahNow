import { Bool, Num, Str } from "chanfana";
import { z } from "zod";
import { canDeleteVideo, channelRoleOf } from "@al-ummah/shared-types";
import { loadChannelRecord } from "../../lib/channelAccess";
import { VideoView } from "../../lib/model/view";
import { listDeletedVideos, TrashError, trashErrorBody } from "../../lib/videoTrash";
import { errorResponse } from "../video/videoTrashSchemas";
import { AuthenticatedRoute, AppContext } from '../../base';

/** GET /api/channels/:id/deleted-videos — the channel's trash (lib/videoTrash.ts). */
export class ChannelDeletedVideosList extends AuthenticatedRoute {
	schema = {
		tags: ["Channels"],
		summary: "List a channel's deleted videos",
		description:
			"Videos deleted from this channel that can still be restored, newest first, each with `deletedAt` and `restorableUntil`. Videos removed by an administrator are not listed. The owner, or a channel role with video.delete (an editor sees their own uploads).",
		request: {
			params: z.object({ id: Str({ description: "Channel id" }) }),
			query: z.object({
				limit: Num({ description: "Items per page (1-100, default 20)", required: false }),
				cursor: Str({ description: "Cursor from the previous page", required: false }),
			}),
		},
		responses: {
			"200": {
				description: "A page of deleted videos",
				content: {
					"application/json": {
						schema: z.object({
							success: Bool(),
							result: z.object({
								items: z.array(
									VideoView.extend({
										isDeleted: Bool(),
										deletedAt: Str({ description: "ISO time of the delete" }),
										restorableUntil: Str({ description: "ISO time until which it can be restored" }),
									}).passthrough(),
								),
								cursor: Str({ description: "Next page cursor; null on the last page" }).nullable(),
							}),
						}),
					},
				},
			},
			"403": errorResponse("Forbidden - no role on this channel that may delete videos"),
			"404": errorResponse("Channel not found"),
			"503": errorResponse("The trash is unavailable right now"),
		},
	};

	async handle(c: AppContext) {
		const request = await this.getValidatedData<typeof this.schema>();
		const { id: channelId } = request.params;
		const userId = this.getUserId(c);
		const channel = await loadChannelRecord(c.env as never, channelId);
		if (!channel || channel.isDeleted) return c.json({ success: false, error: "Channel not found", code: "channel_not_found" }, 404);
		const role = channelRoleOf(channel, userId);
		const mayManage = (video: { uploadedBy?: string | null }) => canDeleteVideo(role, video, userId);
		if (role !== 'owner' && !canDeleteVideo(role, { uploadedBy: userId }, userId)) {
			return c.json({ success: false, error: "Forbidden - you cannot manage this channel's videos", code: "forbidden" }, 403);
		}
		const limit = Math.min(Math.max(Number(request.query.limit) || 20, 1), 100);
		try {
			const result = await listDeletedVideos(c.env as never, channelId, { limit, cursor: request.query.cursor ?? null, mayManage: role === 'owner' ? undefined : mayManage });
			return { success: true, result };
		} catch (error) {
			if (error instanceof TrashError) {
				const { body, status } = trashErrorBody(error);
				return c.json(body, status);
			}
			throw error;
		}
	}
}
