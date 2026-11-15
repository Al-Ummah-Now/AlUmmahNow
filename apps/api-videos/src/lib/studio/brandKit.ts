/**
 * Institution mode (E19 19.9): one brand kit and one shared asset library per account, used by every
 * channel the account owns and by those channels' teams (a member acting as the channel reads its
 * owner's kit; only the owner changes it). There is no organisation entity (AUN-SUBS S10: an account
 * holds the institution). Stored in MEDIA_PRIVATE under studio/<ownerId>/.
 */
type Bucket = any;

export const STUDIO_ASSET_LIMITS = {
	maxAssets: 50,
	/** One asset: a Worker request body tops out at 100 MB */
	maxAssetBytes: 95 * 1024 * 1024,
	maxTotalBytes: 1024 * 1024 * 1024,
	maxNameChars: 80,
} as const;

export type StudioAssetKind = 'image' | 'video' | 'audio';

export interface StudioAsset {
	id: string;
	kind: StudioAssetKind;
	name: string;
	contentType: string;
	bytes: number;
	createdAt: string;
}

export interface BrandKit {
	v: 1;
	/** The institution's display name on titles and lower thirds, per language */
	name: { en?: string; ar?: string };
	colors: { primary: string; secondary: string; text: string; background: string };
	/** Asset ids from the library */
	logo?: string;
	intro?: string;
	outro?: string;
	/** Lower-third look used by the desktop editor's title templates */
	lowerThird: { style: 'bar' | 'box' | 'minimal'; position: 'start' | 'center' | 'end' };
	/** Logo watermark corner on exported videos, or none */
	watermark: 'none' | 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end';
	updatedAt: string;
	updatedBy: string;
}

export const DEFAULT_BRAND_KIT: Omit<BrandKit, 'updatedAt' | 'updatedBy'> = {
	v: 1,
	name: {},
	// Fanous tokens (night teal, lantern, parchment)
	colors: { primary: '#ffa037', secondary: '#093041', text: '#f7f1e8', background: '#093041' },
	lowerThird: { style: 'bar', position: 'start' },
	watermark: 'none',
};

/** Everything an account keeps here (erased with the account, lib/privacy/user-data.ts). */
export const studioPrefix = (ownerId: string) => `studio/${safe(ownerId)}/`;
export const brandKitKey = (ownerId: string) => `studio/${safe(ownerId)}/brand-kit.json`;
export const assetIndexKey = (ownerId: string) => `studio/${safe(ownerId)}/assets.json`;
export const assetKey = (ownerId: string, id: string) => `studio/${safe(ownerId)}/assets/${id}`;

