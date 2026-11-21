'use client';

import React from 'react';
import Link from '@/components/common/AppLink';
import '@/theme/playlist-card.css';

/**
 * The one playlist-style card: a stacked cover (two sheets behind it say "a list"), a count badge,
 * a title and a meta line, with an optional action over the cover's top start corner (Play all,
 * Resume) that is a link of its own, never nested in the card's link. Used by playlist cards and by
 * the home page's Continue watching card, so both look and behave the same in every theme.
 */
export interface PlaylistCardFrameProps {
  href: string;
  /** The cover image (PlaylistCover or a video thumbnail); the badge and progress go over it */
  cover: (overlay: React.ReactNode) => React.ReactNode;
  /** "12 videos" / «١٢ مرئيًا» */
  countLabel: string;
  title: string;
  /** Lines under the title */
  meta?: React.ReactNode;
  /** A link of its own over the cover (Play all, Resume) */
  action?: React.ReactNode;
  /** 0–100: a progress bar along the cover's bottom edge (how far the top item was watched) */
  progress?: number;
  testId: string;
  className?: string;
  /** Accessible name when the visible title alone is not enough */
  ariaLabel?: string;
}

export function PlaylistCardFrame({ href, cover, countLabel, title, meta, action, progress, testId, className, ariaLabel }: PlaylistCardFrameProps) {
  const pct = progress === undefined ? null : Math.max(0, Math.min(100, progress));
  const overlay = (
    <>
      <span className="plc-badge" data-testid={`${testId}-count`}>
        {countLabel}
      </span>
      {pct !== null && pct > 0 && (
        <span className="plc-progress" aria-hidden="true">
          <span style={{ inlineSize: `${pct}%` }} />
        </span>
      )}
    </>
  );
  return (
    <div className={`plc group ${className ?? ''}`}>
      <Link href={href} className="plc-link video-card" data-testid={testId} aria-label={ariaLabel}>
        <div className="plc-stack">
          <span className="plc-sheet plc-sheet-2" aria-hidden="true" />
          <span className="plc-sheet plc-sheet-1" aria-hidden="true" />
          <div className="plc-cover" data-progress={pct !== null && pct > 0 ? '' : undefined}>{cover(overlay)}</div>
        </div>
        <div className="plc-body">
          <h3 className="plc-title">{title}</h3>
          {meta}
        </div>
      </Link>
      {action && <div className="plc-action">{action}</div>}
    </div>
  );
}
