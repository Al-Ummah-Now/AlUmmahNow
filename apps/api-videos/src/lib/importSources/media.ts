/**
 * An imported item's images, copied to the platform media host first, as any post image
 * (endpoints/community/upload-images.ts): the same storage path, the same image-owner record for the
 * CSAM index, the file checked by its bytes. The file name comes from the source and item, so a retried
 * job writes the same file again instead of a second copy.
 */
import { IMPORT_MAX_IMAGE_BYTES, type PostImage } from '@al-ummah/shared-types';
import BunnyStorageClient from '../bunny/storage';
import { requireEnvVar, requireSecret } from '../env-helpers';
import { readLimited, safeFetch, PreviewError } from '../link-preview';
import { validateImageMagicBytes } from '../security/magic-bytes';
import { imageSize } from '../thumbnail/shape';
import { recordImageOwner } from '../csam/imageOwners';
import { TG_FILE, telegramFileUrl } from './telegram';
import type { FetchedImage } from './fetchers';
import { logger } from '../logger';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
export const IMAGE_HOST = 'https://images.alummahnow.net';

async function sha256Hex(text: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A source URL ready to fetch. Only a Telegram source's items name files by their Telegram id (fetched
 * through getFile with our bot): any other source naming one is refused, so a feed or a post can never
 * make us download a file our bot can see. Every other URL must be public https (the fetch checks the
 * address again, lib/link-preview.ts).
 */
export async function resolveSourceUrl(env: unknown, network: string, url: string, f: typeof fetch = fetch): Promise<{ url: string; bytes: number | null } | null> {
	if (url.startsWith(TG_FILE)) return network === 'telegram' ? telegramFileUrl(env as never, url.slice(TG_FILE.length), f) : null;
	if (network === 'telegram') return null;
	if (!/^https:\/\//i.test(url)) return null;
	return { url, bytes: null };
}

export interface CopyImagesInput {
	channelId: string;
	/** The source's network (only Telegram sources name Telegram files) */
	network: string;
	ownerId: string;
	/** Names the files (source id and item id) */
	key: string;
	images: FetchedImage[];
}

/**
 * Copies the images; one that is missing, too big or not an image is left out (the caller skips an item
 * that had images and kept none). A storage failure throws, so the job retries.
 */
export async function copyImages(env: Record<string, unknown>, input: CopyImagesInput, f: typeof fetch = fetch): Promise<PostImage[]> {
	const out: PostImage[] = [];
	let storage: BunnyStorageClient | null = null;
	for (const [index, image] of input.images.slice(0, 10).entries()) {
		let bytes: Uint8Array;
		try {
			const source = await resolveSourceUrl(env, input.network, image.url, f);
			if (!source) continue;
			const res = await safeFetch(source.url, 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9', f);
			bytes = await readLimited(res, IMPORT_MAX_IMAGE_BYTES, true);
		} catch (error) {
			if (error instanceof PreviewError) {
				logger.debug('[ImportSources] Image left out', { key: input.key, index, code: error.code });
				continue;
			}
			throw error;
		}
		const check = validateImageMagicBytes(bytes);
		const type = check.detectedMimeType ?? '';
		if (!check.isValid || !EXT[type]) continue;
		const dims = imageSize(bytes);
		const path = `/community-posts/${input.channelId}/import-${(await sha256Hex(`${input.key}:${index}`)).slice(0, 32)}.${EXT[type]}`;
		storage ??= new BunnyStorageClient(requireEnvVar(env as never, 'ZONE'), await requireSecret(env.image_storage_key as never, 'image_storage_key'));
		if (!(await storage.putFile(path, new Blob([bytes]).stream() as ReadableStream))) throw new Error('The image could not be stored');
		const url = `${IMAGE_HOST}${path}`;
		// Who uploaded it: the channel's owner (a CSAM match maps the image to its uploader; lib/csam/imageOwners.ts)
		await recordImageOwner(env.SEARCH_DB as never, url, { kind: 'post_image', ownerId: input.ownerId, channelId: input.channelId });
		out.push({ url, width: dims?.width ?? 0, height: dims?.height ?? 0, mimeType: type, size: bytes.byteLength });
	}
	return out;
}
