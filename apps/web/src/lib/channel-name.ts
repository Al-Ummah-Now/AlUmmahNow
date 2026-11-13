/**
 * The channel name to show on a page: the page language's name, else the default name, else any
 * other language's. API payloads carry `channelName` plus `channelNameLocalized` (api-videos
 * lib/channelName.ts); showing `channelName` alone put English channel names under Arabic titles
 * on /ar (owner, 2026-11-13).
 */
export interface ChannelNamed {
  channelName?: string | null;
  channelNameLocalized?: Record<string, string | null | undefined> | null;
  /** Older payloads name the channel here */
  channel?: string | null;
}

export function channelLabel(item: ChannelNamed | null | undefined, lang: string): string {
  if (!item) return '';
  const names = item.channelNameLocalized ?? {};
  const own = names[lang]?.trim();
  if (own) return own;
  const fallback = item.channelName?.trim() || (typeof item.channel === 'string' ? item.channel.trim() : '');
  if (fallback) return fallback;
  for (const name of Object.values(names)) if (name?.trim()) return name.trim();
  return '';
}
