/**
 * Institution mode (E19 19.9): the account's brand kit and shared assets.
 *
 *   GET    /api/studio/brand-kit         the kit (defaults when none saved) and whether the caller may change it
 *   PUT    /api/studio/brand-kit         save (account owner only)
 *   GET    /api/studio/assets            the shared asset library
 *   POST   /api/studio/assets?name=…     add one asset, raw body (image, video or audio; ≤ 95 MB)
 *   GET    /api/studio/assets/:assetId   the asset's bytes
 *   DELETE /api/studio/assets/:assetId   remove it (and its use in the kit)
 *
 * The kit belongs to the account: with a `channelId` header a channel team member reads the kit of
 * the channel's owner; only the owner writes (lib/channelAccess.ts keeps unlisted writes owner only).
 */
import { Str } from '../../lib/chanfana-params';
import { z } from 'zod';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { logger } from '../../lib/logger';
import {
	DEFAULT_BRAND_KIT,
	STUDIO_ASSET_LIMITS,
	assetKey,
	brandKitKey,
	checkBrandKit,
	newAssetId,
	readAssets,
	readBrandKit,
	sniff,
	writeAssets,
	type BrandKit,
	type StudioAsset,
} from '../../lib/studio/brandKit';

const Err = { 'application/json': { schema: z.object({ success: z.literal(false), error: z.string() }) } };
const Kit = z.object({
	name: z.object({ en: z.string().optional(), ar: z.string().optional() }),
	colors: z.object({ primary: z.string(), secondary: z.string(), text: z.string(), background: z.string() }),
	logo: z.string().optional(),
	intro: z.string().optional(),
	outro: z.string().optional(),
	lowerThird: z.object({ style: z.enum(['bar', 'box', 'minimal']), position: z.enum(['start', 'center', 'end']) }),
	watermark: z.enum(['none', 'top-start', 'top-end', 'bottom-start', 'bottom-end']),
});
const Asset = z.object({ id: z.string(), kind: z.enum(['image', 'video', 'audio']), name: z.string(), contentType: z.string(), bytes: z.number(), createdAt: z.string() });

/** Whose kit: the channel's owner when acting as a channel, else the caller. */
function ownerOf(c: AppContext, userId: string): { ownerId: string; isOwner: boolean } {
	const channelOwner = (c.get('channelOwnerId' as never) as string | undefined) ?? undefined;
	const ownerId = channelOwner || userId;
	return { ownerId, isOwner: ownerId === userId };
}

const bucketOf = (c: AppContext) => c.env.MEDIA_PRIVATE as any;

export class BrandKitGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Studio'],
			summary: 'The account brand kit (institution mode)',
			responses: {
				'200': { description: 'Kit', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ kit: Kit, saved: z.boolean(), canEdit: z.boolean() }) }) } } },
				'503': { description: 'Storage unavailable', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const bucket = bucketOf(c);
		if (!bucket) return c.json({ success: false, error: 'storage_unavailable' }, 503);
		const { ownerId, isOwner } = ownerOf(c, this.getUserId(c));
		const saved = await readBrandKit(bucket, ownerId);
		const { v: _v, updatedAt: _a, updatedBy: _b, ...kit } = saved ?? { ...DEFAULT_BRAND_KIT, updatedAt: '', updatedBy: '' };
		return c.json({ success: true, data: { kit, saved: !!saved, canEdit: isOwner } });
	}
}

export class BrandKitPut extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Studio'],
			summary: 'Save the account brand kit',
			description: 'Colours are #rrggbb. `logo` must be an image and `intro`/`outro` videos from the asset library. Account owner only (403 when acting as someone else\'s channel).',
			request: { body: { content: { 'application/json': { schema: Kit } } } },
			responses: {
				'200': { description: 'Saved', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ kit: Kit }) }) } } },
				'400': { description: 'Invalid kit', content: Err },
				'403': { description: 'Not the account owner', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const bucket = bucketOf(c);
		if (!bucket) return c.json({ success: false, error: 'storage_unavailable' }, 503);
		const userId = this.getUserId(c);
		const { ownerId, isOwner } = ownerOf(c, userId);
		if (!isOwner) return c.json({ success: false, error: 'forbidden' }, 403);
		const checked = checkBrandKit(body, (await readAssets(bucket, ownerId)).assets);
		if (!checked.ok) {
			const failed = checked as Extract<typeof checked, { ok: false }>;
			return c.json({ success: false, error: failed.error, field: failed.field }, 400);
		}
		const kit: BrandKit = { v: 1, ...(checked as Extract<typeof checked, { ok: true }>).kit, updatedAt: new Date().toISOString(), updatedBy: userId };
		await bucket.put(brandKitKey(ownerId), JSON.stringify(kit), { httpMetadata: { contentType: 'application/json' } });
		const { v: _v, updatedAt: _a, updatedBy: _b, ...out } = kit;
		return c.json({ success: true, data: { kit: out } });
	}
}

