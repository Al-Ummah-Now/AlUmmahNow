/**
 * Release e2e specs that sign up or sign in never record a trace or a video.
 *
 * The password goes into the page with fillSecret (so it stays out of step
 * titles), but a Playwright trace still holds the evaluate argument and the
 * form POST body, and a video shows the typed screens. With `retries: 1` and
 * `trace: 'retain-on-failure'`, any signed-in spec that fails once and passes
 * on retry keeps a trace with the password. The artifact scanner then removes
 * the report and fails the release job (nothing leaks, but every PR is red).
 *
 * Rule (see apps/web/e2e/release/secret-fill.ts): a spec that reaches the
 * sign-in helpers (imports a module that types a secret, directly or through
 * another helper, or uses TEST_PASSWORD) has a top-level
 * `test.use({ trace: 'off', ... })`, and no release config turns video on.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const RELEASE = join(ROOT, 'apps', 'web', 'e2e', 'release');
const CONFIGS = ['playwright.release.config.ts', 'playwright.release-prod.config.ts'].map((f) => join(ROOT, 'apps', 'web', f));

const read = (file: string) => readFileSync(file, 'utf8');
const localImports = (source: string) => [...source.matchAll(/from '\.\/([\w.-]+)'/g)].map((m) => m[1].replace(/\.ts$/, ''));

/** Helper modules (non-spec files) that type a secret, directly or through another helper. */
function secretHelpers(): Set<string> {
	const helpers = readdirSync(RELEASE).filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')).map((f) => f.replace(/\.ts$/, ''));
	const sources = new Map(helpers.map((h) => [h, read(join(RELEASE, `${h}.ts`))]));
	const typing = new Set(['secret-fill']);
	for (const [h, s] of sources) if (/\bfillSecret\(|\bTEST_PASSWORD\b/.test(s) && h !== 'targets') typing.add(h);
	let grew = true;
	while (grew) {
		grew = false;
		for (const [h, s] of sources) {
			if (!typing.has(h) && localImports(s).some((i) => typing.has(i))) {
				typing.add(h);
				grew = true;
			}
		}
	}
	return typing;
}

export function signsIn(source: string, helpers: Set<string>): boolean {
	return /\bTEST_PASSWORD\b|\bfillSecret\(/.test(source) || localImports(source).some((i) => helpers.has(i));
}

export function tracesOff(source: string): boolean {
	return /^test\.use\(\{[^}]*\btrace:\s*'off'[^}]*\}\);?$/m.test(source);
}

describe('release specs that sign in record no trace or video', () => {
	const helpers = secretHelpers();

	it('finds the sign-in helpers', () => {
		assert.ok(helpers.has('web-session'), [...helpers].join());
		assert.ok(helpers.has('secret-fill'));
	});

	it('every spec that signs up or in turns traces off at the top level', () => {
		const specs = readdirSync(RELEASE).filter((f) => f.endsWith('.spec.ts'));
		const signing = specs.filter((f) => signsIn(read(join(RELEASE, f)), helpers));
		assert.ok(signing.length >= 10, `expected the signed-in specs, found ${signing.length}`);
		const missing = signing.filter((f) => !tracesOff(read(join(RELEASE, f))));
		assert.deepEqual(missing, [], `add test.use({ trace: 'off', video: 'off' }) after the imports of: ${missing.join(', ')}`);
	});

	it('no release config records video', () => {
		for (const config of CONFIGS) {
			const video = read(config).match(/\bvideo:\s*'([\w-]+)'/g) ?? [];
			assert.ok(video.every((v) => v.includes("'off'")), `${config}: ${video.join(', ')}`);
		}
	});

	it('the rule itself: a nested or commented-out test.use does not count', () => {
		assert.equal(tracesOff("test.use({ trace: 'off' });"), true);
		assert.equal(tracesOff("test.use({ trace: 'off', video: 'off' });"), true);
		assert.equal(tracesOff("  test.use({ trace: 'off' });"), false);
		assert.equal(tracesOff("// test.use({ trace: 'off' });"), false);
		assert.equal(signsIn("import { signUpOnWeb } from './web-session';", new Set(['web-session'])), true);
		assert.equal(signsIn("import { target } from './targets';", new Set(['web-session'])), false);
	});
});
