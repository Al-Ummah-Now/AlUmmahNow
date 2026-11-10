import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { ERROR_LIMITS } from '@al-ummah/shared-types';

/**
 * Browser error reports (lib/errors/reporter.ts) → admin-api POST /internal/errors.
 *
 * Same origin, so sendBeacon works (it posts text/plain or application/json)
 * and no CSP host is needed. admin-api trusts nothing the page claims about
 * who it is: this route vouches for the app (X-Report-App: web) and the
 * signed-in account from the server-side session (X-Client-User-Id; the
 * page's own userId is dropped). Adds the internal API key, the visitor's IP (for
 * admin-api's per-IP rate limit; never stored) and user agent (parsed into
 * browser/OS; never stored), and marks the batch as browser-sourced so it can
 * neither resolve items nor attach Retry actions. Answers 202 at once; the
 * forward runs in the background. Reporting must never fail the page, so
 * nothing here is logged through the reporting logger.
 */
export const dynamic = 'force-dynamic';

interface Ctx {
  env: Record<string, unknown>;
  ctx?: { waitUntil(p: Promise<unknown>): void };
}

async function cloudflare(): Promise<Ctx | null> {
  try {
    return (await getCloudflareContext({ async: true })) as unknown as Ctx;
  } catch {
    return null; // next dev
  }
}

async function internalApiKey(cf: Ctx | null): Promise<string> {
  const binding = cf?.env.INTERNAL_API_KEY as string | { get(): Promise<string> } | undefined;
  try {
    if (typeof binding === 'string' && binding) return binding;
    if (binding && typeof binding !== 'string') return (await binding.get()) || '';
  } catch {
    // fall through
  }
  return process.env.INTERNAL_API_KEY || '';
}

/** The signed-in account from the session cookie (no network call); none when signed out. */
async function sessionUserId(): Promise<string | null> {
  try {
    const { SessionManager } = await import('@/lib/auth/session-manager');
    return (await SessionManager.getActiveSession())?.userId ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return new NextResponse(null, { status: 403 });
  const text = await req.text();
  if (!text || text.length > ERROR_LIMITS.maxBodyBytes) return new NextResponse(null, { status: 413 });
  try {
    const parsed = JSON.parse(text) as { events?: unknown };
    if (!parsed || !Array.isArray(parsed.events)) return new NextResponse(null, { status: 400 });
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const cf = await cloudflare();
  const adminApi = (cf?.env.ADMIN_API_URL as string | undefined) || process.env.ADMIN_API_URL;
  const key = await internalApiKey(cf);
  if (!adminApi || !key) return new NextResponse(null, { status: 204 });

  const userId = await sessionUserId();
  const forward = fetch(`${adminApi.replace(/\/$/, '')}/internal/errors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': key,
      'X-Report-Source': 'browser',
      'X-Report-App': 'web',
      ...(userId ? { 'X-Client-User-Id': userId } : {}),
      'X-Client-IP': req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
      'X-Client-User-Agent': (req.headers.get('user-agent') || '').slice(0, 512),
    },
    body: text,
    cache: 'no-store',
  })
    .then(() => undefined)
    .catch(() => undefined);
  if (cf?.ctx?.waitUntil) cf.ctx.waitUntil(forward);
  else await forward;
  return new NextResponse(null, { status: 202, headers: { 'Cache-Control': 'no-store' } });
}
