import { imageGate, newImagePatch, queueImageScan } from '../../lib/review/images';
import { Hono } from "hono";
import type { AppContext } from "../../base/types";
import BunnyStorageClient from "../../lib/bunny/storage";
import R2Repository, { rethrowBusy } from "../../lib/r2Repo";
import { Profile as BusinessProfile } from "../../lib/types";
import { z } from "zod";
import { requireSecret, requireEnvVar } from "../../lib/env-helpers";
import Queue, { MessageType } from "../../lib/queue";
import { logger } from '../../lib/logger';
import { recordImageOwner } from '../../lib/csam/imageOwners';

const app = new Hono();

const handleAvatarUpdate = async (c: AppContext) => {
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
        const path = `/${photoId}_avatar.${file.type.split("/")[1]}`;

        const avatarUrl = `https://images.alummahnow.net${path}`;
        // The key and the review settings together (VR16): each is a round trip, and the uploader waits for all of them
        const [key, gate] = await Promise.all([
            requireSecret(c.env.image_storage_key, 'image_storage_key'),
            imageGate(c.env as never),
        ]);
        const zone = requireEnvVar(c.env, 'ZONE');

        const bunnyStorageClient = new BunnyStorageClient(zone, key);
        const uploaded = await bunnyStorageClient.putFile(path, file.stream());
        if (!uploaded) {
            throw new Error(`Image storage rejected the upload for ${path}`);
        }

        // Conditional write on the fresh profile (SCALABILITY-AUDIT AV-6)
        // Pre-publication review (VR16): the new image waits in pendingImages until it is clean
        let reviewId: string | null = null;
        const [saved] = await Promise.all([
            repository.updateObject(userId, (fresh) => {
                const reviewed = newImagePatch(gate, 'profile_picture', avatarUrl, (fresh as { pendingImages?: never }).pendingImages);
                reviewId = reviewed.reviewId;
                Object.assign(fresh, reviewed.patch);
            }),
            // Who uploaded it (a CSAM match maps the image to its uploader; lib/csam/imageOwners.ts)
            recordImageOwner(c.env.SEARCH_DB, avatarUrl, { kind: 'profile_avatar', ownerId: userId }),
        ]);
        if (!saved) {
            return c.json({ success: false, error: "Profile not found" }, 404);
        }
        Object.assign(profile, saved);

        // The image is saved: a message that cannot be sent is logged, never an error for the uploader
        await Promise.allSettled([
            new Queue(c.env.queue).send(MessageType.ProfileUpdate, {
                profileId: userId,
                userId,
                timestamp: new Date().toISOString(),
                action: 'avatar_update',
            }),
            reviewId
                ? queueImageScan(c.env as never, gate, { subject: 'profile_picture', subjectId: userId, reviewId, ownerId: userId, images: [avatarUrl] })
                : undefined,
        ]).then((results) => {
            for (const r of results) if (r.status === 'rejected') logger.error('[ImageUpload] Saved, but a message was not queued', { error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
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

export default handleAvatarUpdate;