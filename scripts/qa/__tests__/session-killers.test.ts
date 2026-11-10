/**
 * Guard: an E2E test that ends sessions must never sign in as a shared account.
 *
 * Signing out goes through the auth server's /logout, which ends the account's
 * sign-in everywhere; revoking tokens, changing a password or a role does the
 * same. On a shared seed account (qa-admin, qa-creator...) that bounced every
 * other suite using it to the sign-in page mid-test (CMS QA E2E, 2026-11-10).
 * Such tests use their own run accounts (apps/web/e2e/test-utils/run-users.ts)
 * or a seeded account dedicated to that one spec.
 *
 * Rules, per test block of every apps/{web,admin-web}/e2e spec:
 * 1. a block with a session-ending action never references a shared seed account;
 * 2. admin-web: such a block that signs in through `accounts.admin` /
 *    `accounts.nonadmin` (or their storage states) must skip outside run mode
 *    (`test.skip(!RUN_ID, RUN_ACCOUNTS_ONLY)`): there they are the shared seeds.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SPEC_DIRS = ['apps/web/e2e', 'apps/admin-web/e2e'];

/** Sign-out / log-out (any app's goes through the auth server), revoke, password or role changes, session ends. */
// Actions only: a check that a sign-out button is visible ends nothing.
export const SESSION_ENDING =
	/\/logout\b|(logout|sign-?out)[\w-]*['"]\)\s*\.click|name:\s*\/?['"]?(log ?out|sign ?out)[^)]*\)\s*\.click|\b(log|sign)Out\w*\(|revoke|sign-out-all|(change|reset|update)[ -]?password|password[/-](change|reset)|\/test\/promote|promoteToAdmin|setRole|assignRole|terminate|end[ -]?session/i;

/** The shared seed accounts (apps/web/e2e/seed/seed-config.ts) and ways to reach them. */
export const SHARED_ACCOUNT =
	/qa-(superadmin|admin|moderator|creator|viewer)@|QA_SEED_PASSWORD|SEED_ACCOUNTS|seedPassword\(|SEED_VIEWER_EMAIL|accounts\.(moderator|superadmin)\b|QA_(ADMIN|MODERATOR|NONADMIN|SUPERADMIN|CREATOR|VIEWER)_EMAIL/;

/** admin-web accounts that are run accounts only in run mode. */
const RUN_MODE_ACCOUNT = /accounts\.(admin|nonadmin)\b|storageStatePath\(['"](admin|nonadmin)['"]\)/;
const RUN_MODE_SKIP = /test\.skip\(\s*!RUN_ID\s*,\s*RUN_ACCOUNTS_ONLY\s*\)/;

export interface Finding {
	file: string;
	test: string;
	reason: string;
}

/** Splits a spec into test blocks: each `test(` / `it(` call up to the next one. */
export function testBlocks(source: string): { title: string; body: string }[] {
	const starts = [...source.matchAll(/^[ \t]*(?:test|it)(?:\.(?:only|fixme|fail))?\(\s*(['"`])(.*?)\1/gm)];
	return starts.map((m, i) => ({
		title: m[2],
		body: source.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : source.length),
	}));
}

export function checkSpec(file: string, source: string): Finding[] {
	const findings: Finding[] = [];
	const admin = file.includes('admin-web/');
	for (const { title, body } of testBlocks(source)) {
		if (!SESSION_ENDING.test(body)) continue;
		const shared = SHARED_ACCOUNT.exec(body);
		if (shared) findings.push({ file, test: title, reason: `ends sessions but references the shared account ${shared[0]}` });
		else if (admin && RUN_MODE_ACCOUNT.test(body) && !RUN_MODE_SKIP.test(body)) {
			findings.push({ file, test: title, reason: 'ends sessions with accounts.admin/nonadmin without test.skip(!RUN_ID, RUN_ACCOUNTS_ONLY)' });
		}
	}
	return findings;
}

function specFiles(dir: string): string[] {
	const out: string[] = [];
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (name !== 'node_modules') out.push(...specFiles(path));
		} else if (name.endsWith('.spec.ts')) out.push(path);
	}
	return out;
}

describe('session-ending E2E tests never use shared accounts', () => {
	it('flags a sign-out as a shared seed account, and an admin sign-out without the run-mode skip', () => {
		const bad = `
test('signs out', async ({ page }) => {
  await uiLogin(page, { email: 'qa-admin@delivered.resend.dev', password: process.env.QA_SEED_PASSWORD });
  await page.getByTestId('logout-button').click();
});
test('reads only', async ({ page }) => {
  await uiLogin(page, accounts.moderator);
});`;
		assert.deepEqual(
			checkSpec('apps/web/e2e/x.spec.ts', bad).map((f) => f.test),
			['signs out'],
		);
		const admin = `
test('AUTH-x logs out', async ({ page }) => {
  await uiLogin(page, accounts.admin);
  await page.getByRole('button', { name: 'Log out' }).click();
});`;
		assert.equal(checkSpec('apps/admin-web/e2e/x.spec.ts', admin).length, 1);
		assert.equal(checkSpec('apps/admin-web/e2e/x.spec.ts', admin.replace('{\n', '{\n  test.skip(!RUN_ID, RUN_ACCOUNTS_ONLY);\n')).length, 0);
	});

	it('holds for every spec in the repository', () => {
		const findings = SPEC_DIRS.flatMap((d) => specFiles(join(ROOT, d))).flatMap((path) => checkSpec(relative(ROOT, path), readFileSync(path, 'utf8')));
		assert.deepEqual(findings, [], findings.map((f) => `${f.file} "${f.test}": ${f.reason}`).join('\n'));
	});
});
