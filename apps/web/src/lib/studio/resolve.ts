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
