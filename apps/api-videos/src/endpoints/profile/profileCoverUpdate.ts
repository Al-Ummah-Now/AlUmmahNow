import { Hono } from "hono";
import BunnyStorageClient from "../../lib/bunny/storage";
import R2Repository from "../../lib/r2Repo";
import { Profile as BusinessProfile } from '../../lib/types';
import { z } from "zod";
import { requireSecret, requireEnvVar } from "../../lib/env-helpers";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';

const app = new Hono();

const handleCoverUpdate = async (c) => {
    try {
        // Get auth context - profile ID is always the user ID
        const auth = c.get('auth');
        const userId = auth?.userId;
        if (!userId) {
            return c.json({ error: 'Unauthorized' }, 401);
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
        if(!["image/jpeg", "image/png"].includes(file.type)) {  
            return c.json({ success: false, error: "Invalid file type" }, 400);
        }

        // R2 bucket and repository (profile ID = user ID)
        const bucket: R2Bucket = c.env.profiles;
        type ProfileType = z.infer<typeof BusinessProfile>;
        const repository = new R2Repository<ProfileType>(bucket);

        // Fetch the profile from the repository
        const profile = await repository.getObject(userId);
        if (!profile) {
            return c.json({ success: false, error: "Profile not found" }, 404);
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

        //Update the profile's cover URL
        profile.coverUrl = `https://images.alummahnow.net${path}`;
        await repository.putObject(userId, profile);

        // Send queue message for cover update
        const queue = new Queue(c.env.queue);
        await queue.send(MessageType.ProfileUpdate, {
            profileId: userId,
            userId,
            timestamp: new Date().toISOString(),
            action: 'cover_update',
        });

        return c.json(profile, 200);
    } catch (error) {
        logger.error("Error updating avatar photo:", error);
        return c.json(
            {
                success: false,
                error: "Failed to update avatar photo",
            },
            500
        );
    }
}

export default handleCoverUpdate;