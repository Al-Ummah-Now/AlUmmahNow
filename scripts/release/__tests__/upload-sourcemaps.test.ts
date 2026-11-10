import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findSourceMaps, objectKey, parseArgs, uploadSourceMaps } from '../upload-sourcemaps.ts';

function assets() {
	const dir = mkdtempSync(join(tmpdir(), 'maps-'));
	mkdirSync(join(dir, '_next/static/chunks/app'), { recursive: true });
	writeFileSync(join(dir, '_next/static/chunks/app/page-abc.js'), '1');
	writeFileSync(join(dir, '_next/static/chunks/app/page-abc.js.map'), '{"version":3}');
	writeFileSync(join(dir, '_next/static/chunks/main-1.js.map'), '{"version":3}');
	writeFileSync(join(dir, 'favicon.ico'), 'x');
	return dir;
}

describe('upload-sourcemaps', () => {
	it('finds only browser chunk maps and keys them like admin-api', () => {
		const dir = assets();
		const files = findSourceMaps(dir);
		assert.equal(files.length, 2);
		assert.equal(objectKey('web', 'abc123def456', dir, files[0]), 'web/abc123def456/_next/static/chunks/app/page-abc.js.map');
	});

	it('uploads to the environment bucket, then deletes the maps from the assets', async () => {
		const dir = assets();
		const puts: string[] = [];
		const r = await uploadSourceMaps({ env: 'qa', app: 'web', release: 'abc123def456', dir }, { token: 't', accountId: 'a', put: async (_t, _a, bucket, key) => void puts.push(`${bucket}/${key}`) });
		assert.equal(r.uploaded, 2);
		assert.ok(puts.includes('al-ummah-now-sourcemaps-qa/web/abc123def456/_next/static/chunks/main-1.js.map'));
		assert.equal(existsSync(join(dir, '_next/static/chunks/main-1.js.map')), false);
		assert.equal(existsSync(join(dir, '_next/static/chunks/app/page-abc.js')), true);
	});

	it('validates arguments', () => {
		assert.throws(() => parseArgs(['--env', 'prod', '--app', 'web', '--release', 'x']), /--env/);
		assert.throws(() => parseArgs(['--env', 'qa', '--app', 'cms', '--release', 'x']), /--app/);
		assert.deepEqual(parseArgs(['--env', 'qa', '--app', 'admin-web', '--release', 'abc']).dir, 'apps/admin-web/.open-next/assets');
	});
});
