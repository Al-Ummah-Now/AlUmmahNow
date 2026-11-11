/**
 * oEmbed provider: GET /oembed?url=…&maxwidth=&maxheight=&format=json
 * (docs/embeds/README.md §3, spec 25.3). Public data, CORS *, no credentials.
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger-server';
import { loadPublicPlaylist, loadPublicVideo, localizedTitle, videoAspect } from '@/lib/embed/content';
import { buildOEmbed, fitSize, parseContentUrl, type OEmbedContent } from '@/lib/embed/oembed';
import { channelPath } from '@/lib/channel-url';
import { requestOrigin } from '@/lib/embed/request-origin';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status: number, cacheSeconds = 0): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      'Cache-Control': cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = request.nextUrl;
  const format = searchParams.get('format');
  if (format && format !== 'json') return json({ error: 'Only format=json is supported' }, 501);

  const url = searchParams.get('url');
  if (!url) return json({ error: 'Missing url parameter' }, 400);

  const origin = requestOrigin(request);
  let ref = parseContentUrl(url, new URL(origin).host);
  if (!ref) return json({ error: 'URL not recognised' }, 404);

  let size = fitSize(searchParams.get('maxwidth'), searchParams.get('maxheight'));
  let content: OEmbedContent | null = null;

  // A video inside a public playlist embeds the playlist, starting at that video (PLAYLIST-PLAYBACK.md 2.5)
  if (ref.kind === 'video' && ref.list) {
    const playlist = await loadPublicPlaylist(ref.list);
    const at = playlist ? playlist.videos.findIndex((v) => v.id === ref.id) : -1;
    if (playlist && at >= 0) {
      ref = { kind: 'playlist', id: playlist.id, index: at };
      content = { title: playlist.title, authorName: playlist.channelName || undefined, thumbnailUrl: playlist.videos[at].poster };
    }
  }

  if (content) {
    logger.debug('[oembed] Video in a playlist: playlist embed', { playlistId: ref.id, index: ref.index });
  } else if (ref.kind === 'video') {
    const video = await loadPublicVideo(ref.id);
    if (video) {
      // the video's own ratio (a Short is 9:16), not always 16:9
      size = fitSize(searchParams.get('maxwidth'), searchParams.get('maxheight'), videoAspect(video));
      content = {
        title: localizedTitle(video, 'en'),
        authorName: video.channelName || undefined,
        authorUrl: video.channelId
          ? `${origin}${channelPath('en', { id: video.channelId, handle: video.channelHandle ?? undefined })}`
          : undefined,
        thumbnailUrl: video.poster,
        duration: video.duration,
      };
    }
  } else {
    const playlist = await loadPublicPlaylist(ref.id);
    if (playlist && playlist.videos.length > 0) {
      content = {
        title: playlist.title,
        authorName: playlist.channelName || undefined,
        thumbnailUrl: playlist.videos[0].poster,
      };
    }
  }

  if (!content) {
    logger.debug('[oembed] Not available', { kind: ref.kind, id: ref.id });
    return json({ error: 'Not found' }, 404);
  }
  return json(buildOEmbed(origin, ref, size, content), 200, 300);
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
