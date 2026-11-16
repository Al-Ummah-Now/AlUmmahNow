'use client';

import { useEffect } from 'react';
import { CUT_SELECTOR, markCut } from '@/lib/truncation-fade';

/**
 * Marks one-line truncation boxes whose text is actually cut (data-cut), so globals.css fades
 * only those at their end edge. The app never uses text-overflow: ellipsis (WebKit crash, #1382).
 * Renders nothing; one MutationObserver and one ResizeObserver for the page.
 */
export function TruncationFade() {
  useEffect(() => {
    const seen = new WeakSet<Element>();
    const resize = new ResizeObserver((entries) => {
      for (const entry of entries) markCut(entry.target);
    });
    let queued = false;
    const scan = () => {
      queued = false;
      for (const el of Array.from(document.querySelectorAll(CUT_SELECTOR))) {
        if (!seen.has(el)) {
          seen.add(el);
          resize.observe(el);
        }
        markCut(el);
      }
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(scan);
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener('resize', schedule);
    document.fonts?.ready.then(schedule).catch(() => undefined);
    schedule();
    return () => {
      mutations.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, []);
  return null;
}
