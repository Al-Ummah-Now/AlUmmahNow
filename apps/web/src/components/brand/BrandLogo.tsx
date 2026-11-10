/* eslint-disable @next/next/no-img-element -- images are unoptimized (no srcset from next/image), so the sizes are listed here */

/**
 * The lantern mark, sized for its slot. The header shows it above the fold on
 * every page, so it loads eagerly at high priority from a small WebP (1x, 2x and
 * 3x screens) instead of the 1000px /logo.png. width and height reserve the slot
 * so nothing moves when it arrives; the ring around it comes from the theme CSS.
 */
export const BRAND_LOGO = {
  src: '/brand/logo-64.webp',
  srcSet: '/brand/logo-32.webp 1x, /brand/logo-64.webp 2x, /brand/logo-96.webp 3x',
} as const;

/** A larger copy for fallback thumbnails and notification icons. */
export const BRAND_LOGO_LARGE = '/brand/logo-320.webp';

interface BrandLogoProps {
  className?: string;
  /** CSS pixels; the 1x/2x/3x files cover slots up to 32px. */
  size?: number;
}

export function BrandLogo({ className, size = 32 }: BrandLogoProps) {
  return (
    <img
      src={BRAND_LOGO.src}
      srcSet={BRAND_LOGO.srcSet}
      width={size}
      height={size}
      alt=""
      loading="eager"
      fetchPriority="high"
      decoding="async"
      className={className}
      data-testid="brand-logo"
    />
  );
}
