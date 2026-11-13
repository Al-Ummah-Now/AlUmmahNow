/**
 * A channel's name as it goes out with a video (or a post, a playlist item, a history entry):
 * the default `channelName` plus the names it has per language (`channelNameLocalized`, e.g.
 * { en: 'Al Ummah Now', ar: 'الأمة الآن' }), so every page shows the name in its own language
 * (web: lib/channel-name.ts channelLabel). Lists used to send the default name only, and Arabic
 * pages showed English channel names under Arabic titles.
 */

export interface NamedChannel {
  name?: string | null;
  nameLocalized?: Record<string, string | null | undefined> | null;
}

export interface ChannelNameFields {
  channelName: string;
  channelNameLocalized?: Record<string, string>;
}

/** The non-empty names per language (trimmed). */
export function localizedChannelNames(channel?: NamedChannel | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [lang, value] of Object.entries(channel?.nameLocalized ?? {})) {
    const name = typeof value === 'string' ? value.trim() : '';
    if (name) out[lang] = name;
  }
  return out;
}

/** `channelName` (the default name, else any localized one, else `fallback`) and `channelNameLocalized` when the channel has any. */
export function channelNameFields(channel?: NamedChannel | null, fallback = ''): ChannelNameFields {
  const localized = localizedChannelNames(channel);
  const name = channel?.name?.trim() || localized.en || Object.values(localized)[0] || fallback;
  return Object.keys(localized).length ? { channelName: name, channelNameLocalized: localized } : { channelName: name };
}

/**
 * The channel's name as notification params: `channelName` (the default) and one
 * `channelName_<lang>` per language it has. Notification params are flat strings;
 * the web shows the viewer's language's name (lib/websocket/notification-text.ts).
 */
export function channelNameParams(channel?: NamedChannel | null, fallback = ''): Record<string, string> {
  const { channelName, channelNameLocalized } = channelNameFields(channel, fallback);
  const params: Record<string, string> = { channelName };
  for (const [lang, name] of Object.entries(channelNameLocalized ?? {})) params[`channelName_${lang}`] = name;
  return params;
}
