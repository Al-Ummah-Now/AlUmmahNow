import { OpenAPIRoute, Str } from "chanfana";
import { date, z } from "zod";
import { Video, ResponseError } from "../../lib/types";
import R2Repository from "../../lib/r2Repo";
import Queue, { MessageType } from "../../lib/queue";

export class LikeCreate extends OpenAPIRoute {
    schema = {
        tags: ["Likes"],
        summary: "Like a comment on a video",
        request: {
            params: z.object({
                id: Str({ description: "Video id" }),
                cid: Str({ description: "Comment id" }),
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

    async handle(c) {
        // Get validated data
        const request = await this.getValidatedData<typeof this.schema>();

        // Retrieve the validated slug
		const { id, cid } = request.params;
		const auth = c.get('auth');
		const userId = auth?.userId;
		const { channelId } = request.headers;

        // Implement your own object fetch here
        const bucket = c.env.videos;
        type VideoType = z.infer<typeof Video>;
        const repository = new R2Repository<VideoType>(bucket);
        let video = await repository.getObject(id);

        const exists = video !== null;

        if (!exists) {
            return Response.json(
                {
                    success: false,
                    error: "Object not found",
                },
                {
                    status: 404,
                },
            );
        }

		// Check privacy permissions
		if (video.isPublic === false && (!userId || video.userId !== userId)) {
			return Response.json(
				{
					success: false,
					error: "Object not found", // Don't reveal that private video exists
				},
				{
					status: 404,
				},
			);
		}

		const comment = video.comments.find((comment) => comment.id === cid);
		if (!comment) {
			return Response.json(
				{
					success: false,
					error: "Object not found",
				},
				{
					status: 404,
				},
			);
		}	

        const like = {
            id: crypto.randomUUID(),
            userId: userId,
            channelId: channelId,
			entityId: `${id}:${cid}`,
            dateCreated: new Date().toISOString(),
        }

        const queue = new Queue(c.env.queue);
		await queue.send(MessageType.CommentLike, {
			likeId: like.id,
			commentId: cid,
			videoId: id,
			userId: userId,
			channelId: channelId,
			timestamp: new Date().toISOString(),
		});

        // Check if the user has already liked the video
        const alreadyLiked = comment.likes.find((like) => like.channelId === channelId);
        if (alreadyLiked) {
            return Response.json(
                {
                    success: true,
                },
                {
                    status: 201,
                },
            );
        }

        comment.likes.push(like);
        // Note: likesCount is calculated in view layer, not stored

        await repository.putObject(video.id, video);

        return true;
    }
}

