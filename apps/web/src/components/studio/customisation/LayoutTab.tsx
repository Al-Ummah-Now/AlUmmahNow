'use client';

import Link from '@/components/common/AppLink';
import { ExternalLink } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { channelPath } from '@/lib/channel-url';
import { cn } from '@/lib/utils';
import type { LayoutView } from '@/lib/studio/params';
import { SectionsView } from './SectionsView';
import { TabsView } from './TabsView';

/**
 * Customisation → Layout (spec §4.9): what visitors see on the channel page,
 * in two views chosen with `?view=sections|tabs`, each with a link to
 * preview the channel page.
 */
export function LayoutTab({ locale, channel, view }: { locale: string; channel: { id: string; handle?: string; userId?: string | null }; view: LayoutView }) {
  const { t } = useLanguage();
  const text = t.studio.layout;
  const base = `/${locale}/studio/${encodeURIComponent(channel.id)}/customisation/layout`;
  const views: Array<{ id: LayoutView; label: string }> = [
    { id: 'sections', label: text.sections },
    { id: 'tabs', label: text.tabs },
  ];

  return (
    <div className="max-w-4xl space-y-6" data-testid="studio-layout" data-view={view}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={text.viewsLabel} className="inline-flex rounded-lg border border-border bg-muted p-1">
          {views.map((item) => (
            <Link
              key={item.id}
              href={`${base}?view=${item.id}`}
              aria-current={item.id === view ? 'page' : undefined}
              data-testid={`studio-layout-view-${item.id}`}
              className={cn(
                'flex min-h-11 items-center rounded-md px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                item.id === view ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Link
          href={channelPath(locale, channel)}
          target="_blank"
          rel="noopener"
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[var(--fanous-color-link)] underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="studio-layout-preview"
        >
          <ExternalLink aria-hidden="true" className="h-4 w-4" />
          {text.preview}
        </Link>
      </div>
      {view === 'tabs' ? <TabsView channelId={channel.id} /> : <SectionsView channelId={channel.id} ownerId={channel.userId ?? null} />}
    </div>
  );
}
