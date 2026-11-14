/**
 * Image uploads made by an admin (channel avatar/cover, video thumbnail), stored
 * like the owners' uploads (Bunny Storage zone, served from images.alummahnow.net).
 */
import { bunnyRef } from '../media/providers';
import BunnyStorageClient from '../bunny/storage';
import { requireEnvVar, requireSecret } from '../env-helpers';
import { AdminError } from './service';
import R2Repository from '../r2Repo';
import { fetchBunnyVideo } from '../processing/loop';
import { checkThumbnailShape, imageSize, resolveVideoSize } from '../thumbnail/shape';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function checkImage(file: unknown): File {
	if (!file || !(file instanceof File)) throw new AdminError(400, 'no_file');
	if (file.size > MAX_IMAGE_BYTES) throw new AdminError(400, 'file_too_large');
	if (!IMAGE_TYPES.includes(file.type)) throw new AdminError(400, 'invalid_file_type');
	return file;
}

export async function storeImage(env: Record<string, unknown>, file: File, suffix: string): Promise<string> {
	const path = `/${crypto.randomUUID()}_${suffix}.${file.type.split('/')[1]}`;
	const key = await requireSecret(env.image_storage_key as never, 'image_storage_key');
	const zone = requireEnvVar(env as never, 'ZONE');
	const uploaded = await new BunnyStorageClient(zone, key).putFile(path, file.stream());
	if (!uploaded) throw new Error(`Image storage rejected the upload for ${path}`);
	return `https://images.alummahnow.net${path}`;
}

/**
 * A video thumbnail an admin uploads must have the video's shape, like an
 * owner's (lib/thumbnail/shape.ts); admin-web crops to it first.
 */
export async function checkThumbnailShapeFor(env: Record<string, unknown>, videoId: string, file: File): Promise<void> {
	const video = await new R2Repository<{ width?: number; height?: number; isDeleted?: boolean; media?: unknown }>(env.videos as R2Bucket).getObject(videoId);
	if (!video || video.isDeleted) throw new AdminError(404, 'video_not_found');
	const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
	// Bunny's copy (new videos: its GUID) tells the size when the record does not
	const bunnyId = bunnyRef(video as never);
	const videoSize = await resolveVideoSize(video, async () => (bunnyId ? fetchBunnyVideo(env as never, bunnyId, video as never) : null));
	const shape = checkThumbnailShape(imageSize(head), videoSize);
	if (!shape.ok) throw new AdminError(422, shape.code, shape.error);
}
