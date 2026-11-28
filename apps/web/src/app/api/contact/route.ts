import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import * as v from 'valibot';
import { SessionManager } from '@/lib/auth/session-manager';
import { logger } from '@/lib/logger';
import { jsonObjectSchema, sanitizeHeaderValue } from '@/lib/security/safe-input';

/**
 * Contact us form endpoint (same origin, so no CORS and no extra CSP host).
 * Forwards to admin-api POST /internal/contact with the internal API key, the
 * visitor's IP (for the rate limit) and user agent, and, when signed in, the
 * active account's access token: admin-api then uses the account's email.
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 32 * 1024;

async function internalApiKey(): Promise<string> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    const binding = (env as unknown as { INTERNAL_API_KEY?: string | { get(): Promise<string> } }).INTERNAL_API_KEY;
    if (typeof binding === 'string' && binding) return binding;
    if (binding && typeof binding !== 'string') return (await binding.get()) || '';
  } catch {
    // Not running on Workers (next dev): fall through to process.env
  }
  return process.env.INTERNAL_API_KEY || '';
}

export async function POST(req: NextRequest) {
  // Only this site's own pages may post here
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'too_large' }, { status: 413 });
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const checked = v.safeParse(jsonObjectSchema, parsedJson);
  if (!checked.success) return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  const body = checked.output;

  const adminApi = process.env.ADMIN_API_URL;
  const key = await internalApiKey();
  if (!adminApi || !key) {
    logger.error('[contact] ADMIN_API_URL or INTERNAL_API_KEY is not configured');
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const session = await SessionManager.ensureFreshActiveSession().catch(() => null);
  const clientIp = sanitizeHeaderValue(req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0], 128) || 'unknown';
  const clientUa = sanitizeHeaderValue(req.headers.get('user-agent'), 512) || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': key,
    'X-Client-IP': clientIp,
    'X-Client-User-Agent': clientUa,
  };
  if (session?.accessToken) headers.Authorization = `Bearer ${session.accessToken}`;

  let upstream: Response;
  try {
    upstream = await fetch(`${adminApi.replace(/\/$/, '')}/internal/contact`, { method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store' });
  } catch (error) {
    logger.error('[contact] admin-api unreachable', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const result = (await upstream.json().catch(() => ({}))) as { result?: { id?: string | null }; errors?: Record<string, string>; error?: string; siteKey?: string };
  if (upstream.status === 201) return NextResponse.json({ ok: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  if (upstream.status === 400 && result.errors) return NextResponse.json({ error: 'validation', errors: result.errors }, { status: 400 });
  if (upstream.status === 429) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  // Turnstile (admin-api lib/bot-guard.ts): the page runs the check and sends again with the token
  if (upstream.status === 403 && result.error === 'human_check_required') {
    return NextResponse.json({ error: 'human_check_required', siteKey: result.siteKey ?? null }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  logger.error('[contact] admin-api refused the message', { status: upstream.status, error: result.error });
  return NextResponse.json({ error: 'failed' }, { status: 502 });
}
