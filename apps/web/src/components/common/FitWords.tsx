'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * The longest run of whole words that fits, then «…» with no space before it (exported for tests).
 * `fits` says whether a candidate string fits the slot. One word that doesn't fit on its own comes
 * back whole, and the slot's CSS ellipsis cuts it.
 */
export function fitWords(text: string, fits: (candidate: string) => boolean): string {
  if (fits(text)) return text;
  const words = text.trim().split(/\s+/);
  for (let k = words.length - 1; k >= 1; k--) {
    const candidate = `${words.slice(0, k).join(' ').replace(/[\s،,.:;\-–—]+$/u, '')}…`;
    if (fits(candidate)) return candidate;
  }
  return text;
}

/**
 * The width a name may take in its slot (exported for tests). A slot with a max width (the header chip:
 * `max-inline-size: 9rem`, auto width) is as wide as the text it holds, so its own width shrinks after
 * each cut and the next fit cuts again ("Al-Fajr Reminders…" became "Al-Fajr…"): its max width is the
 * room. A slot with no max width uses its laid-out width.
 */
export function slotRoom(clientWidth: number, maxInlineSize: string): number {
  const max = parseFloat(maxInlineSize);
  return Number.isFinite(max) && max > 0 ? max : clientWidth;
}

/**
 * A one-line name in a fixed-width slot (the header's account chip) cut at a word, never mid-word
 * (AUDIT-2: «…والتق»). The parent element is the slot: it keeps `overflow: hidden` and its CSS
 * ellipsis as the fallback. Candidates are measured in a hidden copy with the slot's font, so React
 * owns the shown text. The full name stays in `title`.
 */
export function FitWords({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);

  const fit = useCallback(() => {
    const slot = ref.current?.parentElement;
    if (!slot) return;
    const cs = getComputedStyle(slot);
    const room = slotRoom(slot.clientWidth, cs.maxInlineSize);
    if (room <= 1) {
      setShown(text);
      return;
    }
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;inset-inline-start:0;top:0;';
    probe.style.font = cs.font;
    probe.style.letterSpacing = cs.letterSpacing;
    probe.dir = slot.dir || 'auto';
    slot.appendChild(probe);
    try {
      setShown(fitWords(text, (candidate) => {
        probe.textContent = candidate;
        return probe.getBoundingClientRect().width <= room + 0.5;
      }));
    } finally {
      probe.remove();
    }
  }, [text]);

  useIsomorphicLayoutEffect(() => {
    fit();
    const slot = ref.current?.parentElement;
    if (!slot || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => fit());
    observer.observe(slot);
    // Web fonts change widths once they load
    void document.fonts?.ready.then(() => fit());
    return () => observer.disconnect();
  }, [fit]);

  if (shown === text) return <span ref={ref}>{text}</span>;
  // Cut: screen readers get the whole name
  return (
    <span ref={ref} title={text}>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
