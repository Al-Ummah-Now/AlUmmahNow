import { cache } from 'react';
import { getChannelById } from '@/lib/api/channels';
import { getChannelByHandle } from '@/lib/api/channel-profile';

/**
 * Per-request memoised channel lookups: the channel layout, its metadata and
 * the page all need the channel, but the API is called once per request.
 */
export const loadChannelById = cache((id: string) => getChannelById(id));

export const loadChannelByHandle = cache((handle: string) => getChannelByHandle(handle));

/** Decode a [handle] route segment ("%40name" / "@name" / "name"). */
export function decodeHandleSegment(raw: string): string {
  try {
    return decodeURIComponent(raw).replace(/^@+/, '');
  } catch {
    return raw;
  }
}
