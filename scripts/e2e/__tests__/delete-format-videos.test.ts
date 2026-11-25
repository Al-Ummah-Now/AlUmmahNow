import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QA_API, QA_AUTH, inPool, run, videoIdsOf } from '../delete-format-videos.ts';

const dir = mkdtempSync(join(tmpdir(), 'dfv-'));
const resources = join(dir, 'resources.txt');
const session = join(dir, 'session.json');
writeFileSync(resources, 'video vid-aaaaaa\nchannel ch-111111\nvideo vid-bbbbbb\nvideo vid-aaaaaa\nvideo ../bad\n');
writeFileSync(session, JSON.stringify({ refreshToken: 'refresh-secret', channelId: 'ch-111111' }));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('delete-format-videos', () => {
	it('reads the distinct video ids of the resources file and ignores the rest', () => {
		assert.deepEqual(videoIdsOf(readFileTextForTest()), ['vid-aaaaaa', 'vid-bbbbbb']);
	});

	it('renews the token, then trashes and deletes each video for good with the channel header', async () => {
		const calls: string[] = [];
		const logs: string[] = [];
		const fetchFake = (async (url: string, init?: RequestInit) => {
			calls.push(`${init?.method} ${url}`);
			if (url === `${QA_AUTH}/token`) return json({ access_token: 'access-1' });
			assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer access-1');
			assert.equal((init?.headers as Record<string, string>).channelId, 'ch-111111');
			return json({}, 200);
		}) as typeof fetch;
		const r = await run({ resources, session }, { fetch: fetchFake, log: (l) => logs.push(l) });
		assert.deepEqual(r, { deleted: 2, failed: 0, notTried: 0 });
		assert.ok(calls.includes(`DELETE ${QA_API}/api/videos/vid-aaaaaa`));
		assert.ok(calls.includes(`DELETE ${QA_API}/api/videos/vid-aaaaaa/permanent`));
		assert.ok(!logs.join('\n').includes('refresh-secret') && !logs.join('\n').includes('access-1'), 'no token in the log');
	});

	it('counts a 404 as deleted and any other refusal as failed', async () => {
		const fetchFake = (async (url: string, init?: RequestInit) => {
			if (url === `${QA_AUTH}/token`) return json({ access_token: 'a' });
			if (url.endsWith('vid-aaaaaa')) return json({}, 404);
			if (url.endsWith('vid-bbbbbb/permanent')) return json({}, 401);
			return json({}, 200);
		}) as typeof fetch;
		const r = await run({ resources, session }, { fetch: fetchFake, log: () => undefined });
		assert.equal(r.deleted, 1);
		assert.equal(r.failed, 1);
	});

	it('reports every video as left when the session cannot be renewed, without deleting', async () => {
		let deletes = 0;
		const fetchFake = (async (url: string, init?: RequestInit) => {
			if (init?.method === 'DELETE') deletes++;
			return json({}, 400);
		}) as typeof fetch;
		const logs: string[] = [];
		const r = await run({ resources, session }, { fetch: fetchFake, log: (l) => logs.push(l) });
		assert.deepEqual(r, { deleted: 0, failed: 2, notTried: 0 });
		assert.equal(deletes, 0);
		assert.match(logs.join('\n'), /could not be renewed/);
	});

	it('has nothing to do without recorded videos, and flags videos with no session file', async () => {
		const empty = join(dir, 'none.txt');
		writeFileSync(empty, '');
		assert.deepEqual(await run({ resources: empty, session }, { fetch, log: () => undefined }), { deleted: 0, failed: 0, notTried: 0 });
		assert.equal((await run({ resources, session: join(dir, 'missing.json') }, { fetch, log: () => undefined })).failed, 2);
	});

	it('stops starting work at the deadline and says how many it did not try', async () => {
		let started = 0;
		const left = await inPool([1, 2, 3, 4], 1, Date.now() - 1, async () => void started++);
		assert.equal(started, 0);
		assert.equal(left, 4);
	});
});

function readFileTextForTest(): string {
	return 'video vid-aaaaaa\nchannel ch-111111\nvideo vid-bbbbbb\nvideo vid-aaaaaa\nvideo ../bad\n';
}
