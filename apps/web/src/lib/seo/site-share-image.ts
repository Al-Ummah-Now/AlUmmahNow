/**
 * The site's share image (the root layout's card). Next merges metadata per key, so a page that sets
 * its own `openGraph` or `twitter` replaces the root's and loses this image unless it lists one: every
 * such page goes through these helpers, with its own image when it has one.
 */
export const SITE_SHARE_IMAGE = { url: '/icon-512.png', width: 512, height: 512 } as const;

/** og:image for a page: its own image, else the site's (with its declared size). */
export function ogImages(own: string | null | undefined, alt?: string): { url: string; width?: number; height?: number; alt?: string }[] {
  return [own ? { url: own, ...(alt ? { alt } : {}) } : { ...SITE_SHARE_IMAGE, ...(alt ? { alt } : {}) }];
}

/** twitter:image for a page: its own image, else the site's. */
export function twitterImages(own: string | null | undefined): string[] {
  return [own || SITE_SHARE_IMAGE.url];
}
