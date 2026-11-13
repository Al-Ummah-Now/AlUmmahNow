'use client';

import { useRef, useState } from 'react';
import { CommunityPost } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
const POSITION = { top: 'justify-start', middle: 'justify-center', bottom: 'justify-end' } as const;

/** A cards post: its title and its cards in a swipeable strip, text drawn over each image (never burned in). */
export default function CardsPost({ post }: { post: CommunityPost }) {
  const { t } = useLanguage();
  const strip = useRef<HTMLOListElement>(null);
  const [current, setCurrent] = useState(0);
  const slides = post.slides ?? [];
  if (slides.length === 0) return null;
  const lang = post.locale ?? undefined;

  const go = (i: number) => {
    const n = Math.max(0, Math.min(slides.length - 1, i));
    const el = strip.current?.children[n] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    setCurrent(n);
  };
  const onScroll = () => {
    const el = strip.current;
    if (!el || !el.clientWidth) return;
    setCurrent(Math.round(Math.abs(el.scrollLeft) / el.clientWidth));
  };

  return (
    <section lang={lang} dir={lang === 'ar' ? 'rtl' : lang === 'en' ? 'ltr' : undefined} aria-label={post.title ?? t.community.cards} data-testid="community-cards" className="space-y-2">
      {post.title ? <h3 className="text-base font-semibold text-[var(--fanous-color-text-primary)] break-words">{post.title}</h3> : null}
      <div className="relative">
        <ol ref={strip} onScroll={onScroll} className="flex overflow-x-auto snap-x snap-mandatory rounded-lg" style={{ scrollbarWidth: 'none' }}>
          {slides.map((s, i) => (
            <li key={s.id} className="relative shrink-0 w-full snap-start aspect-[4/5] bg-[var(--fanous-color-surface-raised)]" aria-label={fill(t.community.cardOf, { n: i + 1, total: slides.length })}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.image.url} alt={s.image.alt ?? ''} loading={i === 0 ? 'eager' : 'lazy'} decoding="async" className="absolute inset-0 w-full h-full object-cover" />
              {s.heading || s.body ? (
                <div className={`absolute inset-0 flex flex-col ${POSITION[s.position] ?? POSITION.bottom} p-4`}>
                  <div className="rounded-md p-3 bg-[var(--fanous-c-player-control-bg)] text-[var(--fanous-c-player-control)] space-y-1">
                    {s.heading ? <p className="font-semibold text-base">{s.heading}</p> : null}
                    {s.body ? <p className="text-sm whitespace-pre-wrap">{s.body}</p> : null}
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
        {slides.length > 1 ? (
          <div className="flex items-center justify-between gap-2 pt-2">
            <button type="button" onClick={() => go(current - 1)} disabled={current === 0} aria-label={t.community.previousCard} className="w-11 h-11 inline-flex items-center justify-center rounded-full border border-[var(--fanous-color-divider)] disabled:opacity-40">
              <ChevronLeft className="w-5 h-5 rtl:-scale-x-100" aria-hidden="true" />
            </button>
            <span className="text-sm text-[var(--fanous-color-text-secondary)]" aria-live="polite">{fill(t.community.cardOf, { n: current + 1, total: slides.length })}</span>
            <button type="button" onClick={() => go(current + 1)} disabled={current === slides.length - 1} aria-label={t.community.nextCard} className="w-11 h-11 inline-flex items-center justify-center rounded-full border border-[var(--fanous-color-divider)] disabled:opacity-40">
              <ChevronRight className="w-5 h-5 rtl:-scale-x-100" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
