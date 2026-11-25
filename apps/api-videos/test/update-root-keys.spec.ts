/**
 * AUN-APP-UPDATES §9: every environment trusts the same root public key for each app repo. The list is read as
 * text, so a typo in the escaped JSON fails here and not as "no root key trusted" in production.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP_RELEASE_REPOS } from '@al-ummah/shared-types';
import { rootKeys } from '../src/lib/app-updates/releases';

const values = (file: string) =>
	[...readFileSync(join(__dirname, '..', file), 'utf8').matchAll(/"UPDATE_ROOT_KEYS":\s*("(?:[^"\\]|\\.)*")/g)].map((m) => JSON.parse(m[1]) as string);

describe('UPDATE_ROOT_KEYS', () => {
	it('is set in production, stage and QA, the same everywhere, with one key per repo', () => {
		const all = [...values('wrangler.jsonc'), ...values('wrangler.qa.jsonc')];
		assert.equal(all.length, 3, 'production, stage, QA');
		assert.equal(new Set(all).size, 1);
		const keys = rootKeys(all[0]);
		assert.deepEqual(Object.keys(keys).sort(), [...APP_RELEASE_REPOS].sort());
		for (const repo of APP_RELEASE_REPOS) assert.equal(keys[repo]?.length, 1, repo);
		assert.equal(new Set(Object.values(keys).flat()).size, APP_RELEASE_REPOS.length, 'a key per repo, never shared');
	});
});
