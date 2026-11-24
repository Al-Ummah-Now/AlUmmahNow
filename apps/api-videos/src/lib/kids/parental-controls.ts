/**
 * Parent-owned Parental Controls, PBKDF2 PIN verification, escalating lockouts,
 * signed Kids Mode session tokens, allowlist checks, and GDPR export/erasure
 * (wiki E20 §5.3 & §8; story E20-4).
 *
 * Security invariants:
 * - PINs are hashed with Web Crypto PBKDF2-HMAC-SHA256 (100,000 iterations,
 *   16-byte random salt) and verified in constant time.
 * - `pin_hash`, `pin_salt`, and raw attempt counters are NEVER returned to callers
 *   or included in GDPR exports.
 * - Kids Mode tokens are HMAC-SHA256 signed using `KIDS_SESSION_SECRET` (or an
 *   HKDF/HMAC-derived subkey from `INTERNAL_API_KEY`); no hardcoded fallback.
 */
import {
  KIDS_SESSION_COOKIE,
  KIDS_SESSION_HEADER,
  renderEmail,
  isKidsActiveAgeBand,
  isValidKidsPin,
  isValidKidsTime,
  matchingKidsAgeBands,
  nextPinLockout,
  type EmailDoc,
  type EmailLocale,
  type KidsActiveAgeBand,
  type KidsTargetType,
  type ParentalControlsView,
} from '@al-ummah/shared-types';
import { getSecret } from '../env-helpers';
import { logger } from '../logger';
import { getEmailSettings } from '../notifications';

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_BITS = 256;
const SALT_BYTES = 16;
const KIDS_SESSION_TTL_SECONDS = 24 * 60 * 60;
const KIDS_KEY_DOMAIN = 'al-ummah-now:ummah-kids-session:v1';

interface ParentalControlsRow {
  user_id: string;
  pin_hash: string | null;
  pin_salt: string | null;
  pin_updated_at: string | null;
  pin_failed_attempts: number;
  pin_locked_until: string | null;
  pin_hard_locked: number;
  active_age_band: string;
  daily_limit_minutes: number | null;
  bedtime_start: string | null;
  bedtime_end: string | null;
  bedtime_timezone: string | null;
  prayer_pause_enabled: number;
  updated_at: string;
}

export interface KidsSessionClaims {
  v: 1;
  uid: string;
  did: string | null;
  band: KidsActiveAgeBand;
  iat: number;
  exp: number;
}

export interface KidsSecretEnv {
  KIDS_SESSION_SECRET?: { get(): Promise<string> } | string;
  INTERNAL_API_KEY?: { get(): Promise<string> } | string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(raw: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const pad = (4 - (raw.length % 4)) % 4;
  const b64 = `${raw.replace(/-/g, '+').replace(/_/g, '/')}${'='.repeat(pad)}`;
  try {
    return base64ToBytes(b64);
  } catch {
    return null;
  }
}

function constantTimeBytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashKidsPin(pin: string): Promise<{ pinHash: string; pinSalt: string }> {
  if (!isValidKidsPin(pin)) throw new Error('Invalid PIN format');
  const saltBytes = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const pinSalt = bytesToBase64(saltBytes);
  const derived = await derivePbkdf2Bits(pin, saltBytes, PBKDF2_ITERATIONS);
  return {
    pinHash: `pbkdf2-sha256:${PBKDF2_ITERATIONS}:${bytesToBase64(derived)}`,
    pinSalt,
  };
}

export async function verifyKidsPin(pin: string, storedHash: string, storedSalt: string): Promise<boolean> {
  if (!isValidKidsPin(pin) || !storedHash || !storedSalt) return false;
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  // Cloudflare workerd caps PBKDF2 at 100,000 iterations; reject higher values before Web Crypto throws.
  if (!Number.isInteger(iterations) || iterations < 10_000 || iterations > PBKDF2_ITERATIONS) return false;
  let saltBytes: Uint8Array;
  let expectedBytes: Uint8Array;
  try {
    saltBytes = base64ToBytes(storedSalt);
    expectedBytes = base64ToBytes(parts[2]);
  } catch {
    return false;
  }
  const actualBytes = await derivePbkdf2Bits(pin, saltBytes, iterations);
  return constantTimeBytesEqual(actualBytes, expectedBytes);
}

async function derivePbkdf2Bits(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_BITS,
  );
  return new Uint8Array(bits);
}

