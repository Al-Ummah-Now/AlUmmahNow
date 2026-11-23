/**
 * Links shown inside the player, over the video (docs/specs/VIDEO-PLAYER.md, "In-player links").
 *
 * One small, data-driven slot: each link is a label, a destination and a placement. Today the only
 * placement is `caption-end`: a compact link at the inline end of the caption band, just under the
 * captions (they move up a row while it shows), clear of the centre of the video, the big play
 * button and the control bar, and following the band as the controls show and hide. The first link is
 * Quran Foundation's credit next to Quran captions (QF 2026-11-23); creator links (cards, end-screen
 * links) are meant to reuse this slot with more placements.
 *
 * Every link is a real <a>: keyboard reachable in the player's tab order, named for screen readers
 * (with "opens in a new tab" for another site), and never pauses or seeks. A link to another site
 * opens in a new tab (rel="noopener"); a link on this site opens in place.
 */
'use client';

import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

export type PlayerLinkPlacement = 'caption-end';

export interface PlayerOverlayLink {
  /** Stable id (React key, data-link) */
  id: string;
  /** Visible text, short: it sits next to the captions */
  label: string;
  href: string;
  /** Screen-reader name when it needs more than the label (e.g. "…, opens in a new tab") */
  ariaLabel?: string;
  /** Language of the label when it differs from the page's */
  lang?: string;
  /** Direction of the label and its placement when it differs from the page's (a caption credit follows its cue) */
  dir?: 'ltr' | 'rtl';
  placement: PlayerLinkPlacement;
  testId?: string;
}

/** Another site: opens in a new tab. A relative path or this site's origin opens in place. */
export function isExternalHref(href: string, origin: string = typeof window !== 'undefined' ? window.location.origin : ''): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    return new URL(href).origin !== origin;
  } catch {
    return false;
  }
}

/** Presses on a link are the link's own: the player never reads them as a tap on the video. */
const keepToLink = (e: MouseEvent | PointerEvent) => e.stopPropagation();

/**
 * The links to show: `links`, except that links which just went away stay while one of them has focus
 * or the pointer, until blur or pointer leave, so keyboard focus is never lost and a click is never
 * pulled from under the pointer (wiki AUN-PLAYER-LINKS, phase 0 accessibility).
 */
function useHeldLinks(links: PlayerOverlayLink[]) {
  const [held, setHeld] = useState<PlayerOverlayLink[]>([]);
  const engaged = useRef({ focus: false, hover: false });
  const latest = useRef(links);
  latest.current = links;
  const shown = links.length > 0 ? links : held;
  useEffect(() => {
    if (links.length > 0) setHeld(links);
    else if (!engaged.current.focus && !engaged.current.hover) setHeld([]);
  }, [links]);
  const release = () => {
    if (!engaged.current.focus && !engaged.current.hover && latest.current.length === 0) setHeld([]);
  };
  const handlers = {
    onFocus: () => { engaged.current.focus = true; },
    onBlur: () => { engaged.current.focus = false; release(); },
    onPointerEnter: () => { engaged.current.hover = true; },
    onPointerLeave: () => { engaged.current.hover = false; release(); },
  };
  return { shown, handlers };
}

export function PlayerLinkOverlay({ links, dir }: { links: PlayerOverlayLink[]; dir: 'ltr' | 'rtl' }) {
  const { shown, handlers } = useHeldLinks(links);
  if (shown.length === 0) return null;
  const placements = [...new Set(shown.map((l) => l.placement))];
  return (
    <>
      {placements.map((placement) => {
        const here = shown.filter((l) => l.placement === placement);
        return (
          <div key={placement} className="vjs-fanous-links" data-placement={placement} dir={here[0]?.dir ?? dir} data-testid={`player-links-${placement}`}>
            {here.map((l) => {
              const external = isExternalHref(l.href);
              return (
                <a
                  key={l.id}
                  className="vjs-fanous-link"
                  data-link={l.id}
                  data-testid={l.testId}
                  href={l.href}
                  lang={l.lang}
                  aria-label={l.ariaLabel}
                  {...(external ? { target: '_blank', rel: 'noopener' } : {})}
                  onClick={keepToLink}
                  onPointerDown={keepToLink}
                  onDoubleClick={keepToLink}
                  {...handlers}
                >
                  {l.label}
                </a>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
