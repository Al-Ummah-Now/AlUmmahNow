'use client';

import { useCallback, useEffect, useState } from 'react';
import { listChannelSectionsPopulated } from '@/lib/api/channel-sections';
import { useChannelViewer } from '@/components/Channel/ChannelViewerContext';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { ChannelSectionRenderer } from './ChannelSectionRenderer';
import type { PopulatedChannelSection } from './sectionData';

interface ChannelSectionsProps {
  channelId: string;
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
export function ChannelSections({ channelId }: ChannelSectionsProps) {
  const { t } = useLanguage();
  const { canEditLayout } = useChannelViewer();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    listChannelSectionsPopulated(channelId)
      .then((sections) => {
        if (cancelled) return;
        if (!sections) {
          logger.error('ChannelSections: sections response was not usable', { channelId });
          setState({ status: 'failed' });
          return;
        }
        setState({ status: 'ready', sections: sections as PopulatedChannelSection[] });
      })
      .catch((error) => {
        logger.error('ChannelSections: loading sections failed', { channelId, error });
        if (!cancelled) setState({ status: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [channelId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

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

  if (state.sections.length === 0) return null;

  return (
    <div className="space-y-8" data-testid="channel-sections">
      {state.sections.map((section) => (
        <ChannelSectionRenderer key={section.id} section={section} channelId={channelId} />
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
