/** Every Worker whose 0% checks want X-Release-Check proves it: the entry wraps it last, the configs bind the version. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseJsonc } from '../jsonc.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const APPS = [
	{ app: 'web', entry: 'apps/web/worker.ts', config: 'apps/web/wrangler.production.jsonc' },
	{ app: 'admin-web', entry: 'apps/admin-web/worker.ts', config: 'apps/admin-web/wrangler.production.jsonc' },
	{ app: 'api-videos', entry: 'apps/api-videos/src/index.ts', config: 'apps/api-videos/wrangler.jsonc' },
];

describe('X-Release-Check wiring', () => {
	for (const { app, entry, config } of APPS) {
		it(`${app}: the default export answers through withReleaseCheck, last`, () => {
			const source = read(entry);
			if (entry.endsWith('worker.ts')) {
				assert.match(source, /const released: Handler = \{[^}]*fetch: async \(request, env, ctx\) => withReleaseCheck\(request, env, await worker\.fetch\(request, env, ctx\)\),\n\};\n\nexport default released;\n$/);
			} else {
				const exported = source.slice(source.indexOf('export default {'));
				const body = exported.slice(0, exported.indexOf('\n};'));
				assert.deepEqual([...body.matchAll(/\breturn (.+);/g)].map((m) => m[1]), ['withReleaseCheck(request, env, response)']);
			}
		});
		it(`${app}: production and stage bind the version`, () => {
			const parsed = parseJsonc(read(config)) as { version_metadata?: object; env: { stage: { version_metadata?: object } } };
			for (const block of [parsed, parsed.env.stage]) assert.deepEqual(block.version_metadata, { binding: 'CF_VERSION_METADATA' });
		});
	}

	it('every checked app is one of them', () => {
		const checked = new Set([...read('scripts/release/smoke.ts').matchAll(/await check\('[^']+', '([a-z-]+)'/g)].map((m) => m[1]));
		assert.deepEqual([...checked].sort(), APPS.map((a) => a.app).sort());
	});
});
