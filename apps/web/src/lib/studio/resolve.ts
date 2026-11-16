/** Which channel a link with no channel in it should open (spec §3.2). */

export interface ResolvableChannel {
  id: string;
  isMain?: boolean;
}

export function chooseChannel(channels: readonly ResolvableChannel[], activeChannelId?: string | null): string | null {
  if (channels.length === 0) return null;
  const active = channels.find((channel) => channel.id === activeChannelId);
  return (active ?? channels.find((channel) => channel.isMain) ?? channels[0]).id;
}

const STUDIO_PATH = /^\/(en|ar)\/studio(\/[A-Za-z0-9_-]+)*$/;

/** A path sign-in may return to: only a Studio page on this site, never a full URL. */
export function safeStudioReturn(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 512 && STUDIO_PATH.test(value) ? value : null;
}

/** Codes the YouTube connection's callback may send (wiki AUN-YT-IMPORT). */
const YOUTUBE_CONNECT_ERRORS = new Set(['failed', 'youtube_denied', 'youtube_no_channel']);

/**
 * Where /studio opens a channel. The YouTube callback lands on /studio?error=<code> when it can't
 * tell which channel the connection was for (missing or expired state); that error belongs on the
 * Move from YouTube tab, where it is explained with a Connect again button, not lost on the dashboard.
 */
export function studioLanding(locale: string, channelId: string, error?: unknown): string {
  const base = `/${locale}/studio/${encodeURIComponent(channelId)}`;
  return typeof error === 'string' && YOUTUBE_CONNECT_ERRORS.has(error) ? `${base}/content/youtube?error=${error}` : `${base}/dashboard`;
}
