import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { START_MAX_DELIVERIES } from '../src/jobs';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('wrangler configs match the job rules', () => {
	for (const file of ['wrangler.jsonc', 'wrangler.qa.jsonc']) {
		const text = read(file);
		it(`${file}: the transcode queue redelivers exactly as often as startRetry expects`, () => {
			const retries = [...text.matchAll(/"queue": "al-ummah-now-transcode[^"]*",[\s\S]*?"max_retries": (\d+)/g)].map((m) => Number(m[1]));
			assert.ok(retries.length > 0);
			for (const r of retries) assert.equal(r + 1, START_MAX_DELIVERIES);
		});
		it(`${file}: a deploy lets running transcodes finish (rollout grace period on every container)`, () => {
			const containers = (text.match(/"class_name": "Transcoder",\s*"image"/g) ?? []).length;
			const grace = [...text.matchAll(/"rollout_active_grace_period": (\d+)/g)].map((m) => Number(m[1]));
			assert.equal(grace.length, containers);
			for (const g of grace) assert.ok(g >= 1800, `grace ${g} s`);
		});
	}
});
