/**
 * GET /api/review-media/:reviewId?key=review/...  a frame of a video under review, streamed from
 * admin-api with the session's token (the browser never holds the admin API token). Never cached:
 * unpublished, possibly NSFW media (docs/specs/VIDEO-REVIEW.md §6).
 */
import { getAdminSession } from '@/lib/auth';
import { logger } from '@/lib/logger';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://127.0.0.1:3090';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await getAdminSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await params;
  const key = new URL(request.url).searchParams.get('key') ?? '';
  if (!key.startsWith('review/') || key.length > 500) return new Response(null, { status: 400 });
  try {
    const upstream = await fetch(`${ADMIN_API_URL}/api/review/${encodeURIComponent(id)}/media?${new URLSearchParams({ key })}`, { headers: { Authorization: `Bearer ${session.accessToken}` }, cache: 'no-store', signal: request.signal });
    return new Response(upstream.body, { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    logger.error('[review-media] Admin API unreachable', { id, error: error instanceof Error ? error.message : String(error) });
    return new Response(null, { status: 503 });
  }
}
