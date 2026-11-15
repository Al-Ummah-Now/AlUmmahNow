/**
 * Institution mode (E19 19.9): one brand kit and asset library per account, read by the account's
 * channel teams, changed only by the owner.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BrandKitGet, BrandKitPut, StudioAssetCreate, StudioAssetDelete, StudioAssetGet, StudioAssetsList } from '../src/endpoints/studio/brandKit';
import { STUDIO_ASSET_LIMITS, sniff, studioPrefix } from '../src/lib/studio/brandKit';
import { buildApp } from './helpers';

class Bucket {
	store = new Map<string, { body: any; etag: string }>();
	n = 0;
	async get(key: string) {
		const v = this.store.get(key);
		return v ? { etag: v.etag, body: v.body, json: async () => JSON.parse(v.body) } : null;
	}
	async put(key: string, body: any, opts?: { onlyIf?: { etagMatches?: string; etagDoesNotMatch?: string } }) {
		const cur = this.store.get(key);
		if (opts?.onlyIf?.etagDoesNotMatch === '*' && cur) return null;
		if (opts?.onlyIf?.etagMatches && cur?.etag !== opts.onlyIf.etagMatches) return null;
		this.store.set(key, { body, etag: `e${++this.n}` });
		return { key };
	}
	async delete(keys: string | string[]) {
		for (const k of Array.isArray(keys) ? keys : [keys]) this.store.delete(k);
	}
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const MP4 = new Uint8Array([0, 0, 0, 0x18, ...[...'ftypisom'].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);

const app = (auth: { userId: string; channelOwnerId?: string }) =>
	buildApp((r) => {
		r.get('/api/studio/brand-kit', BrandKitGet);
		r.put('/api/studio/brand-kit', BrandKitPut);
		r.get('/api/studio/assets', StudioAssetsList);
		r.post('/api/studio/assets', StudioAssetCreate);
		r.get('/api/studio/assets/:assetId', StudioAssetGet);
		r.delete('/api/studio/assets/:assetId', StudioAssetDelete);
	}, auth);

const KIT = {
	name: { en: 'Masjid An-Nur', ar: 'مسجد النور' },
	colors: { primary: '#FFA037', secondary: '#093041', text: '#f7f1e8', background: '#093041' },
	lowerThird: { style: 'box', position: 'end' },
	watermark: 'bottom-end',
};
const putKit = (env: unknown, body: unknown, auth = { userId: 'owner' }) =>
	app(auth).request('/api/studio/brand-kit', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env as never);
const upload = (env: unknown, bytes: Uint8Array, name = 'Logo', auth = { userId: 'owner' }) =>
	app(auth).request(`/api/studio/assets?name=${encodeURIComponent(name)}`, { method: 'POST', body: bytes }, env as never);

describe('brand kit', () => {
	it('defaults until saved; the owner saves it; their channel team reads it but cannot change it', async () => {
		const env = { MEDIA_PRIVATE: new Bucket() };
		const first = (await (await app({ userId: 'owner' }).request('/api/studio/brand-kit', {}, env as never)).json()) as any;
		assert.equal(first.data.saved, false);
		assert.equal(first.data.canEdit, true);

		const logo = ((await (await upload(env, PNG)).json()) as any).data.id;
		const res = await putKit(env, { ...KIT, logo });
		assert.equal(res.status, 200);
		assert.equal(((await res.json()) as any).data.kit.colors.primary, '#ffa037');

		const member = { userId: 'editor', channelOwnerId: 'owner' };
		const read = (await (await app(member).request('/api/studio/brand-kit', {}, env as never)).json()) as any;
		assert.deepEqual([read.data.saved, read.data.canEdit, read.data.kit.logo, read.data.kit.name.ar], [true, false, logo, 'مسجد النور']);
		assert.equal((await putKit(env, KIT, member)).status, 403);
		assert.equal((await upload(env, PNG, 'x', member)).status, 403);
		// The member can use the owner's assets
		assert.equal((await app(member).request(`/api/studio/assets/${logo}`, {}, env as never)).status, 200);
	});

	it('refuses bad colours, unknown or wrong-kind assets, and unknown styles', async () => {
		const env = { MEDIA_PRIVATE: new Bucket() };
		const logo = ((await (await upload(env, PNG)).json()) as any).data.id;
		const cases: Array<[unknown, string]> = [
			[{ ...KIT, colors: { ...KIT.colors, primary: 'red' } }, 'colors.primary'],
			[{ ...KIT, logo: 'ffffffffffffffff' }, 'logo'],
			[{ ...KIT, intro: logo }, 'intro'],
			[{ ...KIT, lowerThird: { style: 'neon', position: 'end' } }, 'lowerThird'],
			[{ ...KIT, name: { en: 'x'.repeat(81) } }, 'name.en'],
		];
		for (const [body, field] of cases) {
			const res = await putKit(env, body);
			assert.equal(res.status, 400, field);
			assert.equal(((await res.json()) as any).field, field);
		}
	});
});

describe('shared assets', () => {
	it('types come from the bytes; limits hold; deleting clears the kit', async () => {
		assert.deepEqual(sniff(PNG), { kind: 'image', contentType: 'image/png' });
		assert.deepEqual(sniff(MP4), { kind: 'video', contentType: 'video/mp4' });
		assert.equal(sniff(new TextEncoder().encode('<svg onload=alert(1)>')), null);

		const env = { MEDIA_PRIVATE: new Bucket() };
		assert.equal((await upload(env, new TextEncoder().encode('<html>'))).status, 400);
		assert.equal((await upload(env, new Uint8Array())).status, 400);
		const intro = ((await (await upload(env, MP4, 'Intro')).json()) as any).data;
		assert.equal(intro.kind, 'video');
		await putKit(env, { ...KIT, intro: intro.id });
		const list = (await (await app({ userId: 'owner' }).request('/api/studio/assets', {}, env as never)).json()) as any;
		assert.deepEqual(list.data.assets.map((a: any) => a.name), ['Intro']);
		assert.equal(list.data.limits.maxAssets, STUDIO_ASSET_LIMITS.maxAssets);

		assert.equal((await app({ userId: 'owner' }).request(`/api/studio/assets/${intro.id}`, { method: 'DELETE' }, env as never)).status, 200);
		const kit = (await (await app({ userId: 'owner' }).request('/api/studio/brand-kit', {}, env as never)).json()) as any;
		assert.equal(kit.data.kit.intro, undefined);
		assert.equal([...env.MEDIA_PRIVATE.store.keys()].some((k) => k.includes(intro.id)), false);
	});

	it('the library is full at 50 assets', async () => {
		const env = { MEDIA_PRIVATE: new Bucket() };
		for (let i = 0; i < STUDIO_ASSET_LIMITS.maxAssets; i++) assert.equal((await upload(env, PNG, `L${i}`)).status, 201);
		const res = await upload(env, PNG, 'one more');
		assert.deepEqual([res.status, ((await res.json()) as any).error], [409, 'library_full']);
	});

	it('everything lives under the account prefix', () => {
		assert.equal(studioPrefix('usr_123'), 'studio/usr_123/');
		assert.throws(() => studioPrefix('../x'));
	});
});
