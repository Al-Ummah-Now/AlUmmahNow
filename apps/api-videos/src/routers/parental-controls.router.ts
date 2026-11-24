/**
 * Parent-owned Parental Controls and Kids Mode session routes (wiki E20 §5.3; story E20-4).
 *
 * Mounted under `/api/me`:
 * - GET  /api/me/parental-controls
 * - PUT  /api/me/parental-controls
 * - PUT  /api/me/parental-controls/pin       (requires fresh `auth_time` <= 300s step-up)
 * - POST /api/me/kids-mode/enter
 * - POST /api/me/kids-mode/exit
 *
 * Every route sits behind `ummahKids` in `FEATURE_ROUTES` (404 `feature_off` while off).
 */
import { Hono, type Context } from 'hono';
import { fromHono } from 'chanfana';
import {
  KIDS_ACTIVE_AGE_BANDS,
  KIDS_STEP_UP_MAX_AGE_SECONDS,
  isKidsActiveAgeBand,
  isValidKidsPin,
  type SearchDb,
} from '@al-ummah/shared-types';
import type { AppBindings } from '../base';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../lib/api-error';
import { clearKidsSessionCookie, formatKidsSessionCookie, getParentalControls, setParentalPin, signKidsSessionToken, updateParentalControls, verifyAndConsumeParentalPin, type PinCheckResult } from '../lib/kids/parental-controls';

type AuthPayloadWithStepUp = {
  sub?: string;
  email?: string;
  authTime?: number;
};

type Env = {
  Bindings: AppBindings;
  Variables: {
    userId?: string;
    auth?: { userId: string; email?: string; payload?: AuthPayloadWithStepUp };
  };
};
type C = Context<Env>;

function respondPinFailure(c: C, check: PinCheckResult) {
  if (check.code === 'pin_not_set') return apiError(c, 400, 'pin_not_set');
  if (check.code === 'pin_locked') {
    if (check.retryAfterSeconds) c.header('Retry-After', String(check.retryAfterSeconds));
    return apiError(c, 429, 'pin_locked', {
      retryAfter: check.retryAfterSeconds,
      lockedUntil: check.lockedUntil ?? undefined,
      hardLocked: check.hardLocked ?? false,
    });
  }
  return apiError(c, 403, 'pin_invalid');
}

function hasFreshStepUp(c: C, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const authTime = c.get('auth')?.payload?.authTime;
  return typeof authTime === 'number' && Number.isFinite(authTime) && nowSeconds - authTime <= KIDS_STEP_UP_MAX_AGE_SECONDS;
}

function requestUiLocale(c: C): 'en' | 'ar' {
  const header = c.req.header('X-App-Locale')?.trim().toLowerCase();
  if (header === 'ar' || c.req.query('lang') === 'ar') return 'ar';
  return 'en';
}

async function parseJsonBody(c: C): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const app = new Hono<Env>();

app.use('*', authMiddleware);

export const parentalControlsRouter = fromHono(app);

app.get('/parental-controls', async (c) => {
  const userId = c.get('userId');
  const db = c.env.SEARCH_DB as unknown as D1Database | undefined;
  if (!userId) return apiError(c, 401, 'authentication_required');
  if (!db) return apiError(c, 503, 'service_unavailable');
  const controls = await getParentalControls(db, userId);
  return c.json({ success: true, controls });
});

app.put('/parental-controls', async (c) => {
  const userId = c.get('userId');
  const db = c.env.SEARCH_DB as unknown as D1Database | undefined;
  if (!userId) return apiError(c, 401, 'authentication_required');
  if (!db) return apiError(c, 503, 'service_unavailable');

  const body = await parseJsonBody(c);
  if (!body) return apiError(c, 400, 'invalid_request');

  const existing = await getParentalControls(db, userId);
  if (existing.hasPin) {
    if (typeof body.pin !== 'string' || !body.pin) {
      return apiError(c, 400, 'pin_required');
    }
    const pinCheck = await verifyAndConsumeParentalPin(db, userId, body.pin, {
      env: c.env as never,
      email: c.get('auth')?.email,
      locale: requestUiLocale(c),
    });
    if (!pinCheck.ok) return respondPinFailure(c, pinCheck);
  }

  if (body.activeAgeBand !== undefined && !isKidsActiveAgeBand(body.activeAgeBand)) {
    return apiError(c, 400, 'invalid_request');
  }
  if (
    body.dailyLimitMinutes !== undefined &&
    body.dailyLimitMinutes !== null &&
    typeof body.dailyLimitMinutes !== 'number'
  ) {
    return apiError(c, 400, 'invalid_request');
  }
  for (const key of ['bedtimeStart', 'bedtimeEnd', 'bedtimeTimezone'] as const) {
    if (body[key] !== undefined && body[key] !== null && typeof body[key] !== 'string') {
      return apiError(c, 400, 'invalid_request');
    }
  }
  for (const key of ['prayerPauseEnabled'] as const) {
    if (body[key] !== undefined && typeof body[key] !== 'boolean') {
      return apiError(c, 400, 'invalid_request');
    }
  }

  const updated = await updateParentalControls(db, userId, {
    activeAgeBand: body.activeAgeBand as (typeof KIDS_ACTIVE_AGE_BANDS)[number] | undefined,
    dailyLimitMinutes: body.dailyLimitMinutes as number | null | undefined,
    bedtimeStart: body.bedtimeStart as string | null | undefined,
    bedtimeEnd: body.bedtimeEnd as string | null | undefined,
    bedtimeTimezone: body.bedtimeTimezone as string | null | undefined,
    prayerPauseEnabled: body.prayerPauseEnabled as boolean | undefined,
  });
  if (!updated.ok) return apiError(c, 400, 'invalid_request');
  return c.json({ success: true, controls: updated.view });
});

