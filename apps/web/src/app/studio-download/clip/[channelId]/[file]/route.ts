/**
 * Share kit clip download: GET /studio-download/clip/<channelId>/<shortId>.mp4 (wiki AUN-SOCIAL, SOC-1).
 *
 * The creator's session asks the videos API for the Short's MP4 source (only a channel member with video.edit
 * gets it, and only for a Short of that channel), then the file streams back as an attachment so the browser
 * saves it, which a cross-origin `<a download>` can't do. Never cached.
 */
import { buildApiUrl, apiRequestServerResult } from '@/lib/api/api-client';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { fetchAllowedImageSource, isAllowedImageSource } from '@/lib/embed/share-image';
import { logger } from '@/lib/logger-server';

const ID = /^[A-Za-z0-9_-]{1,80}$/;
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

function status(code: number, text: string): Response {
  return new Response(text, { status: code, headers: NO_STORE });
}

export async function GET(_request: Request, { params }: { params: Promise<{ channelId: string; file: string }> }): Promise<Response> {
  const { channelId, file } = await params;
  const shortId = /^(.+)\.mp4$/.exec(file)?.[1];
  if (!ID.test(channelId) || !shortId || !ID.test(shortId)) return status(404, 'Not found');

  const source = await apiRequestServerResult<{ url: string }>(
    { method: 'GET', url: buildApiUrl(`/api/social/channel/${encodeURIComponent(channelId)}/share-kit/${encodeURIComponent(shortId)}/clip-source`), functionName: 'shareKitClipSource' },
    getServerAuthContext,
    true,
  );
  if (source.status === 401 || source.status === 403) return status(source.status, 'Forbidden');
  if (source.status === 404) return status(404, 'Not found');
  const url = source.data?.url;
  // Same hosts as share images: Bunny's CDN or our own media domains, https only
  if (source.status !== 200 || !url || !isAllowedImageSource(url)) {
    logger.error('[studio-download] clip source unavailable', { channelId, shortId, status: source.status });
    return status(502, 'Unavailable');
  }

  try {
    const upstream = await fetchAllowedImageSource(url);
    if (!upstream || !upstream.ok || !upstream.body) {
      logger.error('[studio-download] clip fetch failed', { channelId, shortId, status: upstream?.status ?? 0 });
      return status(502, 'Unavailable');
    }
    const headers = new Headers({ ...NO_STORE, 'Content-Type': 'video/mp4', 'Content-Disposition': `attachment; filename="${shortId}.mp4"` });
    const length = upstream.headers.get('content-length');
    if (length && /^\d+$/.test(length)) headers.set('Content-Length', length);
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    logger.error('[studio-download] clip fetch threw', { channelId, shortId, error });
    return status(502, 'Unavailable');
  }
}
