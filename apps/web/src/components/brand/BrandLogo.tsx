/**
 * The lantern mark. The header shows it above the fold on every page (Header/HeaderParts.tsx
 * HeaderBrand, 36px, 32px on phones), so it loads eagerly at high priority from a small WebP
 * per screen density instead of the 1000px /logo.png; width and height reserve the slot.
 */
export const BRAND_LOGO = {
  src: '/brand/logo-64.webp',
  srcSet: '/brand/logo-64.webp 1x, /brand/logo-96.webp 2x',
} as const;

/** A larger copy for fallback thumbnails and notification icons. */
export const BRAND_LOGO_LARGE = '/brand/logo-320.webp';
