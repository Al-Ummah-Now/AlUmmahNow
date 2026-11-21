import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { fromHono } from 'chanfana';
import { z } from 'zod';
import { AdminRoute } from '../src/base/AdminRoute';
import { Num, Str } from '../src/lib/chanfana-params';

/**
 * chanfana 3's fromHono() re-throws a failed request schema to app.onError. Every admin router has an
 * onError that answers unknown errors with 500, so AdminRoute answers the schema failure itself:
 * 400 with chanfana's issues, as chanfana 2 did.
 */
class Echo extends AdminRoute {
	schema = {
		request: {
			query: z.object({ limit: Num({ required: false }), q: Str({ required: false }) }),
			body: { content: { 'application/json': { schema: z.object({ n: z.number() }) } } },
		},
	};
	async handle(c: any) {
		const data = await this.getValidatedData<typeof this.schema>();
		return c.json({ success: true, n: data.body.n, limit: data.query.limit ?? null, q: data.query.q ?? null });
	}
}

function app() {
	const hono = new Hono();
	hono.onError((e, c) => c.json({ success: false, error: 'internal_error', thrown: String(e) }, 500));
	hono.use('*', async (c, next) => {
		c.set('auth' as never, { userId: 'usr_admin', email: 'a@test.local', roles: ['admin'], payload: {} } as never);
		await next();
	});
	fromHono(hono).post('/echo', Echo);
	return hono;
}

const post = (query: string, body: unknown) =>
	app().request(`/echo${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('admin request validation (chanfana 3)', () => {
	it('a body that fails the schema is a 400 with the issue paths, not the router onError 500', async () => {
		const res = await post('', { n: 'one' });
		assert.equal(res.status, 400);
		const body = (await res.json()) as { success: boolean; errors: Array<{ path: string[]; message: string }> };
		assert.equal(body.success, false);
		assert.deepEqual(body.errors[0].path, ['body', 'n']);
	});

	it('valid input reaches the handler, with query numbers coerced and optional helpers optional', async () => {
		const res = await post('?limit=5', { n: 1 });
		assert.equal(res.status, 200);
		assert.deepEqual(await res.json(), { success: true, n: 1, limit: 5, q: null });
	});

	it('a non-numeric query number is a 400', async () => {
		assert.equal((await post('?limit=abc', { n: 1 })).status, 400);
	});
});
