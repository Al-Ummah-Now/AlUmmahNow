'use client';

/**
 * Next and previous Short on /[locale]/shorts/{id} (owner decision D-SEO-10). The next Short comes
 * from the public Shorts feed (GET {api}/api/v1/shorts?after={id}, newest first, the same order as
 * www's Shorts viewer); previous goes back through the Shorts seen in this tab. Buttons, ↑ ↓ /
 * Page Up / Page Down, and a vertical swipe all do the same; each move is a normal navigation, so the
 * URL, history and the page's metadata follow, and the watch shell keeps the player mounted.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useLanguage } from '@/hooks/useLanguage';
import { getApiUrl } from '@/lib/runtime-config';
import { logger } from '@/lib/logger-client';

const SHORT_PATH = /^\/(en|ar)\/shorts\/([^/?#]+)\/?$/;
const SWIPE_MIN_PX = 80;
const SWIPE_MAX_MS = 700;

/** The next Short after `id` in the public feed, or null at the end. */
export async function nextShortId(api: string, id: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const res = await fetcher(`${api.replace(/\/$/, '')}/api/v1/shorts?after=${encodeURIComponent(id)}&limit=5`, { credentials: 'omit' });
  if (!res.ok) return null;
  const body = (await res.json()) as { items?: { id?: unknown }[] };
  const next = (body.items ?? []).map((i) => i.id).find((v): v is string => typeof v === 'string' && v !== id);
  return next ?? null;
}

const typing = (el: Element | null) => !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable);

export function ShortsNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { t, locale } = useLanguage();
  const match = pathname ? SHORT_PATH.exec(pathname) : null;
  const id = match ? decodeURIComponent(match[2]) : null;
  /** Shorts this tab moved through, so "previous" can go back */
  const trail = useRef<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    if (!id) return;
    const at = trail.current.indexOf(id);
    trail.current = at >= 0 ? trail.current.slice(0, at + 1) : [...trail.current, id];
    setAtEnd(false);
  }, [id]);

  const canGoBack = !!id && trail.current.indexOf(id) > 0;

  const next = useCallback(async () => {
    if (!id || busy) return;
    setBusy(true);
    try {
      const nextId = await nextShortId(getApiUrl(), id);
      if (nextId) router.push(`/${locale}/shorts/${encodeURIComponent(nextId)}`);
      else setAtEnd(true);
    } catch (error) {
      logger.warn('[ShortsNav] next Short failed', { id, error });
    } finally {
      setBusy(false);
    }
  }, [busy, id, locale, router]);

  const previous = useCallback(() => {
    if (canGoBack) router.back();
  }, [canGoBack, router]);

  useEffect(() => {
    if (!id) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || typing(document.activeElement)) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') {
        e.preventDefault();
        void next();
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault();
        previous();
      }
    };
    let start: { y: number; x: number; at: number } | null = null;
    const onStart = (e: TouchEvent) => {
      const p = e.touches[0];
      start = p ? { y: p.clientY, x: p.clientX, at: Date.now() } : null;
    };
    const onEnd = (e: TouchEvent) => {
      const p = e.changedTouches[0];
      if (!start || !p) return;
      const dy = p.clientY - start.y;
      const dx = p.clientX - start.x;
      const quick = Date.now() - start.at <= SWIPE_MAX_MS;
      start = null;
      if (!quick || Math.abs(dy) < SWIPE_MIN_PX || Math.abs(dx) > Math.abs(dy)) return;
      if (dy < 0) void next();
      else previous();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchend', onEnd);
    };
  }, [id, next, previous]);

  if (!id) return null;
  const button =
    'inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--fanous-color-border,currentColor)] bg-[var(--fanous-color-surface,transparent)] text-lg shadow disabled:opacity-40 focus-visible:outline focus-visible:outline-2';
  return (
    <nav
      aria-label={t.video.nextShort && t.video.previousShort ? `${t.video.previousShort} / ${t.video.nextShort}` : 'Shorts'}
      className="fixed end-4 top-1/2 z-40 flex -translate-y-1/2 flex-col gap-3"
      data-testid="shorts-nav"
    >
      <button type="button" className={button} onClick={previous} disabled={!canGoBack} aria-label={t.video.previousShort ?? 'Previous Short'} data-testid="shorts-prev">
        <span aria-hidden="true">↑</span>
      </button>
      <button type="button" className={button} onClick={() => void next()} disabled={busy || atEnd} aria-label={t.video.nextShort ?? 'Next Short'} data-testid="shorts-next">
        <span aria-hidden="true">↓</span>
      </button>
    </nav>
  );
}
