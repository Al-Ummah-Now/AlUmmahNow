import { can, channelRoleOf } from "@al-ummah/shared-types";
import { Hono } from "hono";
import type { AppContext } from "../../base/types";
import BunnyStorageClient from "../../lib/bunny/storage";
import R2Repository, { rethrowBusy } from "../../lib/r2Repo";
import { patchOwnedRecord } from '../../lib/videoWrites';
import { Channel } from "../../lib/types";
import { z } from "zod";
import Queue, { MessageType } from "../../lib/queue";
import { requireSecret, requireEnvVar } from "../../lib/env-helpers";

const app = new Hono();

const handleAvatarUpdate = async (c: AppContext) => {
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
        if(file.size > 5 * 1024 * 1024) {
            return c.json({ success: false, error: "File size exceeds 5MB" }, 400);
        }
        if(!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {  
            return c.json({ success: false, error: "Invalid file type" }, 400);
        }

        // Get R2 bucket from context
        const bucket: R2Bucket = c.env.channels;
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
        if (!can(channelRoleOf(channel, userId), 'channel.edit')) {
            return c.json({
                success: false,
                error: "You do not have permission to update this channel",
            }, 403);
        }

        // Define the file path
        const photoId = crypto.randomUUID();
        const path = `/${photoId}_avatar.${file.type.split("/")[1]}`;

        // Get Bunny.net storage key and zone from environment
        const key = await requireSecret(c.env.image_storage_key, 'image_storage_key');
        const zone = requireEnvVar(c.env, 'ZONE');

        const bunnyStorageClient = new BunnyStorageClient(zone, key);
        const uploaded = await bunnyStorageClient.putFile(path, file.stream());
        if (!uploaded) {
            throw new Error(`Image storage rejected the upload for ${path}`);
        }

        //Update the Channel's avatar URL
        const avatarUrl = `https://images.alummahnow.net${path}`;

        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.ChannelUpdate, {
			channelId: id,
			userId: userId,
			timestamp: new Date().toISOString(),
		});

        // Conditional write on the fresh channel (SCALABILITY-AUDIT AV-5)
        const saved = await patchOwnedRecord(repository, id, { avatarUrl }, { ownerId: channel.userId });
        if (saved.status === 'missing') {
            return c.json({ success: false, error: "Channel not found" }, 404);
        }
        if (saved.status === 'forbidden') {
            return c.json({ success: false, error: "You do not have permission to update this channel" }, 403);
        }
        Object.assign(channel, saved.video);

        return c.json(channel, 200);
    } catch (error) {
        rethrowBusy(error);
        return c.json(
            {
                success: false,
                error: error instanceof Error ? error.message : "Failed to update avatar photo",
            },
            500
        );
    }
}

export default handleAvatarUpdate;