function safe(id: string): string {
	if (!/^[A-Za-z0-9_|:-]{1,128}$/.test(id)) throw new Error('unsafe owner id');
	return id.replace(/[|:]/g, '_');
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const ASSET_ID = /^[a-f0-9]{16}$/;

export type KitCheck = { ok: true; kit: Omit<BrandKit, 'v' | 'updatedAt' | 'updatedBy'> } | { ok: false; error: string; field?: string };

/** Validates a brand kit from Studio; asset references must exist in the owner's library. */
export function checkBrandKit(input: any, assets: StudioAsset[]): KitCheck {
	const fail = (field: string): KitCheck => ({ ok: false, error: 'invalid_brand_kit', field });
	if (!input || typeof input !== 'object') return fail('body');
	const name: BrandKit['name'] = {};
	for (const lang of ['en', 'ar'] as const) {
		const v = input.name?.[lang];
		if (v === undefined || v === '') continue;
		if (typeof v !== 'string' || v.trim().length > 80) return fail(`name.${lang}`);
		name[lang] = v.trim();
	}
	const colors = input.colors ?? {};
	for (const k of ['primary', 'secondary', 'text', 'background'] as const) if (typeof colors[k] !== 'string' || !HEX.test(colors[k])) return fail(`colors.${k}`);
	const ref = (field: 'logo' | 'intro' | 'outro', kinds: StudioAssetKind[]) => {
		const v = input[field];
		if (v === undefined || v === null || v === '') return { ok: true as const, value: undefined };
		const a = typeof v === 'string' && ASSET_ID.test(v) ? assets.find((x) => x.id === v) : undefined;
		return a && kinds.includes(a.kind) ? { ok: true as const, value: v as string } : { ok: false as const };
	};
	const logo = ref('logo', ['image']);
	const intro = ref('intro', ['video']);
	const outro = ref('outro', ['video']);
	if (!logo.ok) return fail('logo');
	if (!intro.ok) return fail('intro');
	if (!outro.ok) return fail('outro');
	const lt = input.lowerThird ?? {};
	if (!['bar', 'box', 'minimal'].includes(lt.style) || !['start', 'center', 'end'].includes(lt.position)) return fail('lowerThird');
	if (!['none', 'top-start', 'top-end', 'bottom-start', 'bottom-end'].includes(input.watermark)) return fail('watermark');
	return {
		ok: true,
		kit: {
			name,
			colors: { primary: colors.primary.toLowerCase(), secondary: colors.secondary.toLowerCase(), text: colors.text.toLowerCase(), background: colors.background.toLowerCase() },
			...(logo.value ? { logo: logo.value } : {}),
			...(intro.value ? { intro: intro.value } : {}),
			...(outro.value ? { outro: outro.value } : {}),
			lowerThird: { style: lt.style, position: lt.position },
			watermark: input.watermark,
		},
	};
}

/** What a file is, from its first bytes; the declared type is never trusted. */
export function sniff(bytes: Uint8Array): { kind: StudioAssetKind; contentType: string } | null {
	const at = (i: number, ...b: number[]) => b.every((x, j) => bytes[i + j] === x);
	const ascii = (i: number, s: string) => at(i, ...[...s].map((ch) => ch.charCodeAt(0)));
	if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { kind: 'image', contentType: 'image/png' };
	if (at(0, 0xff, 0xd8, 0xff)) return { kind: 'image', contentType: 'image/jpeg' };
	if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return { kind: 'image', contentType: 'image/webp' };
	if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return { kind: 'audio', contentType: 'audio/wav' };
	if (ascii(0, 'ID3') || at(0, 0xff, 0xfb) || at(0, 0xff, 0xf3)) return { kind: 'audio', contentType: 'audio/mpeg' };
	if (ascii(4, 'ftyp')) {
		const brand = String.fromCharCode(...bytes.slice(8, 12));
		if (brand === 'M4A ') return { kind: 'audio', contentType: 'audio/mp4' };
		if (brand === 'qt  ') return { kind: 'video', contentType: 'video/quicktime' };
		return { kind: 'video', contentType: 'video/mp4' };
	}
	return null;
}

export async function readAssets(bucket: Bucket, ownerId: string): Promise<{ assets: StudioAsset[]; etag?: string }> {
	const obj = await bucket.get(assetIndexKey(ownerId));
	if (!obj) return { assets: [] };
	return { assets: ((await obj.json()) as { assets: StudioAsset[] }).assets ?? [], etag: obj.etag };
}

/** Writes the asset index only if nobody changed it meanwhile (false = retry). */
export async function writeAssets(bucket: Bucket, ownerId: string, assets: StudioAsset[], etag: string | undefined): Promise<boolean> {
	const written = await bucket.put(assetIndexKey(ownerId), JSON.stringify({ assets }), {
		httpMetadata: { contentType: 'application/json' },
		onlyIf: etag ? { etagMatches: etag } : { etagDoesNotMatch: '*' },
	});
	return !!written;
}

export async function readBrandKit(bucket: Bucket, ownerId: string): Promise<BrandKit | null> {
	const obj = await bucket.get(brandKitKey(ownerId));
	return obj ? ((await obj.json()) as BrandKit) : null;
}

export function newAssetId(): string {
	let out = '';
	for (const b of crypto.getRandomValues(new Uint8Array(8))) out += b.toString(16).padStart(2, '0');
	return out;
}