export class StudioAssetsList extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Studio'],
			summary: 'The account\'s shared assets (institution mode)',
			responses: {
				'200': {
					description: 'Assets, newest first',
					content: { 'application/json': { schema: z.object({ success: z.literal(true), data: z.object({ assets: z.array(Asset), bytes: z.number(), limits: z.object({ maxAssets: z.number(), maxAssetBytes: z.number(), maxTotalBytes: z.number() }), canEdit: z.boolean() }) }) } },
				},
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const bucket = bucketOf(c);
		if (!bucket) return c.json({ success: false, error: 'storage_unavailable' }, 503);
		const { ownerId, isOwner } = ownerOf(c, this.getUserId(c));
		const { assets } = await readAssets(bucket, ownerId);
		const { maxAssets, maxAssetBytes, maxTotalBytes } = STUDIO_ASSET_LIMITS;
		return c.json({
			success: true,
			data: { assets: [...assets].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), bytes: assets.reduce((n, a) => n + a.bytes, 0), limits: { maxAssets, maxAssetBytes, maxTotalBytes }, canEdit: isOwner },
		});
	}
}

export class StudioAssetCreate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Studio'],
			summary: 'Add a shared asset',
			description: 'Raw body: PNG, JPEG or WebP image; MP4 or MOV video; MP3, M4A or WAV audio (the type comes from the bytes). ≤ 95 MB each, 50 assets and 1 GB per account (409 `library_full`). Account owner only.',
			request: { query: z.object({ name: Str({ description: 'Display name, ≤ 80 characters' }) }) },
			responses: {
				'201': { description: 'Added', content: { 'application/json': { schema: z.object({ success: z.literal(true), data: Asset }) } } },
				'400': { description: 'Empty, too large or not a supported file', content: Err },
				'403': { description: 'Not the account owner', content: Err },
				'409': { description: 'Library full', content: Err },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { query } = await this.getValidatedData<typeof this.schema>();
		const bucket = bucketOf(c);
		if (!bucket) return c.json({ success: false, error: 'storage_unavailable' }, 503);
		const userId = this.getUserId(c);
		const { ownerId, isOwner } = ownerOf(c, userId);
		if (!isOwner) return c.json({ success: false, error: 'forbidden' }, 403);
		const name = query.name.trim();
		if (!name || name.length > STUDIO_ASSET_LIMITS.maxNameChars) return c.json({ success: false, error: 'invalid_name' }, 400);
		const declared = Number(c.req.header('content-length'));
		if (Number.isFinite(declared) && declared > STUDIO_ASSET_LIMITS.maxAssetBytes) return c.json({ success: false, error: 'too_large' }, 400);
		const data = new Uint8Array(await c.req.arrayBuffer());
		if (data.byteLength === 0) return c.json({ success: false, error: 'empty' }, 400);
		if (data.byteLength > STUDIO_ASSET_LIMITS.maxAssetBytes) return c.json({ success: false, error: 'too_large' }, 400);
		const type = sniff(data);
		if (!type) return c.json({ success: false, error: 'unsupported_type' }, 400);
		const asset: StudioAsset = { id: newAssetId(), kind: type.kind, name, contentType: type.contentType, bytes: data.byteLength, createdAt: new Date().toISOString() };
		const full = (assets: StudioAsset[]) =>
			assets.length >= STUDIO_ASSET_LIMITS.maxAssets || assets.reduce((n, a) => n + a.bytes, 0) + asset.bytes > STUDIO_ASSET_LIMITS.maxTotalBytes;
		// Quota first, so a full library never stores the bytes at all
		if (full((await readAssets(bucket, ownerId)).assets)) return c.json({ success: false, error: 'library_full' }, 409);
		await bucket.put(assetKey(ownerId, asset.id), data, { httpMetadata: { contentType: type.contentType } });
		// The bytes are stored: every exit but success deletes them, so nothing is kept outside the index
		let outcome: 'added' | 'library_full' | 'busy' = 'busy';
		try {
			for (let attempt = 0; attempt < 5 && outcome === 'busy'; attempt++) {
				const { assets, etag } = await readAssets(bucket, ownerId);
				if (full(assets)) outcome = 'library_full';
				else if (await writeAssets(bucket, ownerId, [...assets, asset], etag)) outcome = 'added';
			}
		} finally {
			if (outcome !== 'added') await bucket.delete(assetKey(ownerId, asset.id));
		}
		if (outcome === 'added') {
			logger.info('[Studio] Asset added', { ownerId, assetId: asset.id, kind: asset.kind, bytes: asset.bytes });
			return c.json({ success: true, data: asset }, 201);
		}
		return outcome === 'library_full' ? c.json({ success: false, error: 'library_full' }, 409) : c.json({ success: false, error: 'busy' }, 503);
	}
}

