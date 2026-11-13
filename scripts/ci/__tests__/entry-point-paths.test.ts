/**
 * Scripts must run from a checkout whose path has a space (#1108). `URL.pathname` keeps `%20`, so an
 * entry check built from it is false there and the script exits 0 without doing anything.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);

/** Entry checks and roots that break on a space: `.pathname` of an import.meta URL, or `file://${argv[1]}` */
const BAD = [
	/new URL\(import\.meta\.url\)\.pathname/,
	/new URL\([^)]*,\s*import\.meta\.url\)\.pathname/,
	/file:\/\/\$\{process\.argv\[1\]\}/,
];

function sources(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		const path = join(dir, name);
		if (statSync(path).isDirectory()) sources(path, out);
		else if (/\.(ts|mts|js|mjs)$/.test(name)) out.push(path);
	}
	return out;
}

describe('entry points in a path with a space', () => {
	it('runs a copied entry-point script from a directory whose name contains a space', () => {
		// realpath: macOS tmpdir() is behind the /var -> /private/var symlink, and node runs the real path
		const dir = mkdtempSync(join(realpathSync(tmpdir()), 'aun space '));
		try {
			const script = join(dir, 'playwright-outcomes.ts');
			copyFileSync(join(ROOT, 'scripts/ci/playwright-outcomes.ts'), script);
			const report = join(dir, 'report with space.json');
			writeFileSync(report, JSON.stringify({ suites: [{ title: 'a.spec.ts', file: 'a.spec.ts', specs: [{ title: 'runs', file: 'a.spec.ts', line: 3, tests: [{ projectName: 'chromium', status: 'expected' }] }] }] }));
			const out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', script, report, 'Space check'], { cwd: dir, encoding: 'utf8' });
			assert.match(out, /### Space check/);
			assert.match(out, /1 passed, 0 failed, 0 flaky, 0 skipped/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('no script decides its entry point or root from URL.pathname or file://${argv[1]}', () => {
		const offenders: string[] = [];
		for (const file of [...sources(join(ROOT, 'scripts')), ...sources(join(ROOT, 'packages'))]) {
			if (file === SELF) continue;
			readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
				if (BAD.some((re) => re.test(line))) offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
			});
		}
		assert.deepEqual(offenders, [], 'use fileURLToPath(import.meta.url) === resolve(process.argv[1]) and fileURLToPath(new URL(..., import.meta.url))');
	});
});
