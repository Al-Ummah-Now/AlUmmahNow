/**
 * The video's width / height: its encoded size, else 9:16 for a Short, else null (unknown: the
 * embed's player fills the frame). Drives the embed's player box and the declared card / oEmbed
 * sizes. Pure (no server-only imports): the client EmbedPlayer uses it too.
 */
export function videoAspect(video: { width?: number; height?: number; isShort?: boolean } | null | undefined): number | null {
  if (video?.width && video.height) return video.width / video.height;
  return video?.isShort ? 9 / 16 : null;
}
