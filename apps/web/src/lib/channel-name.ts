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

/** A channel object's names (the `Channel` shape: `name` + `nameLocalized`). */
export interface ChannelOwnNamed {
  name?: string | null;
  nameLocalized?: Record<string, string | null | undefined> | null;
}

/**
 * A channel's name in `lang`, else its default name, trimmed; '' when it has neither. The types
 * say `name: string`, but API responses are not validated against them: a stored channel without
 * a name reached the channel header as `undefined` and its `name.charAt(0)` aborted the render.
 */
export function channelOwnName(channel: ChannelOwnNamed | null | undefined, lang: string): string {
  if (!channel) return '';
  const own = channel.nameLocalized?.[lang];
  if (typeof own === 'string' && own.trim()) return own.trim();
  return typeof channel.name === 'string' ? channel.name.trim() : '';
}
