import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildServerEvent,
  idsFromRoute,
  newErrorRef,
  reportServerError,
  resetServerReporterState,
  scrubContext,
  scrubEvent,
  withErrorReporting,
  workerNameFor,
  type ErrorEventInput,
} from '@al-ummah/shared-types';
import { breadcrumb, noteIds, noteUpstream, runWithErrorTrail } from '@al-ummah/shared-types/error-trail';
import { eventContext, ingestErrorEvents, listGroupEvents } from '../src/lib/errors-store';
import { sqliteD1 } from './d1-sqlite';

const NOW = new Date('2026-11-18T12:00:00.000Z');

describe('error context: scrub', () => {
  it('keeps ids, upstream, job and breadcrumbs; drops anything else', () => {
    const c = scrubContext({
      worker: 'videos',
      videoId: 'vid_abc123',
      channelId: 'bad id with spaces',
      upstream: { service: 'video.bunnycdn.com', status: 503, route: '/library/1/videos/abc?token=x' },
      job: { queue: 'al-ummah-now-videos', id: 'msg-1', attempt: 3, secret: 'x' },
      breadcrumbs: [{ at: NOW.toISOString(), kind: 'fetch', message: 'GET auth for someone@example.com → 500' }, { kind: 'x' }],
      email: 'a@b.co',
    });
    assert.deepEqual(c, {
      worker: 'videos',
      videoId: 'vid_abc123',
      upstream: { service: 'video.bunnycdn.com', status: 503, route: '/library/1/videos/abc' },
      breadcrumbs: [{ at: NOW.toISOString(), kind: 'fetch', message: 'GET auth for [email] → 500' }],
      job: { queue: 'al-ummah-now-videos', id: 'msg-1', attempt: 3 },
    });
  });

  it('scrubEvent carries the context and drops an upstream without a service', () => {
    const e = scrubEvent({ app: 'api-videos', kind: 'http', ref: newErrorRef(), message: 'HTTP 502', context: { upstream: { service: 'not a host!', status: 502 }, videoId: 'abcdef1' } });
    assert.deepEqual(e?.context, { videoId: 'abcdef1' });
  });

  it('caps the breadcrumb trail at the last 12', () => {
    const crumbs = Array.from({ length: 20 }, (_, i) => ({ at: NOW.toISOString(), kind: 'step', message: `step ${i}` }));
    const c = scrubContext({ breadcrumbs: crumbs });
    assert.equal(c?.breadcrumbs?.length, 12);
    assert.equal(c?.breadcrumbs?.[11]?.message, 'step 19');
  });
});

describe('error context: ids and worker names', () => {
  it('reads video and channel ids from routes', () => {
    assert.deepEqual(idsFromRoute('/api/videos/aB3dEf9hiJ/comments'), { videoId: 'aB3dEf9hiJ' });
    assert.deepEqual(idsFromRoute('/ar/video/aB3dEf9hiJ?t=3'), { videoId: 'aB3dEf9hiJ' });
    assert.deepEqual(idsFromRoute('/api/channels/ch_123456/members'), { channelId: 'ch_123456' });
    assert.deepEqual(idsFromRoute('/api/videos/upload/initiate'), {});
    assert.deepEqual(idsFromRoute(undefined), {});
  });

  it('names the deployed Worker of each app (matches the wrangler configs)', () => {
    const root = join(process.cwd(), '..');
    const nameIn = (file: string, env?: string) => {
      const text = readFileSync(join(root, file), 'utf8');
      if (!env) return /"name":\s*"([^"]+)"/.exec(text)?.[1];
      const block = text.slice(text.indexOf(`"${env}": {`));
      return /"name":\s*"([^"]+)"/.exec(block)?.[1];
    };
    assert.equal(workerNameFor('api-videos', 'production'), nameIn('api-videos/wrangler.jsonc'));
    assert.equal(workerNameFor('api-videos', 'stage'), nameIn('api-videos/wrangler.jsonc', 'stage'));
    assert.equal(workerNameFor('admin-api', 'production'), nameIn('admin-api/wrangler.jsonc'));
    assert.equal(workerNameFor('admin-api', 'qa'), nameIn('admin-api/wrangler.qa.jsonc'));
    assert.equal(workerNameFor('processor', 'production'), nameIn('processor/wrangler.jsonc'));
    assert.equal(workerNameFor('websocket', 'production'), nameIn('websocket-server/wrangler.jsonc'));
    assert.equal(workerNameFor('web', 'production'), nameIn('web/wrangler.production.jsonc'));
    assert.equal(workerNameFor('web', 'qa'), nameIn('web/wrangler.qa.jsonc'));
    assert.equal(workerNameFor('admin-web', 'production'), nameIn('admin-web/wrangler.production.jsonc'));
    assert.equal(workerNameFor('web', 'development'), undefined);
  });
});

