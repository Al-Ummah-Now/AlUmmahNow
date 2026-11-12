/**
 * #982: every deploy syncs the translation store with the repo. Repo text wins
 * for every key not on a file's overrides list, edits on the list are kept,
 * removed keys are dropped, missing files are seeded; a read-only check then
 * fails the deploy when the store still differs from the repo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { changedKeyCount, planTranslationSync, storeDrift } from '../sync-translations.ts';
import { KEYS } from '../seed-translations.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const NOW = '2026-11-12T00:00:00.000Z';
const DEFAULTS = {
	en: { common: { save: 'Save', home: 'Home (new)' } },
	ar: { common: { save: 'حفظ', home: 'الرئيسية (جديد)' } },
};
const locale = (l: string, translations: unknown, overrides?: string[], version = '1.0.5') =>
	JSON.stringify({ version, locale: l, updatedAt: 'x', translations, ...(overrides ? { overrides } : {}) });
const metadata = JSON.stringify({ version: '1.0.5', locales: ['en', 'ar'], checksums: {} });

describe('planTranslationSync', () => {
	it('updates a changed repo key, keeps the admin edit, drops a removed key', () => {
		const stored = {
			en: locale('en', { common: { save: 'Save it!', home: 'Home (old)', gone: 'Removed key' } }, ['common.save']),
			ar: locale('ar', DEFAULTS.ar, []),
			metadata,
		};
		const plan = planTranslationSync(stored, DEFAULTS, NOW);
		assert.deepEqual(plan.writes.map((w) => w.key), [KEYS.en, KEYS.metadata]);
		const en = JSON.parse(plan.writes[0].body);
		assert.deepEqual(en.translations, { common: { save: 'Save it!', home: 'Home (new)' } });
		assert.deepEqual(en.overrides, ['common.save']);
		assert.equal(en.version, '1.0.6');
		assert.equal(plan.updated, 2, 'home changed + gone dropped');
		assert.equal(plan.kept, 1);
		assert.deepEqual(plan.legacy, []);
		assert.deepEqual(storeDrift({ ...stored, en: plan.writes[0].body }, DEFAULTS), []);
	});

	it('writes nothing when the store already matches', () => {
		const stored = { en: locale('en', DEFAULTS.en, []), ar: locale('ar', DEFAULTS.ar, []), metadata };
		const plan = planTranslationSync(stored, DEFAULTS, NOW);
		assert.deepEqual(plan.writes, []);
		assert.equal(plan.updated, 0);
	});

	it('seeds missing files from the repo with an empty overrides list', () => {
		const plan = planTranslationSync({ en: null, ar: null, metadata: null }, DEFAULTS, NOW);
		const files = Object.fromEntries(plan.writes.map((w) => [w.key, w.body]));
		assert.deepEqual(Object.keys(files).sort(), [KEYS.ar, KEYS.en, KEYS.metadata].sort());
		assert.deepEqual(storeDrift({ en: files[KEYS.en], ar: files[KEYS.ar], metadata: files[KEYS.metadata] }, DEFAULTS), []);
		assert.equal(plan.updated, 4);
	});

	it('keeps every differing key of a legacy file and reports it', () => {
		const stored = { en: locale('en', { common: { save: 'Save it!', home: 'Home (new)' } }), ar: locale('ar', DEFAULTS.ar, []), metadata };
		const plan = planTranslationSync(stored, DEFAULTS, NOW);
		assert.deepEqual(plan.legacy, ['en']);
		assert.equal(JSON.parse(plan.writes[0].body).translations.common.save, 'Save it!');
		assert.deepEqual(JSON.parse(plan.writes[0].body).overrides, ['common.save']);
	});
});

describe('storeDrift (release smoke check)', () => {
	it('names a non-override key that differs, a stray key and a missing list', () => {
		const stored = {
			en: locale('en', { common: { save: 'Save', home: 'Home (old)', stray: 'x' } }, []),
			ar: locale('ar', DEFAULTS.ar),
			metadata,
		};
		const problems = storeDrift(stored, DEFAULTS);
		assert.equal(problems.length, 3);
		assert.match(problems[0], /en common\.home: store "Home \(old\)" != repo "Home \(new\)"/);
		assert.match(problems[1], /en common\.stray: not in the repo/);
		assert.match(problems[2], /ar\.json has no overrides list/);
	});

	it('accepts an override key that differs from the repo', () => {
		const stored = { en: locale('en', { common: { save: 'Save it!', home: 'Home (new)' } }, ['common.save']), ar: locale('ar', DEFAULTS.ar, []), metadata };
		assert.deepEqual(storeDrift(stored, DEFAULTS), []);
	});

	it('counts added, changed and removed keys', () => {
		assert.equal(changedKeyCount({ a: { x: 1, y: 2 } }, { a: { x: 1, y: 3, z: 4 } }), 2);
	});
});

/** The `run:` lines of the named job in a workflow file (2-space job keys). */
function jobSteps(path: string, job: string): string {
	const text = readFileSync(resolve(ROOT, path), 'utf8');
	const start = text.indexOf(`\n  ${job}:\n`);
	assert.ok(start >= 0, `${path} has no job ${job}`);
	const rest = text.slice(start + 1);
	const end = rest.slice(1).search(/\n  [\w-]+:\n/);
	return end < 0 ? rest : rest.slice(0, end + 1);
}

function assertSyncAfter(steps: string, env: string, after: string): void {
	const sync = steps.indexOf(`scripts/release/sync-translations.ts --env ${env}\n`);
	const check = steps.indexOf(`scripts/release/sync-translations.ts --env ${env} --check`);
	assert.ok(sync >= 0, `must run sync-translations.ts --env ${env}`);
	assert.ok(check > sync, `must check (--check) after syncing ${env}`);
	assert.ok(steps.indexOf(after) >= 0 && sync > steps.indexOf(after), `sync ${env} after: ${after}`);
	assert.doesNotMatch(steps, /seed-translations\.ts --env/);
}

describe('every deploy syncs and checks the translation store', () => {
	it('release: stage after its deploy', () => {
		assertSyncAfter(jobSteps('.github/workflows/release.yml', 'stage'), 'stage', 'pnpm release:promote --env stage');
	});

	it('release: production after its promote', () => {
		assertSyncAfter(jobSteps('.github/workflows/release.yml', 'production'), 'production', 'pnpm release:promote --env production');
	});

	it('QA deploy: after the API deploy', () => {
		assertSyncAfter(jobSteps('.github/workflows/deploy.yml', 'deploy-qa'), 'qa', '- name: Deploy API to QA');
	});
});
