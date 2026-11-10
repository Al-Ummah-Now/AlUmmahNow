import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { z } from 'zod';
import { AuthenticatedRoute, PublicRoute } from '../src/base';
import { UploadInitiateEndpoint } from '../src/endpoints/video/uploadInitiate';

/**
 * A request that fails the endpoint's schema is a 400 with the issues, even
 * when the handler wraps validation in a catch-all that answers 500
 * (release E2E: upload initiate without fileSize/mimeType was a 500 ZodError).
 */

class CatchAll extends PublicRoute {
	schema = { request: { body: { content: { 'application/json': { schema: z.object({ n: z.number() }) } } } } };
	async handle(c: any) {
		try {
			const data = await this.getValidatedData<typeof this.schema>();
			return c.json({ success: true, n: data.body.n });
		} catch (error) {
			return c.json({ success: false, error: String(error) }, 500);
		}
	}
}

class OwnAnswer extends PublicRoute {
	schema = { request: { body: { content: { 'application/json': { schema: z.object({ n: z.number() }) } } } } };
	async handle(c: any) {
		try {
			await this.getValidatedData<typeof this.schema>();
			return c.json({ success: true });
		} catch {
			return c.json({ success: false, error: 'mine' }, 422);
		}
	}
}

class BrokenAfterValidation extends PublicRoute {
	schema = { request: { body: { content: { 'application/json': { schema: z.object({ n: z.number() }) } } } } };
	async handle(c: any) {
		try {
			await this.getValidatedData<typeof this.schema>();
			throw new Error('storage down');
		} catch {
			return c.json({ success: false }, 500);
		}
	}
}

function app(userId: string | null = 'usr_a') {
	const hono = new Hono();
	hono.onError((e: any, c) => c.json({ thrown: String(e?.stack ?? e) }, 500));
	hono.use('*', async (c, next) => {
		if (userId) c.set('auth' as never, { userId, email: `${userId}@test.local`, payload: {} } as never);
		await next();
	});
	const r = fromHono(hono);
	r.post('/catch-all', CatchAll);
	r.post('/own-answer', OwnAnswer);
	r.post('/broken', BrokenAfterValidation);
	r.post('/api/videos/upload/initiate', UploadInitiateEndpoint);
	return hono;
}

const post = (a: Hono, path: string, body: unknown, headers: Record<string, string> = {}) =>
	a.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

describe('request validation errors are 400, not 500', () => {
	it('a catch-all handler that answers 500 to a schema failure answers 400 with the issues', async () => {
		const res = await post(app(), '/catch-all', { n: 'one' });
		assert.equal(res.status, 400);
		const body = (await res.json()) as { success: boolean; errors: Array<{ path: unknown[] }> };
		assert.equal(body.success, false);
		assert.deepEqual(body.errors[0].path, ['body', 'n']);
	});

	it('valid input still reaches the handler', async () => {
		const res = await post(app(), '/catch-all', { n: 1 });
		assert.equal(res.status, 200);
	});

	it("a handler's own 4xx answer to a schema failure is kept", async () => {
		assert.equal((await post(app(), '/own-answer', {})).status, 422);
	});

	it('a 500 for a real failure after validation stays a 500', async () => {
		assert.equal((await post(app(), '/broken', { n: 1 })).status, 500);
	});

	it('upload initiate without fileSize and mimeType is a 400 naming both', async () => {
		const res = await post(app(), '/api/videos/upload/initiate', { title: 'x' }, { channelId: 'ch_1' });
		assert.equal(res.status, 400, await res.clone().text());
		const body = (await res.json()) as { errors: Array<{ path: string[] }> };
		const paths = body.errors.map((e) => e.path.join('.'));
		assert.ok(paths.includes('body.fileSize'), paths.join(','));
		assert.ok(paths.includes('body.mimeType'), paths.join(','));
	});

	it('authentication is still checked first', async () => {
		class Authed extends AuthenticatedRoute {
			async handle() {
				return new Response('ok');
			}
		}
		const hono = new Hono();
		hono.onError((e: any, c) => c.json({ error: e.message }, e.status ?? 500));
		fromHono(hono).post('/authed', Authed);
		assert.equal((await post(hono, '/authed', {})).status, 401);
	});
});