describe('error context: request trail', () => {
  it('records fetches, the failed upstream call, ids and steps into the reported event', async () => {
    resetServerReporterState();
    const realFetch = globalThis.fetch;
    const posted: ErrorEventInput[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/internal/errors')) {
        posted.push(...JSON.parse(String(init?.body)).events);
        return new Response(null, { status: 202 });
      }
      return new Response('x', { status: url.includes('bunny') ? 503 : 200 });
    }) as typeof fetch;
    try {
      const env = { ERRORS_INGEST_URL: 'https://admin.api.test/internal/errors', INTERNAL_API_KEY: 'k', ENVIRONMENT: 'production' };
      const handler = withErrorReporting('api-videos', async (req: Request) => {
        noteIds({ channelId: 'ch_abcdef' });
        breadcrumb('step', 'loading the video');
        await fetch('https://auth.alummahnow.net/userinfo');
        const r = await fetch('https://video.bunnycdn.com/library/123/videos/aB3dEf9hiJ');
        if (r.status >= 500) throw new Error('Bunny refused');
        return new Response('ok');
      });
      const waits: Promise<unknown>[] = [];
      const res = await handler(new Request('https://videos.api.alummahnow.net/api/videos/aB3dEf9hiJ'), env as never, { waitUntil: (p) => waits.push(p) });
      await Promise.all(waits);
      assert.equal(res.status, 500);
      assert.equal(posted.length, 1);
      const c = posted[0]!.context!;
      assert.equal(c.videoId, 'aB3dEf9hiJ');
      assert.equal(c.channelId, 'ch_abcdef');
      assert.deepEqual(c.upstream, { service: 'video.bunnycdn.com', status: 503, route: '/library/:id/videos/:id' });
      assert.deepEqual(
        c.breadcrumbs!.map((b) => `${b.kind} ${b.message}`),
        ['step loading the video', 'fetch GET auth.alummahnow.net/userinfo → 200', 'fetch GET video.bunnycdn.com/library/:id/videos/:id → 503'],
      );
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('a queue job carries its queue, message id and attempt; noteUpstream names a binding', () => {
    const env = { ENVIRONMENT: 'production' };
    const e = runWithErrorTrail({ job: { queue: 'al-ummah-now-videos', id: 'm-1', attempt: 2 } }, () => {
      noteUpstream('REPORTS_DB', 500, '/d1/query');
      return buildServerEvent('processor', new Error('boom'), {}, env);
    });
    assert.deepEqual(e?.context?.job, { queue: 'al-ummah-now-videos', id: 'm-1', attempt: 2 });
    assert.equal(e?.context?.upstream?.service, 'REPORTS_DB');
  });

  it('outside a trail the caller context is used as is, and reporting never throws', () => {
    const e = buildServerEvent('scheduler', new Error('x'), { context: { job: { id: 'cron:publish' } } }, {});
    assert.deepEqual(e?.context, { job: { id: 'cron:publish' } });
    assert.match(reportServerError('scheduler', {} as never, undefined, new Error('y'), { context: { videoId: 'bad id' } }), /^ERR-/);
  });
});

describe('error context: ingest', () => {
  it('stores the context with the worker name and route ids added', async () => {
    const db = sqliteD1();
    const e = scrubEvent({
      app: 'api-videos',
      kind: 'http',
      ref: newErrorRef(),
      message: 'HTTP 502',
      route: '/api/videos/aB3dEf9hiJ/comments',
      method: 'POST',
      status: 502,
      occurredAt: NOW.toISOString(),
      context: { upstream: { service: 'auth', status: 500 }, job: { attempt: 1 } },
    })!;
    const out = await ingestErrorEvents(db as never, [e], { now: NOW, environment: 'production', random: () => 0 });
    assert.equal(out.accepted, 1);
    const group = (await db.prepare('SELECT id FROM error_groups').first<{ id: string }>())!;
    const [row] = await listGroupEvents(db as never, group.id);
    assert.deepEqual(JSON.parse(row!.context_json!), {
      upstream: { service: 'auth', status: 500 },
      job: { attempt: 1 },
      worker: 'videos',
      videoId: 'aB3dEf9hiJ',
    });
  });

  it('an event without anything to add stores no context', () => {
    assert.equal(eventContext({ app: 'web', route: '/en' }, 'development'), undefined);
  });
});
