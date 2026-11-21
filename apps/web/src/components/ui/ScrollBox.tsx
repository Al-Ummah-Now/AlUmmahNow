'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A box that scrolls sideways inside itself (a wide table on a phone) and shows it: when the content
 * is wider than the box, the edge with more to see fades out and a thin scrollbar stays visible, and
 * the box takes keyboard focus so the arrows scroll it. Content that fits looks like a plain div.
 */
export function ScrollBox({ children, label, className = '', testId }: { children: ReactNode; label: string; className?: string; testId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const over = el.scrollWidth - el.clientWidth;
      // scrollLeft runs negative in RTL; its size is the distance from the start edge
      const fromStart = Math.abs(el.scrollLeft);
      const next = { start: over > 1 && fromStart > 1, end: over > 1 && over - fromStart > 1 };
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    el.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer?.disconnect();
      el.removeEventListener('scroll', measure);
    };
  }, []);

  const scrolls = edges.start || edges.end;
  // The gradient runs along the inline axis: `to right` is the end edge in LTR, the start edge in RTL
  const fade = 'var(--scrollbox-fade, 2rem)';
  const mask = scrolls
    ? `linear-gradient(to var(--scrollbox-end, right), ${edges.start ? `transparent, #000 ${fade}` : '#000'}, ${edges.end ? `#000 calc(100% - ${fade}), transparent` : '#000'})`
    : undefined;

  return (
    <div
      ref={ref}
      className={`scroll-box overflow-x-auto ${scrolls ? 'scroll-box-scrolls' : ''} ${className}`}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      role={scrolls ? 'region' : undefined}
      aria-label={scrolls ? label : undefined}
      tabIndex={scrolls ? 0 : undefined}
      data-scrolls={scrolls ? (edges.end ? 'end' : 'start') : undefined}
      data-testid={testId}
    >
      {children}
    </div>
  );
}