app.put('/parental-controls/pin', async (c) => {
  const userId = c.get('userId');
  const db = c.env.SEARCH_DB as unknown as D1Database | undefined;
  if (!userId) return apiError(c, 401, 'authentication_required');
  if (!db) return apiError(c, 503, 'service_unavailable');

  if (!hasFreshStepUp(c)) {
    return apiError(c, 401, 'step_up_required', { maxAgeSeconds: KIDS_STEP_UP_MAX_AGE_SECONDS });
  }

  const body = await parseJsonBody(c);
  if (!body || !isValidKidsPin(body.pin)) {
    return apiError(c, 400, 'invalid_request');
  }

  if (body.currentPin !== undefined) {
    if (!isValidKidsPin(body.currentPin)) return apiError(c, 403, 'pin_invalid');
    const check = await verifyAndConsumeParentalPin(db, userId, body.currentPin, {
      env: c.env as never,
      email: c.get('auth')?.email,
      locale: requestUiLocale(c),
    });
    if (!check.ok && check.code !== 'pin_not_set') {
      return respondPinFailure(c, check);
    }
  }

  const controls = await setParentalPin(db, userId, body.pin);
  return c.json({ success: true, controls });
});

app.post('/kids-mode/enter', async (c) => {
  const userId = c.get('userId');
  const db = c.env.SEARCH_DB as unknown as D1Database | undefined;
  if (!userId) return apiError(c, 401, 'authentication_required');
  if (!db) return apiError(c, 503, 'service_unavailable');

  const controls = await getParentalControls(db, userId);
  if (!controls.hasPin) {
    return apiError(c, 400, 'pin_not_set');
  }

  const body = (await parseJsonBody(c)) ?? {};
  if (body.ageBand !== undefined && !isKidsActiveAgeBand(body.ageBand)) {
    return apiError(c, 400, 'invalid_request');
  }
  const ageBand = isKidsActiveAgeBand(body.ageBand) ? body.ageBand : controls.activeAgeBand;
  let deviceId: string | null = null;
  if (body.deviceId !== undefined && body.deviceId !== null) {
    if (typeof body.deviceId !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(body.deviceId.trim())) {
      return apiError(c, 400, 'invalid_request');
    }
    deviceId = body.deviceId.trim();
  }

  let signed;
  try {
    signed = await signKidsSessionToken(c.env as never, {
      userId,
      deviceId,
      ageBand,
    });
  } catch {
    return apiError(c, 503, 'service_unavailable');
  }

  const isHttps = c.req.url.startsWith('https://');
  c.header('Set-Cookie', formatKidsSessionCookie(signed.token, isHttps));
  return c.json({
    success: true,
    kidsSessionToken: signed.token,
    ageBand: signed.claims.band,
    deviceId: signed.claims.did,
    expiresAt: new Date(signed.claims.exp * 1000).toISOString(),
  });
});

app.post('/kids-mode/exit', async (c) => {
  const userId = c.get('userId');
  const db = c.env.SEARCH_DB as unknown as D1Database | undefined;
  if (!userId) return apiError(c, 401, 'authentication_required');
  if (!db) return apiError(c, 503, 'service_unavailable');

  const body = await parseJsonBody(c);
  if (body?.method === 'sso') {
    if (!hasFreshStepUp(c)) {
      return apiError(c, 401, 'step_up_required', { maxAgeSeconds: KIDS_STEP_UP_MAX_AGE_SECONDS });
    }
    const isHttps = c.req.url.startsWith('https://');
    c.header('Set-Cookie', clearKidsSessionCookie(isHttps));
    const controls = await getParentalControls(db, userId);
    return c.json({ success: true, exited: true, via: 'sso', controls });
  }

  if (!body || typeof body.pin !== 'string' || !body.pin) {
    return apiError(c, 400, 'pin_required');
  }
  const check = await verifyAndConsumeParentalPin(db, userId, body.pin, {
    env: c.env as never,
    email: c.get('auth')?.email,
    locale: requestUiLocale(c),
  });
  if (!check.ok) {
    return respondPinFailure(c, check);
  }

  const isHttps = c.req.url.startsWith('https://');
  c.header('Set-Cookie', clearKidsSessionCookie(isHttps));
  return c.json({ success: true, exited: true, via: 'pin', controls: check.view });
});
