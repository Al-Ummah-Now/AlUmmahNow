/** What a stream is beside its status (wiki E17): a premiere, and its event tag. Nothing for a plain live stream. */
import { LIVE_EVENT_LABELS, LIVE_WATCH_AR, LIVE_WATCH_EN, isLiveEventType, type LiveEventType, type LiveStreamKind } from '@al-ummah/shared-types';
import { Badge } from '@/components/ui/badge';

export function LiveKindBadges({ kind, eventType, lang }: { kind?: LiveStreamKind; eventType?: LiveEventType | null; lang: 'en' | 'ar' }) {
  const tag = isLiveEventType(eventType) ? LIVE_EVENT_LABELS[eventType][lang] : null;
  if (kind !== 'premiere' && !tag) return null;
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="live-kind-badges">
      {kind === 'premiere' && <Badge variant="outline">{(lang === 'ar' ? LIVE_WATCH_AR : LIVE_WATCH_EN).premiere}</Badge>}
      {tag && <Badge variant="outline" data-testid="live-event-badge" data-event={eventType ?? undefined}>{tag}</Badge>}
    </div>
  );
}
