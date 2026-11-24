export const studioLiveHref = (locale: string, channelId: string, streamId?: string) =>
  `/${locale}/studio/${encodeURIComponent(channelId)}/content/live${streamId ? `/${encodeURIComponent(streamId)}` : ''}`;
