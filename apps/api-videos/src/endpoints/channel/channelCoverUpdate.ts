import { Hono } from "hono";
import BunnyStorageClient from "../../lib/bunny/storage";
import R2Repository from "../../lib/r2Repo";
import { Channel } from "../../lib/types";
import { z } from "zod";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret, requireEnvVar } from "../../lib/env-helpers";

const app = new Hono();

const handleCoverUpdate = async (c) => {
    try {
        // Extract the `id` parameter
        const id = c.req.param("id");

        // Validate the `id`
        if (!id) {
            return c.json({ success: false, error: "Channel ID is required" }, 400);
        }

        // Parse the form data
        const formData = await c.req.parseBody();
        const file = formData["photo"];

        // Validate the uploaded file
        if (!file || !(file instanceof File)) {
            return c.json({ success: false, error: "No file uploaded" }, 400);
        }
        if (file.size > 5 * 1024 * 1024) {
            return c.json({ success: false, error: "File size exceeds 5MB" }, 400);
        }
        if (!["image/jpeg", "image/png"].includes(file.type)) {
            return c.json({ success: false, error: "Invalid file type" }, 400);
        }

        // Get R2 bucket from context
        const bucket: R2Bucket = c.c.env.channels;
        type ChannelType = z.infer<typeof Channel>;
        const repository = new R2Repository<ChannelType>(bucket);

        // Fetch the Channel from the repository
        const channel = await repository.getObject(id);
        if (!channel) {
            return c.json({ success: false, error: "Channel not found" }, 404);
        }

        // Verify user owns this channel
        const auth = c.get('auth');
        const userId = auth?.userId;
        if (channel.userId !== userId) {
            return c.json({
                success: false,
                error: "You do not have permission to update this channel",
            }, 403);
        }

        // Define the file path
        const photoId = crypto.randomUUID();
        const path = `/${photoId}_cover.${file.type.split("/")[1]}`;

        // Get Bunny.net storage key and zone from environment
        const key = await requireSecret(c.c.env.image_storage_key, 'image_storage_key');
        const zone = requireEnvVar(c.env, 'ZONE');

        const bunnyStorageClient = new BunnyStorageClient(zone, key);
        const stream: ReadableStream = new ReadableStream({
            start(controller) {
                const reader = file.stream().getReader();
                function push() {
                    reader.read().then(({ done, value }) => {
                        if (done) {
                            controller.close();
                            return;
                        }
                        controller.enqueue(value);
                        push();
                    });
                }
                push();
            }
        });
        await bunnyStorageClient.putFile(path, stream);

        //Update the Channel's cover URL
        channel.coverUrl = `https://images.alummahnow.net${path}`;

        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.ChannelUpdate, {
			channelId: id,
			userId: userId,
			timestamp: new Date().toISOString(),
		});

        await repository.putObject(id, channel);

        return c.json(channel, 200);
    } catch (error) {
        return c.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Failed to update avatar photo",
            },
            500
        );
    }
}

export default handleCoverUpdate;