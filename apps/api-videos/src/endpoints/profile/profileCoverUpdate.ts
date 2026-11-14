import { imageGate, newImagePatch, queueImageScan } from '../../lib/review/images';
import { Hono } from "hono";
import type { AppContext } from "../../base/types";
import BunnyStorageClient from "../../lib/bunny/storage";
import R2Repository, { rethrowBusy } from "../../lib/r2Repo";
import { Profile as BusinessProfile } from '../../lib/types';
import { z } from "zod";
import { requireSecret, requireEnvVar } from "../../lib/env-helpers";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';
import { recordImageOwner } from '../../lib/csam/imageOwners';

const app = new Hono();

const handleCoverUpdate = async (c: AppContext) => {
    try {
        // Get user ID from auth - profile ID is always the user ID
        const auth = c.get('auth');
        if (!auth || !auth.userId) {
            return c.json({ error: 'Unauthorized' }, 401);
        }
        const userId = auth.userId;

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
        const key = await requireSecret(c.env.image_storage_key, 'image_storage_key');
        const zone = requireEnvVar(c.env, 'ZONE');

        const bunnyStorageClient = new BunnyStorageClient(zone, key);
        const uploaded = await bunnyStorageClient.putFile(path, file.stream());
        if (!uploaded) {
            throw new Error(`Image storage rejected the upload for ${path}`);
        }

        //Update the profile's cover URL
        // Conditional write on the fresh profile (SCALABILITY-AUDIT AV-6)
        const coverUrl = `https://images.alummahnow.net${path}`;
        // Who uploaded it (a CSAM match maps the image to its uploader; lib/csam/imageOwners.ts)
        await recordImageOwner(c.env.SEARCH_DB, coverUrl, { kind: 'profile_cover', ownerId: userId });
        // Pre-publication review (VR16): the new image waits in pendingImages until it is clean
        const gate = await imageGate(c.env as never);
        let reviewId: string | null = null;
        const saved = await repository.updateObject(userId, (fresh) => {
            const reviewed = newImagePatch(gate, 'profile_banner', coverUrl, (fresh as { pendingImages?: never }).pendingImages);
            reviewId = reviewed.reviewId;
            Object.assign(fresh, reviewed.patch);
        });
        if (saved && reviewId) {
            await queueImageScan(c.env as never, gate, { subject: 'profile_banner', subjectId: userId, reviewId, ownerId: userId, images: [coverUrl] });
        }
        if (!saved) {
            return c.json({ success: false, error: "Profile not found" }, 404);
        }
        Object.assign(profile, saved);

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
        rethrowBusy(error);
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