async function resolveSessionHmacKey(env: KidsSecretEnv): Promise<CryptoKey | null> {
  let rawSecret = '';
  let needsDomainDerivation = false;
  if (env.KIDS_SESSION_SECRET) {
    rawSecret = (await getSecret(env.KIDS_SESSION_SECRET as never, 'KIDS_SESSION_SECRET').catch(() => '')).trim();
  }
  if (!rawSecret && env.INTERNAL_API_KEY) {
    rawSecret = (await getSecret(env.INTERNAL_API_KEY as never, 'INTERNAL_API_KEY').catch(() => '')).trim();
    needsDomainDerivation = true;
  }
  if (!rawSecret) return null;

  let keyBytes = new TextEncoder().encode(rawSecret);
  if (needsDomainDerivation) {
    const domainKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const derived = await crypto.subtle.sign('HMAC', domainKey, new TextEncoder().encode(KIDS_KEY_DOMAIN));
    keyBytes = new Uint8Array(derived);
  }
  return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signKidsSessionToken(
  env: KidsSecretEnv,
  input: { userId: string; deviceId?: string | null; ageBand: KidsActiveAgeBand; nowSeconds?: number },
): Promise<{ token: string; claims: KidsSessionClaims }> {
  const key = await resolveSessionHmacKey(env);
  if (!key) throw new Error('KIDS_SESSION_SECRET or INTERNAL_API_KEY must be configured');
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const claims: KidsSessionClaims = {
    v: 1,
    uid: input.userId,
    did: input.deviceId?.trim() || null,
    band: input.ageBand,
    iat: nowSeconds,
    exp: nowSeconds + KIDS_SESSION_TTL_SECONDS,
  };
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const data = new TextEncoder().encode(`ak1.${payloadB64}`);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  return { token: `ak1.${payloadB64}.${bytesToBase64Url(sig)}`, claims };
}

export async function verifyKidsSessionToken(
  env: KidsSecretEnv,
  token: string | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<KidsSessionClaims | null> {
  if (!token || typeof token !== 'string') return null;
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'ak1') return null;
  const [, payloadB64, sigB64] = parts;
  const payloadBytes = base64UrlToBytes(payloadB64);
  const sigBytes = base64UrlToBytes(sigB64);
  if (!payloadBytes || !sigBytes) return null;

  const key = await resolveSessionHmacKey(env);
  if (!key) return null;
  const validSig = await crypto.subtle.verify('HMAC', key, sigBytes as BufferSource, new TextEncoder().encode(`ak1.${payloadB64}`));
  if (!validSig) return null;

  try {
    const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as Partial<KidsSessionClaims>;
    if (
      parsed.v !== 1 ||
      typeof parsed.uid !== 'string' ||
      !parsed.uid ||
      !isKidsActiveAgeBand(parsed.band) ||
      typeof parsed.exp !== 'number' ||
      typeof parsed.iat !== 'number' ||
      parsed.exp <= nowSeconds
    ) {
      return null;
    }
    return {
      v: 1,
      uid: parsed.uid,
      did: typeof parsed.did === 'string' && parsed.did ? parsed.did : null,
      band: parsed.band,
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function extractKidsSessionToken(req: Request): string | null {
  const fromHeader = req.headers.get(KIDS_SESSION_HEADER);
  if (fromHeader && fromHeader.trim()) return fromHeader.trim();
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    if (name !== KIDS_SESSION_COOKIE) continue;
    const value = part.slice(idx + 1).trim();
    if (value) {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return null;
}

export function formatKidsSessionCookie(token: string, secure = true): string {
  const parts = [
    `${KIDS_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${KIDS_SESSION_TTL_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearKidsSessionCookie(secure = true): string {
  const parts = [
    `${KIDS_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function defaultControlsView(): ParentalControlsView {
  return {
    hasPin: false,
    pinUpdatedAt: null,
    pinLockedUntil: null,
    pinHardLocked: false,
    activeAgeBand: '7-12',
    dailyLimitMinutes: null,
    bedtimeStart: null,
    bedtimeEnd: null,
    bedtimeTimezone: null,
    prayerPauseEnabled: false,
    updatedAt: null,
  };
}

function rowToView(row: ParentalControlsRow | null): ParentalControlsView {
  if (!row) return defaultControlsView();
  const activeBand = isKidsActiveAgeBand(row.active_age_band) ? row.active_age_band : '7-12';
  const lockedUntil = row.pin_locked_until && Date.parse(row.pin_locked_until) > Date.now() ? row.pin_locked_until : null;
  return {
    hasPin: Boolean(row.pin_hash && row.pin_salt),
    pinUpdatedAt: row.pin_updated_at ?? null,
    pinLockedUntil: lockedUntil,
    pinHardLocked: row.pin_hard_locked === 1,
    activeAgeBand: activeBand,
    dailyLimitMinutes: typeof row.daily_limit_minutes === 'number' ? row.daily_limit_minutes : null,
    bedtimeStart: row.bedtime_start ?? null,
    bedtimeEnd: row.bedtime_end ?? null,
    bedtimeTimezone: row.bedtime_timezone ?? null,
    prayerPauseEnabled: row.prayer_pause_enabled === 1,
    updatedAt: row.updated_at ?? null,
  };
}

async function readRow(db: D1Database, userId: string): Promise<ParentalControlsRow | null> {
  return (
    (await db
      .prepare(
        `SELECT user_id, pin_hash, pin_salt, pin_updated_at, pin_failed_attempts, pin_locked_until,
                pin_hard_locked, active_age_band, daily_limit_minutes, bedtime_start, bedtime_end,
                bedtime_timezone, prayer_pause_enabled, updated_at
         FROM parental_controls
         WHERE user_id = ?`,
      )
      .bind(userId)
      .first<ParentalControlsRow>()) ?? null
  );
}

export async function getParentalControls(db: D1Database, userId: string): Promise<ParentalControlsView> {
  return rowToView(await readRow(db, userId));
}

export interface ParentalControlsPatch {
  activeAgeBand?: KidsActiveAgeBand;
  dailyLimitMinutes?: number | null;
  bedtimeStart?: string | null;
  bedtimeEnd?: string | null;
  bedtimeTimezone?: string | null;
  prayerPauseEnabled?: boolean;
}

export function isValidTimezone(tz: string): boolean {
  if (!tz || tz.length > 64) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export async function updateParentalControls(
  db: D1Database,
  userId: string,
  patch: ParentalControlsPatch,
): Promise<{ ok: true; view: ParentalControlsView } | { ok: false; error: string }> {
  const existing = await readRow(db, userId);
  const current = rowToView(existing);

  const activeAgeBand = patch.activeAgeBand ?? current.activeAgeBand;
  if (!isKidsActiveAgeBand(activeAgeBand)) return { ok: false, error: 'Invalid age band' };

  const dailyLimitMinutes = patch.dailyLimitMinutes === undefined ? current.dailyLimitMinutes : patch.dailyLimitMinutes;
  if (dailyLimitMinutes !== null && (!Number.isInteger(dailyLimitMinutes) || dailyLimitMinutes < 1 || dailyLimitMinutes > 480)) {
    return { ok: false, error: 'dailyLimitMinutes must be 1..480 or null' };
  }

  const bedtimeStart = patch.bedtimeStart === undefined ? current.bedtimeStart : patch.bedtimeStart;
  const bedtimeEnd = patch.bedtimeEnd === undefined ? current.bedtimeEnd : patch.bedtimeEnd;
  const bedtimeTimezone = patch.bedtimeTimezone === undefined ? current.bedtimeTimezone : patch.bedtimeTimezone;

  if (bedtimeStart !== null && !isValidKidsTime(bedtimeStart)) return { ok: false, error: 'Invalid bedtimeStart' };
  if (bedtimeEnd !== null && !isValidKidsTime(bedtimeEnd)) return { ok: false, error: 'Invalid bedtimeEnd' };
  if ((bedtimeStart === null) !== (bedtimeEnd === null)) {
    return { ok: false, error: 'bedtimeStart and bedtimeEnd must both be set or both be null' };
  }
  if (bedtimeTimezone !== null && !isValidTimezone(bedtimeTimezone)) {
    return { ok: false, error: 'Invalid bedtimeTimezone' };
  }

  const prayerPauseEnabled = patch.prayerPauseEnabled ?? current.prayerPauseEnabled;
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO parental_controls (
         user_id, active_age_band, daily_limit_minutes, bedtime_start, bedtime_end, bedtime_timezone,
         prayer_pause_enabled, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         active_age_band = excluded.active_age_band,
         daily_limit_minutes = excluded.daily_limit_minutes,
         bedtime_start = excluded.bedtime_start,
         bedtime_end = excluded.bedtime_end,
         bedtime_timezone = excluded.bedtime_timezone,
         prayer_pause_enabled = excluded.prayer_pause_enabled,
         updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      activeAgeBand,
      dailyLimitMinutes,
      bedtimeStart,
      bedtimeEnd,
      bedtimeTimezone,
      prayerPauseEnabled ? 1 : 0,
      now,
    )
    .run();

  return { ok: true, view: await getParentalControls(db, userId) };
}

export async function setParentalPin(db: D1Database, userId: string, pin: string): Promise<ParentalControlsView> {
  const { pinHash, pinSalt } = await hashKidsPin(pin);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO parental_controls (
         user_id, pin_hash, pin_salt, pin_updated_at, pin_failed_attempts, pin_locked_until, pin_hard_locked, updated_at
       ) VALUES (?, ?, ?, ?, 0, NULL, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         pin_hash = excluded.pin_hash,
         pin_salt = excluded.pin_salt,
         pin_updated_at = excluded.pin_updated_at,
         pin_failed_attempts = 0,
         pin_locked_until = NULL,
         pin_hard_locked = 0,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, pinHash, pinSalt, now, now)
    .run();

  return getParentalControls(db, userId);
}

const DEFAULT_ALERT_FROM = 'Al Ummah Now <support@alummahnow.net>';

export interface PinAlertEnv {
  RESEND_API_KEY?: { get(): Promise<string> } | string;
  EMAIL_FROM?: string;
  CONTACT_FROM?: string;
  VIDEOS_WEB_URL?: string;
  NOTIFICATIONS_DB?: D1Database;
  profiles?: R2Bucket;
  ENVIRONMENT?: string;
}

export interface PinCheckOptions {
  nowMs?: number;
  env?: PinAlertEnv;
  email?: string | null;
  locale?: EmailLocale | null;
  fetchImpl?: typeof fetch;
  onHardLockout?: (info: { userId: string; email: string | null }) => Promise<void> | void;
}

async function resolveParentEmail(userId: string, opts?: PinCheckOptions): Promise<string | null> {
  if (typeof opts?.email === 'string' && opts.email.includes('@')) return opts.email.trim();
  const bucket = opts?.env?.profiles;
  if (!bucket) return null;
  try {
    const obj = await bucket.get(userId);
    const data = (await obj?.json<{ email?: unknown }>()) ?? null;
    return typeof data?.email === 'string' && data.email.includes('@') ? data.email.trim() : null;
  } catch {
    return null;
  }
}

async function resolveAlertLocale(userId: string, opts?: PinCheckOptions): Promise<EmailLocale> {
  const ndb = opts?.env?.NOTIFICATIONS_DB;
  if (ndb) {
    try {
      const prefs = await getEmailSettings(ndb, userId);
      if (prefs.locale === 'en' || prefs.locale === 'ar') return prefs.locale;
    } catch {
      // Fall back to request UI language when notifications DB table is absent in isolated test harnesses.
    }
  }
  return opts?.locale === 'ar' ? 'ar' : 'en';
}

function kidsPinAlertEmailDoc(locale: EmailLocale, siteUrl: string): EmailDoc {
  const base = siteUrl.replace(/\/$/, '');
  const settingsUrl = `${base}/${locale}/settings/parental-controls`;
  if (locale === 'ar') {
    return {
      locale: 'ar',
      siteUrl: base,
      subject: 'تنبيه أمني: قفل رمز الرقابة الأبوية في أطفال الأمة',
      preheader: 'تسبّبت محاولات خاطئة متكررة في قفل رمز الرقابة الأبوية حتى إعادة ضبطه.',
      heading: 'تم قفل رمز الرقابة الأبوية في أطفال الأمة',
      blocks: [
        {
          kind: 'notice',
          tone: 'warning',
          text: 'تم إدخال محاولات خاطئة متكررة لرمز الرقابة الأبوية في حسابك على الأمة الآن، ولذلك أُقفل الرمز إلى أن تعيد تسجيل الدخول لإعادة ضبطه.',
        },
        {
          kind: 'p',
          text: 'سجّل الدخول تفاعليًا بحساب الوالدين لإزالة القفل وتعيين رمز جديد للرقابة الأبوية.',
        },
      ],
      cta: { label: 'إعادة ضبط رمز الرقابة الأبوية', url: settingsUrl },
      reason: 'يصلك هذا التنبيه الأمني لأنّ إعدادات الرقابة الأبوية مفعّلة في حسابك على الأمة الآن.',
    };
  }
  return {
    locale: 'en',
    siteUrl: base,
    subject: 'Security alert: Ummah Kids parental PIN locked',
    preheader: 'Too many wrong parental PIN attempts locked your Ummah Kids PIN.',
    heading: 'Ummah Kids parental PIN locked',
    blocks: [
      {
        kind: 'notice',
        tone: 'warning',
        text: 'Too many wrong parental PIN attempts were entered on your Al Ummah Now account. Your PIN is now locked until you sign in again to reset it.',
      },
      {
        kind: 'p',
        text: 'Sign in interactively with your parent account to clear the lock and choose a new parental PIN.',
      },
    ],
    cta: { label: 'Reset parental PIN', url: settingsUrl },
    reason: 'You received this security alert because parental controls are enabled on your Al Ummah Now account.',
  };
}

async function sendKidsPinAlertEmail(userId: string, opts?: PinCheckOptions): Promise<void> {
  const email = await resolveParentEmail(userId, opts);
  if (opts?.onHardLockout) await opts.onHardLockout({ userId, email });
  if (!email || /@e2e\.alummahnow\.net$/i.test(email)) return;
  const keyBinding = opts?.env?.RESEND_API_KEY;
  if (!keyBinding) return;
  const apiKey = (await getSecret(keyBinding as never, 'RESEND_API_KEY').catch(() => '')).trim();
  if (!apiKey) return;

  const locale = await resolveAlertLocale(userId, opts);
  const siteUrl = opts?.env?.VIDEOS_WEB_URL?.trim() || 'https://www.alummahnow.net';
  const rendered = renderEmail(kidsPinAlertEmailDoc(locale, siteUrl));
  const from = opts?.env?.EMAIL_FROM?.trim() || opts?.env?.CONTACT_FROM?.trim() || DEFAULT_ALERT_FROM;

  const doFetch = opts?.fetchImpl ?? fetch;
  try {
    const res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    });
    if (!res.ok) {
      logger.warn('[KidsPin] Security alert email rejected by provider', { status: res.status });
    }
  } catch (err) {
    logger.warn('[KidsPin] Security alert email failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

async function triggerHardLockIfFirst(
  db: D1Database,
  userId: string,
  nowIso: string,
  opts?: PinCheckOptions,
): Promise<boolean> {
  const flipped = await db
    .prepare(
      `UPDATE parental_controls
       SET pin_hard_locked = 1, pin_locked_until = NULL, updated_at = ?
       WHERE user_id = ? AND pin_hard_locked = 0
       RETURNING user_id`,
    )
    .bind(nowIso, userId)
    .first<{ user_id: string }>();
  if (!flipped) return false;
  await sendKidsPinAlertEmail(userId, opts);
  return true;
}

export interface PinCheckResult {
  ok: boolean;
  view?: ParentalControlsView;
  code?: 'pin_not_set' | 'pin_invalid' | 'pin_locked';
  retryAfterSeconds?: number;
  lockedUntil?: string | null;
  hardLocked?: boolean;
  alertSent?: boolean;
}

/**
 * Atomically claims an attempt slot in D1 BEFORE running PBKDF2 so concurrent
 * requests cannot share the same failure count or slip past lockout thresholds (S4).
 */
export async function verifyAndConsumeParentalPin(
  db: D1Database,
  userId: string,
  pin: string,
  options: number | PinCheckOptions = {},
): Promise<PinCheckResult> {
  const opts = typeof options === 'number' ? { nowMs: options } : options;
  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const claimed = await db
    .prepare(
      `UPDATE parental_controls
       SET pin_failed_attempts = pin_failed_attempts + 1, updated_at = ?
       WHERE user_id = ?
         AND pin_hash IS NOT NULL
         AND pin_salt IS NOT NULL
         AND pin_hard_locked = 0
         AND (pin_locked_until IS NULL OR pin_locked_until <= ?)
       RETURNING user_id, pin_hash, pin_salt, pin_updated_at, pin_failed_attempts, pin_locked_until,
                 pin_hard_locked, active_age_band, daily_limit_minutes, bedtime_start, bedtime_end,
                 bedtime_timezone, prayer_pause_enabled, updated_at`,
    )
    .bind(nowIso, userId, nowIso)
    .first<ParentalControlsRow>();

  if (!claimed) {
    const row = await readRow(db, userId);
    if (!row || !row.pin_hash || !row.pin_salt) {
      return { ok: false, code: 'pin_not_set' };
    }
    if (row.pin_hard_locked === 1) {
      return { ok: false, code: 'pin_locked', hardLocked: true, lockedUntil: null };
    }
    if (row.pin_locked_until) {
      const lockedMs = Date.parse(row.pin_locked_until);
      if (Number.isFinite(lockedMs) && lockedMs > nowMs) {
        return {
          ok: false,
          code: 'pin_locked',
          retryAfterSeconds: Math.max(1, Math.ceil((lockedMs - nowMs) / 1000)),
          lockedUntil: row.pin_locked_until,
          hardLocked: false,
        };
      }
    }
    return { ok: false, code: 'pin_invalid' };
  }

  // Reject concurrent burst slots past the 8th failure ceiling without running PBKDF2,
  // sending at most one alert email via the atomic 0->1 `pin_hard_locked` transition (S-C, S-D).
  if (claimed.pin_failed_attempts >= 9) {
    const alertSent = await triggerHardLockIfFirst(db, userId, nowIso, opts);
    return { ok: false, code: 'pin_locked', hardLocked: true, lockedUntil: null, ...(alertSent ? { alertSent: true } : {}) };
  }

  const matched = await verifyKidsPin(pin, claimed.pin_hash!, claimed.pin_salt!);
  if (!matched) {
    const lock = nextPinLockout(claimed.pin_failed_attempts - 1, nowMs);
    if (lock.hardLocked) {
      const alertSent = await triggerHardLockIfFirst(db, userId, nowIso, opts);
      return {
        ok: false,
        code: 'pin_locked',
        hardLocked: true,
        ...(alertSent ? { alertSent: true } : {}),
      };
    }
    if (lock.lockedUntilIso) {
      await db
        .prepare(
          `UPDATE parental_controls
           SET pin_locked_until = ?, updated_at = ?
           WHERE user_id = ? AND pin_failed_attempts = ? AND pin_hard_locked = 0`,
        )
        .bind(lock.lockedUntilIso, nowIso, userId, claimed.pin_failed_attempts)
        .run();
    }
    return {
      ok: false,
      code: lock.lockedUntilIso ? 'pin_locked' : 'pin_invalid',
      ...(lock.retryAfterSeconds > 0 ? { retryAfterSeconds: lock.retryAfterSeconds } : {}),
      ...(lock.lockedUntilIso ? { lockedUntil: lock.lockedUntilIso } : {}),
      hardLocked: false,
    };
  }

  await db
    .prepare(
      `UPDATE parental_controls
       SET pin_failed_attempts = 0, pin_locked_until = NULL, pin_hard_locked = 0, updated_at = ?
       WHERE user_id = ?`,
    )
    .bind(nowIso, userId)
    .run();

  return {
    ok: true,
    view: rowToView({ ...claimed, pin_failed_attempts: 0, pin_locked_until: null, pin_hard_locked: 0 }),
  };
}

/** Export parent-owned parental controls without ever exposing `pin_hash` or `pin_salt`. */
export async function exportParentalControls(db: D1Database, userId: string): Promise<ParentalControlsView | null> {
  const row = await readRow(db, userId);
  return row ? rowToView(row) : null;
}

/**
 * Erase parental controls row and anonymize user references in Kids review requests
 * and catalog audit log (GDPR Art. 17; safe when tables do not yet exist in legacy test DBs).
 */
export async function eraseKidsUserData(db: D1Database, userId: string, tombId: string): Promise<number> {
  let deletedRows = 0;
  try {
    const res = await db.prepare('DELETE FROM parental_controls WHERE user_id = ?').bind(userId).run();
    deletedRows += Number((res as { meta?: { changes?: number } })?.meta?.changes ?? 0);
  } catch (err) {
    if (!String(err).includes('no such table')) throw err;
  }

  const updates: [string, unknown[]][] = [
    ['UPDATE kids_review_requests SET requested_by = ? WHERE requested_by = ?', [tombId, userId]],
    ['UPDATE kids_review_requests SET decided_by = ? WHERE decided_by = ?', [tombId, userId]],
    ['UPDATE kids_catalog_audit SET actor_id = ? WHERE actor_id = ?', [tombId, userId]],
  ];
  for (const [sql, binds] of updates) {
    try {
      await db.prepare(sql).bind(...binds).run();
    } catch (err) {
      if (!String(err).includes('no such table')) throw err;
    }
  }
  return deletedRows;
}

/**
 * Checks if a target item (`video` or curated `playlist`) is explicitly approved for Kids Mode.
 * Until KIDS-D16 is decided, channel-wide approvals admit nothing automatically (S2: fail closed).
 */
export async function isTargetAllowlistedInKidsCatalog(
  db: D1Database,
  targetType: KidsTargetType,
  targetId: string,
  options: { ageBand: KidsActiveAgeBand },
): Promise<boolean> {
  if (targetType !== 'video' && targetType !== 'playlist') return false;
  const bands = matchingKidsAgeBands(options.ageBand);
  const bandPlaceholders = bands.map(() => '?').join(', ');

  const direct = await db
    .prepare(
      `SELECT 1 AS ok
       FROM kids_catalog_items
       WHERE target_type = ? AND target_id = ? AND status = 'approved'
         AND age_band IN (${bandPlaceholders})
       LIMIT 1`,
    )
    .bind(targetType, targetId, ...bands)
    .first<{ ok: number }>();
  return direct?.ok === 1;
}
