/**
 * Kids Mode route policy completeness & runtime enforcement tests (wiki E20 §4.2–§4.3; B2 & B3).
 *
 * - Fails CI if ANY served non-internal/non-webhook route lacks an entry in KIDS_ROUTE_POLICIES.
 * - Verifies `kidsModeMiddleware` against the real worker:
 *   - blocks social/library/devices/notifications/upload/unlisted-search routes with `403 kids_mode_restricted`
 *   - blocks non-allowlisted video reads (`403 kids_mode_restricted`)
 *   - allows allowlisted video reads and strips `playerLinks`/`endScreen`/`cards` while forcing
 *     `commentSettings: 'off'` and `autoplayNext: false`
 *   - suppresses `viewerKey`/`discovery_viewers` and queue telemetry writes on `POST /api/videos/:id/view`
 *   - short-circuits `PUT /api/watch-state/:videoId`, `POST /api/watch-history*`, and
 *     `POST /api/analytics/events` with zero D1/R2/Queue writes.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import {
  KIDS_DECISION_IDS,
  KIDS_SESSION_COOKIE,
  forgetFeatureSwitches,
  kidsCanTurnOnHook,
  writeFeatureSwitch,
} from '@al-ummah/shared-types';
import worker, { listServedRoutes } from '../src/index';
import { __resetClientForTests } from '../src/lib/openauth-client';
import { clearRevocationCache } from '../src/lib/token-revocation';
import { KIDS_ROUTE_POLICIES, matchKidsRoutePolicy } from '../src/lib/kids/route-policy';
import { signKidsSessionToken } from '../src/lib/kids/parental-controls';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const ISSUER = 'https://auth.example.com';

const servedNonInternal = () =>
  listServedRoutes().filter(
    (r) =>
      r.method !== 'ALL' &&
      r.method !== 'OPTIONS' &&
      !r.path.startsWith('/internal/') &&
      !r.path.startsWith('/webhooks/'),
  );

const keyOf = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

describe('Kids Mode route classification completeness', () => {
  it('classifies every served non-internal route in KIDS_ROUTE_POLICIES', () => {
    const mapped = new Set(KIDS_ROUTE_POLICIES.map(keyOf));
    const missing = [...new Set(servedNonInternal().map(keyOf).filter((k) => !mapped.has(k)))];
    assert.deepEqual(
      missing,
      [],
      'Every new api-videos route must have an explicit KIDS_ROUTE_POLICIES classification',
    );
  });

  it('has no stale entries in KIDS_ROUTE_POLICIES', () => {
    const served = new Set(servedNonInternal().map(keyOf));
    const stale = [...new Set(KIDS_ROUTE_POLICIES.map(keyOf).filter((k) => !served.has(k)))];
    assert.deepEqual(stale, []);
  });

  it('matches versioned /api/v1/* paths identically to /api/*', () => {
    const unversioned = matchKidsRoutePolicy('PUT', '/api/watch-state/vid_123');
    const versioned = matchKidsRoutePolicy('PUT', '/api/v1/watch-state/vid_123');
    assert.equal(unversioned?.entry.mode, 'suppress_attribution');
    assert.equal(versioned?.entry.mode, 'suppress_attribution');
  });
});

describe('Kids Mode middleware & telemetry suppression on the real worker', () => {
  let realFetch: typeof fetch;
  let signJwt: (sub?: string) => Promise<string>;
  let db: SqliteD1;
  let queueMessages: unknown[];
  let env: Record<string, unknown>;
  let kidsToken: string;

  beforeEach(async () => {
    forgetFeatureSwitches();
    __resetClientForTests();
    clearRevocationCache();
    queueMessages = [];

    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
    signJwt = (sub = 'usr_parent') =>
      new SignJWT({ mode: 'access', type: 'user', properties: { id: sub, email: 'p@example.com' }, auth_time: Math.floor(Date.now() / 1000) })
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setIssuer(ISSUER)
        .setAudience('client-1')
        .setSubject(`user:${sub}`)
        .setIssuedAt()
        .setExpirationTime('15m')
        .sign(privateKey);

    realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname === '/.well-known/oauth-authorization-server') {
        return Response.json({ issuer: ISSUER, jwks_uri: `${ISSUER}/.well-known/jwks.json` });
      }
      if (url.pathname === '/.well-known/jwks.json') {
        return Response.json({ keys: [jwk] });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;

    db = new SqliteD1();
    const vidsBucket = new MemoryBucket({
      vid_allowed: {
        id: 'vid_allowed',
        userId: 'usr_creator',
        channelId: 'ch_kids',
        title: 'Short Dua',
        status: 'published',
        visibility: 'public',
        views: 42,
        commentSettings: 'on',
        autoplayNext: true,
        playerLinks: [{ title: 'Shop', url: 'https://shop.example' }],
        endScreen: { items: [] },
        cards: [{ label: 'Link' }],
      },
      vid_adult: {
        id: 'vid_adult',
        userId: 'usr_creator',
        channelId: 'ch_adult',
        title: 'Adult Lecture',
        status: 'published',
        visibility: 'public',
        views: 10,
      },
    });
    const channelsBucket = new MemoryBucket({
      ch_kids: { id: 'ch_kids', userId: 'usr_creator', name: 'Kids Channel' },
      ch_adult: { id: 'ch_adult', userId: 'usr_creator', name: 'Adult Channel' },
    });

    await db
      .prepare(
        `INSERT INTO search_videos (id, channel_id, visible, payload) VALUES
         ('vid_allowed', 'ch_kids', 1, ?),
         ('vid_adult', 'ch_adult', 1, ?)`,
      )
      .bind(
        JSON.stringify({ id: 'vid_allowed', channelId: 'ch_kids', title: 'Short Dua' }),
        JSON.stringify({ id: 'vid_adult', channelId: 'ch_adult', title: 'Adult Lecture' }),
      )
      .run();

    await db
      .prepare(
        `INSERT INTO kids_catalog_items (id, target_type, target_id, age_band, status, topics_json, position, approved_by, approved_at, updated_at)
         VALUES ('kc_1', 'video', 'vid_allowed', '3-6', 'approved', '["dua"]', 1, 'usr_mod', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')`,
      )
      .run();

    const decisions = JSON.stringify(Object.fromEntries(KIDS_DECISION_IDS.map((d) => [d, 'Option A'])));
    await db
      .prepare("INSERT INTO kids_policy_settings (key, decisions_json, legal_approved, legal_approved_by, legal_approved_at, updated_at) VALUES ('default', ?, 1, 'usr_sa', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')")
      .bind(decisions)
      .run();
    assert.equal((await kidsCanTurnOnHook({ SEARCH_DB: db as never })).ok, true);
    await writeFeatureSwitch({ SEARCH_DB: db as never }, { key: 'ummahKids', enabled: true, expectedVersion: 0, actorId: 'usr_sa', currentStored: false });

    env = {
      ENVIRONMENT: 'test',
      Issuer: ISSUER,
      ClientId: 'client-1',
      INTERNAL_API_KEY: 'test-internal-api-key-not-for-prod',
      SEARCH_DB: db,
      videos: vidsBucket,
      channels: channelsBucket,
      profiles: new MemoryBucket(),
      watch_history: new MemoryBucket(),
      queue: {
        async send(msg: unknown) {
          queueMessages.push(msg);
        },
      },
    };

    const signed = await signKidsSessionToken(env as never, {
      userId: 'usr_parent',
      deviceId: 'dev_tablet',
      ageBand: '3-6',
    });
    kidsToken = signed.token;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const call = async (path: string, init: RequestInit = {}) => {
    const token = await signJwt('usr_parent');
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    if (!headers.has('X-Kids-Session') && !headers.has('Cookie')) {
      headers.set('X-Kids-Session', kidsToken);
    }
    return worker.fetch(
      new Request(`https://videos.api.example${path}`, { ...init, headers }),
      env as never,
      { waitUntil() {}, passThroughOnException() {} } as never,
    );
  };

  it('blocks interactive social, upload, search, push, watch-later, and notifications routes', async () => {
    const blocked: [string, string][] = [
      ['POST', '/api/videos/vid_allowed/comments'],
      ['GET', '/api/videos/vid_allowed/comments'],
      ['POST', '/api/videos/vid_allowed/likes'],
      ['PUT', '/api/devices/install_1'],
      ['POST', '/api/library/watch-later'],
      ['GET', '/api/notifications'],
      ['GET', '/api/watch-state'],
      ['GET', '/api/continue-watching'],
      ['GET', '/api/search?q=quran'],
      ['GET', '/api/channels/ch_kids/videos'],
      ['GET', '/api/playlists/pl_kids'],
      ['POST', '/api/videos/upload/initiate'],
      ['PUT', '/api/me/parental-controls/pin'],
    ];
    for (const [method, path] of blocked) {
      const res = await call(path, { method, body: method === 'GET' ? undefined : '{}' });
      assert.equal(res.status, 403, `${method} ${path} -> ${res.status}`);
      const body = (await res.json()) as { code?: string };
      assert.equal(body.code, 'kids_mode_restricted', `${method} ${path}`);
    }
  });

  it('blocks non-allowlisted videos and sanitizes allowlisted video responses', async () => {
    const denied = await call('/api/videos/vid_adult');
    assert.equal(denied.status, 403);
    assert.equal(((await denied.json()) as { code?: string }).code, 'kids_mode_restricted');

    const ok = await call('/api/videos/vid_allowed');
    assert.equal(ok.status, 200);
    const data = (await ok.json()) as Record<string, unknown>;
    assert.equal(data.commentSettings, 'off');
    assert.equal(data.autoplayNext, false);
    assert.equal('playerLinks' in data, false);
    assert.equal('endScreen' in data, false);
    assert.equal('cards' in data, false);
  });

  it('fails closed on new uploads from an approved channel until moderated (KIDS-D16 / S2) and redacts video IDs from request logs (S3)', async () => {
    await db
      .prepare(
        `INSERT INTO search_videos (id, channel_id, visible, payload) VALUES ('vid_unreviewed_ch', 'ch_kids', 1, ?)`,
      )
      .bind(JSON.stringify({ id: 'vid_unreviewed_ch', channelId: 'ch_kids', title: 'New Unreviewed Upload' }))
      .run();
    await db
      .prepare(
        `INSERT INTO kids_catalog_items (id, target_type, target_id, age_band, status, topics_json, position, approved_by, approved_at, updated_at)
         VALUES ('kc_ch', 'channel', 'ch_kids', '3-6', 'approved', '["dua"]', 2, 'usr_mod', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')`,
      )
      .run();

    const blockedVideo = await call('/api/videos/vid_unreviewed_ch');
    assert.equal(blockedVideo.status, 403);
    assert.equal(((await blockedVideo.json()) as { code?: string }).code, 'kids_mode_restricted');

    // Capture stdout info logs during a Kids Mode video fetch to confirm userId & raw videoId are absent
    const capturedLogs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      capturedLogs.push(args.map(String).join(' '));
    };
    try {
      const ok = await call('/api/videos/vid_allowed');
      assert.equal(ok.status, 200);
    } finally {
      console.log = origLog;
    }
    const combined = capturedLogs.join('\n');
    assert.equal(combined.includes('vid_allowed'), false, 'raw video ID must be redacted from Kids Mode logs');
    assert.equal(combined.includes('usr_parent'), false, 'userId must be omitted from Kids Mode logs');
  });

  it('works identically via HttpOnly aun_kids_session cookie and fails closed on tampered tokens', async () => {
    const resCookie = await call('/api/videos/vid_adult', {
      headers: { Cookie: `${KIDS_SESSION_COOKIE}=${encodeURIComponent(kidsToken)}` },
    });
    assert.equal(resCookie.status, 403);

    const resTampered = await call('/api/kids/catalog', {
      headers: { 'X-Kids-Session': `${kidsToken}tamper` },
    });
    assert.equal(resTampered.status, 403);
    assert.equal(((await resTampered.json()) as { code?: string }).code, 'kids_mode_restricted');
  });

  it('suppresses viewerKey, queue telemetry, watch-state, watch-history, and analytics writes', async () => {
    const executedSql: string[] = [];
    const origPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      executedSql.push(sql);
      return origPrepare(sql);
    }) as typeof db.prepare;

    const viewRes = await call('/api/videos/vid_allowed/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watchTime: 30 }),
    });
    assert.equal(viewRes.status, 200);
    assert.equal(
      executedSql.some((s) => s.includes('discovery_viewers')),
      false,
    );

    const wsRes = await call('/api/watch-state/vid_allowed', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ positionSeconds: 12, durationSeconds: 60 }),
    });
    assert.equal(wsRes.status, 200);
    assert.equal(((await wsRes.json()) as { suppressed?: boolean }).suppressed, true);
    assert.equal(
      executedSql.some((s) => s.includes('watch_state')),
      false,
    );

    const whRes = await call('/api/watch-history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: 'vid_allowed' }),
    });
    assert.equal(whRes.status, 200);
    assert.equal((await (env.watch_history as MemoryBucket).list()).objects.length, 0);

    const evRes = await call('/api/analytics/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'ab_test', events: [{ name: 'exp' }] }),
    });
    assert.equal(evRes.status, 202);
    assert.equal(((await evRes.json()) as { accepted?: number; suppressed?: boolean }).accepted, 0);
    assert.equal(queueMessages.length, 0);
  });
});
