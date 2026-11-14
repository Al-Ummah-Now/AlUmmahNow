/**
 * Thumbnail shape rules shared by every path that sets a video's thumbnail
 * (2026-11-10: "thumbs don't match aspect", owner: "don't let it happen in
 * future").
 *
 * A thumbnail must have the video's shape (Bunny's encoded width/height):
 *   - studio custom upload, admin upload, picking a URL in the editor:
 *     refused with 422 `thumbnail_shape` (the web crops to the shape first);
 *   - an image sent with an upload: dropped for Bunny's own frame;
 *   - legacy imports and Bunny thumbnails: checked daily by the
 *     videos.repair-thumbnails job and flagged on the admin Errors page.
 */

export interface Size {
	width: number;
	height: number;
}

/** Shapes further apart than 5% are a mismatch (rounding of odd encodes stays well inside). */
export const ASPECT_TOLERANCE = 0.05;

/** True when the two shapes differ by more than `tolerance` (5%). */
export function aspectMismatch(a: Size, b: Size, tolerance = ASPECT_TOLERANCE): boolean {
	const ra = a.width / a.height;
	const rb = b.width / b.height;
	return Math.max(ra, rb) / Math.min(ra, rb) > 1 + tolerance;
}

/**
 * Old YouTube art (hqdefault 480x360, sddefault 640x480): a 16:9 picture with
 * black bars baked into a 4:3 image, on a landscape video. Cards show it whole
 * on a blurred backdrop, so the check treats it as acceptable rather than
 * flagging every imported video.
 */
export function isLetterboxedArt(thumbnail: Size, video: Size): boolean {
	const t = thumbnail.width / thumbnail.height;
	const v = video.width / video.height;
	return Math.abs(t / (4 / 3) - 1) <= 0.02 && v >= 1.5;
}

/** The video's encoded size from its record, or null when not known yet. */
export function videoSizeOf(video: { width?: unknown; height?: unknown } | null | undefined): Size | null {
	const width = Number(video?.width);
	const height = Number(video?.height);
	return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null;
}

/**
 * Legacy imports stored thumbnail addresses without a scheme
 * ("images.alummahnow.net/<title>.jpg"); fetch() refuses those. Returns an
 * absolute https URL, or null when the value is not a usable address.
 */
export function absoluteImageUrl(url: string | undefined | null): string | null {
	const value = (url ?? '').trim();
	if (!value) return null;
	const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : value.startsWith('//') ? `https:${value}` : `https://${value}`;
	try {
		const parsed = new URL(candidate);
		return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
	} catch {
		return null;
	}
}

/**
 * The video's size: its record, else Bunny's (a video edited before its size
 * was stored). Null when neither knows yet (still encoding).
 */
export async function resolveVideoSize(
	video: { width?: unknown; height?: unknown } | null | undefined,
	readBunny: () => Promise<{ width?: number; height?: number } | null>,
): Promise<Size | null> {
	const own = videoSizeOf(video);
	if (own) return own;
	try {
		return videoSizeOf(await readBunny());
	} catch {
		return null;
	}
}

export interface ShapeVerdict {
	ok: boolean;
	/** When refused */
	code?: 'thumbnail_shape';
	error?: string;
	expected?: Size;
	actual?: Size;
}

/**
 * Whether `image` may become the thumbnail of a video of size `video`.
 * Unknown video size (not encoded yet) passes: the daily check catches it.
 */
export function checkThumbnailShape(image: Size | null, video: Size | null): ShapeVerdict {
	if (!image || !video || !aspectMismatch(image, video)) return { ok: true };
	return {
		ok: false,
		code: 'thumbnail_shape',
		error: `The thumbnail must have the video's shape (${video.width}x${video.height}); this image is ${image.width}x${image.height}. Crop it to the video's shape first.`,
		expected: video,
		actual: image,
	};
}

/** Where our thumbnails live: custom uploads and imported art, and Bunny's CDN. */
export const IMAGE_HOST = 'images.alummahnow.net';