export class StudioAssetGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Studio'],
			summary: 'Download a shared asset',
			request: { params: z.object({ assetId: Str({ description: 'Asset id' }) }) },
			responses: { '200': { description: 'The bytes' }, '404': { description: 'No such asset', content: Err } },
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const bucket = bucketOf(c);
		if (!bucket) return c.json({ success: false, error: 'storage_unavailable' }, 503);
		const { ownerId } = ownerOf(c, this.getUserId(c));
		const asset = (await readAssets(bucket, ownerId)).assets.find((a) => a.id === params.assetId);
		const obj = asset ? await bucket.get(assetKey(ownerId, asset.id)) : null;
		if (!asset || !obj) return c.json({ success: false, error: 'asset_not_found' }, 404);
		return new Response(obj.body, { headers: { 'content-type': asset.contentType, 'content-length': String(asset.bytes), 'cache-control': 'private, max-age=0' } });
	}
}

export class StudioAssetDelete extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Studio'],
			summary: 'Remove a shared asset',
			description: 'Also clears it from the brand kit (logo, intro, outro). Account owner only.',
			request: { params: z.object({ assetId: Str({ description: 'Asset id' }) }) },
			responses: { '200': { description: 'Removed', content: { 'application/json': { schema: z.object({ success: z.literal(true) }) } } }, '403': { description: 'Not the account owner', content: Err }, '404': { description: 'No such asset', content: Err } },
		},
		'required',
	);

	async handle(c: AppContext) {
		const { params } = await this.getValidatedData<typeof this.schema>();
		const bucket = bucketOf(c);
		if (!bucket) return c.json({ success: false, error: 'storage_unavailable' }, 503);
		const { ownerId, isOwner } = ownerOf(c, this.getUserId(c));
		if (!isOwner) return c.json({ success: false, error: 'forbidden' }, 403);
		for (let attempt = 0; attempt < 5; attempt++) {
			const { assets, etag } = await readAssets(bucket, ownerId);
			if (!assets.some((a) => a.id === params.assetId)) return c.json({ success: false, error: 'asset_not_found' }, 404);
			if (!(await writeAssets(bucket, ownerId, assets.filter((a) => a.id !== params.assetId), etag))) continue;
			await bucket.delete(assetKey(ownerId, params.assetId));
			const kit = await readBrandKit(bucket, ownerId);
			if (kit && (kit.logo === params.assetId || kit.intro === params.assetId || kit.outro === params.assetId)) {
				for (const k of ['logo', 'intro', 'outro'] as const) if (kit[k] === params.assetId) delete kit[k];
				await bucket.put(brandKitKey(ownerId), JSON.stringify(kit), { httpMetadata: { contentType: 'application/json' } });
			}
			return c.json({ success: true });
		}
		return c.json({ success: false, error: 'busy' }, 503);
	}
}
