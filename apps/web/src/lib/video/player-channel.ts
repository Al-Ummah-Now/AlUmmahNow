import type { PlayerOptions } from '@/components/VideoPagePlayer/interface';

/**
 * Channel of a watch-page video. `channel` is a legacy field: older videos
 * carry the channel's display NAME there ("Mostafa Elbadry"), so it must never
 * be used as an id; links built from it asked the API for
 * GET /api/channels/Mostafa%20Elbadry and got a 404 (#289).
 */
export function playerChannelId(options: Pick<PlayerOptions, 'channelId'>): string | undefined {
  return options.channelId || undefined;
}

/** Display name: `channelName`, else the legacy `channel` name. */
export function playerChannelName(options: Pick<PlayerOptions, 'channelName' | 'channel'>): string {
  return options.channelName || options.channel || '';
}

/** Public channel page of the video, or undefined when the video has no channel id. */
export function playerChannelHref(locale: string, options: Pick<PlayerOptions, 'channelId'>): string | undefined {
  const id = playerChannelId(options);
  return id ? `/${locale}/channels/${encodeURIComponent(id)}` : undefined;
}
