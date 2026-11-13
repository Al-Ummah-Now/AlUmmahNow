import { NextResponse, type NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import { SessionManager } from '@/lib/auth/session-manager';
import { logger } from '@/lib/logger';
import { upstreamPath } from '@/lib/studio/site-domains';

/**
 * Studio → Site → Domains (wiki AUN-SCHOLAR-SITES §4.2, #1212): this site's pages call here, and the
 * server passes the call to admin-api /internal/site-domains with the internal key and the signed-in
 * account's access token. admin-api checks the token and that the account may edit the channel
 * (channel.edit), then talks to Cloudflare for SaaS. Same-origin only; no caching.
 *
 *   GET    /api/studio/site-domains/:channelId               → the domains, hosts and limit
 *   POST   /api/studio/site-domains/:channelId               { host }
 *   POST   /api/studio/site-domains/:channelId/:host/refresh
 *   DELETE /api/studio/site-domains/:channelId/:host
 *   PUT    /api/studio/site-domains/:channelId/primary       { host }
 */
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4 * 1024;

async function bindings(): Promise<{ key: string; adminApi: string }> {
  let key = '';
  let adminApi = '';
  try {
    const { env } = await getCloudflareContext({ async: true });
    const e = env as unknown as { INTERNAL_API_KEY?: string | { get(): Promise<string> }; ADMIN_API_URL?: string };
    const b = e.INTERNAL_API_KEY;
    key = typeof b === 'string' ? b : ((await b?.get()) ?? '');
    adminApi = e.ADMIN_API_URL ?? '';
  } catch {
    // Not running on Workers (next dev): process.env below
  }
  return { key: key || process.env.INTERNAL_API_KEY || '', adminApi: adminApi || process.env.ADMIN_API_URL || '' };
}

async function handle(req: NextRequest, ctx: { params: Promise<{ channelId: string; path?: string[] }> }) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return NextResponse.json({ code: 'forbidden' }, { status: 403 });
  const { channelId, path = [] } = await ctx.params;
  const target = upstreamPath(req.method, channelId, path);
  if (!target) return NextResponse.json({ code: 'not_found' }, { status: 404 });

  let body: string | undefined;
  if (req.method === 'POST' || req.method === 'PUT') {
    body = await req.text();
    if (body.length > MAX_BODY_BYTES) return NextResponse.json({ code: 'too_large' }, { status: 413 });
  }
  const session = await SessionManager.ensureFreshActiveSession().catch(() => null);
  if (!session?.accessToken) return NextResponse.json({ code: 'unauthorized' }, { status: 401 });
  const { key, adminApi } = await bindings();
  if (!key || !adminApi) {
    logger.error('[site-domains] ADMIN_API_URL or INTERNAL_API_KEY is not configured');
    return NextResponse.json({ code: 'unavailable' }, { status: 503 });
  }
  try {
    const upstream = await fetch(`${adminApi.replace(/\/$/, '')}${target}`, {
      method: req.method,
      headers: { 'X-API-Key': key, Authorization: `Bearer ${session.accessToken}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body,
      cache: 'no-store',
    });
    const payload = await upstream.json().catch(() => ({ code: 'unavailable' }));
    return NextResponse.json(payload, { status: upstream.status, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    logger.error('[site-domains] admin-api unreachable', { channelId, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ code: 'unavailable' }, { status: 503 });
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
