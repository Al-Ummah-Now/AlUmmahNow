import { Str } from "chanfana";
import { z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { broadcastInBackground } from "../../lib/websocket-notify";
import { recordLike } from "../../lib/library";
import { AuthenticatedRoute, AppContext } from '../../base';
import { ReactorHeaders, applyVideoReaction, reactorId } from "../../lib/reactions";

export class LikeCreate extends AuthenticatedRoute {
    schema = {
        tags: ["Likes"],
        summary: "Like a video",
        request: {
            params: z.object({
                id: Str({ description: "Video id" }),
            }),
			headers: ReactorHeaders,
        },
        responses: {
            "200": {
                description: "Returns success status",
                content: {
                    "application/json": {
                        schema: {
                            success: true,
                        },
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
        const request = await this.getValidatedData<typeof this.schema>();
        const { id } = request.params;
        const userId = this.getUserId(c);
        const channelId = reactorId(request.headers.channelId, userId);

        const repository = new R2Repository<z.infer<typeof Video>>(c.env.videos);
        const result = await applyVideoReaction(repository, id, "likes", "add", { userId, channelId });
        if (!result) {
            return c.json({ success: false, error: "Object not found" }, 404);
        }

        // Per-user liked-videos index (Library, Story 29.6); idempotent
        await recordLike(c.env.NOTIFICATIONS_DB, userId, id);

        // Liking twice is a no-op: no second event or broadcast
        if (result.changed) {
            await new Queue(c.env.queue).send(MessageType.VideoLike, {
                likeId: result.changed.id,
                videoId: id,
                userId,
                channelId,
                timestamp: result.changed.dateCreated,
            });
            broadcastInBackground(c, `video:${id}`, 'video_liked', {
                videoId: id,
                userId,
                likesCount: result.video.likes.length,
                dislikesCount: result.video.dislikes.length,
            });
        }

        // chanfana cannot build a response from a bare boolean (it 500ed after storing the like)
        return { success: true };
    }
}
