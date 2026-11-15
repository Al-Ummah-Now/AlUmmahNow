import { cache } from 'react';
import { headers } from 'next/headers';
import { getPublicUserByHandle } from '@/lib/api/public-profile';
import { originFromHost } from '@/lib/embed/request-origin';

/** Per-request memoised profile lookup: the layout, its metadata and the page call the API once. */
export const loadPublicProfile = cache((handle: string, locale: string) => getPublicUserByHandle(handle, locale));

/** Absolute origin of the current request (canonical links need absolute URLs). */
export async function requestOrigin(): Promise<string | null> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') || h.get('host');
    return host ? originFromHost(host) : null;
  } catch {
    return null;
  }
}