const hostOf = (url: string): string | null => {
	try {
		const u = new URL(url);
		return u.protocol === 'https:' ? u.hostname.toLowerCase().replace(/\.$/, '') : null;
	} catch {
		return null;
	}
};

/**
 * True when `url` is https on one of our image hosts. A thumbnail URL sent by
 * a user is only fetched (to read its size) when it is, so the worker never
 * requests an address of the user's choosing.
 */
export function isOwnImageHost(url: string, hosts: readonly (string | undefined)[]): boolean {
	const host = hostOf(url);
	return !!host && [IMAGE_HOST, ...hosts].some((h) => !!h && h.toLowerCase() === host);
}

/** True when `url` is https on exactly `host`. */
export function isOnHost(url: string, host: string | undefined): boolean {
	return !!host && hostOf(url) === host.toLowerCase();
}

/** A frame Bunny rendered from this video (thumbnail.jpg, thumbnail_N.jpg): its shape is the video's. */
export function isBunnyFrameOf(url: string, videoId: string, bunnyHostname?: string): boolean {
	if (!bunnyHostname) return false;
	try {
		const u = new URL(url);
		return u.hostname === bunnyHostname && new RegExp(`^/${videoId}/thumbnail(_\\d+)?\\.jpg$`).test(u.pathname);
	} catch {
		return false;
	}
}

/**
 * A frame our transcode rendered from this video (lib/media/r2-delivery.ts storedR2Frame), public or
 * private (any token segment): its shape is the video's.
 */
export function isR2FrameOf(url: string, videoId: string, mediaHost?: string): boolean {
	if (!mediaHost) return false;
	try {
		const u = new URL(url);
		return u.hostname === mediaHost && new RegExp(`^/(?:pub|priv/[^/]+)/${videoId}/[A-Za-z0-9_-]{1,64}/thumb\\.jpg$`).test(u.pathname);
	} catch {
		return false;
	}
}

/** A custom thumbnail of this video stored on R2 (lib/thumbnail/store.ts) */
export function isR2ThumbnailOf(url: string, videoId: string, mediaHost?: string): boolean {
	if (!mediaHost) return false;
	try {
		const u = new URL(url);
		return u.hostname === mediaHost && new RegExp(`^/pub/thumbs/${videoId}/[A-Za-z0-9_-]+\\.(?:jpe?g|png|webp)$`).test(u.pathname);
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Image size from the first bytes (JPEG, PNG, WebP)
// ---------------------------------------------------------------------------

function u16be(b: Uint8Array, i: number): number {
	return (b[i] << 8) | b[i + 1];
}
function u32be(b: Uint8Array, i: number): number {
	return ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
}
function u24le(b: Uint8Array, i: number): number {
	return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}

/**
 * Pixel size of a JPEG, PNG or WebP from its first bytes, or null. JPEG walks
 * the marker segments (so an EXIF preview inside APP1 is skipped) to the
 * first start-of-frame.
 */
export function imageSize(bytes: Uint8Array): Size | null {
	const b = bytes;
	// PNG: signature, then IHDR width/height
	if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
		const width = u32be(b, 16);
		const height = u32be(b, 20);
		return width && height ? { width, height } : null;
	}
	// WebP: RIFF....WEBP + VP8 / VP8L / VP8X chunk
	if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
		const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
		if (chunk === 'VP8 ') return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
		if (chunk === 'VP8L') {
			const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
			return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
		}
		if (chunk === 'VP8X') return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
		return null;
	}
	// JPEG
	if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
		let i = 2;
		while (i + 9 < b.length) {
			if (b[i] !== 0xff) return null;
			const marker = b[i + 1];
			if (marker === 0xff) {
				i++; // fill byte
				continue;
			}
			if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
				i += 2; // standalone markers
				continue;
			}
			const length = u16be(b, i + 2);
			// SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC)
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
				const height = u16be(b, i + 5);
				const width = u16be(b, i + 7);
				return width && height ? { width, height } : null;
			}
			if (marker === 0xda || length < 2) return null; // start of scan: no frame header found
			i += 2 + length;
		}
	}
	return null;
}

function u16le(b: Uint8Array, i: number): number {
	return b[i] | (b[i + 1] << 8);
}
