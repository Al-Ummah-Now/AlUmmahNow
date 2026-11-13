/**
 * Legacy imported videos store their thumbnail without a scheme and unencoded:
 * "images.alummahnow.net/<Arabic title with spaces>.jpg". Browsers on the web
 * app cope (posterFor adds https://), but every other client (native apps, www,
 * the CMS) had to repair it. Responses now carry the loadable form:
 * "https://images.alummahnow.net/<percent-encoded path>".
 */

const SCHEMELESS = /^(?:\/\/)?((?:[a-z0-9-]+\.)*alummahnow\.net)\/(.+)$/i;
const IMAGE_FIELDS = new Set(['thumbnailUrl', 'thumbnail', 'previewUrl', 'poster', 'videoThumbnail', 'avatarUrl', 'bannerUrl', 'coverUrl']);
const IMAGE_MAP_FIELD = 'thumbnailSizes';

/** https:// form of a scheme-less image URL on our domain; anything else unchanged */
export function absoluteImageUrl(value: string): string {
	if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return value;
	const m = SCHEMELESS.exec(value.trim());
	if (!m) return value;
	// Encode each segment once: decode first so an already-encoded path is not double-encoded
	const path = m[2].split('/').map((seg) => {
		let raw = seg;
		try {
			raw = decodeURIComponent(seg);
		} catch {
			/* keep the segment as stored */
		}
		return encodeURIComponent(raw);
	});
	return `https://${m[1].toLowerCase()}/${path.join('/')}`;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Rewrite scheme-less image URLs in known image fields of a JSON body; non-JSON is returned unchanged */
export function absoluteImageUrlsInText(text: string): string {
	// Cheap guard: only bodies holding a scheme-less value of our domain are parsed
	if (!/"(?:\/\/)?(?:[a-z0-9-]+\.)*alummahnow\.net\//i.test(text)) return text;
	let body: Json;
	try {
		body = JSON.parse(text) as Json;
	} catch {
		return text;
	}
	let changed = false;
	const fix = (v: string) => {
		const out = absoluteImageUrl(v);
		if (out !== v) changed = true;
		return out;
	};
	const walk = (node: Json): void => {
		if (Array.isArray(node)) {
			node.forEach(walk);
			return;
		}
		if (!node || typeof node !== 'object') return;
		for (const [key, value] of Object.entries(node)) {
			if (typeof value === 'string') {
				if (IMAGE_FIELDS.has(key)) node[key] = fix(value);
			} else if (key === IMAGE_MAP_FIELD && value && typeof value === 'object' && !Array.isArray(value)) {
				for (const [size, url] of Object.entries(value)) if (typeof url === 'string') value[size] = fix(url);
			} else {
				walk(value);
			}
		}
	};
	walk(body);
	return changed ? JSON.stringify(body) : text;
}
