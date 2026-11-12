/**
 * #982 one-off repair: legacy store files get an `overrides` list. Values the
 * repo itself once had are stale and follow the repo; other differing values
 * are admin edits and are kept.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planLocaleRepair, repairBucket, repairedMetadata, topVersion } from '../repair-translation-store.ts';
import { computeChecksum } from '../seed-translations.ts';

const DEFAULTS = { a11y: { goToHomePage: 'الأمة الآن - الصفحة الرئيسية' }, common: { save: 'حفظ', cancel: 'إلغاء' } };
const HISTORY = { 'a11y.goToHomePage': [JSON.stringify('الصفحة الرئيسية للأمة الآن'), JSON.stringify('الأمة الآن - الصفحة الرئيسية')], 'settings.needHelp': [JSON.stringify('هل تحتاج إلى مساعدة؟')] };
const NOW = '2026-11-12T00:00:00Z';

describe('planLocaleRepair', () => {
	const legacy = {
		version: '1.0.81',
		locale: 'ar',
		translations: {
			a11y: { goToHomePage: 'الصفحة الرئيسية للأمة الآن' }, // an old repo value: stale
			common: { save: 'احفظ الآن', cancel: 'إلغاء' }, // never in the repo: an admin edit
			settings: { needHelp: 'هل تحتاج إلى مساعدة؟' }, // removed from the repo: stale, dropped
		},
	};

	it('splits a legacy file into admin edits (kept) and stale keys (updated)', () => {
		const plan = planLocaleRepair(legacy, DEFAULTS, HISTORY, '1.0.82', NOW);
		assert.equal(plan.legacy, true);
		assert.deepEqual(plan.adminEdited.map((d) => d.path), ['common.save']);
		assert.deepEqual(plan.stale.map((d) => d.path), ['a11y.goToHomePage', 'settings.needHelp']);
		assert.deepEqual(plan.next, {
			version: '1.0.82',
			locale: 'ar',
			updatedAt: NOW,
			translations: { a11y: { goToHomePage: 'الأمة الآن - الصفحة الرئيسية' }, common: { save: 'احفظ الآن', cancel: 'إلغاء' } },
			overrides: ['common.save'],
		});
	});

	it('only refreshes a file that already has a list, and writes nothing when it is current', () => {
		const listed = { ...legacy, overrides: ['common.save'] };
		const plan = planLocaleRepair(listed, DEFAULTS, {}, '1.0.82', NOW);
		assert.deepEqual(plan.adminEdited.map((d) => d.path), ['common.save']);
		assert.equal((plan.next as any).translations.a11y.goToHomePage, DEFAULTS.a11y.goToHomePage);
		const current = { ...(plan.next as object) } as Record<string, unknown>;
		assert.equal(planLocaleRepair(current, DEFAULTS, {}, '1.0.83', NOW).next, null);
	});

	it('gives an up-to-date legacy file an empty list', () => {
		const plan = planLocaleRepair({ version: '1.0.0', locale: 'ar', translations: DEFAULTS }, DEFAULTS, {}, '1.0.1', NOW);
		assert.deepEqual(plan.stale, []);
		assert.deepEqual((plan.next as any).overrides, []);
	});
});

describe('repair helpers', () => {
	it('bumps from the highest stored version', () => {
		assert.equal(topVersion(['1.0.511', '1.0.81', undefined, 'x']), '1.0.511');
		assert.equal(topVersion([]), '1.0.0');
	});

	it('rewrites metadata checksums from the files as written', () => {
		const files = { en: JSON.stringify({ translations: { common: {} } }), ar: '{"translations":{}}' };
		const meta = repairedMetadata({ version: '1.0.0', checksums: { en: 'old' }, locales: ['en', 'ar'] }, files, '1.0.2', NOW);
		assert.equal(meta.version, '1.0.2');
		assert.deepEqual(meta.checksums, { en: computeChecksum(files.en), ar: computeChecksum(files.ar) });
		assert.deepEqual(meta.sections, ['common']);
	});

	it('resolves each environment to its own bucket', () => {
		const root = join(import.meta.dirname, '..', '..', '..');
		const buckets = (['qa', 'stage', 'production'] as const).map((e) => repairBucket(e, root));
		assert.equal(new Set(buckets).size, 3);
		assert.ok(readFileSync(join(root, 'apps/api-videos/wrangler.jsonc'), 'utf8').includes(buckets[2]));
	});
});
