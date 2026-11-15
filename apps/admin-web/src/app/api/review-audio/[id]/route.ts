/**
 * GET /api/review-audio/:reviewId  the audio track under review (wiki AUN-MULTI-AUDIO MA8), streamed
 * from admin-api with the session's token; Range is passed through so the player can seek. Never
 * cached: unpublished media.
 */
import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getAdminSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await params;
  const headers: Record<string, string> = { Authorization: `Bearer ${session.accessToken}` };
  const range = request.headers.get('range');
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.range = range;
  try {
    const upstream = await fetch(`${ADMIN_API_URL}/api/review/${encodeURIComponent(id)}/audio`, { headers, cache: 'no-store', signal: request.signal });
    const out = new Headers({ 'content-type': upstream.headers.get('content-type') ?? 'audio/mp4', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'accept-ranges': 'bytes' });
    for (const h of ['content-length', 'content-range']) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    logger.error('[review-audio] Admin API unreachable', { id, error: error instanceof Error ? error.message : String(error) });
    return new Response(null, { status: 503 });
  }
}
