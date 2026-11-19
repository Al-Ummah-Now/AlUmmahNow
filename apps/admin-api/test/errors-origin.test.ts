import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newErrorRef, scrubEvent, withErrorReporting, resetServerReporterState, type ErrorEventInput } from '@al-ummah/shared-types';
import { browserOrigin } from '../src/endpoints/errors/ErrorsIngest';
import { ingestErrorEvents } from '../src/lib/errors-store';
import { sqliteD1 } from './d1-sqlite';

const NOW = new Date('2026-11-19T12:00:00.000Z');

describe('error origin', () => {
  it('a browser report gets the origin the proxy saw, never the page claims, with no UA or IP kept', () => {
    const h: Record<string, string> = {
      'X-Client-User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      'X-Client-Page': 'https://alummahnow.net/ar/video/abc123XYZ?utm_source=newsletter&token=secret',
      'X-Client-Country': 'EG',
      'X-Report-App': 'web',
    };
    const o = browserOrigin((n) => h[n]);
    assert.deepEqual(o, { surface: 'web', source: 'campaign', campaign: 'newsletter', entry: '/:locale/video/:id', country: 'EG', device: 'phone' });
    assert.equal(browserOrigin(() => undefined), undefined);
  });

  it('a Worker error carries the request origin; ingest stores surface and source for the filter', async () => {
    resetServerReporterState();
    const real = globalThis.fetch;
    const posted: ErrorEventInput[] = [];
    globalThis.fetch = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      posted.push(...JSON.parse(String(init?.body)).events);
      return new Response(null, { status: 202 });
    }) as typeof fetch;
    try {
      const handler = withErrorReporting('api-videos', async () => {
        throw new Error('boom');
      });
      const waits: Promise<unknown>[] = [];
      await handler(
        new Request('https://videos.api.alummahnow.net/api/videos/abc123XYZ', { headers: { 'x-aun-client': 'aun-android/2.1.0 (Android 15)', referer: 'https://t.co/x' } }),
        { ERRORS_INGEST_URL: 'https://admin.api.test/internal/errors', INTERNAL_API_KEY: 'k', ENVIRONMENT: 'production', CF_VERSION_METADATA: { id: 'v1', tag: 'v2026.11.19' } } as never,
        { waitUntil: (p) => waits.push(p) },
      );
      await Promise.all(waits);
    } finally {
      globalThis.fetch = real;
    }
    const origin = posted[0]!.context!.origin!;
    assert.deepEqual(origin, { surface: 'android', app: 'aun-android', appVersion: '2.1.0', release: 'v2026.11.19', source: 'social:x', referrerHost: 't.co', entry: '/api/videos/:id', device: 'phone' });

    const db = sqliteD1();
    const e = scrubEvent({ ...posted[0], ref: newErrorRef(), occurredAt: NOW.toISOString() })!;
    await ingestErrorEvents(db as never, [e], { now: NOW, environment: 'production', random: () => 0 });
    const row = await db.prepare('SELECT origin_surface, origin_source, context_json FROM error_events').first<{ origin_surface: string; origin_source: string; context_json: string }>();
    assert.equal(row!.origin_surface, 'android');
    assert.equal(row!.origin_source, 'social:x');
    assert.equal(JSON.parse(row!.context_json).origin.country, undefined);
  });
});
