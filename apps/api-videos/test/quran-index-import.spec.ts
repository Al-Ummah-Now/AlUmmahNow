/**
 * readQuranIndex (TA-13): the matcher's index of the fresh copy, for Admin Tools, with the moment the
 * copy turns 7 days old; nothing once it is stale, missing or built from another version.
 * Synthetic words only: never Quran Foundation text (QF terms).
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QURAN_CURRENT_KEY, quranIndexKey } from '@al-ummah/shared-types';
import { clearQuranCopyCache, readQuranIndex } from '../src/lib/quran/copy';
import { MemoryBucket } from './helpers';

const VERSION = '20261120T000000Z';
const DAY = 24 * 60 * 60 * 1000;

function bucket(syncedAt: string, index: Record<string, unknown> | null = { v: 1, version: VERSION, syncedAt, words: 'ابج دهو زحط', locs: [1001001, 1001002, 1001003] }) {
	const b = new MemoryBucket();
	b.store.set(QURAN_CURRENT_KEY, JSON.stringify({ v: 1, version: VERSION, syncedAt, builtAt: syncedAt, surahs: 1, words: 3 }));
	if (index) b.store.set(quranIndexKey(VERSION), JSON.stringify(index));
	return b;
}

beforeEach(() => clearQuranCopyCache());

describe('readQuranIndex', () => {
	it('serves the fresh index with the moment its copy turns 7 days old', async () => {
		const syncedAt = new Date(Date.now() - 2 * DAY).toISOString();
		const out = await readQuranIndex(bucket(syncedAt) as never);
		assert.equal(out?.index.version, VERSION);
		assert.deepEqual(out?.index.locs, [1001001, 1001002, 1001003]);
		assert.equal(out?.expiresAt, new Date(Date.parse(syncedAt) + 7 * DAY).toISOString());
	});

	it('serves nothing from a copy over 7 days old', async () => {
		assert.equal(await readQuranIndex(bucket(new Date(Date.now() - 8 * DAY).toISOString()) as never), null);
	});

	it('serves nothing when the index is missing or belongs to another version', async () => {
		const syncedAt = new Date().toISOString();
		assert.equal(await readQuranIndex(bucket(syncedAt, null) as never), null);
		clearQuranCopyCache();
		assert.equal(await readQuranIndex(bucket(syncedAt, { v: 1, version: 'older', syncedAt, words: 'ابج', locs: [1001001] }) as never), null);
	});

	it('serves nothing without a bucket', async () => {
		assert.equal(await readQuranIndex(undefined), null);
	});
});
