/**
 * Where a custom thumbnail (an uploaded image, or a frame the uploader picked) is stored:
 * the Delivery settings' `thumbnails.store` (docs/media-delivery/PROVIDERS.md §Thumbnails).
 *
 *   bunny ─► Bunny image storage, served by images.alummahnow.net (Bunny Optimizer sizes)
 *   r2    ─► the public media bucket under pub/thumbs/<videoId>/, served by the media domain
 *
 * Only new images go here: a stored thumbnail (legacy, custom) is never moved or replaced. Each
 * upload gets its own path, so a CDN never serves a previous image. The caller checks the
 * image's shape against the video first (lib/thumbnail/shape.ts).
 */
import type { MediaProviderId } from '@al-ummah/shared-types';
import BunnyStorageClient from '../bunny/storage';
import { requireEnvVar, requireSecret } from '../env-helpers';
import { logger } from '../logger';
import { readMediaSettings } from '../media/settings';
import { THUMBNAIL_SIZES, thumbnailProcessor } from './processor';

export const IMAGE_CDN_BASE_URL = 'https://images.alummahnow.net';

/** Key prefix of a video's custom thumbnails in the public media bucket */
export function r2ThumbnailPrefix(videoId: string): string {
	return `pub/thumbs/${videoId}/`;
}

export interface StoredThumbnail {
	thumbnailUrl: string;
	thumbnailSizes: Record<string, string>;
	store: MediaProviderId;
}

type ThumbnailStoreEnv = {
	global_settings?: R2Bucket;
	image_storage_key?: unknown;
	ZONE?: string;
	MEDIA?: R2Bucket;
	MEDIA_PUBLIC_HOST?: string;
};

/** Store one custom thumbnail where the settings say. Throws when the store fails. */
export async function storeCustomThumbnail(
	env: ThumbnailStoreEnv,
	videoId: string,
	image: ArrayBuffer,
	mime: { type: string; extension: string },
): Promise<StoredThumbnail> {
	const store = (await readMediaSettings(env)).thumbnails.store;
	const name = `${crypto.randomUUID()}.${mime.extension}`;
	if (store === 'r2') {
		if (!env.MEDIA || !env.MEDIA_PUBLIC_HOST) throw new Error('The media bucket is not configured');
		const key = `${r2ThumbnailPrefix(videoId)}${name}`;
		await env.MEDIA.put(key, image, { httpMetadata: { contentType: mime.type, cacheControl: 'public, max-age=31536000, immutable' } });
		const url = `https://${env.MEDIA_PUBLIC_HOST}/${key}`;
		// The media domain serves the image as stored: every size is the image itself
		const thumbnailSizes = Object.fromEntries([...THUMBNAIL_SIZES.map((size) => size.name), 'original'].map((size) => [size, url]));
		logger.debug('[Thumbnail] Custom thumbnail stored on R2', { videoId, key });
		return { thumbnailUrl: url, thumbnailSizes, store };
	}
	const path = `/thumbnails/${videoId}/${name}`;
	const storage = new BunnyStorageClient(requireEnvVar(env as never, 'ZONE'), await requireSecret(env.image_storage_key as never, 'image_storage_key'));
	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(new Uint8Array(image));
			controller.close();
		},
	});
	if (!(await storage.putFile(path, body))) throw new Error('Bunny image storage refused the thumbnail');
	const thumbnailSizes = thumbnailProcessor.generateBunnyUrls(`${IMAGE_CDN_BASE_URL}${path}`);
	logger.debug('[Thumbnail] Custom thumbnail stored on Bunny', { videoId, path });
	return { thumbnailUrl: thumbnailSizes.hd || `${IMAGE_CDN_BASE_URL}${path}`, thumbnailSizes, store: 'bunny' };
}
