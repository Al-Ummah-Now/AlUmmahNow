import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import * as v from 'valibot';
import { logger } from '@/lib/logger';
import { jsonObjectSchema, sanitizeHeaderValue } from '@/lib/security/safe-input';

/**
 * Reports of people who are not signed in (same origin, /[locale]/report; signed-in people use
 * lib/api/moderation.ts). Forwards to admin-api POST /internal/guest-reports with the internal API key and the
 * visitor's address, which is only counted (admin-api lib/guest-report-limits.ts).
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
    logger.error('[guest-report] ADMIN_API_URL or INTERNAL_API_KEY is not configured');
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const cfIp = sanitizeHeaderValue(req.headers.get('cf-connecting-ip'), 128);
  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': key,
    // Only what Cloudflare itself says; a header of the visitor's own would pick their limit
    ...(cfIp ? { 'X-Client-IP': cfIp } : {}),
  };

  let upstream: Response;
  try {
    upstream = await fetch(`${adminApi.replace(/\/$/, '')}/internal/guest-reports`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (error) {
    logger.error('[guest-report] admin-api unreachable', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }

  const result = (await upstream.json().catch(() => ({}))) as {
    errors?: Record<string, string>;
    code?: string;
    error?: string;
    siteKey?: string;
  };
  const errCode = result.code ?? result.error;
  // The same answer for every report that was taken, whatever it is about
  if (upstream.status === 201) return NextResponse.json({ ok: true }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  if (upstream.status === 400 && result.errors) {
    return NextResponse.json({ error: 'validation', errors: result.errors }, { status: 400 });
  }
  if (upstream.status === 429) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }
  if (upstream.status === 403 && errCode === 'human_check_required') {
    return NextResponse.json(
      { error: 'human_check_required', siteKey: result.siteKey ?? null },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (upstream.status === 503) {
    return NextResponse.json({ error: 'unavailable' }, { status: 503 });
  }
  logger.error('[guest-report] admin-api refused the report', { status: upstream.status, error: errCode });
  return NextResponse.json({ error: 'failed' }, { status: 502 });
}
