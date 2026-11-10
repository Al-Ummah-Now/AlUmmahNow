'use client';
// Prototype only: the featured video at the top of the home page.
import Link from 'next/link';
import { Play } from 'lucide-react';
import type { VideoObject } from '@/interfaces';
import { getLocalizedValue } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';

export function HomeHero({ video }: { video: VideoObject }) {
  const { lang } = useLanguage();
  const title = getLocalizedValue(video.titleLocalized, video.title, lang);
  const copy = lang === 'ar' ? { tag: 'مختارات', watch: 'شاهد الآن' } : { tag: 'Featured', watch: 'Watch now' };
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
