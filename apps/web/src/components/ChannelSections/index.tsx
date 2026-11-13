'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { listChannelSectionsPopulated } from '@/lib/api/channel-sections';
import { useChannelViewer } from '@/components/Channel/ChannelViewerContext';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { ChannelSectionRenderer } from './ChannelSectionRenderer';
import { fallbackSections, sectionHasContent, type ChannelHomeFallback, type PopulatedChannelSection } from './sectionData';
import { loadChannelHomeFallback, loadFallbackPlaylists } from './fallback';

interface ChannelSectionsProps {
  channelId: string;
  /**
   * The populated sections the server already read (server-rendered Home tab, wiki AUN-SEO phase 4):
   * shown from the first paint and not fetched again. Missing when the server had none in time.
   */
  initialSections?: PopulatedChannelSection[];
  /** The server dropped an image only the viewer may see: reload the sections after hydration */
  initialPartial?: boolean;
  /** The server's fallback (latest uploads) for a channel without sections to show (#1206) */
  initialFallback?: ChannelHomeFallback;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; sections: PopulatedChannelSection[] }
  | { status: 'failed' };

/**
 * The channel Home tab: the channel's sections in the owner's order, every
 * one populated by a single API call. If that call fails, visitors see
 * nothing; people who can edit the channel get a retry.
 */
export function ChannelSections({ channelId, initialSections, initialPartial = false, initialFallback }: ChannelSectionsProps) {
  const { t } = useLanguage();
  const { canEditLayout } = useChannelViewer();
  const [state, setState] = useState<LoadState>(() => (initialSections ? { status: 'ready', sections: initialSections } : { status: 'loading' }));
  const [attempt, setAttempt] = useState(0);
  // The channel the server's sections belong to: its first load is skipped (a retry fetches)
  const seededChannel = useRef<string | null>(initialSections ? channelId : null);

  useEffect(() => {
    const quiet = seededChannel.current === channelId && attempt === 0;
    // The server's sections are shown: reload them only when it had to drop an image, without a skeleton
    if (quiet && !initialPartial) return undefined;
    if (!quiet) seededChannel.current = null;
    let cancelled = false;
    if (!quiet) setState({ status: 'loading' });
    listChannelSectionsPopulated(channelId)
      .then((sections) => {
        if (cancelled) return;
        if (!sections) {
          logger.error('ChannelSections: sections response was not usable', { channelId });
          if (!quiet) setState({ status: 'failed' });
          return;
        }
        setState({ status: 'ready', sections: sections as PopulatedChannelSection[] });
      })
      .catch((error) => {
        logger.error('ChannelSections: loading sections failed', { channelId, error });
        if (!cancelled && !quiet) setState({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, attempt, initialPartial]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // No section has anything to show (none made yet, or all empty): the latest uploads instead, YouTube style (#1206)
  const needsFallback = state.status === 'ready' && !state.sections.some(sectionHasContent);
  const [fallback, setFallback] = useState<{ channelId: string; data: ChannelHomeFallback } | null>(
    initialFallback ? { channelId, data: initialFallback } : null,
  );
  const shownFallback = fallback?.channelId === channelId ? fallback.data : null;
  useEffect(() => {
    if (!needsFallback || shownFallback) return undefined;
    let cancelled = false;
    loadChannelHomeFallback(channelId)
      .then((data) => {
        if (!cancelled) setFallback({ channelId, data });
      })
      .catch((error) => logger.warn('ChannelSections: loading the uploads fallback failed', { channelId, error }));
    return () => {
      cancelled = true;
    };
  }, [needsFallback, shownFallback, channelId]);
  // The server's fallback came without the playlists (they were late): add them once loaded
  const playlistsMissing = !!shownFallback && shownFallback.playlists === undefined;
  useEffect(() => {
    if (!playlistsMissing) return undefined;
    let cancelled = false;
    loadFallbackPlaylists(channelId)
      .catch(() => [])
      .then((playlists) => {
        if (!cancelled) setFallback((prev) => (prev && prev.channelId === channelId ? { channelId, data: { ...prev.data, playlists } } : prev));
      });
    return () => {
      cancelled = true;
    };
  }, [playlistsMissing, channelId]);

  if (state.status === 'loading') return <ChannelSectionsSkeleton />;

  if (state.status === 'failed') {
    if (!canEditLayout) return null;
    return (
      <div role="alert" data-testid="channel-sections-load-failed" className="flex flex-col items-start gap-3 rounded-lg border border-border bg-muted p-4 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-foreground">{t.channelSections.loadFailedForOwner}</p>
        <button
          type="button"
          onClick={retry}
          className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-on-brand hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t.channelSections.retry}
        </button>
      </div>
    );
  }

  if (needsFallback) {
    if (!shownFallback) return <ChannelSectionsSkeleton />;
    const sections = fallbackSections(channelId, shownFallback);
    if (sections.length === 0) return null;
    return (
      <div className="space-y-8" data-testid="channel-sections" data-fallback="uploads">
        {sections.map((section, index) => (
          <ChannelSectionRenderer key={section.id} section={section} channelId={channelId} leading={index === 0} />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8" data-testid="channel-sections">
      {state.sections.map((section, index) => (
        <ChannelSectionRenderer key={section.id} section={section} channelId={channelId} leading={index === 0} />
      ))}
    </div>
  );
}

function ChannelSectionsSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true" data-testid="channel-sections-loading">
      {[1, 2, 3].map((i) => (
        <div key={i} className="animate-pulse space-y-4">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="flex gap-4 overflow-hidden pb-2">
            {[1, 2, 3, 4, 5].map((j) => (
              <div key={j} className="w-64 flex-shrink-0 space-y-2">
                <div className="aspect-video rounded bg-muted" />
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="h-3 w-1/2 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
