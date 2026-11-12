import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mediaSmoke } from '../media-smoke.ts';

const fetchWith = (priv: number, pub: number) =>
	(async (url: string | URL | Request) => new Response('', { status: String(url).includes('/priv/') ? priv : pub })) as typeof fetch;
const cfWith = (apps: { name: string; state?: string }[]) => ({ request: async () => apps }) as never;

describe('media smoke', () => {
	it('passes when the Worker guards /priv/, R2 serves /pub/ and the transcoder exists', async () => {
		const r = await mediaSmoke('stage', { fetch: fetchWith(403, 404), cf: cfWith([{ name: 'al-ummah-now-media-stage-transcoder-stage', state: 'ready' }]) });
		assert.deepEqual(r.map((x) => x.ok), [true, true, true]);
	});
	it('fails when /priv/ reaches R2 (the route is gone), the host is down, or the container app is missing', async () => {
		const r = await mediaSmoke('production', { fetch: fetchWith(404, 522), cf: cfWith([]) });
		assert.deepEqual(r.map((x) => x.ok), [false, false, false]);
		assert.match(r[2].detail, /al-ummah-now-media-transcoder not found/);
	});
});
