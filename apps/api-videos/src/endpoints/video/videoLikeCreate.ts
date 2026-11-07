import { Str } from "chanfana";
import { date, z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";
import { broadcastInBackground } from "../../lib/websocket-notify";
import { AuthenticatedRoute, AppContext } from '../../base';

export class LikeCreate extends AuthenticatedRoute {
    schema = {
        tags: ["Likes"],
        summary: "Like a video",
        request: {
            params: z.object({
                id: Str({ description: "Video id" }),
            }),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }),
			}),
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
        // Get validated data
        const request = await this.getValidatedData<typeof this.schema>();

        // Retrieve the validated slug
        const { id } = request.params;
		const userId = this.getUserId(c);
		const { channelId } = request.headers;

        // Implement your own object fetch here
        const bucket = c.env.videos;
        type VideoType = z.infer<typeof Video>;
        const repository = new R2Repository<VideoType>(bucket);
        let video = await repository.getObject(id);

        const exists = video !== null;

        if (!exists) {
            return c.json(
                {
                    success: false,
                    error: "Object not found",
                },
                404
            );
        }

        const like = {
            id: crypto.randomUUID(),
            userId: userId,
			channelId: channelId,
			entityId: id,
            dateCreated: new Date().toISOString(),
        }

        const queue = new Queue(c.env.queue);
		await queue.send(MessageType.VideoLike, {
			likeId: like.id,
			videoId: id,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

        // Check if the user has already liked the video
        const alreadyLiked = (video.likes || []).find((existingLike) => existingLike.entityId === id && existingLike.channelId === channelId);
        if (alreadyLiked) {
            return c.json(
                {
                    success: true,
                },
                201
            );
        }

		// Initialize likes array if it doesn't exist
		if (!video.likes) {
			video.likes = [];
		}
		video.likes.push(like);
		// Note: likesCount is calculated in view layer, not stored

		await repository.putObject(video.id, video);

		broadcastInBackground(c, `video:${id}`, 'video_liked', {
			videoId: id,
			userId,
			likesCount: video.likes.length,
			dislikesCount: video.dislikes?.length || 0,
		});

		// chanfana cannot build a response from a bare boolean (it 500ed after storing the like)
		return { success: true };
    }
}
