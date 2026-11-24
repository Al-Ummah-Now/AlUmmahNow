/**
 * Parent-owned Parental Controls, PBKDF2 PIN, auth_time step-up, escalating lockout,
 * and Kids Mode session enter/exit tests (wiki E20 §5.3 & KIDS-D8; story E20-4).
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
import worker from '../src/index';
import { __resetClientForTests } from '../src/lib/openauth-client';
import { clearRevocationCache } from '../src/lib/token-revocation';
import { SqliteD1 } from './search-sqlite-d1';
import { createSqliteD1 } from './sqlite-d1';

const ISSUER = 'https://auth.example.com';

describe('Parental Controls and Kids Mode enter/exit API', () => {
  let realFetch: typeof fetch;
  let db: SqliteD1;
  let env: Record<string, unknown>;
  let signJwt: (authTimeSeconds?: number) => Promise<string>;

  beforeEach(async () => {
    forgetFeatureSwitches();
    __resetClientForTests();
    clearRevocationCache();

    const { publicKey, privateKey } = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
    signJwt = (authTimeSeconds = Math.floor(Date.now() / 1000)) =>
      new SignJWT({
        mode: 'access',
        type: 'user',
        properties: { id: 'usr_parent', email: 'parent@example.com' },
        auth_time: authTimeSeconds,
      })
        .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setIssuer(ISSUER)
        .setAudience('client-1')
        .setSubject('user:usr_parent')
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
    await db
      .prepare("INSERT INTO search_videos (id, channel_id, visible, payload) VALUES ('vid_1', 'ch_1', 1, ?)")
      .bind(JSON.stringify({ id: 'vid_1', channelId: 'ch_1', title: 'Kids Intro' }))
      .run();
    await db
      .prepare("INSERT INTO kids_catalog_items (id, target_type, target_id, age_band, status, topics_json, position, approved_by, approved_at, updated_at) VALUES ('kc_1', 'video', 'vid_1', '3-6', 'approved', '[\"dua\"]', 1, 'usr_sa', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')")
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
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const call = async (path: string, init: RequestInit = {}, authTimeSeconds?: number) => {
    const token = await signJwt(authTimeSeconds);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    return worker.fetch(
      new Request(`https://videos.api.example${path}`, { ...init, headers }),
      env as never,
      { waitUntil() {}, passThroughOnException() {} } as never,
    );
  };

  it('returns 404 feature_off when ummahKids switch is off', async () => {
    await writeFeatureSwitch({ SEARCH_DB: db as never }, { key: 'ummahKids', enabled: false, expectedVersion: 1, actorId: 'usr_sa', currentStored: true });
    const res = await call('/api/me/parental-controls');
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { code?: string }).code, 'feature_off');
  });

  it('reads defaults and updates non-PIN parental settings without exposing hashes', async () => {
    const getRes = await call('/api/me/parental-controls');
    assert.equal(getRes.status, 200);
    const getBody = (await getRes.json()) as { controls: Record<string, unknown> };
    assert.equal(getBody.controls.hasPin, false);
    assert.equal(getBody.controls.activeAgeBand, '7-12');
    assert.equal('pinHash' in getBody.controls, false);
    assert.equal('pinSalt' in getBody.controls, false);

    const putRes = await call('/api/me/parental-controls', {
      method: 'PUT',
      body: JSON.stringify({
        activeAgeBand: '3-6',
        dailyLimitMinutes: 45,
        bedtimeStart: '19:30',
        bedtimeEnd: '06:30',
        bedtimeTimezone: 'America/New_York',
        prayerPauseEnabled: true,
      }),
    });
    assert.equal(putRes.status, 200);
    const putBody = (await putRes.json()) as { controls: Record<string, unknown> };
    assert.equal(putBody.controls.activeAgeBand, '3-6');
    assert.equal(putBody.controls.dailyLimitMinutes, 45);
    assert.equal(putBody.controls.prayerPauseEnabled, true);
  });

  it('requires fresh auth_time (<= 300s) step-up for PIN setup and hashes with PBKDF2', async () => {
    const staleAuthTime = Math.floor(Date.now() / 1000) - 600;
    const staleRes = await call(
      '/api/me/parental-controls/pin',
      { method: 'PUT', body: JSON.stringify({ pin: '1234' }) },
      staleAuthTime,
    );
    assert.equal(staleRes.status, 401);
    assert.equal(((await staleRes.json()) as { code?: string }).code, 'step_up_required');

    const okRes = await call('/api/me/parental-controls/pin', {
      method: 'PUT',
      body: JSON.stringify({ pin: '2468' }),
    });
    assert.equal(okRes.status, 200);
    const body = (await okRes.json()) as { controls: Record<string, unknown> };
    assert.equal(body.controls.hasPin, true);
    assert.equal('pinHash' in body.controls, false);
    assert.equal('pinSalt' in body.controls, false);

    const stored = await db
      .prepare('SELECT pin_hash, pin_salt FROM parental_controls WHERE user_id = ?')
      .bind('usr_parent')
      .first<{ pin_hash: string; pin_salt: string }>();
    assert.ok(stored?.pin_hash.startsWith('pbkdf2-sha256:100000:'));
    assert.ok((stored?.pin_salt.length ?? 0) >= 16);
    assert.equal(stored?.pin_hash.includes('2468'), false);
  });

  it('requires PIN to update settings once set, enforces atomic 5->5m/6->15m/7->1h/8->hard-stop + email + SSO exit (S4, S7)', async () => {
    const beforePin = await call('/api/me/kids-mode/enter', { method: 'POST', body: '{}' });
    assert.equal(beforePin.status, 400);
    assert.equal(((await beforePin.json()) as { code?: string }).code, 'pin_not_set');

    assert.equal(
      (await call('/api/me/parental-controls/pin', { method: 'PUT', body: JSON.stringify({ pin: '4321' }) })).status,
      200,
    );

    // S7: updating parental controls without PIN is refused once PIN is set; valid PIN succeeds
    const noPinUpdate = await call('/api/me/parental-controls', {
      method: 'PUT',
      body: JSON.stringify({ dailyLimitMinutes: 90 }),
    });
    assert.equal(noPinUpdate.status, 400);
    assert.equal(((await noPinUpdate.json()) as { code?: string }).code, 'pin_required');

    const badPinUpdate = await call('/api/me/parental-controls', {
      method: 'PUT',
      body: JSON.stringify({ dailyLimitMinutes: 90, pin: '0000' }),
    });
    assert.equal(badPinUpdate.status, 403);
    assert.equal(((await badPinUpdate.json()) as { code?: string }).code, 'pin_invalid');

    const goodPinUpdate = await call('/api/me/parental-controls', {
      method: 'PUT',
      body: JSON.stringify({ dailyLimitMinutes: 90, pin: '4321' }),
    });
    assert.equal(goodPinUpdate.status, 200);
    assert.equal(((await goodPinUpdate.json()) as { controls: { dailyLimitMinutes: number } }).controls.dailyLimitMinutes, 90);

    const enterRes = await call('/api/me/kids-mode/enter', {
      method: 'POST',
      body: JSON.stringify({ ageBand: '3-6', deviceId: 'ipad_living_room' }),
    });
    assert.equal(enterRes.status, 200);
    const enterCookie = enterRes.headers.get('Set-Cookie') ?? '';
    assert.ok(enterCookie.includes(`${KIDS_SESSION_COOKIE}=ak1.`));
    assert.ok(enterCookie.includes('HttpOnly'));
    const enterBody = (await enterRes.json()) as { kidsSessionToken: string; ageBand: string };
    assert.equal(enterBody.ageBand, '3-6');

    // S4 concurrent race check: 5 parallel wrong attempts atomically reach attempt 5 (300s lock) with zero lost counts
    const burst = await Promise.all(
      Array.from({ length: 5 }, () =>
        call('/api/me/kids-mode/exit', {
          method: 'POST',
          headers: { 'X-Kids-Session': enterBody.kidsSessionToken },
          body: JSON.stringify({ pin: '0000' }),
        }),
      ),
    );
    const statuses = burst.map((r) => r.status).sort();
    assert.deepEqual(statuses, [403, 403, 403, 403, 429]);
    const fifthBody = (await burst.find((r) => r.status === 429)!.json()) as { code?: string; retryAfter?: number };
    assert.equal(fifthBody.code, 'pin_locked');
    assert.ok((fifthBody.retryAfter ?? 0) >= 295);

    // Even the right PIN is blocked while locked
    const lockedOut = await call('/api/me/kids-mode/exit', {
      method: 'POST',
      headers: { 'X-Kids-Session': enterBody.kidsSessionToken },
      body: JSON.stringify({ pin: '4321' }),
    });
    assert.equal(lockedOut.status, 429);

    // Expire timed locks to verify 6th -> 900s, 7th -> 3600s, 8th -> hard stop + alert email
    await db.prepare('UPDATE parental_controls SET pin_locked_until = NULL WHERE user_id = ?').bind('usr_parent').run();
    const sixth = await call('/api/me/kids-mode/exit', {
      method: 'POST',
      headers: { 'X-Kids-Session': enterBody.kidsSessionToken },
      body: JSON.stringify({ pin: '0000' }),
    });
    assert.equal(sixth.status, 429);
    assert.ok((((await sixth.json()) as { retryAfter?: number }).retryAfter ?? 0) >= 895);

    await db.prepare('UPDATE parental_controls SET pin_locked_until = NULL WHERE user_id = ?').bind('usr_parent').run();
    const seventh = await call('/api/me/kids-mode/exit', {
      method: 'POST',
      headers: { 'X-Kids-Session': enterBody.kidsSessionToken },
      body: JSON.stringify({ pin: '0000' }),
    });
    assert.equal(seventh.status, 429);
    assert.ok((((await seventh.json()) as { retryAfter?: number }).retryAfter ?? 0) >= 3595);

    // Enable Resend key & capture outgoing parent alert email on 8th attempt hard stop
    const sentEmails: Array<{ url: string; body: string }> = [];
    const origFetch = globalThis.fetch;
    env.RESEND_API_KEY = 're_test_key';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://api.resend.com/emails') {
        sentEmails.push({ url, body: String(init?.body ?? '') });
        return Response.json({ id: 're_alert_1' });
      }
      return origFetch(input, init);
    }) as typeof fetch;

    await db.prepare('UPDATE parental_controls SET pin_locked_until = NULL WHERE user_id = ?').bind('usr_parent').run();
    const eighth = await call('/api/me/kids-mode/exit', {
      method: 'POST',
      headers: { 'X-Kids-Session': enterBody.kidsSessionToken },
      body: JSON.stringify({ pin: '0000' }),
    });
    globalThis.fetch = origFetch;
    assert.equal(eighth.status, 429);
    const eighthBody = (await eighth.json()) as { code?: string; hardLocked?: boolean };
    assert.equal(eighthBody.code, 'pin_locked');
    assert.equal(eighthBody.hardLocked, true);
    assert.equal(sentEmails.length, 1);
    assert.ok(sentEmails[0].body.includes('parent@example.com'));

    // Stale SSO cannot exit, but fresh auth_time (<= 300s) can exit via SSO fallback + reset PIN
    const staleSsoExit = await call(
      '/api/me/kids-mode/exit',
      {
        method: 'POST',
        headers: { 'X-Kids-Session': enterBody.kidsSessionToken },
        body: JSON.stringify({ method: 'sso' }),
      },
      Math.floor(Date.now() / 1000) - 600,
    );
    assert.equal(staleSsoExit.status, 401);
    assert.equal(((await staleSsoExit.json()) as { code?: string }).code, 'step_up_required');

    const freshSsoExit = await call('/api/me/kids-mode/exit', {
      method: 'POST',
      headers: { 'X-Kids-Session': enterBody.kidsSessionToken },
      body: JSON.stringify({ method: 'sso' }),
    });
    assert.equal(freshSsoExit.status, 200);
    const exitCookie = freshSsoExit.headers.get('Set-Cookie') ?? '';
    assert.ok(exitCookie.includes(`${KIDS_SESSION_COOKIE}=;`));
    assert.ok(exitCookie.includes('Max-Age=0'));

    // Resetting PIN with fresh SSO clears pin_hard_locked, letting normal PIN exit work again
    assert.equal(
      (await call('/api/me/parental-controls/pin', { method: 'PUT', body: JSON.stringify({ pin: '1357' }) })).status,
      200,
    );
    const pinExit = await call('/api/me/kids-mode/exit', {
      method: 'POST',
      headers: { 'X-Kids-Session': enterBody.kidsSessionToken },
      body: JSON.stringify({ pin: '1357' }),
    });
    assert.equal(pinExit.status, 200);

    // S-C: typing the correct PIN on the 8th try after 7 failures SUCCEEDS (hard lock only on 8th failure)
    await db
      .prepare('UPDATE parental_controls SET pin_failed_attempts = 7, pin_locked_until = NULL, pin_hard_locked = 0 WHERE user_id = ?')
      .bind('usr_parent')
      .run();
    const eighthRight = await call('/api/me/kids-mode/exit', {
      method: 'POST',
      headers: { 'X-Kids-Session': enterBody.kidsSessionToken },
      body: JSON.stringify({ pin: '1357' }),
    });
    assert.equal(eighthRight.status, 200);
    assert.equal(((await eighthRight.json()) as { exited?: boolean }).exited, true);

    // S-D + S-E: concurrent burst on attempt 8 sends at most ONE single-language branded email from configured sender
    const notifDb = createSqliteD1();
    notifDb.raw
      .prepare("INSERT INTO notification_email_prefs VALUES ('usr_parent', 1, 'ar', 0)")
      .run();
    env.NOTIFICATIONS_DB = notifDb;
    env.EMAIL_FROM = 'Al Ummah Now Alerts <alerts@alummahnow.net>';
    await db
      .prepare('UPDATE parental_controls SET pin_failed_attempts = 7, pin_locked_until = NULL, pin_hard_locked = 0 WHERE user_id = ?')
      .bind('usr_parent')
      .run();

    const burstAlerts: Array<{ from?: string; subject?: string; html?: string; text?: string }> = [];
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://api.resend.com/emails') {
        burstAlerts.push(JSON.parse(String(init?.body ?? '{}')));
        return Response.json({ id: 're_burst_1' });
      }
      return savedFetch(input, init);
    }) as typeof fetch;

    const lockBurst = await Promise.all(
      Array.from({ length: 10 }, () =>
        call('/api/me/kids-mode/exit', {
          method: 'POST',
          headers: { 'X-Kids-Session': enterBody.kidsSessionToken },
          body: JSON.stringify({ pin: '9999' }),
        }),
      ),
    );
    globalThis.fetch = savedFetch;
    assert.ok(lockBurst.every((r) => r.status === 429));
    assert.equal(burstAlerts.length, 1);
    assert.equal(burstAlerts[0].from, 'Al Ummah Now Alerts <alerts@alummahnow.net>');
    assert.ok(burstAlerts[0].subject?.includes('تنبيه أمني'));
    assert.equal(burstAlerts[0].subject?.includes('Security alert'), false);
    assert.ok(burstAlerts[0].html?.includes('dir="rtl"'));
    assert.ok(burstAlerts[0].html?.includes('alummah-now-logo.png'));
    assert.equal(burstAlerts[0].text?.includes('Security alert'), false);
  });

  it('falls back to request UI language for hard-lockout alert when saved preference is unset (S-E)', async () => {
    assert.equal(
      (await call('/api/me/parental-controls/pin', { method: 'PUT', body: JSON.stringify({ pin: '2468' }) })).status,
      200,
    );
    const enterRes = await call('/api/me/kids-mode/enter', { method: 'POST', body: JSON.stringify({}) });
    const { kidsSessionToken } = (await enterRes.json()) as { kidsSessionToken: string };
    await db
      .prepare('UPDATE parental_controls SET pin_failed_attempts = 7, pin_locked_until = NULL, pin_hard_locked = 0 WHERE user_id = ?')
      .bind('usr_parent')
      .run();

    const captured: Array<{ from?: string; subject?: string; html?: string; text?: string }> = [];
    const savedFetch = globalThis.fetch;
    env.RESEND_API_KEY = 're_test_key';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://api.resend.com/emails') {
        captured.push(JSON.parse(String(init?.body ?? '{}')));
        return Response.json({ id: 're_ui_ar' });
      }
      return savedFetch(input, init);
    }) as typeof fetch;

    const locked = await call('/api/me/kids-mode/exit', {
      method: 'POST',
      headers: { 'X-Kids-Session': kidsSessionToken, 'X-App-Locale': 'ar' },
      body: JSON.stringify({ pin: '0000' }),
    });
    globalThis.fetch = savedFetch;
    assert.equal(locked.status, 429);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].from, 'Al Ummah Now <support@alummahnow.net>');
    assert.ok(captured[0].subject?.includes('تنبيه أمني'));
    assert.ok(captured[0].html?.includes('lang="ar"'));
    assert.equal(captured[0].text?.includes('Too many wrong'), false);
  });
});
