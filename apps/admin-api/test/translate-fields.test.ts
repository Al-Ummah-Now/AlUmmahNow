/**
 * /api/translate/fields: staff-only (content:translate) Translate for en/ar site fields. admin-api
 * checks the permission and the request, then api-videos runs it (internal key, staff id as actor);
 * its refusals (paused, budget, daily cap) pass through with their status.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import router, { validateFieldTranslate } from '../src/routers/translate.router';

function setup(roles: string[], answer: (body: any) => Response = (b) => Response.json({ success: true, data: { items: b.texts.map((t: string) => ({ text: `ar:${t}`, cached: false })), provider: 'workers-ai', machineTranslation: true, usage: { used: 1, limit: 500, resetsAt: 'x' } } })) {
  const calls: Array<{ path: string; key: string | null; actor: string | null; body: any }> = [];
  const env = {
    INTERNAL_API_KEY: 'k',
    VIDEOS: {
      async fetch(input: string, init?: RequestInit) {
        const body = JSON.parse(String(init?.body));
        calls.push({ path: new URL(input).pathname, key: new Headers(init?.headers).get('X-API-Key'), actor: new Headers(init?.headers).get('X-Admin-Actor'), body });
        return answer(body);
      },
    },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'staff-1', roles } as never);
    await next();
  });
  app.route('/api/translate', router);
  const post = (json: unknown) => app.request('/api/translate/fields', { method: 'POST', body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } }, env as never);
  return { post, calls };
}

describe('/api/translate/fields', () => {
  it('an admin gets suggestions from api-videos with the internal key and their id', async () => {
    const { post, calls } = setup(['admin']);
    const res = await post({ from: 'en', to: 'ar', texts: ['News', ''], field: 'categories.label' });
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.deepEqual(body.result.items.map((i: any) => i.text), ['ar:News', 'ar:']);
    assert.equal(calls[0]!.path, '/internal/translate/admin-fields');
    assert.equal(calls[0]!.key, 'k');
    assert.equal(calls[0]!.actor, 'staff-1');
    assert.deepEqual(calls[0]!.body, { userId: 'staff-1', from: 'en', to: 'ar', texts: ['News', ''], field: 'categories.label' });
  });

  it('a moderator is refused; nothing reaches api-videos', async () => {
    const { post, calls } = setup(['moderator']);
    const res = await post({ from: 'en', to: 'ar', texts: ['News'] });
    assert.equal(res.status, 403);
    assert.equal(calls.length, 0);
  });

  it('checks the request before calling', async () => {
    assert.deepEqual(validateFieldTranslate({ from: 'en', to: 'fr', texts: ['a'] }), { code: 'invalid_language' });
    assert.deepEqual(validateFieldTranslate({ from: 'ar', to: 'ar', texts: ['a'] }), { code: 'same_language' });
    assert.equal(validateFieldTranslate({ from: 'en', to: 'ar', texts: [] })?.code, 'too_many_texts');
    assert.equal(validateFieldTranslate({ from: 'en', to: 'ar', texts: ['x'.repeat(5001)] })?.code, 'text_too_long');
    assert.equal(validateFieldTranslate({ from: 'en', to: 'ar', texts: ['a'], field: 'Bad Field' })?.code, 'invalid_field');
    assert.deepEqual(validateFieldTranslate({ from: 'en', to: 'ar', texts: [1] }), { code: 'invalid_request' });
    assert.equal(validateFieldTranslate({ from: 'en', to: 'ar', texts: ['a'], field: 'email.subject' }), null);
    const { post, calls } = setup(['admin']);
    assert.equal((await post({ from: 'en', to: 'ar', texts: 'nope' })).status, 400);
    assert.equal(calls.length, 0);
  });

  it('api-videos refusals pass through; an unexpected failure is a 502', async () => {
    const limited = setup(['super_admin'], () => Response.json({ success: false, error: 'daily_limit', used: 500, limit: 500, resetsAt: 'x' }, { status: 429 }));
    const res = await limited.post({ from: 'ar', to: 'en', texts: ['أخبار'] });
    assert.equal(res.status, 429);
    const body = (await res.json()) as any;
    assert.equal(body.code, 'daily_limit');
    assert.equal(body.limit, 500);
    const paused = setup(['admin'], () => Response.json({ success: false, error: 'translation_paused' }, { status: 503 }));
    assert.equal((await paused.post({ from: 'ar', to: 'en', texts: ['أخبار'] })).status, 503);
    const broken = setup(['admin'], () => new Response('oops', { status: 500 }));
    const failed = await broken.post({ from: 'ar', to: 'en', texts: ['أخبار'] });
    assert.equal(failed.status, 502);
    assert.equal(((await failed.json()) as any).code, 'translation_failed');
  });
});
