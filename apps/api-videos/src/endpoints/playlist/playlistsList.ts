import { Num, OpenAPIRoute, Str } from "chanfana";
import { string, z } from "zod";
import { Playlist, PaginationResponse, ResponseError } from "../../lib/types";
import { env } from 'cloudflare:workers';
import R2Repository from "../../lib/r2Repo";

export class PlaylistsList extends OpenAPIRoute {
    schema = {
        tags: ["Playlists"],
        summary: "List Playlists",
        request: {
            query: z.object({
                limit: Num({
                    description: "Limit the number of playlists to return",
                    default: 10,
                }),
                cursor: string({
                    description: "The last cursor returned from the previous request",
                }).optional(),
            }),
			headers: z.object({
				channelId: Str({ description: "Channel ID" }).optional().nullable(),
				userId: Str({ description: "User ID" }).optional().nullable(),
			}),
        },
        responses: {
            "200": {
                description: "Returns a list of playlists",
                content: {
                    "application/json": {
                        schema: PaginationResponse.extend({ data: z.array(Playlist) }),
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

        // Retrieve the validated parameters
        const { limit, cursor } = request.query;
		const { channelId, userId } = request.headers;

        // Implement your own object list here
        const bucket = env.playlists;
        type PlaylistType = z.infer<typeof Playlist>;
        const repository = new R2Repository<PlaylistType>(bucket);
        let playlists = !cursor ? await repository.listObjects(limit) : await repository.listObjects(limit, cursor);
        
        // Filter playlists based on privacy settings and user context
        const filteredPlaylists = {
            ...playlists,
            items: (playlists.items || []).filter(playlist => {
                // If playlist is explicitly private (false), only show if user owns it
                if (playlist.isPublic === false) {
                    return userId && playlist.userId === userId;
                }
                
                // If playlist is public (true) or undefined/null (default to public), always show it
                return true;
            })
        };
        
        let response: PaginationResponse<PlaylistType>;
        if (!filteredPlaylists.items || filteredPlaylists.items.length === 0) {
            response = {
                cursor: "",
                limit,
                data: [],
            };
        } else {
            response = {
                cursor: filteredPlaylists.cursor,
                limit,
                data: filteredPlaylists.items || [],
            };
        }

        return response;
    }
}
