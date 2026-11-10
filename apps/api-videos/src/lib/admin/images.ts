/**
 * Image uploads made by an admin (channel avatar/cover, video thumbnail), stored
 * like the owners' uploads (Bunny Storage zone, served from images.alummahnow.net).
 */
import BunnyStorageClient from '../bunny/storage';
import { requireEnvVar, requireSecret } from '../env-helpers';
import { AdminError } from './service';

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
