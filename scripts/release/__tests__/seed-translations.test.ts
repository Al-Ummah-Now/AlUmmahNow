/**
 * Translation store seeding (seed-translations.ts). Stage's store had never been
 * filled: GET /api/i18n/translations/{en,ar} answered 404 and every page logged
 * console errors. The release (stage) and the QA deploy must seed missing files
 * and check both locales are served; files edited in an environment are kept.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkTranslationsServed, computeChecksum, KEYS, planTranslationSeed, translationBucket } from '../seed-translations.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const NOW = '2026-11-09T00:00:00.000Z';
const DEFAULTS = { en: { common: { hello: 'Hello' } }, ar: { common: { hello: 'مرحبا' } } };
const file = (locale: string, version: string, hello: string) => JSON.stringify({ version, locale, updatedAt: 'x', translations: { common: { hello } } });

describe('planTranslationSeed', () => {
	it('seeds all three files into an empty store', () => {
		const writes = planTranslationSeed({ en: null, ar: null, metadata: null }, DEFAULTS, NOW);
		assert.deepEqual(writes.map((w) => w.key), [KEYS.en, KEYS.ar, KEYS.metadata]);
		const en = JSON.parse(writes[0].body);
		assert.deepEqual(en, { version: '1.0.0', locale: 'en', updatedAt: NOW, translations: DEFAULTS.en });
		const metadata = JSON.parse(writes[2].body);
		assert.equal(metadata.version, '1.0.0');
		assert.deepEqual(metadata.locales, ['en', 'ar']);
		assert.deepEqual(metadata.sections, ['common']);
		assert.equal(metadata.checksums.ar, computeChecksum(writes[1].body));
	});

	it('writes nothing when every file exists, even if it differs from the defaults', () => {
		const stored = { en: file('en', '1.0.7', 'Hi there'), ar: file('ar', '1.0.7', 'أهلا'), metadata: '{"version":"1.0.7"}' };
		assert.deepEqual(planTranslationSeed(stored, DEFAULTS, NOW), []);
	});

	it('keeps an edited locale and fills only the missing one, at the stored version', () => {
		const en = file('en', '1.2.3', 'Edited');
		const writes = planTranslationSeed({ en, ar: null, metadata: null }, DEFAULTS, NOW);
		assert.deepEqual(writes.map((w) => w.key), [KEYS.ar, KEYS.metadata]);
		assert.equal(JSON.parse(writes[0].body).version, '1.2.3');
		const metadata = JSON.parse(writes[1].body);
		assert.equal(metadata.checksums.en, computeChecksum(en), 'metadata describes the kept file, not the defaults');
	});

	it('matches the checksum admin-api writes', () => {
		const admin = readFileSync(resolve(ROOT, 'apps/admin-api/src/endpoints/i18n/translationsUpdate.ts'), 'utf8');
		assert.match(admin, /sum \+= data\.charCodeAt\(i\)/);
		assert.match(admin, /return `\$\{data\.length\}-\$\{sum\.toString\(16\)\}`/);
	});
});

describe('translationBucket', () => {
	it('resolves QA and stage to their own buckets, never production', () => {
		assert.equal(translationBucket('qa', ROOT), 'global-settings-qa');
		assert.equal(translationBucket('stage', ROOT), 'global-settings-stage');
	});
});

describe('checkTranslationsServed', () => {
	const respond = (status: number, body?: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

	it('passes when both locales answer 200 with translations', async () => {
		await checkTranslationsServed('https://api', (async () => respond(200, { result: { translations: {} } })) as typeof fetch);
	});

	it('fails naming each locale that answers 404', async () => {
		await assert.rejects(checkTranslationsServed('https://api', (async () => respond(404)) as typeof fetch), /en: HTTP 404; ar: HTTP 404/);
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

describe('pipelines seed the translation store', () => {
	it('release stage job seeds stage after deploying it', () => {
		const stage = jobSteps('.github/workflows/release.yml', 'stage');
		const seed = stage.indexOf('scripts/release/seed-translations.ts --env stage');
		assert.ok(seed >= 0, 'release.yml stage job must run seed-translations.ts --env stage');
		assert.ok(seed > stage.indexOf('pnpm release:promote --env stage'), 'seed after the stage deploy');
		assert.doesNotMatch(stage.slice(seed, stage.indexOf('\n', seed)), /--dry-run/);
	});

	it('production never seeds (its store is the live, edited copy)', () => {
		assert.doesNotMatch(jobSteps('.github/workflows/release.yml', 'production'), /seed-translations/);
	});

	it('QA deploy seeds QA after deploying the API', () => {
		const qa = jobSteps('.github/workflows/deploy.yml', 'deploy-qa');
		const seed = qa.indexOf('scripts/release/seed-translations.ts --env qa');
		assert.ok(seed >= 0, 'deploy.yml deploy-qa must run seed-translations.ts --env qa');
		assert.ok(seed > qa.indexOf('- name: Deploy API to QA'), 'seed after the API deploy');
	});
});
