'use client';
// The featured video at the top of the home page, and the 16:9 frame it shares with the channel Spotlight.
import { useState, type ReactNode } from 'react';
import Link from '@/components/common/AppLink';
import { Play } from 'lucide-react';
import type { VideoObject } from '@/interfaces';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { resolveUrl } from '@/lib/utility';
import { aspectOf } from '@/lib/video/aspect';
import { heroSrcSet, heroThumbFit, type HeroThumbnailSizes, type HeroVideo } from '@/lib/video/hero';
import { channelLabel } from '@/lib/channel-name';

const heroCopy = (lang: string) => (lang === 'ar' ? { tag: 'مختارات', watch: 'شاهد الآن' } : { tag: 'Featured', watch: 'Watch now' });

/** The frame takes about 60% of the hero beside the text from 768px, the full width below. */
const HERO_SIZES = '(max-width: 767px) 100vw, 60vw';

interface HeroThumbProps {
  video: HeroVideo & { thumbnailUrl?: string; thumbnailSizes?: HeroThumbnailSizes };
  href: string;
  /** The link's accessible name when it differs from the image's alt (the title) */
  label?: string;
  alt: string;
  children?: ReactNode;
}

/**
 * The hero's 16:9 thumbnail link (lib/video/hero.ts). A real image, not a CSS background, so it
 * has alt text, a responsive size and a high fetch priority (it is the page's largest image). A
 * landscape thumbnail fills the frame; a vertical or square one (a Short) is shown whole
 * (`data-fit="contain"`) over a blurred, dimmed copy of itself.
 */
export function HeroThumb({ video, href, label, alt, children }: HeroThumbProps) {
  const src = video.thumbnailUrl ? resolveUrl(video.thumbnailUrl) : '';
  // Keyed by src: a new image is measured again
  const [measured, setMeasured] = useState<{ src: string; aspect?: number } | null>(null);
  // The src that failed to load (keyed by src, so a new image gets a fresh attempt): the frame then
  // shows a placeholder, as video cards do, not a broken image. A listed video's thumbnail can be gone
  // for a moment, e.g. a video deleted while the cached first page of the list still has it.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = Boolean(src) && failedSrc === src;
  // The hero image is server-rendered with a high fetch priority, so it often finishes loading
  // before React hydrates, and React never replays that load event: a vertical image in a
  // landscape-sized video then stayed 'cover' (cropped to a strip). Measure on mount too.
  const measure = (img: HTMLImageElement | null, loaded = false) => {
    if (!img) return;
    // Failed before hydration: React never replays that error event either
    if (!loaded && img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
      setFailedSrc(src);
      return;
    }
    if (!(loaded || img.complete) || img.naturalWidth <= 0 || img.naturalHeight <= 0) return;
    const aspect = aspectOf(img.naturalWidth, img.naturalHeight);
    setMeasured((m) => (m?.src === src && m.aspect === aspect ? m : { src, aspect }));
  };
  const fit = heroThumbFit(video, measured?.src === src ? measured.aspect : undefined);
  const width = video.width && video.width > 0 ? video.width : 1280;
  const height = video.height && video.height > 0 ? video.height : 720;

  return (
    <Link href={href} className="home-hero-t" aria-label={label} data-fit={fit} data-testid="hero-thumb">
      {src && !failed && fit === 'contain' && (
        // eslint-disable-next-line @next/next/no-img-element -- decorative backdrop, the smallest variant is enough under the blur
        <img className="home-hero-bd" src={video.thumbnailSizes?.mobile || src} alt="" aria-hidden="true" data-testid="hero-thumb-backdrop" />
      )}
      {failed && (
        <span className="home-hero-ph" role="img" aria-label={alt} data-testid="hero-thumb-placeholder">
          <Play aria-hidden="true" />
        </span>
      )}
      {src && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- Bunny serves the variants; next/image would re-encode them
        <img
          className="home-hero-img"
          src={src}
          srcSet={heroSrcSet(video.thumbnailSizes)}
          sizes={HERO_SIZES}
          width={width}
          height={height}
          alt={alt}
          fetchPriority="high"
          loading="eager"
          decoding="async"
          data-testid="hero-thumb-image"
          ref={measure}
          onLoad={(e) => measure(e.currentTarget, true)}
          onError={() => setFailedSrc(src)}
        />
      )}
      {children}
    </Link>
  );
}

export function HomeHero({ video }: { video: VideoObject }) {
  const { lang } = useLanguage();
  const title = getLocalizedValue(video.titleLocalized, video.title, lang);
  const copy = heroCopy(lang);
  const href = `/${lang}/video?vid=${video.id}`;
  return (
    <section className="home-hero">
      <HeroThumb video={video} href={href} alt={title} />
      <div className="home-hero-b">
        <span className="home-hero-tag">{copy.tag}</span>
        <h2>{title}</h2>
        <p>{channelLabel(video, lang)}</p>
        <Link href={href} className="b b-primary"><Play aria-hidden="true" />{copy.watch}</Link>
      </div>
    </section>
  );
}

/**
 * The hero's frame while the first page of videos loads: the same section, thumbnail box and
 * rows (tag, a two-line title, channel, button), so the hero swaps in without pushing the heading
 * and the grid down (it was inserted above them after the fetch: CLS 0.84 on home in Lighthouse).
 */
export function HomeHeroPlaceholder() {
  const { lang } = useLanguage();
  const copy = heroCopy(lang);
  const bar = 'sk block';
  return (
    <section className="home-hero" aria-hidden="true" data-testid="home-hero-loading">
      <div className="home-hero-t" />
      <div className="home-hero-b">
        <span className="home-hero-tag">{copy.tag}</span>
        <h2 className="w-full">
          <span className={`${bar} h-[1em] w-11/12`} />
          <span className={`${bar} h-[1em] w-2/3 mt-[0.2em]`} />
        </h2>
        <p><span className={`${bar} h-[1em] w-32`} /></p>
        <span className="b b-primary invisible">{copy.watch}</span>
      </div>
    </section>
  );
}
