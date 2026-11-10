'use client';
// Prototype only: the featured video at the top of the home page.
import Link from 'next/link';
import { Play } from 'lucide-react';
import type { VideoObject } from '@/interfaces';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';

const heroCopy = (lang: string) => (lang === 'ar' ? { tag: 'مختارات', watch: 'شاهد الآن' } : { tag: 'Featured', watch: 'Watch now' });

export function HomeHero({ video }: { video: VideoObject }) {
  const { lang } = useLanguage();
  const title = getLocalizedValue(video.titleLocalized, video.title, lang);
  const copy = heroCopy(lang);
  return (
    <section className="home-hero">
      <Link href={`/${lang}/video?vid=${video.id}`} className="home-hero-t" aria-label={title} style={{ backgroundImage: `url("${video.thumbnailUrl}")` }} />
      <div className="home-hero-b">
        <span className="home-hero-tag">{copy.tag}</span>
        <h2>{title}</h2>
        <p>{video.channelName || video.channel}</p>
        <Link href={`/${lang}/video?vid=${video.id}`} className="b b-primary"><Play aria-hidden="true" />{copy.watch}</Link>
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
