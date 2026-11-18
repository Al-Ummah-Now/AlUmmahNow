/**
 * The admin Videos list's titles: the stored title or nothing (never the id: the admin shows
 * "Untitled video"), plus the creator's per-language titles for the admin's own language.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hydrateVideos, titleLocalizedOf } from '../src/lib/admin/directory';
import { MemoryBucket } from './helpers';

describe('admin video titles', () => {
	it('keeps only non-empty string titles per language', () => {
		assert.deepEqual(titleLocalizedOf({ en: ' Lesson 1 ', ar: 'الدرس ١', fr: '', de: 3 }), { titleLocalized: { en: 'Lesson 1', ar: 'الدرس ١' } });
		assert.deepEqual(titleLocalizedOf(undefined), {});
		assert.deepEqual(titleLocalizedOf('x'), {});
		assert.deepEqual(titleLocalizedOf({ en: '  ' }), {});
	});

	it('a row has the stored title, the index title, or an empty title, never its id', async () => {
		const videos = new MemoryBucket();
		await videos.put('v1', JSON.stringify({ id: 'v1', title: 'Stored', titleLocalized: { ar: 'مخزّن' } }));
		await videos.put('v3', JSON.stringify({ id: 'v3' }));
		const rows = [
			{ id: 'v1', admin_title: 'Index', is_public: 1, is_hidden: 0, is_deleted: 0, views: 0 },
			{ id: 'v2', admin_title: 'Index only', is_public: 1, is_hidden: 0, is_deleted: 0, views: 0 },
			{ id: 'v3', admin_title: null, is_public: 1, is_hidden: 0, is_deleted: 0, views: 0 },
		];
		const out = await hydrateVideos({ videos } as never, rows as never);
		assert.deepEqual(out.map((v) => v.title), ['Stored', 'Index only', '']);
		assert.deepEqual(out[0]!.titleLocalized, { ar: 'مخزّن' });
		assert.equal('titleLocalized' in out[1]!, false);
	});

	it("the uploader is the account's name, else its email, else nothing (never the id)", async () => {
		const base = { is_public: 1, is_hidden: 0, is_deleted: 0, views: 0, owner_id: 'u' };
		const rows = [
			{ ...base, id: 'a', owner_name: 'Aisha Rahman', owner_email: 'aisha@example.com' },
			{ ...base, id: 'b', owner_name: null, owner_email: 'nameless@example.com' },
			{ ...base, id: 'c', owner_name: '', owner_email: null },
		];
		const out = await hydrateVideos({ videos: new MemoryBucket() } as never, rows as never);
		assert.deepEqual(out.map((v) => v.ownerName), ['Aisha Rahman', 'nameless@example.com', null]);
	});
});
