import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COST_INPUT_SQL, namesFor, percentile, SEARCH_D1, SLOWEST_STARTS_SQL, START_TIMES_SQL, startTimeSummary } from '../media-diagnostics.ts';
import { readFileSync } from 'node:fs';

test('production names are the al-ummah media resources only', () => {
	const n = namesFor('production');
	assert.equal(n.media, 'al-ummah-now-media');
	assert.equal(n.queue, 'al-ummah-now-transcode');
	assert.equal(n.dlq, 'al-ummah-now-transcode-dlq');
	assert.equal(n.videos, 'videos');
	assert.equal(n.admin, 'al-ummah-admin-api');
});

test('stage names carry the -stage suffix', () => {
	const n = namesFor('stage');
	assert.equal(n.media, 'al-ummah-now-media-stage');
	assert.equal(n.queue, 'al-ummah-now-transcode-stage');
	assert.equal(n.dlq, 'al-ummah-now-transcode-dlq-stage');
});

test('scrub drops signed URL queries and credentials', async () => {
	const { scrub } = await import('../scrub.ts');
	assert.equal(scrub('src https://vz-1.b-cdn.net/a/play_720p.mp4?token=abc&expires=1 ok'), 'src https://vz-1.b-cdn.net/a/play_720p.mp4?… ok');
	assert.doesNotMatch(scrub('Authorization: Bearer abc.def'), /abc/);
	assert.match(scrub('{"apiKey":"s3cr3t","videoId":"v1"}'), /"apiKey":"…","videoId":"v1"/);
	assert.equal(scrub('jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.sig'), 'jwt …jwt…');
});

test('start times: nearest-rank percentiles and a summary without ids', () => {
	assert.equal(percentile([], 50), null);
	assert.equal(percentile([1000, 2000, 3000, 4000], 50), 2000);
	assert.equal(percentile([1000, 2000, 3000, 4000], 95), 4000);
	assert.equal(startTimeSummary([4000, 1000, 2000, 3000]), '4 transcodes: p50 2.0 s, p95 4.0 s, fastest 1.0 s, slowest 4.0 s');
	assert.equal(startTimeSummary([]), 'no transcodes started in the last 30 days');
});

test('start times read only: one SELECT, first attempts, and the D1 ids are the api-videos search databases', () => {
	assert.match(START_TIMES_SQL, /^SELECT /);
	assert.match(SLOWEST_STARTS_SQL, /^SELECT [\s\S]* LIMIT 3$/);
	assert.doesNotMatch(SLOWEST_STARTS_SQL, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|title|user)/i);
	assert.doesNotMatch(START_TIMES_SQL, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|video_id|job_id)\b/i);
	const root = new URL('../../../apps/api-videos/', import.meta.url);
	const prod = readFileSync(new URL('wrangler.jsonc', root), 'utf8');
	assert.ok(prod.includes(SEARCH_D1.production) && prod.includes(SEARCH_D1.stage));
	assert.ok(readFileSync(new URL('wrangler.qa.jsonc', root), 'utf8').includes(SEARCH_D1.qa));
});

test('cost inputs are read-only aggregates without ids', () => {
	for (const sql of Object.values(COST_INPUT_SQL)) {
		assert.match(sql, /^SELECT /);
		assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|video_id|job_id|user)/i);
	}
});
