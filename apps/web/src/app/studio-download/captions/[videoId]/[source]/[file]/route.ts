/**
 * Studio caption download: GET /studio-download/captions/<videoId>/<track|draft>/<lang>.<vtt|srt>
 * (AUN-CAPTIONS, QF 2026-11-22).
 *
 * The creator's session asks the videos API for one video's caption file — the published track
 * (`/subtitles/:lang/download`, which follows the video's visibility: the owner and channel staff get
 * private, unlisted and draft videos) or a caption draft (`/captions/drafts/:lang/download`, owner or
 * `video.edit`). The API fills Quran text at download time, unaltered, with Quran Foundation's
 * attribution inside the file; this route only passes the file through, same origin, so Studio can
 * fetch it with the session and save it under the API's attachment name. Never cached.
 */
import { buildApiUrl } from '@/lib/api/api-client';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { logger } from '@/lib/logger-server';

const VIDEO_ID = /^[A-Za-z0-9_-]{1,80}$/;
const FILE = /^([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)\.(vtt|srt)$/;
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
/** The API's attachment header (its names are already reduced to [\w.-]) */
const DISPOSITION = /^attachment; filename="[\w.-]{1,160}"$/;
const PASSED_ON = new Set([400, 401, 403, 404]);

function status(code: number, text: string): Response {
  return new Response(text, { status: code, headers: NO_STORE });
}

export async function GET(_request: Request, { params }: { params: Promise<{ videoId: string; source: string; file: string }> }): Promise<Response> {
  const { videoId, source, file } = await params;
  const match = FILE.exec(file);
  if (!VIDEO_ID.test(videoId) || (source !== 'track' && source !== 'draft') || !match) return status(404, 'Not found');
  const [, language, format] = match as unknown as [string, string, 'vtt' | 'srt'];

  const auth = await getServerAuthContext();
  if (!auth?.accessToken) return status(401, 'Sign in');

  const path =
    source === 'draft'
      ? `/api/videos/${encodeURIComponent(videoId)}/captions/drafts/${encodeURIComponent(language)}/download?format=${format}`
      : `/api/videos/${encodeURIComponent(videoId)}/subtitles/${encodeURIComponent(language)}/download?format=${format}`;
  try {
    const upstream = await fetch(buildApiUrl(path), { headers: { Authorization: `Bearer ${auth.accessToken}` }, cache: 'no-store' });
    if (!upstream.ok || !upstream.body) {
      if (PASSED_ON.has(upstream.status)) return status(upstream.status, upstream.status === 404 ? 'Not found' : 'Unavailable');
      logger.error('[studio-download] caption download failed', { videoId, source, language, status: upstream.status });
      return status(502, 'Unavailable');
    }
    const disposition = upstream.headers.get('content-disposition') ?? '';
    const headers = new Headers({
      ...NO_STORE,
      'Content-Type': format === 'srt' ? 'application/x-subrip; charset=utf-8' : 'text/vtt; charset=utf-8',
      'Content-Disposition': DISPOSITION.test(disposition) ? disposition : `attachment; filename="${videoId}-${language}${source === 'draft' ? '-draft' : ''}.${format}"`,
    });
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    logger.error('[studio-download] caption download threw', { videoId, source, language, error });
    return status(502, 'Unavailable');
  }
}
