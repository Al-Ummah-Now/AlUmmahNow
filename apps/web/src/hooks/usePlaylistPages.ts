'use client';

/**
 * The playlists a picker offers (Save to playlist, Add to playlist, Manage
 * Playlists): a channel's, or without one the user's personal playlists
 * (?mine=true). They open with the first page; `loadMore` adds the next one
 * ("Show more playlists") and `query` searches every playlist on the server
 * (?q=), so a user with hundreds of playlists can reach each of them. The
 * pickers used to read the first 50 or 100 and silently drop the rest.
 */
import { useCallback, useEffect, useState } from 'react';
import { listPlaylists, type PlaylistWithVideos } from '@/lib/api/playlists';
import { useCursorList, type CursorListState } from './useCursorList';

/** Playlists per page */
export const PLAYLIST_PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 250;

interface Options {
  /** Nothing is read while false (a closed menu) */
  enabled?: boolean;
  /** The search box's text; searched on the server once typing pauses */
  query?: string;
  /** Change it to read the list again from the first page (e.g. on each opening) */
  reloadKey?: string | number;
}

export interface PlaylistPages extends CursorListState<PlaylistWithVideos> {
  /** The search the shown list answers ('' while not searching) */
  searched: string;
}

export function usePlaylistPages(channelId: string | undefined, { enabled = true, query = '', reloadKey = 0 }: Options = {}): PlaylistPages {
  const [searched, setSearched] = useState(query.trim());
  useEffect(() => {
    const next = query.trim();
    const timer = setTimeout(() => setSearched(next), next ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchPage = useCallback(async (cursor: string | undefined) => {
    if (!enabled) return { data: [], cursor: '' };
    const page = await listPlaylists({
      ...(channelId ? { channelId } : { mine: true }),
      limit: PLAYLIST_PAGE_SIZE,
      ...(cursor ? { cursor } : {}),
      ...(searched ? { q: searched } : {}),
    });
    if (!page) throw new Error('Playlists could not be listed');
    return { data: page.data, cursor: (page as { cursor?: string | null }).cursor ?? '' };
  }, [channelId, enabled, searched]);

  const list = useCursorList<PlaylistWithVideos>(`${enabled ? 'on' : 'off'}|${channelId || 'mine'}|${searched}|${reloadKey}`, fetchPage, 'playlists');
  return { ...list, searched };
}
