import { Hono } from "hono";
import BunnyStorageClient from "../../lib/bunny/storage";
import R2Repository from "../../lib/r2Repo";
import { Profile as BusinessProfile } from '../../lib/types';
import { z } from "zod";
import { env } from 'cloudflare:workers';
import { ReadableStream } from 'stream/web';

const app = new Hono();

const handleCoverUpdate = async (c) => {
    try {
        // Extract the `id` parameter
        const id = c.req.param("id");

        // Validate the `id`
        if (!id) {
            return c.json({ success: false, error: "Profile ID is required" }, 400);
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

        // Mocked R2 bucket and repository
        const bucket: R2Bucket = env.profiles;
        type ProfileType = z.infer<typeof BusinessProfile>;
        const repository = new R2Repository<ProfileType>(bucket);

        // Fetch the profile from the repository
        const profile = await repository.getObject(id);
        if (!profile) {
            return c.json({ success: false, error: "Profile not found" }, 404);
        }

        // Define the file path
        const photoId = crypto.randomUUID();
        const path = `/${photoId}_cover.${file.type.split("/")[1]}`;

        // Mocked file storage logic
        var key = await env.image_storage_key.get();
        const bunnyStorageClient = new BunnyStorageClient(env.ZONE, key);
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

        //Update the profile's avatar URL
        profile.coverUrl = `https://images.alummahnow.net${path}`;
        await repository.putObject(id, profile);

        return c.json(profile, 200);
    } catch (error) {
        console.error("Error updating avatar photo:", error);
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