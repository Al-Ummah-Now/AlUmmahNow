'use client';

import { useLayoutEffect, useRef, useState } from 'react';

/**
 * A Latin resource name on one line, never broken at its hyphens (AUDIT-2 round 15). When it
 * does not fit, it ends in an ellipsis: the full name shows on hover (title), and a tap or
 * Enter opens it in full, wrapping only after its hyphens; a second tap closes it.
 *
 * One element throughout: swapping a wrapper would remount the measured span and leave the
 * ResizeObserver on a detached node.
 */
export function TruncatedName({ name, testId }: { name: string; testId?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measured while closed only: an open name wraps and never overflows
    const measure = () => {
      if (!el.classList.contains('truncate')) return;
      setCut(el.scrollWidth > el.clientWidth + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [name]);
  const toggle = () => setOpen((o) => !o);
  const interactive = cut || open;
  return (
    <span
      ref={ref}
      dir="ltr"
      title={name}
      className={['block rtl:text-right', open ? 'whitespace-normal' : 'truncate', interactive ? 'cursor-pointer' : ''].filter(Boolean).join(' ')}
      data-testid={testId}
      data-cut={cut ? 'true' : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-expanded={interactive ? open : undefined}
      onClick={interactive ? toggle : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } : undefined}
    >
      {name}
    </span>
  );
}
