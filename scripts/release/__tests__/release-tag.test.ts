import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseReleaseTag, previousTag } from '../release-tag.ts';

describe('release tag names', () => {
	it('accepts a dated tag and a later same-day tag', () => {
		assert.deepEqual(parseReleaseTag('v2026.11.08'), { tag: 'v2026.11.08', date: '2026-11-08', n: 1 });
		assert.deepEqual(parseReleaseTag('v2026.11.08.2'), { tag: 'v2026.11.08.2', date: '2026-11-08', n: 2 });
		assert.equal(parseReleaseTag('v2028.02.29')?.date, '2028-02-29');
	});

	it('rejects other names, impossible dates and .0/.1/leading zeros', () => {
		for (const bad of ['2026.11.08', 'v2026.11.8', 'v26.11.08', 'v2026.13.01', 'v2026.02.30', 'v2027.02.29', 'v2026.11.08.0', 'v2026.11.08.1', 'v2026.11.08.02', 'v2026.11.08-rc1', 'v1.2.3', 'v2026.11.08.2.1']) {
			assert.equal(parseReleaseTag(bad), null, bad);
		}
	});
});

describe('previous release tag', () => {
	const tags = ['v2026.11.08', 'v2026.11.08.2', 'v2026.11.08.10', 'v2026.10.31', 'v1.0.0', 'not-a-tag'];

	it('orders by date then sequence numerically', () => {
		assert.equal(previousTag(tags, 'v2026.11.08.10'), 'v2026.11.08.2');
		assert.equal(previousTag(tags, 'v2026.11.08.2'), 'v2026.11.08');
		assert.equal(previousTag(tags, 'v2026.11.08'), 'v2026.10.31');
		assert.equal(previousTag(tags, 'v2026.11.09'), 'v2026.11.08.10');
	});

	it('is null for the first release or an invalid tag', () => {
		assert.equal(previousTag(tags, 'v2026.10.31'), null);
		assert.equal(previousTag(tags, 'oops'), null);
	});
});

describe('release-tag check (CLI)', () => {
	const script = resolve(import.meta.dirname, '../release-tag.ts');
	const run = (cwd: string, ...args: string[]) => {
		try {
			return { code: 0, out: execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', script, ...args], { cwd, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, GITHUB_OUTPUT: '' } }) };
		} catch (e) {
			const err = e as { status: number; stderr: string };
			return { code: err.status, out: err.stderr };
		}
	};

	it('passes a tag on main and refuses a commit that is not on main or a bad name', () => {
		const dir = mkdtempSync(join(tmpdir(), 'release-tag-'));
		try {
			const g = (...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
			g('init', '-q', '-b', 'main');
			g('config', 'user.email', 't@example.com');
			g('config', 'user.name', 't');
			writeFileSync(join(dir, 'f'), '1');
			g('add', 'f');
			g('commit', '-qm', 'one');
			const onMain = g('rev-parse', 'HEAD');
			g('tag', 'v2026.11.01');
			g('update-ref', 'refs/remotes/origin/main', onMain);
			g('checkout', '-qb', 'feature');
			writeFileSync(join(dir, 'f'), '2');
			g('commit', '-qam', 'two');
			const offMain = g('rev-parse', 'HEAD');

			const ok = run(dir, 'check', 'v2026.11.08', onMain);
			assert.equal(ok.code, 0, ok.out);
			assert.match(ok.out, /previous release: v2026\.11\.01/);

			const off = run(dir, 'check', 'v2026.11.08', offMain);
			assert.equal(off.code, 1);
			assert.match(off.out, /not on main/);

			const bad = run(dir, 'check', 'v2026.11.8', onMain);
			assert.equal(bad.code, 1);
			assert.match(bad.out, /not a release tag/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
