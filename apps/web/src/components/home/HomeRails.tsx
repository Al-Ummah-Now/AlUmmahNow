'use client';

/**
 * The home page's ranked rails (wiki E07 "Discovery ranking"), between the hero and the full video
 * grid. Which rails, in what order, comes from the videos admin; each heading is what the list is
 * right now (`info.label`): with no viewer signal yet Trending reads "New this week" and Popular
 * reads "Featured". A rail scrolls sideways (snap); on a pointer device round buttons page it, and
 * the edge it can still scroll to fades out. Depth is the active theme's (theme/home-rails.css).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Flame, LayoutGrid, Sparkles, Star, TrendingUp, type LucideIcon } from 'lucide-react';
import Link from '@/components/common/AppLink';
import VideoCardLTR from '@/components/videoCard/index';
import VideoCardRTL from '@/components/videoCard/rtl/index';
import { useLanguage } from '@/hooks/useLanguage';
import { homeRailHeading, homeRailHref, type HomeRail } from '@/lib/discovery/home-rails';
import '@/theme/home-rails.css';

const MODE_ICONS: Record<string, LucideIcon> = {
  trending: Flame,
  new: Sparkles,
  featured: Star,
  popular: TrendingUp,
  top: LayoutGrid,
};

/** How far a button pages: most of the visible width, so one card stays in view for context */
const PAGE_FRACTION = 0.85;

interface Edges {
  start: boolean;
  end: boolean;
}

/** Pure: is the list at its start or end? Right to left lists scroll to negative offsets. */
export function scrollEdges(scrollLeft: number, clientWidth: number, scrollWidth: number): Edges {
  const travelled = Math.abs(scrollLeft);
  return { start: travelled <= 2, end: travelled + clientWidth >= scrollWidth - 2 };
}

function HomeRailRow({ rail, heading, index }: { rail: HomeRail; heading: string; index: number }) {
  const { t, lang, isRTL } = useLanguage();
  const VideoCard = isRTL ? VideoCardRTL : VideoCardLTR;
  const listRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState<Edges>({ start: true, end: false });
  const Icon = MODE_ICONS[rail.info.mode] ?? LayoutGrid;
  const headingId = `home-rail-${index}`;

  const measure = useCallback(() => {
    const list = listRef.current;
    if (list) setEdges(scrollEdges(list.scrollLeft, list.clientWidth, list.scrollWidth));
  }, []);

  useEffect(() => {
    measure();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure, rail.data.length]);

  const page = (direction: 1 | -1) => {
    const list = listRef.current;
    if (!list) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    list.scrollBy({ left: direction * (isRTL ? -1 : 1) * list.clientWidth * PAGE_FRACTION, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <section
      className="hr"
      aria-labelledby={headingId}
      data-testid="home-rail"
      data-rail={rail.key}
      data-label={rail.info.label}
      {...(rail.category ? { 'data-category': rail.category } : {})}
    >
      <div className="hr-head">
        <span className="hr-badge" aria-hidden="true">
          <Icon />
        </span>
        <h2 id={headingId} className="hr-title">
          {heading}
        </h2>
        <span className="hr-rule" aria-hidden="true" />
        <Link href={homeRailHref(rail, lang)} className="hr-all" aria-label={t.rails.seeAllLabel.replace('{rail}', heading)} data-testid="home-rail-all">
          {t.rails.seeAll}
          <ChevronRight aria-hidden="true" />
        </Link>
      </div>
      <div className="hr-track" data-more-start={edges.start ? undefined : ''} data-more-end={edges.end ? undefined : ''}>
        <button type="button" className="hr-nav" data-side="start" onClick={() => page(-1)} disabled={edges.start} aria-label={t.rails.previous}>
          <ChevronLeft aria-hidden="true" />
        </button>
        <ul ref={listRef} className="hr-list" onScroll={measure} data-testid="home-rail-list">
          {rail.data.map((video, i) => (
            <li key={video.id}>
              <VideoCard {...video} imageLoading={index === 0 && i < 2 ? 'eager' : undefined} />
            </li>
          ))}
        </ul>
        <button type="button" className="hr-nav" data-side="end" onClick={() => page(1)} disabled={edges.end} aria-label={t.rails.next}>
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

export function HomeRails({ rails }: { rails: HomeRail[] }) {
  const { t, lang } = useLanguage();
  const shown = rails.flatMap((rail) => {
    const heading = homeRailHeading(rail, t.rails, lang);
    return heading ? [{ rail, heading }] : [];
  });
  if (shown.length === 0) return null;
  return (
    <div className="hr-stack" data-testid="home-rails">
      {shown.map(({ rail, heading }, index) => (
        <HomeRailRow key={`${rail.key}:${rail.category ?? ''}`} rail={rail} heading={heading} index={index} />
      ))}
    </div>
  );
}
