'use client';

/** What /[locale]/live gains with wiki E17: the event filter (while event tags are on) and the upcoming list. */
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { LIVE_EVENT_LABELS, LIVE_EVENT_TYPES, type LiveEventType, type LiveStream } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { PriorityStrip } from '@/components/ui/PriorityStrip';
import { useFeatures } from '@/hooks/useFeatures';
import { useLanguage } from '@/hooks/useLanguage';
import { useLiveStreams } from '@/hooks/useLiveStreams';

/** The chosen tag. Forgotten when event tags are turned off. */
export function useLiveEventFilter(): { enabled: boolean; eventType: LiveEventType | undefined; choose: (value: LiveEventType | undefined) => void } {
  const enabled = useFeatures().features.liveEvents;
  const [chosen, choose] = useState<LiveEventType | undefined>();
  return { enabled, eventType: enabled ? chosen : undefined, choose };
}

export function LiveEventFilter({ value, onChange }: { value: LiveEventType | undefined; onChange: (value: LiveEventType | undefined) => void }) {
  const { t, lang, isRTL } = useLanguage();
  const items = [undefined, ...LIVE_EVENT_TYPES].map((type) => ({ id: type ?? 'all', type, label: type ? LIVE_EVENT_LABELS[type][lang] : t.liveWatch.eventAll, current: value === type }));
  return (
    <PriorityStrip
      items={items}
      testId="live-event-strip"
      className="mb-6"
      moreIsButton
      moreLabel={t.liveWatch.eventMore}
      menuLabel={t.liveWatch.eventMoreMenu}
      onSelect={(item) => onChange(item.type)}
      rowProps={{ role: 'group', 'aria-label': t.liveWatch.eventFilter, 'data-testid': 'live-event-filter', dir: isRTL ? 'rtl' : 'ltr', className: 'flex gap-2' }}
      renderItem={(item) => (
        <Button key={item.id} type="button" size="sm" variant={item.current ? 'default' : 'outline'} aria-pressed={item.current} data-testid={`live-event-${item.id}`} onClick={() => onChange(item.type)}>
          {item.label}
        </Button>
      )}
    />
  );
}

/** Streams read to find the first with a time to come. */
const LOOK_AHEAD = 150;

type Card = ComponentType<{ stream: LiveStream; onPlay: () => void }>;

/** Streams and premieres with a time to come, the next first. Nothing while there are none. */
export function UpcomingLive({ eventType, card: CardView, grid: Grid, onOpen }: { eventType?: LiveEventType; card: Card; grid: ComponentType<{ children: ReactNode }>; onOpen: (id: string) => void }) {
  const { t } = useLanguage();
  const { features } = useFeatures();
  const enabled = features.livePremieres || features.liveReminders || features.liveEvents;
  const { streams, hasNextPage, fetchNextPage, isFetchingNextPage } = useLiveStreams({ status: 'scheduled', eventType, limit: 50, enabled, refetchInterval: 60_000 });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const coming = streams
    .filter((s) => s.scheduledStartTime && s.scheduledStartTime.getTime() > now)
    .sort((a, b) => a.scheduledStartTime!.getTime() - b.scheduledStartTime!.getTime());
  // The list is newest first and holds streams without a time: look a little further before giving up
  const empty = !coming.length;
  useEffect(() => {
    if (enabled && empty && hasNextPage && !isFetchingNextPage && streams.length < LOOK_AHEAD) void fetchNextPage();
  }, [enabled, empty, hasNextPage, isFetchingNextPage, streams.length, fetchNextPage]);
  if (!enabled || empty) return null;
  return (
    <section className="mt-10" aria-labelledby="live-upcoming" data-testid="live-upcoming">
      <h2 id="live-upcoming" className="mb-4 text-xl font-semibold text-foreground">{t.liveWatch.upcoming}</h2>
      <Grid>
        {coming.map((stream) => <CardView key={stream.id} stream={stream} onPlay={() => onOpen(stream.id)} />)}
      </Grid>
      {hasNextPage && (
        <div className="mt-6 text-center">
          <Button variant="outline" disabled={isFetchingNextPage} onClick={() => void fetchNextPage()} data-testid="live-upcoming-more">{t.liveWatch.showMore}</Button>
        </div>
      )}
    </section>
  );
}
