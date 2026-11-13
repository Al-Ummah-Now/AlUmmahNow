import { cache } from 'react';
import { loadPublicPlaylistResult, loadPublicVideoResult } from '@/lib/embed/content';
import { buildApiUrl } from '@/lib/api/api-client';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { logger } from '@/lib/logger-server';
import { classifyAvailability, type ApiStatus, type Availability } from './availability';

/** The signed-in viewer's status for an API path; undefined when nobody is signed in. */
async function viewerStatus(path: string): Promise<ApiStatus | undefined> {
  let accessToken: string | undefined;
  try {
    accessToken = (await getServerAuthContext())?.accessToken;
  } catch {
    accessToken = undefined;
  }
  if (!accessToken) return undefined;
  try {
    const response = await fetch(buildApiUrl(path), {
      headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
    return response.status;
  } catch (error) {
    logger.warn('[availability] signed-in lookup failed', { path, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/** Per request: the watch layout and its metadata share one answer. */
export const videoAvailability = cache(async (id: string): Promise<Availability> =>
  classifyAvailability((await loadPublicVideoResult(id)).status, () => viewerStatus(`/api/videos/${encodeURIComponent(id)}`)));

export const playlistAvailability = cache(async (id: string): Promise<Availability> =>
  classifyAvailability((await loadPublicPlaylistResult(id)).status, () => viewerStatus(`/api/playlists/${encodeURIComponent(id)}`)));
