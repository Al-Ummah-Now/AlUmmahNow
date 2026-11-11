'use client';

import Link from 'next/link';
import { Play } from 'lucide-react';

/**
 * "Play all" on a playlist card: a link of its own beside (never inside) the card's link, over the
 * cover's top start corner (docs/specs/PLAYLIST-PLAYBACK.md).
 */
export function PlayAllOverlay({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      data-testid="playlist-card-play-all"
      className="absolute top-2 start-2 z-10 inline-flex items-center gap-1.5 rounded-full bg-black/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      <Play className="h-3.5 w-3.5 fill-current rtl:-scale-x-100" aria-hidden="true" />
      {label}
    </Link>
  );
}
