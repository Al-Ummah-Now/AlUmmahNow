/**
 * Admin-API error ingestion Kids Mode stripping & route coverage tests (wiki E20 §4.3, S1).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { newErrorRef } from '@al-ummah/shared-types';
import { constrainBrowserEvents, errorsIngest, scrubKidsErrorPath } from '../src/endpoints/errors/ErrorsIngest';
import { sqliteD1 } from './d1-sqlite';

describe('admin-api ErrorsIngest Kids Mode suppression (S1)', () => {
  it('scrubs child-viewed /kids/watch/:id and /kids/paths/:slug paths', () => {
    assert.equal(scrubKidsErrorPath('https://videos.alummahnow.com/en/kids/watch/vid_secret99?t=10'), 'https://videos.alummahnow.com/en/kids/watch/:id?t=10');
    assert.equal(scrubKidsErrorPath('/ar/kids/paths/prophets-stories'), '/ar/kids/paths/:slug');
    assert.equal(scrubKidsErrorPath('/api/videos/vid_secret99/playback'), '/api/videos/:id/playback');
  });

  it('drops userId, clientKey, userAgent, and /kids/ video IDs when X-Kids-Mode: 1 is sent', async () => {
    const db = sqliteD1();
    const queued: unknown[] = [];
    const app = new Hono();
    app.post('/internal/errors', errorsIngest as never);

    const res = await app.request(
      '/internal/errors',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'internal-key',
          'X-Client-IP': '203.0.113.9',
          'X-Client-User-Id': 'usr_parent',
          'X-Client-User-Agent': 'Mozilla/5.0 KidsDevice',
          'X-Report-Source': 'browser',
          'X-Report-App': 'web',
          'X-Client-Page': 'https://videos.alummahnow.com/en/kids/watch/vid_secret99',
          'X-Kids-Mode': '1',
        },
        body: JSON.stringify({
          events: [
            {
              app: 'web',
              kind: 'unhandled',
              ref: newErrorRef(),
              name: 'TypeError',
              message: 'Player error',
              route: '/en/kids/watch/vid_secret99',
              release: 'rel1',
              occurredAt: new Date().toISOString(),
              userId: 'usr_parent',
              context: { kidsMode: true, path: '/en/kids/watch/vid_secret99' },
            },
          ],
        }),
      },
      {
        ENVIRONMENT: 'production',
        INTERNAL_API_KEY: 'internal-key',
        REPORTS_DB: db,
        ERRORS_QUEUE: {
          async send(msg: unknown) {
            queued.push(msg);
          },
        },
      } as never,
    );

    assert.equal(res.status, 202);
    assert.equal(queued.length, 1);
    const msg = queued[0] as {
      clientKey?: string;
      userAgent?: string;
      events: Array<{ userId?: string; route?: string; context?: Record<string, unknown> }>;
    };
    assert.equal(msg.clientKey, undefined);
    assert.equal(msg.userAgent, undefined);
    assert.equal(msg.events[0].userId, undefined);
    assert.equal(msg.events[0].route, '/en/kids/watch/:id');
    assert.equal(JSON.stringify(msg).includes('vid_secret99'), false);
    assert.equal(JSON.stringify(msg).includes('usr_parent'), false);
  });

  it('constrainBrowserEvents strips userId even if X-Kids-Mode header was omitted on a /kids/ event', () => {
    const out = constrainBrowserEvents(
      [
        {
          app: 'web',
          kind: 'unhandled',
          ref: newErrorRef(),
          name: 'Error',
          message: 'Oops',
          route: '/kids/watch/vid_abc',
          release: 'rel1',
          occurredAt: new Date().toISOString(),
          userId: 'usr_parent',
          context: { kidsMode: true },
        },
      ],
      { app: 'web', userId: 'usr_parent', environment: 'production' },
    );
    assert.equal(out.length, 1);
    assert.equal(out[0].userId, undefined);
    assert.equal(out[0].route, '/kids/watch/:id');
  });
});
